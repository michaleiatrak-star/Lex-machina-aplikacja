// Task 06: a low-certainty OCR page. Its scan reaches a cloud model only with the user's explicit
// consent, unmasked (the image cannot be anonymized), as an image of the next message.
import type { DocumentPageScan } from "./api";

export type CloudPageImage = { name: string; mediaType: "image/jpeg"; data: string };

/** The page's image for the next message, or null: no consent, or no scan of that page. */
export function cloudPageImage(consent: boolean, scan: DocumentPageScan | null, fileName: string): CloudPageImage | null {
  if (!consent || !scan?.data) return null;
  return { name: `${fileName.replace(/\.[^.]+$/u, "")} - strona ${scan.page}.jpg`, mediaType: "image/jpeg", data: scan.data };
}

/** Pages to mark, with the mean certainty in percent when known. */
export function lowConfidencePages(pages: Array<{ page: number; lowConfidence?: true; confidence?: number }>): Array<{ page: number; percent: number | null }> {
  return pages.filter((page) => page.lowConfidence).map((page) => ({ page: page.page, percent: typeof page.confidence === "number" ? Math.round(page.confidence * 100) : null }));
}
