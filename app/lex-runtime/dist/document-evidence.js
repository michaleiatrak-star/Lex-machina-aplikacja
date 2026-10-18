import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Fewer letters and digits than this: a photo, not a text scan.
export const PHOTO_MAX_TEXT_CHARS = 60;
/**
 * Photos (image files with no or incidental text) go as images by default;
 * a page with text only when the user asks for it ("all"). PDFs are text.
 */
export function wantsImage(page, mediaType, policy) {
    if (!page.image)
        return false;
    if (policy === "all")
        return true;
    return mediaType.startsWith("image/") && page.text.replace(/[^\p{L}\p{N}]/gu, "").length < PHOTO_MAX_TEXT_CHARS;
}
// A line read this badly may hide personal data the text layer missed.
export const LOW_SCORE_LINE = 0.5;
/** Every text the anonymization key hides: values, case forms, name parts. */
export function protectedValues(tokens) {
    const values = new Set();
    const add = (text) => {
        const value = text?.trim();
        if (value && value.length >= 2)
            values.add(value);
    };
    for (const token of tokens) {
        add(token.value);
        const forms = token.entity ? Object.values(token.entity.forms).map((form) => form.text) : [];
        forms.forEach(add);
        add(token.entity?.canonical);
        // A person may appear by surname alone, or split over two lines.
        if (token.kind === "PERSON" || token.kind === "ADDRESS") {
            for (const text of [token.value, ...forms]) {
                for (const word of text.split(/\s+/))
                    if (/\p{L}{3,}|\d{2,}/u.test(word))
                        add(word);
            }
        }
    }
    return [...values].sort((a, b) => b.length - a.length);
}
function escape(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Top and bottom of an outline between two x positions: its vertices there and its edges crossing them. */
export function polyBand(poly, left, right) {
    if (!poly || poly.length < 3)
        return null;
    const ys = [];
    for (let index = 0; index < poly.length; index += 1) {
        const [ax, ay] = poly[index];
        const [bx, by] = poly[(index + 1) % poly.length];
        if (ax >= left && ax <= right)
            ys.push(ay);
        for (const x of [left, right]) {
            if ((ax - x) * (bx - x) < 0)
                ys.push(ay + ((by - ay) * (x - ax)) / (bx - ax));
        }
    }
    return ys.length ? [Math.min(...ys), Math.max(...ys)] : null;
}
/**
 * Boxes to paint black on the page image: every occurrence of a protected
 * value (by the line boxes, spread proportionally over the line, padded),
 * every region the OCR detected but could not read and every badly read
 * line. Null when the image and the text cannot be aligned (no image sent).
 */
export function maskBoxes(page, values) {
    const lines = page.lines ?? [];
    if (!page.image || lines.some((line) => !line.box))
        return null;
    // No line boxes for a page that has text (hand-edited, or OCR lines lost): the protected
    // values cannot be located on the image, so it is not sent at all.
    if (page.editedByUser || (lines.length === 0 && page.text.trim() !== ""))
        return null;
    const offsets = [];
    let cursor = 0;
    for (const line of lines) {
        const at = page.text.indexOf(line.text, cursor);
        if (at < 0)
            return null;
        offsets.push(at);
        cursor = at + line.text.length;
    }
    const boxes = page.image.unread.map((box) => [...box]);
    const lineBox = (index, from, to) => {
        const [x0, y0, x1, y1] = lines[index].box;
        const length = Math.max(1, lines[index].text.length);
        const charWidth = (x1 - x0) / length;
        const pad = charWidth * 1.5 + 4;
        const left = Math.max(x0 - 2, x0 + charWidth * from - pad);
        const right = Math.min(x1 + 2, x0 + charWidth * to + pad);
        // A line bent on a fold: the mask takes the line's height at those letters (from its
        // outline), not the rectangle's, which would cover the lines above and below.
        const band = polyBand(lines[index].poly, left, right);
        return [left, (band?.[0] ?? y0) - 3, right, (band?.[1] ?? y1) + 3];
    };
    // Whole lines hidden: badly read ones, and lines to check against the scan (handwriting,
    // stamps): a handwritten "Wiatrak Michał" read as "Wire mats Mithet" matches no key value.
    const review = new Set((page.review ?? []).map((item) => item.line));
    lines.forEach((line, index) => {
        if ((typeof line.score === "number" && line.score < LOW_SCORE_LINE) || review.has(index)) {
            boxes.push(lineBox(index, 0, line.text.length));
        }
    });
    for (const value of values) {
        // Case-insensitive: "JAN KOWALSKI" on a photo, "Jan Kowalski" in the key.
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escape(value).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "giu");
        for (const match of page.text.matchAll(pattern)) {
            const start = match.index;
            const end = start + match[0].length;
            lines.forEach((line, index) => {
                const lineStart = offsets[index];
                const lineEnd = lineStart + line.text.length;
                if (end <= lineStart || start >= lineEnd)
                    return;
                boxes.push(lineBox(index, Math.max(start, lineStart) - lineStart, Math.min(end, lineEnd) - lineStart));
            });
        }
    }
    return boxes.map((box) => box.map((value) => Math.round(value * 10) / 10));
}
function defaultRedactor() {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, "../../ocr/redact_image.py");
}
/** Paints the boxes black with the OCR Python (Pillow); cached per image and boxes. */
export class LocalPageImageMasker {
    python;
    script;
    timeoutMs;
    cache = new Map();
    constructor(python = process.env.LEX_OCR_PYTHON ?? "python3", script = process.env.LEX_OCR_REDACTOR ?? defaultRedactor(), timeoutMs = 60_000) {
        this.python = python;
        this.script = script;
        this.timeoutMs = timeoutMs;
    }
    async mask(jpeg, boxes) {
        const key = createHash("sha256").update(jpeg).update(JSON.stringify(boxes)).digest("hex");
        const cached = this.cache.get(key);
        if (cached)
            return cached;
        const dir = await mkdtemp(path.join(os.tmpdir(), "lex-evidence-"));
        try {
            const input = path.join(dir, "page.jpg");
            const boxesFile = path.join(dir, "boxes.json");
            const output = path.join(dir, "masked.jpg");
            await writeFile(input, Buffer.from(jpeg, "base64"));
            await writeFile(boxesFile, JSON.stringify(boxes));
            await new Promise((resolve, reject) => {
                const child = spawn(this.python, ["-X", "utf8", this.script, "--input", input, "--boxes", boxesFile, "--output", output], {
                    windowsHide: true,
                    stdio: ["ignore", "ignore", "pipe"]
                });
                let stderr = "";
                child.stderr?.on("data", (chunk) => {
                    stderr = (stderr + String(chunk)).slice(-2000);
                });
                const timer = setTimeout(() => {
                    child.kill();
                    reject(new Error("EVIDENCE_MASK_TIMEOUT"));
                }, this.timeoutMs);
                child.once("error", (error) => {
                    clearTimeout(timer);
                    reject(error);
                });
                child.once("exit", (code) => {
                    clearTimeout(timer);
                    if (code === 0)
                        resolve();
                    else
                        reject(new Error(`EVIDENCE_MASK_FAILED:${code}:${stderr.trim().slice(-300)}`));
                });
            });
            const masked = (await readFile(output)).toString("base64");
            if (this.cache.size > 64)
                this.cache.clear();
            this.cache.set(key, masked);
            return masked;
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
}
