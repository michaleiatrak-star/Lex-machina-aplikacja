import { describe, expect, it } from "vitest";
import type { IngestedPage } from "../src/document-ingestion.js";
import { maskBoxes } from "../src/document-evidence.js";
import { markOcrReview, ocrReviewLines, REVIEW_MARK } from "../src/ocr-review.js";

const DICTIONARY = new Set(["Human", "Park", "Global", "Prezes", "Zarządu", "Juneyoung", "naruszenie", "porozumienia", "Pracownik"]);
const known = async (words: string[]) => words.map((word) => DICTIONARY.has(word));

function page(lines: Array<[string, number]>): IngestedPage {
  return {
    page: 2,
    source: "OCR",
    text: lines.map(([text]) => text).join("\n"),
    lines: lines.map(([text, score], index) => ({ text, score, box: [10, 20 * index, 400, 20 * index + 15] })),
    image: { jpeg: "", width: 500, height: 500, unread: [] }
  };
}

// Lines as PaddleOCR read the end of a real letter: print, handwriting, a signature stamp.
const SCAN = page([
  ["porozumienia, Pracownik naruszenie", 0.975],
  ["Wire mats Mithet", 0.779],
  ["Human Park Global sp. z o.o.", 0.966],
  ["Erymelean 2", 0.565],
  ["810.2024", 0.949],
  ["Prexese 2enoow Juneyoung Park w", 0.908],
  ["Prezes Zarządu", 0.969]
]);

describe("OCR lines to check against the scan", () => {
  it("flags handwriting and doubtful dates, not print", async () => {
    const flagged = await ocrReviewLines(SCAN, known);
    expect(flagged.map((item) => [item.line, item.reason])).toEqual([
      [1, "LOW_CONFIDENCE"], [3, "LOW_CONFIDENCE"], [4, "UNKNOWN_WORDS"], [5, "UNKNOWN_WORDS"]
    ]);
  });

  it("marks them in the page text, keeps the OCR lines as read, and evidence masking still aligns", async () => {
    const marked = await markOcrReview(SCAN, known);
    expect(marked.text).toContain(`${REVIEW_MARK} Wire mats Mithet`);
    expect(marked.lines).toEqual(SCAN.lines);
    expect(marked.review).toHaveLength(4);
    const boxes = maskBoxes(marked, ["Juneyoung Park"]);
    expect(boxes).not.toBeNull();
    // The handwritten lines are hidden whole on the evidence image (line boxes at y = 20 * index).
    for (const line of [1, 3, 4, 5]) expect(boxes!.some((box) => box[1] === 20 * line - 3 && box[0] <= 10)).toBe(true);
    expect(maskBoxes(SCAN, [])!.some((box) => box[1] === 20 - 3)).toBe(false);
  });
});
