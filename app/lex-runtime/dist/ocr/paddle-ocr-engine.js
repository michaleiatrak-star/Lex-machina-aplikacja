import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evidenceBudget, ocrWorkerFailure, readOcrPages } from "./ocr-result.js";
import { fileURLToPath } from "node:url";
import { documentWork } from "../document-work.js";
// One PaddleOCR process scales poorly past a few CPU threads: on a long scan several processes,
// each with a share of the cores, read pages at once. Each loads its own models (about 1.5 GB),
// so an extra process needs free memory. Background OCR (files read ahead) stays at one process.
// Measured peak of one worker (PP-OCRv6 medium, the latin recognizer, folds and stamps): 3.2 GB.
export const OCR_WORKER_MEMORY_BYTES = 3.5 * 1024 ** 3;
export const OCR_PARALLEL_MIN_PAGES = 4;
export function ocrWorkerCount(args) {
    if (args.background || args.pages < OCR_PARALLEL_MIN_PAGES)
        return 1;
    const raw = args.requested ?? (args.env?.trim() && /^\d+$/u.test(args.env.trim()) ? Number(args.env.trim()) : undefined);
    const byMemory = Math.max(1, 1 + Math.floor(Math.max(0, args.freeMemory - OCR_WORKER_MEMORY_BYTES) / OCR_WORKER_MEMORY_BYTES));
    // Measured on 4 cores, 8 scanned pages: 1 process 160 s, 2 -> 127 s, 4 -> 107 s; the text is the
    // same with 1 or 4 threads a process. So one process a core, memory permitting.
    const byCpu = Math.max(1, args.cpus);
    const cap = Math.ceil(args.pages / 2);
    // Set by hand (LEX_OCR_WORKERS or the option): taken as it is, at most one worker per two pages.
    if (raw !== undefined)
        return Math.max(1, Math.min(raw, cap));
    return Math.max(1, Math.min(6, byCpu, byMemory, cap));
}
// Pages per worker pass (one pass = one process, one timeout).
export const OCR_BATCH_PAGES = 30;
const TIMEOUT_TICK_MS = 1_000;
function defaultWorkerPath() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "../../../ocr/paddle_worker.py");
}
export class LocalPaddleOcrEngine {
    python;
    workerPath;
    dpi;
    device;
    timeoutMs;
    lineCrops;
    workers;
    constructor(options = {}) {
        this.python =
            options.python ??
                process.env.LEX_OCR_PYTHON ??
                "python3";
        this.workerPath =
            options.workerPath ??
                process.env.LEX_OCR_WORKER ??
                defaultWorkerPath();
        // 220 dpi: on two real 152 dpi scans 300 dpi dropped spaces ("ul.Pukowca15", "art.270");
        // word accuracy 96.1% at 220 vs 95.9% at 300 (both without UVDoc).
        this.dpi = options.dpi ?? 220;
        this.device =
            (options.device ??
                process.env.LEX_OCR_DEVICE?.trim()) || undefined;
        this.timeoutMs =
            options.timeoutMs ?? 30 * 60 * 1000;
        this.lineCrops = options.lineCrops ?? (() => false);
        this.workers = options.workers;
    }
    async recognizePages(data, pages, onPage) {
        if (pages.length === 0)
            return [];
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lex-paddle-ocr-"));
        const input = path.join(tempRoot, "document.pdf");
        try {
            await writeFile(input, data);
            // Long scans run as worker passes of at most OCR_BATCH_PAGES pages: each pass has its own
            // timeout and evidence directory. With several workers the passes run at once; page images
            // are read into the result in page order afterwards, so the shared byte budget never
            // leaves a gap.
            const budget = evidenceBudget();
            const background = documentWork.inBackground();
            const workers = ocrWorkerCount({
                pages: pages.length,
                cpus: os.availableParallelism?.() ?? os.cpus().length,
                freeMemory: os.freemem(),
                env: process.env.LEX_OCR_WORKERS,
                ...(this.workers !== undefined ? { requested: this.workers } : {}),
                background
            });
            const size = workers > 1 ? Math.min(OCR_BATCH_PAGES, Math.ceil(pages.length / workers)) : OCR_BATCH_PAGES;
            const batches = [];
            for (let start = 0; start < pages.length; start += size)
                batches.push(pages.slice(start, start + size));
            const threads = workers > 1 && !process.env.LEX_OCR_THREADS?.trim()
                ? String(Math.max(1, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / workers)))
                : undefined;
            const done = batches.map(() => 0);
            const report = onPage ? () => onPage(done.reduce((sum, value) => sum + value, 0)) : undefined;
            const raw = [];
            const results = [];
            let next = 0;
            let read = 0;
            const dirOf = (index) => path.join(tempRoot, `batch-${index + 1}`);
            // Batches finished out of order wait here; the images are read strictly in page order.
            const drain = async () => {
                while (read < batches.length && raw[read]) {
                    results.push(...(await readOcrPages(raw[read], path.join(dirOf(read), "evidence"), budget)));
                    // Evidence files are read into the result; free the disk as we go.
                    await rm(dirOf(read), { recursive: true, force: true });
                    raw[read] = [];
                    read += 1;
                }
            };
            let draining = Promise.resolve();
            const lane = async () => {
                try {
                    await laneLoop();
                }
                catch (error) {
                    // A failed pass: the other lanes start no new pass (the document fails closed).
                    next = batches.length;
                    throw error;
                }
            };
            const laneLoop = async () => {
                while (next < batches.length) {
                    const index = next++;
                    // Background OCR: no new pass while the user's own document is being worked on.
                    if (documentWork.inBackground())
                        await documentWork.idle();
                    raw[index] = await this.recognizeBatch(input, dirOf(index), batches[index], report
                        ? (count) => {
                            done[index] = count;
                            report();
                        }
                        : undefined, threads);
                    draining = draining.then(drain);
                    await draining;
                }
            };
            await Promise.all(Array.from({ length: Math.min(workers, batches.length) }, lane));
            await draining;
            const requested = new Set(pages);
            const seen = new Set();
            for (const result of results) {
                if (!Number.isInteger(result.page) ||
                    !requested.has(result.page) ||
                    seen.has(result.page)) {
                    throw new Error("OCR_ENGINE_INVALID_RESULT: Local PaddleOCR worker returned an invalid page set.");
                }
                seen.add(result.page);
            }
            if (seen.size !== requested.size) {
                throw new Error("OCR_ENGINE_INVALID_RESULT: Local PaddleOCR worker did not account for every requested page.");
            }
            return results.sort((a, b) => a.page - b.page);
        }
        finally {
            await rm(tempRoot, {
                recursive: true,
                force: true
            });
        }
    }
    async recognizeBatch(input, batchDir, pages, onPage, threads) {
        await mkdir(batchDir, { recursive: true });
        const output = path.join(batchDir, "result.json");
        const args = [
            this.workerPath,
            "--input",
            input,
            "--output",
            output,
            "--pages",
            pages.join(","),
            "--lang",
            "pl",
            "--dpi",
            String(this.dpi),
            "--evidence-dir",
            path.join(batchDir, "evidence")
        ];
        if (this.device) {
            args.push("--device", this.device);
        }
        if (this.lineCrops()) {
            args.push("--line-crops");
        }
        // Background OCR waits between pages while the user's own document is worked on; the
        // time it waits does not count against the timeout.
        const background = documentWork.inBackground();
        await new Promise((resolve, reject) => {
            const child = spawn(this.python, args, {
                stdio: ["ignore", "ignore", "pipe"],
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: "1",
                    ...(threads ? { LEX_OCR_THREADS: threads } : {}),
                    ...(background ? { LEX_OCR_PAUSE_FILE: documentWork.pauseFile } : {})
                }
            });
            let stderr = "";
            let active = 0;
            const timer = setInterval(() => {
                if (!background || !documentWork.paused())
                    active += TIMEOUT_TICK_MS;
                if (active < this.timeoutMs)
                    return;
                clearInterval(timer);
                child.kill("SIGKILL");
                reject(new Error(`OCR_ENGINE_TIMEOUT: Local PaddleOCR worker exceeded the configured timeout (pages ${pages[0]}-${pages.at(-1)}).`));
            }, TIMEOUT_TICK_MS);
            let pagesDone = 0;
            child.stderr.on("data", (chunk) => {
                const text = chunk.toString("utf8");
                const finished = text.match(/^LEX_OCR_PAGE \d+$/gm)?.length ?? 0;
                if (finished && onPage) {
                    pagesDone += finished;
                    onPage(Math.min(pagesDone, pages.length));
                }
                stderr += text;
                if (stderr.length > 32_000) {
                    stderr = stderr.slice(-32_000);
                }
            });
            child.once("error", (error) => {
                clearInterval(timer);
                reject(new Error(`OCR_ENGINE_START_FAILED: ${error.message}`));
            });
            child.once("exit", (code) => {
                clearInterval(timer);
                if (code === 0)
                    resolve();
                else {
                    reject(ocrWorkerFailure(stderr, code, "worker"));
                }
            });
        });
        return JSON.parse(await readFile(output, "utf8"));
    }
}
