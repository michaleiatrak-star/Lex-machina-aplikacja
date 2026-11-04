import { describe, expect, it } from "vitest";
import { replaceOcrLine } from "./ocr-line-fix.js";

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
