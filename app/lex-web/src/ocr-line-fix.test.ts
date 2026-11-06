import { describe, expect, it } from "vitest";
import { keepOpenReview, replaceOcrLine } from "./ocr-line-fix.js";

describe("poprawka niepewnej linii OCR na liście", () => {
  it("zastępuje linię w tekście strony", () => {
    expect(replaceOcrLine("Sąd Rejonowy\nJan Kowalskl\nul. Polna 1", { line: 1, text: "Jan Kowalskl" }, "Jan Kowalski")).toBe("Sąd Rejonowy\nJan Kowalski\nul. Polna 1");
  });
  it("powtórzony tekst: wystąpienie najbliższe numerowi linii OCR", () => {
    expect(replaceOcrLine("zl\nx\nzl\ny\nzl", { line: 2, text: "zl" }, "zł")).toBe("zl\nx\nzł\ny\nzl");
  });
  it("brak linii w tekście (pieczęć) albo bez zmiany: null", () => {
    expect(replaceOcrLine("Pozew", { line: 0, text: "WPŁYNĘŁO" }, "Wpłynęło 3.11.2026")).toBeNull();
    expect(replaceOcrLine("Pozew", { line: 0, text: "Pozew" }, "Pozew")).toBeNull();
  });
});

describe("keepOpenReview", () => {
  const before = {
    text: "Wezwanie do zaplaty\nKwota 1200 zl\nTermin 14 dni",
    review: [
      { line: 0, text: "Wezwanie do zaplaty", reason: "UNKNOWN_WORDS" },
      { line: 1, text: "Kwota 1200 zl", reason: "LOW_CONFIDENCE" },
      { line: 5, text: "WPŁYNĘŁO 03.11", reason: "STAMP" }
    ],
    corrections: [{ from: "Terrnin", to: "Termin" }]
  };
  it("one saved line leaves the list, the rest of the page stays to check (user report 2026-11-06)", () => {
    const saved = keepOpenReview(before, { text: "Wezwanie do zapłaty\nKwota 1200 zl\nTermin 14 dni", editedByUser: true });
    expect(saved.review?.map((line) => line.text)).toEqual(["Kwota 1200 zl", "WPŁYNĘŁO 03.11"]);
    expect(saved.corrections).toEqual([{ from: "Terrnin", to: "Termin" }]);
    expect(saved.editedByUser).toBe(true);
  });
  it("what the runtime returns wins when it has its own list", () => {
    const own = [{ line: 0, text: "Inna", reason: "GARBLED" }];
    expect(keepOpenReview(before, { text: "Inna", review: own }).review).toBe(own);
  });
});
