// Task 06: an OCR page read with low certainty is marked in the preview. Thresholds from the case
// files (2026-11-24): clean pages 0.992-0.998 mean confidence with 0-3% of lines under 0.95; a
// lightly degraded scan 0.986 / 3%; a heavily degraded one 0.814 / 82%; an unreadable one 0.382.
import type { IngestedPage } from "./document-ingestion.js";

export const LOW_PAGE_CONFIDENCE = 0.95;
export const LOW_LINE_SCORE = 0.95;
export const LOW_LINE_SHARE = 0.25;

/** Share of the page's OCR lines read below LOW_LINE_SCORE (stamps apart), or null without scores. */
export function lowLineShare(page: Pick<IngestedPage, "lines">): number | null {
  const scores = (page.lines ?? []).filter((line) => !line.stamp && typeof line.score === "number").map((line) => line.score as number);
  if (scores.length === 0) return null;
  return scores.filter((score) => score < LOW_LINE_SCORE).length / scores.length;
}

/** An OCR page whose reading should be checked against the scan (not a page the user corrected). */
export function lowConfidencePage(page: Pick<IngestedPage, "source" | "confidence" | "lines" | "editedByUser">): boolean {
  if (page.source !== "OCR" || page.editedByUser) return false;
  if (typeof page.confidence === "number" && page.confidence < LOW_PAGE_CONFIDENCE) return true;
  const share = lowLineShare(page);
  return share !== null && share >= LOW_LINE_SHARE;
}
