import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  NamedEntityRecognizer,
  PiiSpan
} from "./pseudonymizer.js";

export type LocalStanzaOptions = {
  python?: string;
  workerPath?: string;
  timeoutMs?: number;
  // false: one worker process per text (model loaded every time, ~8-10 s on CPU).
  persistent?: boolean;
  // A checked text once the model is loaded.
  requestTimeoutMs?: number;
};

type WorkerSpan = {
  start: number;
  end: number;
  value: string;
  confidence?: number;
};

function defaultWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(
    here,
    "../../../privacy/stanza_ner_worker.py"
  );
}

// The same text is checked several times in one turn (message, its history pass,
// auxiliary text): the answer of the same model for the same text is reused.
const CACHE_ENTRIES = 32;

/**
 * Stanza NER (Polish persons) in a Python worker. By default the worker stays alive
 * and keeps the model loaded: loading it costs ~8-10 s on CPU, a checked text after
 * that well under a second. A worker that cannot start falls back to one process per
 * text, as before; the result is the same model's either way.
 */
export class LocalStanzaNamedEntityRecognizer
implements NamedEntityRecognizer {
  private readonly python: string;
  private readonly workerPath: string;
  private readonly timeoutMs: number;
  private readonly requestTimeoutMs: number;
  private persistent: boolean;
  private worker: {
    child: ChildProcessWithoutNullStreams;
    ready: Promise<void>;
    pending: Map<number, { resolve: (spans: WorkerSpan[]) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>;
  } | null = null;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<string, WorkerSpan[]>();

  constructor(options: LocalStanzaOptions = {}) {
    this.python =
      options.python ??
      process.env.LEX_NER_PYTHON ??
      "python3";
    this.workerPath =
      options.workerPath ??
      process.env.LEX_NER_WORKER ??
      defaultWorkerPath();
    this.timeoutMs =
      options.timeoutMs ?? 10 * 60 * 1000;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? 2 * 60 * 1000;
    this.persistent =
      options.persistent ?? process.env.LEX_NER_PERSISTENT !== "0";
  }

  /** Loads the model in the background (server start), so no message waits for it. */
  warmUp(): void {
    if (!this.persistent) return;
    void this.recognize("Jan Kowalski").catch(() => undefined);
  }

  close(): void {
    this.worker?.child.kill();
    this.worker = null;
  }

  async recognize(text: string): Promise<PiiSpan[]> {
    if (!text.trim()) return [];
    const key = createHash("sha256").update(text).digest("hex");
    let spans = this.cache.get(key);
    if (spans) {
      this.cache.delete(key);
      this.cache.set(key, spans);
    } else {
      spans = this.persistent ? await this.viaWorker(text) : await this.oneShot(text);
      this.cache.set(key, spans);
      while (this.cache.size > CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    }
    return spans
      .filter(
        (span) =>
          Number.isInteger(span.start) &&
          Number.isInteger(span.end) &&
          span.start >= 0 &&
          span.end > span.start &&
          text.slice(span.start, span.end) === span.value
      )
      .map((span) => ({
        start: span.start,
        end: span.end,
        kind: "PERSON" as const,
        value: span.value,
        ...(span.confidence !== undefined
          ? { confidence: span.confidence }
          : {})
      }));
  }

  // One text at a time through the long-running worker.
  private viaWorker(text: string): Promise<WorkerSpan[]> {
    const run = this.queue.then(async () => {
      try {
        const worker = this.startWorker();
        await worker.ready;
        return await this.ask(worker, text);
      } catch (error) {
        // A worker that cannot start (no "--serve" support, Python missing) is not
        // retried on every message: one process per text from now on.
        if (error instanceof WorkerStartError) {
          this.persistent = false;
          process.stderr.write(`LOCAL_STANZA_PERSISTENT_UNAVAILABLE:${error.message.slice(0, 300)}\n`);
          return this.oneShot(text);
        }
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private startWorker(): NonNullable<LocalStanzaNamedEntityRecognizer["worker"]> {
    if (this.worker) return this.worker;
    const child = spawn(this.python, [this.workerPath, "--serve"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });
    const pending: NonNullable<LocalStanzaNamedEntityRecognizer["worker"]>["pending"] = new Map();
    let stderr = "";
    let buffered = "";
    let markReady!: () => void;
    let failStart!: (error: Error) => void;
    let started = false;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failStart = reject;
    });
    const startTimer = setTimeout(() => {
      failStart(new WorkerStartError("Local Stanza NER worker did not load the model in time."));
      child.kill("SIGKILL");
    }, this.timeoutMs);
    const fail = (error: Error) => {
      clearTimeout(startTimer);
      if (this.worker?.child === child) this.worker = null;
      if (!started) failStart(new WorkerStartError(error.message));
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    };
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-32_000);
    });
    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      let newline = buffered.indexOf("\n");
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
        if (!line) continue;
        let message: { ready?: boolean; id?: number; spans?: WorkerSpan[]; error?: string };
        try {
          message = JSON.parse(line) as typeof message;
        } catch {
          continue;
        }
        if (message.ready) {
          started = true;
          clearTimeout(startTimer);
          markReady();
          continue;
        }
        const entry = message.id !== undefined ? pending.get(message.id) : undefined;
        if (!entry) continue;
        pending.delete(message.id!);
        clearTimeout(entry.timer);
        if (message.error !== undefined) entry.reject(new Error(`Local Stanza NER worker failed: ${message.error}`));
        else entry.resolve(Array.isArray(message.spans) ? message.spans : []);
      }
    });
    child.once("error", (error) => fail(error));
    child.once("exit", (code) => fail(new Error(`Local Stanza NER worker exited with code ${code}: ${stderr.trim().slice(-2_000)}`)));
    this.worker = { child, ready, pending };
    return this.worker;
  }

  private ask(worker: NonNullable<LocalStanzaNamedEntityRecognizer["worker"]>, text: string): Promise<WorkerSpan[]> {
    const id = this.nextId++;
    return new Promise<WorkerSpan[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.pending.delete(id);
        // A stuck worker is replaced by a fresh one at the next text.
        worker.child.kill("SIGKILL");
        reject(new Error("Local Stanza NER worker exceeded the configured timeout."));
      }, this.requestTimeoutMs);
      worker.pending.set(id, { resolve, reject, timer });
      worker.child.stdin.write(JSON.stringify({ id, text }) + "\n");
    });
  }

  private async oneShot(text: string): Promise<WorkerSpan[]> {
    const tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "lex-stanza-ner-")
    );
    const input = path.join(tempRoot, "input.txt");
    const output = path.join(tempRoot, "result.json");

    try {
      await writeFile(input, text, "utf8");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.python,
          [
            this.workerPath,
            "--input",
            input,
            "--output",
            output
          ],
          {
            stdio: ["ignore", "ignore", "pipe"],
            env: {
              ...process.env,
              PYTHONUNBUFFERED: "1"
            }
          }
        );
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(
            new Error(
              "Local Stanza NER worker exceeded the configured timeout."
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
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else {
            reject(
              new Error(
                `Local Stanza NER worker failed with exit code ${code}: ${stderr.trim()}`
              )
            );
          }
        });
      });

      return JSON.parse(
        await readFile(output, "utf8")
      ) as WorkerSpan[];
    } finally {
      await rm(tempRoot, {
        recursive: true,
        force: true
      });
    }
  }
}

class WorkerStartError extends Error {}
