import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lastOcrRunStats, type OcrRunStats } from "./paddle-ocr-engine.js";
import { downloadVerified, sizeOf, type FetchLike, type VerifiedFile } from "../verified-download.js";

/**
 * OCR on the graphics card of any vendor (app/ocr/onnx_accel.py): the PaddleOCR networks
 * converted to ONNX run in ONNX Runtime with DirectML on Windows (NVIDIA, AMD, Intel: any
 * DirectX 12 card) or CoreML on Apple Silicon (GPU and Neural Engine). Everything around the
 * networks stays as on the processor.
 *
 * Nothing is assumed about the card: after the download the app reads the same pages both ways
 * on this computer and turns the card on only when it was faster and read the same text.
 */

export type OcrAccelProvider = "dml" | "coreml";

// Converted by .github/workflows/ocr-onnx-models.yml (paddle2onnx 2.1.0, opset 14, the
// official PaddleX models the installer downloads); the conversion is deterministic.
const MODELS_RELEASE = "https://github.com/michaleiatrak-star/lex-machina-aplikacja/releases/download/ocr-onnx-v1";
export const OCR_ACCEL_MODELS: VerifiedFile[] = [
  { filename: "PP-OCRv6_medium_det.onnx", bytes: 62119542, sha256: "363bff8850064024234760b29543d113354221aa336327e107f2530f263f5b09" },
  { filename: "PP-OCRv6_medium_rec.onnx", bytes: 76555610, sha256: "d586cb851b35391d1dda84ff6ff387752ba25ec1ad79a9ad7ea60b1e44765c1b" },
  { filename: "latin_PP-OCRv5_mobile_rec.onnx", bytes: 8064539, sha256: "995b0f5f28d2073896a78c03b5b863eae6af3744bafa0245b8522beea6994927" },
  { filename: "PP-LCNet_x1_0_doc_ori.onnx", bytes: 6783057, sha256: "881d7103e2fafdeaaa9e949504025591b021a84b7373db1e27bb42e9180ed7d0" }
].map((file) => ({ ...file, url: `${MODELS_RELEASE}/${file.filename}` }));

// Windows: the DirectML build of ONNX Runtime, unpacked into its own folder (the CPU build the
// transcription uses stays installed; both are the "onnxruntime" module).
export const DIRECTML_RUNTIME: VerifiedFile = {
  filename: "onnxruntime_directml-1.24.4-cp313-cp313-win_amd64.whl",
  url: "https://files.pythonhosted.org/packages/60/53/2bd2696fac19cf8ca55496a0bcfe431f3aff9579eabbb0e231dc238acf6f/onnxruntime_directml-1.24.4-cp313-cp313-win_amd64.whl",
  bytes: 25112253,
  sha256: "2f1031cb2281e5b27cca9efe0b9399317c7286e4d226f7a79d4ab79bbd94d19e"
};

// The card counts as faster when it takes at most this share of the processor's time.
export const OCR_ACCEL_MIN_GAIN = 0.85;
// Lines (whitespace ignored) that must read the same as on the processor.
export const OCR_ACCEL_MIN_SAME_LINES = 0.95;
// Worker processes sharing one card.
export const OCR_ACCEL_MAX_WORKERS = 3;
const BENCHMARK_PAGES = [1, 2, 3, 4];

export function ocrAccelProvider(platform: string = process.platform, arch: string = process.arch): OcrAccelProvider | null {
  if (platform === "win32" && arch === "x64") return "dml";
  // The macOS build of ONNX Runtime with CoreML is installed for Apple Silicon only.
  if (platform === "darwin" && arch === "arm64") return "coreml";
  return null;
}

export type OcrAccelBenchmark = {
  provider: OcrAccelProvider;
  cpuSeconds: number;
  accelSeconds: number;
  lines: number;
  sameLines: number;
  accepted: boolean;
  reason: "FASTER_SAME_TEXT" | "NOT_FASTER" | "TEXT_DIFFERS" | "ACCEL_NOT_USED";
  measuredAt: string;
};

/** Line by line, whitespace ignored (the card may set a space differently, never a letter). */
export function compareReadings(cpu: string[], accel: string[]): { lines: number; same: number } {
  const split = (pages: string[]) => pages.join("\n").split("\n").map((line) => line.replace(/\s+/gu, "")).filter(Boolean);
  const a = split(cpu);
  const b = split(accel);
  const lines = Math.max(a.length, b.length);
  let same = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) if (a[index] === b[index]) same += 1;
  return { lines, same };
}

