import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ocrWorkerFailure, readOcrPages } from "./ocr-result.js";
import { fileURLToPath } from "node:url";
import type {
  ImageOcrEngine,
  SupportedImageMediaType
} from "../image-ingestion.js";
import type {
  OcrPageResult
} from "../document-ingestion.js";
import type { OcrAccelEnvironment } from "./ocr-acceleration.js";
import { ocrServePool } from "./ocr-serve-pool.js";

export type LocalPaddleImageOcrOptions = {
  python?: string;
  workerPath?: string;
  device?: string;
  timeoutMs?: number;
  // Line images for the local vision model; asked for only when the model is installed.
  lineCrops?: () => boolean;
  // The graphics card when it is on here (ocr-acceleration.ts), as for PDF scans.
  acceleration?: () => OcrAccelEnvironment | null;
  // A long-lived worker with the models loaded (ocr-serve-pool.ts), shared with PDF pages.
  persistent?: boolean;
};

function defaultWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(
    here,
    "../../../ocr/paddle_worker.py"
  );
}

const EXTENSION: Record<
  SupportedImageMediaType,
  string
> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/tiff": ".tiff"
};

export class LocalPaddleImageOcrEngine
implements ImageOcrEngine {
  private readonly python: string;
  private readonly workerPath: string;
  private readonly device: string | undefined;
  private readonly timeoutMs: number;
  private readonly lineCrops: () => boolean;
  private readonly acceleration: () => OcrAccelEnvironment | null;
  private readonly persistent: boolean;

  constructor(
    options: LocalPaddleImageOcrOptions = {}
  ) {
    this.python =
      options.python ??
      process.env.LEX_OCR_PYTHON ??
      "python3";
    this.workerPath =
      options.workerPath ??
      process.env.LEX_OCR_WORKER ??
      defaultWorkerPath();
    this.device =
      (
        options.device ??
        process.env.LEX_OCR_DEVICE?.trim()
      ) || undefined;
    this.timeoutMs =
      options.timeoutMs ?? 10 * 60 * 1000;
    this.lineCrops = options.lineCrops ?? (() => false);
    this.acceleration = options.acceleration ?? (() => null);
    this.persistent = (options.persistent ?? false) && process.env.LEX_OCR_PERSISTENT !== "off";
  }

  async recognizeImage(
    data: Uint8Array,
    mediaType: SupportedImageMediaType
  ): Promise<OcrPageResult> {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "lex-paddle-image-")
    );
    const input = path.join(
      tempRoot,
      "image" + EXTENSION[mediaType]
    );
    const output = path.join(
      tempRoot,
      "result.json"
    );

    const acceleration = this.acceleration();
    try {
      await writeFile(input, data);
      const args = [
        this.workerPath,
        "--input",
        input,
        "--output",
        output,
        "--mode",
        "image",
        "--pages",
        "1",
        "--lang",
        "pl",
        "--evidence-dir",
        path.join(tempRoot, "evidence")
      ];
      if (this.device) {
        args.push("--device", this.device);
      }
      if (this.lineCrops()) {
        args.push("--line-crops");
      }

      if (this.persistent) {
        await this.recognizeServed(input, output, path.join(tempRoot, "evidence"), acceleration);
      } else await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.python,
          args,
          {
            stdio: ["ignore", "ignore", "pipe"],
            env: {
              ...process.env,
              PYTHONUNBUFFERED: "1",
              // Photos and image scans on the card too: before, the worker got no card
              // settings and read every image on the processor.
              ...(acceleration ? acceleration.env : { LEX_OCR_ACCEL: "off" })
            }
          }
        );
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(
            new Error(
              "OCR_ENGINE_TIMEOUT: Local PaddleOCR image worker exceeded the configured timeout."
            )
          );
        }, this.timeoutMs);

        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString("utf8");
          if (stderr.length > 32_000) {
            stderr = stderr.slice(-32_000);
          }
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(new Error(`OCR_ENGINE_START_FAILED: ${error.message}`));
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else {
            reject(ocrWorkerFailure(stderr, code, "image worker"));
          }
        });
      });

      const parsed = await readOcrPages(
        JSON.parse(await readFile(output, "utf8")) as unknown[],
        path.join(tempRoot, "evidence")
      );

      if (
        parsed.length !== 1 ||
        parsed[0]?.page !== 1
      ) {
        throw new Error(
          "OCR_ENGINE_INVALID_RESULT: Local PaddleOCR image worker returned an invalid result set."
        );
      }

      return parsed[0];
    } finally {
      await rm(tempRoot, {
        recursive: true,
        force: true
      });
    }
  }

  /** One image on a long-lived worker: no model loading per photo. */
  private async recognizeServed(input: string, output: string, evidenceDir: string, acceleration: OcrAccelEnvironment | null): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      ...(acceleration ? acceleration.env : { LEX_OCR_ACCEL: "off" })
    };
    delete env.LEX_OCR_PAUSE_FILE;
    // The same key as a PDF pass with all cores: an image reuses that worker's models.
    const key = JSON.stringify({ python: this.python, worker: this.workerPath, threads: null, accel: acceleration?.env ?? null, device: this.device ?? null });
    let stderr = "";
    const run = ocrServePool.run({
      key,
      python: this.python,
      workerArgs: [this.workerPath, "--serve"],
      env,
      job: {
        input,
        output,
        pages: "1",
        lang: "pl",
        ...(this.device ? { device: this.device } : {}),
        evidenceDir,
        lineCrops: this.lineCrops(),
        mode: "image",
        pauseFile: ""
      },
      onStderr: (text) => {
        stderr = (stderr + text).slice(-32_000);
      }
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      run.kill();
    }, this.timeoutMs);
    try {
      await run.done;
    } catch (error) {
      if (timedOut) throw new Error("OCR_ENGINE_TIMEOUT: Local PaddleOCR image worker exceeded the configured timeout.");
      throw ocrWorkerFailure(stderr, (error as { exitCode?: number | null }).exitCode ?? 1, "image worker");
    } finally {
      clearTimeout(timer);
    }
  }
}
