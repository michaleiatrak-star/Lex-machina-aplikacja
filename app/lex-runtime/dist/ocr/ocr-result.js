import { readFile } from "node:fs/promises";
import path from "node:path";
// Bytes of page images (base64) kept per document as evidence (masked before
// sending). A byte budget, not a page count: every page of a long scan keeps
// its image while the stored source stays under the store's 256 MB limit.
export const EVIDENCE_MAX_BYTES = 160 * 1024 * 1024;
export function evidenceBudget() {
    return { bytesLeft: EVIDENCE_MAX_BYTES };
}
function box(value) {
    return Array.isArray(value) && value.length === 4 && value.every((item) => Number.isFinite(item))
        ? value.map(Number)
        : undefined;
}
/**
 * Worker output → OcrPageResult: per-line text/score/box and, while the
 * budget lasts (shared across OCR batches of one document), the page image
 * the boxes refer to. A page image comes only with a
 * box for every line (a photo may have no lines); otherwise the page has no image (nothing could be
 * masked reliably).
 */
export async function readOcrPages(raw, evidenceDir, budget = evidenceBudget()) {
    const pages = [];
    for (const item of raw) {
        const page = item;
        const lines = Array.isArray(page.lines)
            ? page.lines
                .filter((line) => typeof line?.text === "string")
                .map((line) => {
                const lineBox = box(line.box);
                return {
                    text: line.text,
                    ...(typeof line.score === "number" ? { score: line.score } : {}),
                    ...(lineBox ? { box: lineBox } : {})
                };
            })
            : undefined;
        const { evidence, ...rest } = page;
        const result = { ...rest, ...(lines ? { lines } : {}) };
        delete result.image;
        const file = typeof evidence?.file === "string" ? path.basename(evidence.file) : null;
        if (file &&
            (lines ?? []).every((line) => line.box) &&
            budget.bytesLeft > 0 &&
            Number.isFinite(evidence?.width) &&
            Number.isFinite(evidence?.height)) {
            try {
                const jpeg = (await readFile(path.join(evidenceDir, file))).toString("base64");
                if (jpeg.length > budget.bytesLeft) {
                    budget.bytesLeft = 0;
                    throw new Error("EVIDENCE_BUDGET_EXCEEDED");
                }
                result.image = {
                    jpeg,
                    width: Number(evidence.width),
                    height: Number(evidence.height),
                    unread: (Array.isArray(evidence.unread) ? evidence.unread : []).map(box).filter((b) => Boolean(b))
                };
                budget.bytesLeft -= jpeg.length;
            }
            catch {
                // No image for this page: text only.
            }
        }
        pages.push(result);
    }
    return pages;
}
