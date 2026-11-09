import { spawn } from "node:child_process";
export class OcrServePool {
    idleMs;
    workers = [];
    nextId = 1;
    reaper = null;
    constructor(idleMs = Number(process.env.LEX_OCR_WORKER_IDLE_SECONDS ?? "180") * 1000) {
        this.idleMs = idleMs;
    }
    /** Workers alive now (tests, diagnostics). */
    get size() {
        return this.workers.length;
    }
    ensureReaper() {
        if (this.reaper)
            return;
        this.reaper = setInterval(() => this.reap(), 30_000);
        this.reaper.unref();
    }
    /** Closes workers idle for longer than idleMs. */
    reap(now = Date.now()) {
        for (const worker of [...this.workers]) {
            if (!worker.busy && now - worker.lastUsed >= this.idleMs)
                this.close(worker);
        }
    }
    close(worker) {
        const index = this.workers.indexOf(worker);
        if (index >= 0)
            this.workers.splice(index, 1);
        try {
            worker.child.stdin.end();
        }
        catch {
            // Already gone.
        }
        worker.child.kill();
    }
    closeAll() {
        for (const worker of [...this.workers])
            this.close(worker);
    }
    start(key, python, args, env) {
        const child = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"], env, windowsHide: true });
        const worker = { key, child, busy: false, lastUsed: Date.now(), stdoutBuffer: "", onLine: null, onStderr: null, onExit: null };
        child.stdout.on("data", (chunk) => {
            worker.stdoutBuffer += chunk.toString("utf8");
            let at = worker.stdoutBuffer.indexOf("\n");
            while (at >= 0) {
                const line = worker.stdoutBuffer.slice(0, at).trim();
                worker.stdoutBuffer = worker.stdoutBuffer.slice(at + 1);
                // Libraries print to stdout as well: only the worker's own markers count.
                if (line.startsWith("LEX_OCR_"))
                    worker.onLine?.(line);
                at = worker.stdoutBuffer.indexOf("\n");
            }
        });
        child.stderr.on("data", (chunk) => worker.onStderr?.(chunk.toString("utf8")));
        child.once("error", () => worker.onExit?.(null));
        child.once("exit", (code) => {
            const index = this.workers.indexOf(worker);
            if (index >= 0)
                this.workers.splice(index, 1);
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
    run(args) {
        const worker = this.workers.find((item) => item.key === args.key && !item.busy && item.child.exitCode === null) ??
            this.start(args.key, args.python, args.workerArgs, args.env);
        worker.busy = true;
        const id = String(this.nextId++);
        let settle;
        const done = new Promise((resolve, reject) => (settle = { resolve, reject }));
        const finish = (error) => {
            worker.onLine = null;
            worker.onStderr = null;
            worker.onExit = null;
            worker.busy = false;
            worker.lastUsed = Date.now();
            if (error)
                settle.reject(error);
            else
                settle.resolve();
        };
        // stdout and stderr are separate pipes: the result line on stdout can come before the job's last
        // stderr lines (stats, last page). The job ends when both are in: the worker's "LEX_OCR_JOB_END <id>"
        // on stderr, or STDERR_GRACE_MS after the result for a worker that does not write it.
        let stderrEnded = false;
        let result = null;
        let grace = null;
        const complete = () => {
            if (!result)
                return;
            if (grace)
                clearTimeout(grace);
            grace = null;
            const outcome = result;
            result = null;
            finish(outcome.error);
        };
        const endMarker = new RegExp(`^LEX_OCR_JOB_END ${id}$`, "mu");
        let tail = "";
        worker.onStderr = (text) => {
            args.onStderr(text);
            // The marker can be split between two chunks.
            tail = (tail + text).slice(-512);
            if (endMarker.test(tail)) {
                stderrEnded = true;
                complete();
            }
        };
        worker.onLine = (line) => {
            const [marker, jobId, ...rest] = line.split(" ");
            if (jobId !== id)
                return;
            if (marker === "LEX_OCR_JOB_DONE")
                result = {};
            else if (marker === "LEX_OCR_JOB_FAILED")
                result = { error: Object.assign(new Error(`OCR_SERVE_JOB_FAILED:${rest.join(" ")}`), { exitCode: 1 }) };
            else
                return;
            if (stderrEnded)
                complete();
            else
                grace = setTimeout(complete, STDERR_GRACE_MS);
        };
        worker.onExit = (code) => {
            if (grace)
                clearTimeout(grace);
            grace = null;
            result = null;
            finish(Object.assign(new Error(`OCR_SERVE_WORKER_EXITED:${code ?? "error"}`), { exitCode: code }));
        };
        worker.child.stdin.write(`${JSON.stringify({ ...args.job, id })}\n`);
        return {
            done,
            kill: () => this.close(worker)
        };
    }
}
const STDERR_GRACE_MS = 2_000;
/** One pool for the whole runtime: PDF pages and images share the loaded models. */
export const ocrServePool = new OcrServePool();
process.once("exit", () => ocrServePool.closeAll());
