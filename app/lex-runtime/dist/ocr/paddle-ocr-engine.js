import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { evidenceBudget, readOcrPages } from "./ocr-result.js";
import { fileURLToPath } from "node:url";
// Pages per worker pass (one pass = one process, one timeout).
export const OCR_BATCH_PAGES = 30;
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
    constructor(options = {}) {
        this.python =
            options.python ??
                process.env.LEX_OCR_PYTHON ??
                "python3";
        this.workerPath =
            options.workerPath ??
                process.env.LEX_OCR_WORKER ??
                defaultWorkerPath();
        this.dpi = options.dpi ?? 220;
        this.device =
            (options.device ??
                process.env.LEX_OCR_DEVICE?.trim()) || undefined;
        this.timeoutMs =
            options.timeoutMs ?? 30 * 60 * 1000;
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
        await new Promise((resolve, reject) => {
            const child = spawn(this.python, args, {
                stdio: ["ignore", "ignore", "pipe"],
                env: {
                    ...process.env,
                    PYTHONUNBUFFERED: "1"
                }
            });
            let stderr = "";
            const timer = setTimeout(() => {
                child.kill("SIGKILL");
                reject(new Error(`OCR_ENGINE_TIMEOUT: Local PaddleOCR worker exceeded the configured timeout (pages ${pages[0]}-${pages.at(-1)}).`));
            }, this.timeoutMs);
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
                clearTimeout(timer);
                reject(new Error(`OCR_ENGINE_START_FAILED: ${error.message}`));
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                if (code === 0)
                    resolve();
                else {
                    reject(new Error(`${/ModuleNotFoundError|No module named/.test(stderr) ? "OCR_ENGINE_MISSING" : "OCR_ENGINE_FAILED"}: Local PaddleOCR worker failed with exit code ${code}: ${stderr.trim()}`));
                }
            });
        });
        return readOcrPages(JSON.parse(await readFile(output, "utf8")), path.join(batchDir, "evidence"), budget);
    }
}