export function judgeBenchmark(args: {
  provider: OcrAccelProvider;
  cpu: { seconds: number; pages: string[] };
  accel: { seconds: number; pages: string[]; used: boolean };
  now?: Date;
}): OcrAccelBenchmark {
  const { lines, same } = compareReadings(args.cpu.pages, args.accel.pages);
  const sameText = lines > 0 && same / lines >= OCR_ACCEL_MIN_SAME_LINES;
  const faster = args.accel.seconds <= args.cpu.seconds * OCR_ACCEL_MIN_GAIN;
  const reason: OcrAccelBenchmark["reason"] = !args.accel.used ? "ACCEL_NOT_USED" : !sameText ? "TEXT_DIFFERS" : !faster ? "NOT_FASTER" : "FASTER_SAME_TEXT";
  return {
    provider: args.provider,
    cpuSeconds: Math.round(args.cpu.seconds * 10) / 10,
    accelSeconds: Math.round(args.accel.seconds * 10) / 10,
    lines,
    sameLines: same,
    accepted: reason === "FASTER_SAME_TEXT",
    reason,
    measuredAt: (args.now ?? new Date()).toISOString()
  };
}

/** What the OCR worker gets when the card is on. */
export type OcrAccelEnvironment = { env: Record<string, string>; maxWorkers: number };

/** One reading of the benchmark document: seconds, page texts, whether the card was used. */
export type OcrAccelReader = (
  data: Uint8Array,
  pages: number[],
  acceleration: OcrAccelEnvironment | null
) => Promise<{ seconds: number; pages: string[]; used: boolean }>;

export type OcrAccelStatus = {
  supported: boolean;
  provider: OcrAccelProvider | null;
  bytes: number;
  installed: boolean;
  active: boolean;
  state: "IDLE" | "DOWNLOADING" | "MEASURING" | "FAILED";
  progress: { file: string; received: number; total: number; percent: number } | null;
  benchmark: OcrAccelBenchmark | null;
  // The last OCR pass of a document on this computer (time per page, oneDNN, threads).
  lastRun: OcrRunStats | null;
  error?: string;
};

function benchmarkFixture(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../ocr/fixtures/ocr-benchmark.pdf");
}

/** Unpacks a wheel (a ZIP) with the runtime's Python into `target`. */
function unpackWheel(python: string, wheel: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ["-I", "-c", "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", wheel, target], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let err = "";
    child.stderr.on("data", (chunk: Buffer) => (err = (err + chunk.toString("utf8")).slice(-2000)));
    child.once("error", (error) => reject(new Error(`OCR_ACCEL_UNPACK_FAILED:${error.message}`)));
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`OCR_ACCEL_UNPACK_FAILED:${err.trim().split("\n").at(-1) ?? code}`))));
  });
}

export class OcrAccelerationManager {
  readonly provider: OcrAccelProvider | null;
  private job: { state: OcrAccelStatus["state"]; progress: OcrAccelStatus["progress"]; error?: string } = { state: "IDLE", progress: null };
  private readonly python: string;
  private readonly fixture: string;
  reader: OcrAccelReader | null = null;

  constructor(
    readonly dir: string,
    options: { platform?: string; arch?: string; python?: string; fixture?: string } = {}
  ) {
    this.provider = ocrAccelProvider(options.platform, options.arch);
    this.python = options.python ?? process.env.LEX_OCR_PYTHON ?? "python3";
    this.fixture = options.fixture ?? benchmarkFixture();
  }

  private get modelDir(): string {
    return path.join(this.dir, "models");
  }

  private get runtimeDir(): string {
    return path.join(this.dir, "onnxruntime-directml");
  }

  private get recordPath(): string {
    return path.join(this.dir, "ocr-acceleration.json");
  }

  private files(): VerifiedFile[] {
    return this.provider === "dml" ? [...OCR_ACCEL_MODELS, DIRECTML_RUNTIME] : [...OCR_ACCEL_MODELS];
  }

  private record(): { files?: Record<string, string>; benchmark?: OcrAccelBenchmark } | null {
    try {
      return JSON.parse(fs.readFileSync(this.recordPath, "utf8")) as { files?: Record<string, string>; benchmark?: OcrAccelBenchmark };
    } catch {
      return null;
    }
  }

  private writeRecord(content: object): void {
    fs.writeFileSync(`${this.recordPath}.tmp`, `${JSON.stringify(content, null, 2)}\n`);
    fs.renameSync(`${this.recordPath}.tmp`, this.recordPath);
  }

  installed(): boolean {
    if (!this.provider) return false;
    const record = this.record();
    const models = OCR_ACCEL_MODELS.every(
      (file) => record?.files?.[file.filename] === file.sha256 && sizeOf(path.join(this.modelDir, file.filename)) === file.bytes
    );
    const runtime =
      this.provider !== "dml" ||
      (record?.files?.[DIRECTML_RUNTIME.filename] === DIRECTML_RUNTIME.sha256 && fs.existsSync(path.join(this.runtimeDir, "onnxruntime", "__init__.py")));
    return models && runtime;
  }

