import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * A long-running Python worker answering one JSON line per request ({"id", "text"} ->
 * {"id", "spans"} or {"id", "error"}) after a {"ready": true} line. Requests go one at
 * a time; a stuck worker is killed and a fresh one starts at the next request. A worker
 * that cannot start at all throws WorkerStartError, so the caller falls back to one
 * process per text.
 */
export class WorkerStartError extends Error {}

type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };

export class JsonLineWorker<T> {
  private worker: { child: ChildProcessWithoutNullStreams; ready: Promise<void>; pending: Map<number, Pending<T>> } | null = null;
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly name: string,
    private readonly python: string,
    private readonly args: string[],
    private readonly startTimeoutMs: number,
    private readonly requestTimeoutMs: number
  ) {}

  close(): void {
    this.worker?.child.kill();
    this.worker = null;
  }

  ask(text: string): Promise<T> {
    const run = this.queue.then(async () => {
      const worker = this.start();
      await worker.ready;
      return this.send(worker, text);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  private start(): NonNullable<JsonLineWorker<T>["worker"]> {
    if (this.worker) return this.worker;
    const child = spawn(this.python, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: "1" }
    });
    const pending = new Map<number, Pending<T>>();
    let stderr = "";
    let buffered = "";
    let started = false;
    let markReady!: () => void;
    let failStart!: (error: Error) => void;
    const ready = new Promise<void>((resolve, reject) => {
      markReady = resolve;
      failStart = reject;
    });
    // A rejected start nobody waits for yet must not be an unhandled rejection.
    ready.catch(() => undefined);
    const startTimer = setTimeout(() => {
      failStart(new WorkerStartError(`${this.name} worker did not start in time.`));
      child.kill("SIGKILL");
    }, this.startTimeoutMs);
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
        let message: { ready?: boolean; id?: number; spans?: T; error?: string };
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
        if (message.error !== undefined) entry.reject(new Error(`${this.name} worker failed: ${message.error}`));
        else entry.resolve(message.spans as T);
      }
    });
    child.once("error", (error) => fail(error));
    child.once("exit", (code) => fail(new Error(`${this.name} worker exited with code ${code}: ${stderr.trim().slice(-2_000)}`)));
    this.worker = { child, ready, pending };
    return this.worker;
  }

  private send(worker: NonNullable<JsonLineWorker<T>["worker"]>, text: string): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.pending.delete(id);
        worker.child.kill("SIGKILL");
        reject(new Error(`${this.name.toUpperCase().replace(/\s+/g, "_")}_TIMEOUT`));
      }, this.requestTimeoutMs);
      worker.pending.set(id, { resolve, reject, timer });
      worker.child.stdin.write(JSON.stringify({ id, text }) + "\n");
    });
  }
}
