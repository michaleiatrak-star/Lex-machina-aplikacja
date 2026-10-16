import { describe, expect, it } from "vitest";
import {
  LONG_DRAFT_CHARS,
  applySectionChanges,
  draftPrompt,
  pleadingContinuationPrompt,
  pleadingStepText
} from "../src/process-pleading-draft.js";

const DRAFT = [
  "Sąd Okręgowy w Krakowie",
  "POZEW O ZAPŁATĘ",
  "I. ŻĄDANIA",
  "1. zasądzenie kwoty 100 000 zł;",
  "2. zasądzenie kosztów.",
  "II. UZASADNIENIE",
  "1. Zawarcie umowy",
  "Strony zawarły umowę 3 marca 2025 r.",
  "2. Wykonanie robót",
  "Powód wykonał roboty.",
  "III. DOWODY",
  "1. umowa z 3 marca 2025 r."
].join("\n");

describe("długi projekt w potoku pisma procesowego", () => {
  it("zmiana sekcji podmienia tylko tę sekcję, z zachowaniem kolejności i reszty", () => {
    const answer = [
      "Raport CP-QUALITY: poprawiono uzasadnienie.",
      "=== ZMIANA SEKCJI: II. UZASADNIENIE ===",
      "II. UZASADNIENIE",
      "1. Zawarcie umowy",
      "Strony zawarły umowę o roboty budowlane 3 marca 2025 r. w Krakowie.",
      "2. Wykonanie robót",
      "Powód wykonał roboty w terminie.",
      "=== KONIEC ZMIANY ==="
    ].join("\n");
    const step = pleadingStepText(answer, DRAFT);
    expect(step.kind).toBe("FULL");
    const text = (step as { text: string }).text;
    expect(text).toContain("o roboty budowlane 3 marca 2025 r. w Krakowie");
    expect(text).not.toContain("Strony zawarły umowę 3 marca 2025 r.\n");
    expect(text.indexOf("I. ŻĄDANIA")).toBeLessThan(text.indexOf("II. UZASADNIENIE"));
    expect(text.indexOf("II. UZASADNIENIE")).toBeLessThan(text.indexOf("III. DOWODY"));
    expect(text.match(/II\. UZASADNIENIE/gu)).toHaveLength(1);
    expect(text).toContain("1. umowa z 3 marca 2025 r.");
  });

  it("podpunkt arabski nie kończy sekcji rzymskiej; nagłówek bez powtórzenia w treści zostaje", () => {
    const { text, problems } = applySectionChanges(DRAFT, [{ heading: "I. ŻĄDANIA", body: "1. zasądzenie kwoty 120 000 zł;\n2. zasądzenie kosztów." }]);
    expect(problems).toEqual([]);
    expect(text).toContain("I. ŻĄDANIA\n1. zasądzenie kwoty 120 000 zł;");
    expect(text).not.toContain("100 000");
    expect(text).toContain("II. UZASADNIENIE");
  });

  it("nieznana sekcja albo zmiana ucięta: problem, nie cicha stara wersja", () => {
    expect(pleadingStepText("=== ZMIANA SEKCJI: IV. WNIOSKI ===\nx\n=== KONIEC ZMIANY ===", DRAFT)).toEqual({
      kind: "PROBLEM",
      problem: "brak sekcji „IV. WNIOSKI” w projekcie: nowa wersja nie została zapisana"
    });
    expect(pleadingStepText("=== ZMIANA SEKCJI: II. UZASADNIENIE ===\nII. UZASADNIENIE\n1. Zawarcie", DRAFT).kind).toBe("PROBLEM");
    expect(pleadingStepText("=== PISMO ===\nSąd Okręgowy w Krakowie. Pozew o zapłatę kwoty 100 000 zł. Uzasadnienie", null)).toEqual({
      kind: "PROBLEM",
      problem: "tekst pisma ucięty (brak linii końca bloku): nowa wersja nie została zapisana"
    });
  });

  it("pełny blok, część z ciągiem dalszym, bez zmian, bez bloku", () => {
    expect(pleadingStepText(`=== PISMO ===\n${DRAFT}\n=== KONIEC PISMA ===`, null)).toEqual({ kind: "FULL", text: DRAFT });
    expect(pleadingStepText(`=== PISMO ===\n${DRAFT}\n=== CIĄG DALSZY ===`, null)).toEqual({ kind: "PARTIAL", text: DRAFT });
    expect(pleadingStepText("Raport.\n=== BEZ ZMIAN W TEKŚCIE ===", DRAFT)).toEqual({ kind: "UNCHANGED" });
    expect(pleadingStepText("Raport kroku.", DRAFT)).toEqual({ kind: "NONE" });
  });

  it("instrukcja kroku: długi projekt w trybie zmian, krótki z regułą ciągu dalszego", () => {
    const long = { version: 4, source: "PIPELINE" as const, stage: "W3" as const, text: DRAFT + "\n" + "Uzasadnienie. ".repeat(LONG_DRAFT_CHARS / 10), createdAt: "" };
    const prompt = draftPrompt({ checkpoint: "CP-QUALITY", draft: long });
    expect(prompt).toContain("NIE przepisuj całego pisma");
    expect(prompt).toContain("=== ZMIANA SEKCJI:");
    expect(prompt).not.toContain("Pełny, aktualny tekst pisma");
    const first = draftPrompt({ checkpoint: "CP-ATAK", draft: null });
    expect(first).toContain("=== CIĄG DALSZY ===");
    const next = pleadingContinuationPrompt(DRAFT, 1);
    expect(next).toContain("II. UZASADNIENIE");
    expect(next).toContain("WYŁĄCZNIE jego dalszy ciąg");
  });
});
