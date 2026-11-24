export const LOW_PAGE_CONFIDENCE = 0.95;
export const LOW_LINE_SCORE = 0.95;
export const LOW_LINE_SHARE = 0.25;
/** Share of the page's OCR lines read below LOW_LINE_SCORE (stamps apart), or null without scores. */
export function lowLineShare(page) {
    const scores = (page.lines ?? []).filter((line) => !line.stamp && typeof line.score === "number").map((line) => line.score);
    if (scores.length === 0)
        return null;
    return scores.filter((score) => score < LOW_LINE_SCORE).length / scores.length;
}
/** An OCR page whose reading should be checked against the scan (not a page the user corrected). */
export function lowConfidencePage(page) {
    if (page.source !== "OCR" || page.editedByUser)
        return false;
    if (typeof page.confidence === "number" && page.confidence < LOW_PAGE_CONFIDENCE)
        return true;
    const share = lowLineShare(page);
    return share !== null && share >= LOW_LINE_SHARE;
}