  private environmentFor(): OcrAccelEnvironment {
    return {
      env: {
        LEX_OCR_ACCEL: this.provider!,
        LEX_OCR_ONNX_DIR: this.modelDir,
        ...(this.provider === "dml" ? { LEX_OCR_ORT_DIR: this.runtimeDir } : {})
      },
      maxWorkers: OCR_ACCEL_MAX_WORKERS
    };
  }

  /** The worker environment while the card is on (installed and measured faster here). */
  environment(): OcrAccelEnvironment | null {
    if (!this.installed()) return null;
    const benchmark = this.record()?.benchmark;
    return benchmark?.accepted && benchmark.provider === this.provider ? this.environmentFor() : null;
  }

  status(): OcrAccelStatus {
    const installed = this.installed();
    return {
      supported: this.provider !== null,
      provider: this.provider,
      bytes: this.files().reduce((sum, file) => sum + file.bytes, 0),
      installed,
      active: this.environment() !== null,
      state: this.job.state,
      progress: this.job.progress ? { ...this.job.progress } : null,
      benchmark: installed ? (this.record()?.benchmark ?? null) : null,
      lastRun: lastOcrRunStats(),
      ...(this.job.error ? { error: this.job.error } : {})
    };
  }

  private busy(): boolean {
    return this.job.state === "DOWNLOADING" || this.job.state === "MEASURING";
  }

  /** Downloads what is missing, then measures. The status reports the progress. */
  start(fetchImpl?: FetchLike): Promise<void> {
    if (!this.provider) throw new Error("OCR_ACCEL_UNSUPPORTED");
    if (this.busy()) throw new Error("OCR_ACCEL_IN_PROGRESS");
    this.job = { state: "DOWNLOADING", progress: null };
    return this.install(fetchImpl)
      .then(() => this.runMeasure())
      .then(
        () => {
          this.job = { state: "IDLE", progress: null };
        },
        (error: unknown) => {
          this.job = { state: "FAILED", progress: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
        }
      );
  }

  /** Measures again (after a driver or card change). */
  measure(): Promise<void> {
    if (!this.installed()) throw new Error("OCR_ACCEL_NOT_INSTALLED");
    if (this.busy()) throw new Error("OCR_ACCEL_IN_PROGRESS");
    return this.runMeasure().then(
      () => {
        this.job = { state: "IDLE", progress: null };
      },
      (error: unknown) => {
        this.job = { state: "FAILED", progress: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
      }
    );
  }

  private async install(fetchImpl?: FetchLike): Promise<void> {
    if (this.installed()) return;
    fs.mkdirSync(this.modelDir, { recursive: true });
    fs.rmSync(this.recordPath, { force: true });
    const progress = (value: { file: string; received: number; total: number }) => {
      this.job.progress = { ...value, percent: Math.min(100, Math.floor((value.received / Math.max(1, value.total)) * 100)) };
    };
    for (const file of OCR_ACCEL_MODELS) {
      await downloadVerified(file, path.join(this.modelDir, file.filename), "OCR_ACCEL", progress, fetchImpl);
    }
    if (this.provider === "dml") {
      const wheel = path.join(this.dir, DIRECTML_RUNTIME.filename);
      await downloadVerified(DIRECTML_RUNTIME, wheel, "OCR_ACCEL", progress, fetchImpl);
      fs.rmSync(this.runtimeDir, { recursive: true, force: true });
      await unpackWheel(this.python, wheel, this.runtimeDir);
      fs.rmSync(wheel, { force: true });
    }
    this.writeRecord({
      schemaVersion: 1,
      provider: this.provider,
      installedAt: new Date().toISOString(),
      files: Object.fromEntries(this.files().map((file) => [file.filename, file.sha256]))
    });
  }

  private async runMeasure(): Promise<void> {
    if (!this.reader) throw new Error("OCR_ACCEL_READER_MISSING");
    this.job = { state: "MEASURING", progress: null };
    const data = new Uint8Array(fs.readFileSync(this.fixture));
    const cpu = await this.reader(data, BENCHMARK_PAGES, null);
    const accel = await this.reader(data, BENCHMARK_PAGES, this.environmentFor());
    const benchmark = judgeBenchmark({ provider: this.provider!, cpu, accel });
    this.writeRecord({ ...(this.record() ?? {}), benchmark });
  }

  remove(): void {
    if (this.busy()) throw new Error("OCR_ACCEL_IN_PROGRESS");
    fs.rmSync(this.dir, { recursive: true, force: true });
    this.job = { state: "IDLE", progress: null };
  }
}
