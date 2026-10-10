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
    worker = null;
    nextId = 1;
    queue = Promise.resolve();
    constructor(name, python, args, startTimeoutMs, requestTimeoutMs) {
        this.name = name;
        this.python = python;
        this.args = args;
        this.startTimeoutMs = startTimeoutMs;
        this.requestTimeoutMs = requestTimeoutMs;
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
            env: { ...process.env, PYTHONUNBUFFERED: "1" }
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
