import { describe, expect, it } from "vitest";
import { answerLetterMarkup } from "../src/answer-document.js";
import { moveStatuteWarningsOutOfLetter } from "../src/statute-content-check.js";

// Fabricated letter: the mechanism, not a real case.
const WARNING = "⚠️ [PRZEPIS ODCZYTANY, TEZA POTWIERDZONA CZĘŚCIOWO: Przepis wymaga postanowienia sądu. Brzmienie: „wbrew postanowieniu sądu”]";
const answer = [
  "Przygotowałem projekt.",
  "",
  "Warszawa, dnia 1 grudnia 2026 r.",
  "",
  "Sąd Rejonowy w Testowie",
  "",
  "WNIOSEK DOWODOWY POWODA",
  "",
  "Wnoszę o zobowiązanie pozwanej do przedstawienia dokumentu.",
  "",
  `Odmowę przedstawienia dokumentu Sąd oceni na podstawie art. 233 § 2 k.p.c. [ŹRÓDŁO BRZMIENIA: Dz.U. 2026 poz. 468] ${WARNING}`,
  "",
  "Jan Testowy"
].join("\n");

describe("a letter for the court carries no note of the application (2026-11-20)", () => {
  it("the provision's warning leaves the letter and is listed after it", () => {
    const out = moveStatuteWarningsOutOfLetter(answer, [{ claim: "art. 233 § 2 KPC", warning: WARNING }], answerLetterMarkup(answer) !== null);
    const letterLine = out.split("\n").find((line) => line.startsWith("Odmowę"))!;
    expect(letterLine).not.toContain("⚠️");
    expect(letterLine.endsWith("468]")).toBe(true);
    expect(out).toMatch(/Kontrola treści przepisów \(poza pismem[^\n]*\n- art\. 233 § 2 KPC: ⚠️ \[PRZEPIS ODCZYTANY/u);
  });

  it("an answer without a letter keeps the warning next to the provision", () => {
    const plain = `Sąd oceni to na podstawie art. 233 § 2 k.p.c. ${WARNING}`;
    expect(moveStatuteWarningsOutOfLetter(plain, [{ claim: "art. 233 § 2 KPC", warning: WARNING }], false)).toBe(plain);
  });
});
