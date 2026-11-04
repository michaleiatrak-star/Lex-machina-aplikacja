import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Long-lived OCR workers (paddle_worker.py --serve): the models are loaded once per process
 * and each document is a job on its stdin, instead of a new process that loads them again
 * (measured on the user's machine: 2.4-11.6 s per document, also for a single photo).
 *
 * A worker serves one configuration (card or processor, its share of the cores); a worker
 * not used for `idleMs` is closed (each holds 1.5-3 GB of memory).
 */

export type OcrServeJob = Record<string, unknown>;

type Worker = {
  key: string;
  child: ChildProcessWithoutNullStreams;
  busy: boolean;
  lastUsed: number;
  stdoutBuffer: string;
  onLine: ((line: string) => void) | null;
  onStderr: ((text: string) => void) | null;
  onExit: ((code: number | null) => void) | null;
};

export type OcrServeRun = {
  /** Resolves when the worker reported the job done; rejects with the job's own reason. */
  done: Promise<void>;
  /** Ends the worker (timeout): the job rejects, the next job starts a new worker. */
  kill: () => void;
};

export class OcrServePool {
  private readonly workers: Worker[] = [];
  private nextId = 1;
  private reaper: NodeJS.Timeout | null = null;

  constructor(private readonly idleMs: number = Number(process.env.LEX_OCR_WORKER_IDLE_SECONDS ?? "180") * 1000) {}

  /** Workers alive now (tests, diagnostics). */
  get size(): number {
    return this.workers.length;
  }

  private ensureReaper(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => this.reap(), 30_000);
    this.reaper.unref();
  }

  /** Closes workers idle for longer than idleMs. */
  reap(now: number = Date.now()): void {
    for (const worker of [...this.workers]) {
      if (!worker.busy && now - worker.lastUsed >= this.idleMs) this.close(worker);
    }
  }

  private close(worker: Worker): void {
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    try {
      worker.child.stdin.end();
    } catch {
      // Already gone.
    }
    worker.child.kill();
  }

  closeAll(): void {
    for (const worker of [...this.workers]) this.close(worker);
  }

  private start(key: string, python: string, args: string[], env: NodeJS.ProcessEnv): Worker {
    const child = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true });
    const worker: Worker = { key, child, busy: false, lastUsed: Date.now(), stdoutBuffer: "", onLine: null, onStderr: null, onExit: null };
    child.stdout.on("data", (chunk: Buffer) => {
      worker.stdoutBuffer += chunk.toString("utf8");
      let at = worker.stdoutBuffer.indexOf("\n");
      while (at >= 0) {
        const line = worker.stdoutBuffer.slice(0, at).trim();
        worker.stdoutBuffer = worker.stdoutBuffer.slice(at + 1);
        // Libraries print to stdout as well: only the worker's own markers count.
        if (line.startsWith("LEX_OCR_")) worker.onLine?.(line);
        at = worker.stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => worker.onStderr?.(chunk.toString("utf8")));
    child.once("error", () => worker.onExit?.(null));
    child.once("exit", (code) => {
      const index = this.workers.indexOf(worker);
      if (index >= 0) this.workers.splice(index, 1);
      worker.onExit?.(code);
    });
    this.workers.push(worker);
    this.ensureReaper();
    return worker;
  }

  /**
   * One job on a free worker of this configuration (a new worker when all are busy).
   * `onStderr` gets the job's stderr (pages, stats, errors) as it comes.
   */
  run(args: { key: string; python: string; workerArgs: string[]; env: NodeJS.ProcessEnv; job: OcrServeJob; onStderr: (text: string) => void }): OcrServeRun {
    const worker =
      this.workers.find((item) => item.key === args.key && !item.busy && item.child.exitCode === null) ??
      this.start(args.key, args.python, args.workerArgs, args.env);
    worker.busy = true;
    const id = String(this.nextId++);
    let settle!: { resolve: () => void; reject: (error: Error) => void };
    const done = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
    const finish = (error?: Error) => {
      worker.onLine = null;
      worker.onStderr = null;
      worker.onExit = null;
      worker.busy = false;
      worker.lastUsed = Date.now();
      if (error) settle.reject(error);
      else settle.resolve();
    };
    worker.onStderr = args.onStderr;
    worker.onLine = (line) => {
      const [marker, jobId, ...rest] = line.split(" ");
      if (jobId !== id) return;
      if (marker === "LEX_OCR_JOB_DONE") finish();
      else if (marker === "LEX_OCR_JOB_FAILED") finish(Object.assign(new Error(`OCR_SERVE_JOB_FAILED:${rest.join(" ")}`), { exitCode: 1 }));
    };
    worker.onExit = (code) => finish(Object.assign(new Error(`OCR_SERVE_WORKER_EXITED:${code ?? "error"}`), { exitCode: code }));
    worker.child.stdin.write(`${JSON.stringify({ ...args.job, id })}\n`);
    return {
      done,
      kill: () => this.close(worker)
    };
  }
}

/** One pool for the whole runtime: PDF pages and images share the loaded models. */
export const ocrServePool = new OcrServePool();
process.once("exit", () => ocrServePool.closeAll());
