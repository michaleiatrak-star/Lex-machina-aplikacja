import { describe, expect, it } from "vitest";
import { STAMP_MARK, type IngestedPage } from "../src/document-ingestion.js";
import { normalizeOcrPage } from "../src/ocr-correction.js";
import { readOcrPages } from "../src/ocr/ocr-result.js";
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

describe("stamps over printed lines", () => {
  // Lines as the worker read a page with a black stamp over the print (synthetic scan, PP-OCRv6),
  // and a coloured stamp read apart from its own layer.
  const STAMPED = page([
    ["Wnoszę o przeproWadzZZidBW5d6z zeznań świadka Marka Wiśniewskiego na okoliczność", 0.916],
    ["Sad OkregANCELABkoWieDeY WPAWNFGeczowo i miejscowo do rozpoznania sprawy.", 0.888],
    ["Wnoszę o przeprowadzenie dowodu z zeznań świadka", 0.93],
    ["Pozwany odebrał roboty bez zastrzeżeń, sp. z o.o.", 0.99],
    ["r.pr. Anna Nowak", 0.997]
  ]);
  STAMPED.lines![4] = { ...STAMPED.lines![4]!, stamp: true };
  const words = new Set(["Wnoszę", "zeznań", "świadka", "Marka", "Wiśniewskiego", "okoliczność", "przeprowadzenie", "dowodu", "Pozwany", "odebrał", "roboty", "zastrzeżeń", "Anna", "Nowak", "miejscowo", "rozpoznania", "sprawy"]);
  const knownHere = async (list: string[]) => list.map((word) => words.has(word));

  it("a word glued from stamp and print is listed; clean print read with doubt is not", async () => {
    const flagged = await ocrReviewLines(STAMPED, knownHere);
    expect(flagged.map((item) => [item.line, item.reason])).toEqual([[0, "GARBLED"], [1, "UNKNOWN_WORDS"], [4, "STAMP"]]);
  });

  it("a stamp's line is on the review list only, not in the page text; the OCR line stays", async () => {
    const marked = await markOcrReview(STAMPED, knownHere);
    const lines = marked.text.split("\n");
    expect(lines).toHaveLength(4);
    expect(marked.text).not.toContain("r.pr. Anna Nowak");
    expect(marked.text).not.toContain(STAMP_MARK);
    expect(lines[0]).toBe(`${REVIEW_MARK} ${STAMPED.lines![0]!.text}`);
    expect(marked.review!.find((item) => item.reason === "STAMP")).toMatchObject({ line: 4, text: "r.pr. Anna Nowak" });
    expect(marked.lines![4]).toMatchObject({ text: "r.pr. Anna Nowak", stamp: true });
  });

  it("LEX_OCR_STAMP_TEXT=text: the stamp's line stays in the text with its mark (as before)", async () => {
    process.env.LEX_OCR_STAMP_TEXT = "text";
    try {
      const marked = await markOcrReview(STAMPED, knownHere);
      expect(marked.text.split("\n")[4]).toBe(`${STAMP_MARK} r.pr. Anna Nowak`);
    } finally {
      delete process.env.LEX_OCR_STAMP_TEXT;
    }
  });

  it("the evidence image hides a stamp's line whole and still masks values in the text", async () => {
    const marked = await markOcrReview(STAMPED, knownHere);
    const boxes = maskBoxes(marked, ["Marka Wiśniewskiego"]);
    expect(boxes).not.toBeNull();
    // Line 4 (the stamp) at y = 80: hidden whole although it is not in the text.
    expect(boxes!.some((box) => box[1] === 80 - 3 && box[0] <= 10)).toBe(true);
    // Without the review list the stamp's line is hidden too (its values cannot be found in the text).
    const bare = { ...STAMPED, text: normalizeOcrPage(STAMPED).text };
    expect(maskBoxes(bare, [])!.some((box) => box[1] === 80 - 3)).toBe(true);
  });

  it("the cleaning of OCR lines rebuilds the text without stamps; the worker's lines keep the flag", async () => {
    // A ligature in a printed line: the page text is rebuilt from the lines.
    const cleaned = normalizeOcrPage({ ...STAMPED, lines: STAMPED.lines!.map((line, index) => (index === 3 ? { ...line, text: "ﬁrma Kowalski" } : line)) });
    expect(cleaned.text.split("\n")[3]).toBe("firma Kowalski");
    expect(cleaned.text).not.toContain("r.pr. Anna Nowak");
    expect(cleaned.lines![4]).toMatchObject({ stamp: true });
    const [read] = await readOcrPages([{ page: 1, source: "OCR", text: "x", lines: [{ text: "BIURO PODAWCZE", score: 0.98, stamp: true }, { text: "Treść", score: 0.99 }] }], "/nonexistent");
    expect(read!.lines).toEqual([{ text: "BIURO PODAWCZE", score: 0.98, stamp: true }, { text: "Treść", score: 0.99 }]);
  });
});
