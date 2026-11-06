import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
function defaultWorkerPath() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../storage/pdf_form_worker.py");
}
/**
 * Fields of a PDF form and the same PDF filled in, on this computer. The filled form is a new
 * file; the original stays as it was.
 */
export class LocalPdfFormFiller {
    python;
    workerPath;
    timeoutMs;
    constructor(options = {}) {
        this.python = options.python ?? process.env.LEX_STORAGE_PYTHON ?? "python3";
        this.workerPath = options.workerPath ?? defaultWorkerPath();
        this.timeoutMs = options.timeoutMs ?? 60_000;
    }
    async fields(data) {
        const out = await this.run("read", Buffer.from(data));
        const parsed = JSON.parse(out.toString("utf8"));
        return Array.isArray(parsed.fields) ? parsed.fields : [];
    }
    async fill(data, values, flatten) {
        const request = JSON.stringify({ dataBase64: Buffer.from(data).toString("base64"), values, flatten });
        return await this.run("fill", Buffer.from(request, "utf8"));
    }
    run(operation, input) {
        return new Promise((resolve, reject) => {
            const child = spawn(this.python, ["-X", "utf8", this.workerPath, operation], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
            const chunks = [];
            let stderr = "";
            const timer = setTimeout(() => {
                child.kill();
                reject(new Error("PDF_FORM_TIMEOUT"));
            }, this.timeoutMs);
            child.stdout.on("data", (chunk) => chunks.push(chunk));
            child.stderr.on("data", (chunk) => {
                stderr = (stderr + chunk.toString("utf8")).slice(-2000);
            });
            child.once("error", (error) => {
                clearTimeout(timer);
                reject(new Error(`PDF_FORM_FAILED:${error.message}`));
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                if (code === 0)
                    resolve(Buffer.concat(chunks));
                else
                    reject(new Error(/PDF_FORM_[A-Z_]+(?::[^\n]*)?/u.exec(stderr)?.[0]?.slice(0, 300) ?? `PDF_FORM_FAILED:${code}`));
            });
            child.stdin.on("error", () => undefined);
            child.stdin.end(input);
        });
    }
}
/** The values sent by the client: field names to strings, booleans or null; anything else dropped. */
export function pdfFormValues(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error("PDF_FORM_INVALID_REQUEST");
    const out = {};
    for (const [name, value] of Object.entries(raw).slice(0, 5000)) {
        if (typeof value === "string" || typeof value === "boolean" || value === null)
            out[name.slice(0, 500)] = value;
    }
    return out;
}
