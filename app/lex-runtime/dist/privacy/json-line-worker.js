import { spawn } from "node:child_process";
/**
 * A long-running Python worker answering one JSON line per request ({"id", "text"} ->
 * {"id", "spans"} or {"id", "error"}) after a {"ready": true} line. Requests go one at
 * a time; a stuck worker is killed and a fresh one starts at the next request. A worker
 * that cannot start at all throws WorkerStartError, so the caller falls back to one
 * process per text.
 */
export class WorkerStartError extends Error {
}
export class JsonLineWorker {
    name;
    python;
    args;
    startTimeoutMs;
    requestTimeoutMs;
    env;
    worker = null;
    nextId = 1;
    queue = Promise.resolve();
    constructor(name, python, args, startTimeoutMs, requestTimeoutMs, env = {}) {
        this.name = name;
        this.python = python;
        this.args = args;
        this.startTimeoutMs = startTimeoutMs;
        this.requestTimeoutMs = requestTimeoutMs;
        this.env = env;
    }
    close() {
        this.worker?.child.kill();
        this.worker = null;
    }
    ask(text) {
        const run = this.queue.then(async () => {
            const worker = this.start();
            await worker.ready;
            return this.send(worker, text);
        });
        this.queue = run.catch(() => undefined);
        return run;
    }
    start() {
        if (this.worker)
            return this.worker;
        const child = spawn(this.python, this.args, {
            stdio: ["pipe", "pipe", "pipe"],
            windowsHide: true,
            env: { ...process.env, ...this.env, PYTHONUNBUFFERED: "1" }
        });
        const pending = new Map();
        let stderr = "";
        let buffered = "";
        let started = false;
        let markReady;
        let failStart;
        const ready = new Promise((resolve, reject) => {
            markReady = resolve;
            failStart = reject;
        });
        // A rejected start nobody waits for yet must not be an unhandled rejection.
        ready.catch(() => undefined);
        const startTimer = setTimeout(() => {
            failStart(new WorkerStartError(`${this.name} worker did not start in time.`));
            child.kill("SIGKILL");
        }, this.startTimeoutMs);
        const fail = (error) => {
            clearTimeout(startTimer);
            if (this.worker?.child === child)
                this.worker = null;
            if (!started)
                failStart(new WorkerStartError(error.message));
            for (const entry of pending.values()) {
                clearTimeout(entry.timer);
                entry.reject(error);
            }
            pending.clear();
        };
        child.stderr.on("data", (chunk) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-32_000);
        });
        child.stdout.on("data", (chunk) => {
            buffered += chunk.toString("utf8");
            let newline = buffered.indexOf("\n");
            while (newline >= 0) {
                const line = buffered.slice(0, newline).trim();
                buffered = buffered.slice(newline + 1);
                newline = buffered.indexOf("\n");
                if (!line)
                    continue;
                let message;
                try {
                    message = JSON.parse(line);
                }
                catch {
                    continue;
                }
                if (message.ready) {
                    started = true;
                    clearTimeout(startTimer);
                    markReady();
                    continue;
                }
                const entry = message.id !== undefined ? pending.get(message.id) : undefined;
                if (!entry)
                    continue;
                pending.delete(message.id);
                clearTimeout(entry.timer);
                if (message.error !== undefined)
                    entry.reject(new Error(`${this.name} worker failed: ${message.error}`));
                else
                    entry.resolve(message.spans);
            }
        });
        child.once("error", (error) => fail(error));
        child.once("exit", (code) => fail(new Error(`${this.name} worker exited with code ${code}: ${stderr.trim().slice(-2_000)}`)));
        this.worker = { child, ready, pending };
        return this.worker;
    }
    send(worker, text) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
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
/**
 * When to try the long-running worker again after it failed to start: a slow first start
 * (antivirus, a cold disk) must not turn every later page and file into a fresh Python
 * process for the rest of the session. Retried after a pause; given up after three failures.
 */
export class WorkerStartBackoff {
    pauseMs;
    maxFailures;
    failures = 0;
    retryAt = 0;
    constructor(pauseMs = 3 * 60 * 1000, maxFailures = 3) {
        this.pauseMs = pauseMs;
        this.maxFailures = maxFailures;
    }
    /** True while the worker may be used (never failed, or the pause after a failure is over). */
    usable(now = Date.now()) {
        return this.failures < this.maxFailures && now >= this.retryAt;
    }
    failed(now = Date.now()) {
        this.failures += 1;
        this.retryAt = now + this.pauseMs;
    }
    started() {
        this.failures = 0;
        this.retryAt = 0;
    }
}
