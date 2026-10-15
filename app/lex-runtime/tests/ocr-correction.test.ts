import { describe, expect, it } from "vitest";
import { normalizeOcrLine, normalizeOcrPage } from "../src/ocr-correction.js";

describe("model-free OCR cleanup", () => {
  it("cleans ligatures, invisible characters and look-alike letters without the model", () => {
    const cyrillicA = "\u0430";
    const result = normalizeOcrLine(`ﬁrma Kowalski­ego w Warsz${cyrillicA}​wie dnia`);
    expect(result.text).toBe("firma Kowalskiego w Warszawie dnia");
    expect(result.fixes).toContainEqual({ from: "ﬁ", to: "fi" });
    expect(result.fixes).toContainEqual({ from: `Warsz${cyrillicA}wie`, to: "Warszawie" });
    // A word written in Cyrillic stays as it is.
    expect(normalizeOcrLine("сок").text).toBe("сок");
  });

  it("cleans the lines of an OCR page and keeps the original words", () => {
    const page = normalizeOcrPage({
      page: 1,
      source: "OCR",
      text: "ﬁrma Kowalski",
      lines: [{ text: "ﬁrma Kowalski", score: 0.9 }]
    });
    expect(page.text).toBe("firma Kowalski");
    expect(page.corrections).toEqual([{ line: 0, from: "ﬁ", to: "fi" }]);
    const digital = { page: 1, source: "DIGITAL" as const, text: "ﬁrma" };
    expect(normalizeOcrPage(digital)).toBe(digital);
  });
});
