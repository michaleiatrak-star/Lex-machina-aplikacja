import { describe, expect, it } from "vitest";
import { fixOcrAmounts } from "../src/ocr-amounts.js";
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

  it("fixes typical OCR errors in amounts by rule", () => {
    const fix = (text: string) => fixOcrAmounts(text).text;
    expect(fix("kara umowna w wysokości 20.ooo,00 zł za każde")).toBe("kara umowna w wysokości 20.000,00 zł za każde");
    expect(fix("zapłaty kwoty 60.0o0,00 zł w terminie")).toBe("zapłaty kwoty 60.000,00 zł w terminie");
    expect(fix("kwota 1 5OO,OO PLN")).toBe("kwota 1 500,00 PLN");
    expect(fix("kwota 12.34S,67zł")).toBe("kwota 12.345,67zł");
    expect(fix("kwota 12.345,6S zł")).toBe("kwota 12.345,65 zł");
    expect(fix("czynsz 2.5OO,00 złotych")).toBe("czynsz 2.500,00 złotych");
    expect(fix("odsetki 1.200.50 zł")).toBe("odsetki 1.200,50 zł");
    expect(fix("odsetki 20,000,00 zł")).toBe("odsetki 20.000,00 zł");
    expect(fix("opłata 100,00 zl")).toBe("opłata 100,00 zł");
    expect(fixOcrAmounts("kara 20.ooo,00 zł").fixes).toEqual([{ from: "20.ooo,00 zł", to: "20.000,00 zł" }]);
  });

  it("leaves what is not a misread amount", () => {
    const same = (text: string) => expect(fixOcrAmounts(text).text).toBe(text);
    same("dnia 18.03.2024 r. o godz. 10.00");
    same("art. 187 ust. 1 pkt 3 kpc");
    same("kwota 60.000,00 zł");
    same("1 Ola zł");
    same("rachunek 12 3456 7890 1234 5678 9012 3456");
    // A letter that does not become a valid amount stays as read: the reader checks it.
    same("kwota 6x.000,00 zł");
  });

  it("amounts are fixed in the model-free page cleanup and kept in corrections", () => {
    const page = normalizeOcrPage({
      page: 2,
      source: "OCR",
      text: "kara 20.ooo,00 zł",
      lines: [{ text: "kara 20.ooo,00 zł", score: 0.97 }]
    });
    expect(page.text).toBe("kara 20.000,00 zł");
    expect(page.corrections).toEqual([{ line: 0, from: "20.ooo,00 zł", to: "20.000,00 zł" }]);
  });
});
