import { ocrLineText, stampLinesInText } from "./document-ingestion.js";
// Put before a flagged line in the text, so a model reading the document does not take it as written.
export const REVIEW_MARK = "[OCR: odczyt niepewny, sprawdź w skanie]";
// A line whose number differs from the PDF's own text layer (a foreign OCR): one of them misread a digit.
export const LAYER_MARK = "[OCR: liczba inna niż w warstwie tekstowej PDF, sprawdź w skanie]";
export const REVIEW_SCORE = 0.85;
const DOUBT_SCORE = 0.95;
const UNKNOWN_SHARE = 0.34;
const WORD = /\p{L}{3,}/gu;
// "OkregANCELABkoWieDeY", "przeproWadzZZidBW5d6z": not a Polish word or abbreviation.
const GARBLED = /\p{Ll}\p{Lu}+\p{Ll}|\p{Ll}\p{Lu}{2,}|\p{L}\d+\p{L}/u;
export async function ocrReviewLines(page, knownWords) {
    if (page.source !== "OCR" || !page.lines?.length)
        return [];
    const lines = page.lines;
    const vocabulary = [...new Set(lines.flatMap((line) => line.text.match(WORD) ?? []))];
    const flags = vocabulary.length ? await knownWords(vocabulary) : [];
    const known = new Set(vocabulary.filter((_, index) => flags[index]));
    const found = [];
    const layerLines = new Set(page.layerMismatch?.lines ?? []);
    lines.forEach((line, index) => {
        if (layerLines.has(index) && !line.stamp) {
            found.push({ line: index, text: line.text, ...(typeof line.score === "number" ? { score: line.score } : {}), reason: "LAYER_MISMATCH" });
            return;
        }
        const score = typeof line.score === "number" ? line.score : undefined;
        if (line.stamp) {
            found.push({ line: index, text: line.text, ...(score !== undefined ? { score } : {}), reason: "STAMP" });
            return;
        }
        if (score === undefined)
            return;
        if (score < REVIEW_SCORE) {
            found.push({ line: index, text: line.text, score, reason: "LOW_CONFIDENCE" });
            return;
        }
        const words = line.text.match(WORD) ?? [];
        const unknown = words.filter((word) => !known.has(word)).length;
        // A line of digits alone read with doubt: a handwritten date ("810.2024" for "8.10.2024").
        if (score < DOUBT_SCORE && (words.length === 0 || unknown / words.length >= UNKNOWN_SHARE)) {
            found.push({ line: index, text: line.text, score, reason: "UNKNOWN_WORDS" });
            return;
        }
        if (score < DOUBT_SCORE && line.text.split(/\s+/u).some((token) => GARBLED.test(token))) {
            found.push({ line: index, text: line.text, score, reason: "GARBLED" });
        }
    });
    return found;
}
/**
 * The page with flagged lines marked in its text and listed in `review`. The OCR lines stay
 * as read: evidence masking places boxes by the characters of each line on the scan.
 */
export async function markOcrReview(page, knownWords) {
    const review = await ocrReviewLines(page, knownWords);
    if (!review.length)
        return page;
    const flagged = new Set(review.filter((item) => item.reason !== "STAMP" && item.reason !== "LAYER_MISMATCH").map((item) => item.line));
    const layer = new Set(review.filter((item) => item.reason === "LAYER_MISMATCH").map((item) => item.line));
    // A stamp's line is only on the review list (ocrPageText), unless kept in the text.
    const stamps = stampLinesInText();
    const text = page.lines
        .flatMap((line, index) => (line.stamp && !stamps ? [] : [layer.has(index) ? `${LAYER_MARK} ${line.text}` : flagged.has(index) ? `${REVIEW_MARK} ${line.text}` : ocrLineText(line)]))
        .join("\n");
    return { ...page, text, review };
}
