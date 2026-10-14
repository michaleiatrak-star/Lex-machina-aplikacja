// Put before a flagged line in the text, so a model reading the document does not take it as written.
export const REVIEW_MARK = "[OCR: odczyt niepewny, sprawdź w skanie]";
export const REVIEW_SCORE = 0.85;
const DOUBT_SCORE = 0.95;
const UNKNOWN_SHARE = 0.34;
const WORD = /\p{L}{3,}/gu;
export async function ocrReviewLines(page, knownWords) {
    if (page.source !== "OCR" || !page.lines?.length)
        return [];
    const lines = page.lines;
    const vocabulary = [...new Set(lines.flatMap((line) => line.text.match(WORD) ?? []))];
    const flags = vocabulary.length ? await knownWords(vocabulary) : [];
    const known = new Set(vocabulary.filter((_, index) => flags[index]));
    const found = [];
    lines.forEach((line, index) => {
        const score = typeof line.score === "number" ? line.score : undefined;
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
    const flagged = new Set(review.map((item) => item.line));
    const text = page.lines.map((line, index) => (flagged.has(index) ? `${REVIEW_MARK} ${line.text}` : line.text)).join("\n");
    return { ...page, text, review };
}
