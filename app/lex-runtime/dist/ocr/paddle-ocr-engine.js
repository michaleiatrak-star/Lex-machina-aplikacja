import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evidenceBudget, ocrWorkerFailure, readOcrPages } from "./ocr-result.js";
import { fileURLToPath } from "node:url";
import { documentWork } from "../document-work.js";
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
    }
    async recognizePages(data, pages, onPage) {
        if (pages.length === 0)
            return [];
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lex-paddle-ocr-"));
        const input = path.join(tempRoot, "document.pdf");
        try {
            await writeFile(input, data);
            // Long scans run as consecutive worker passes of OCR_BATCH_PAGES pages:
            // each pass has its own timeout and evidence directory, and page images
            // share one byte budget for the whole document.
            const budget = evidenceBudget();
            const results = [];
            for (let start = 0; start < pages.length; start += OCR_BATCH_PAGES) {
                const batch = pages.slice(start, start + OCR_BATCH_PAGES);
                // Background OCR: no new pass while the user's own document is being worked on.
                if (documentWork.inBackground())
                    await documentWork.idle();
                const parsed = await this.recognizeBatch(input, path.join(tempRoot, `batch-${start / OCR_BATCH_PAGES + 1}`), batch, budget, onPage ? (done) => onPage(start + done) : undefined);
                results.push(...parsed);
                // Evidence files are read into the result; free the disk as we go.
                await rm(path.join(tempRoot, `batch-${start / OCR_BATCH_PAGES + 1}`), {
                    recursive: true,
                    force: true
                });
            }
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
    async recognizeBatch(input, batchDir, pages, budget, onPage) {
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
        return readOcrPages(JSON.parse(await readFile(output, "utf8")), path.join(batchDir, "evidence"), budget);
    }
}
