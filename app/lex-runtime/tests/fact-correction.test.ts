import { describe, expect, it } from "vitest";
import { recordCaseWork, caseWorkLine } from "../src/case-work.js";
import { isFactCorrection } from "../src/turn-gate.js";

const thread = (latest: string) => `Użytkownik: Przeanalizuj porozumienie z Human Park Global.\n\nAsystent: Analiza: strony Human Park i Human Park Global…\n\nUżytkownik: ${latest}`;

describe("a fact correction in a running matter: no legal turn", () => {
  it("recognizes corrections, never a task, a question or the first message", () => {
    for (const text of [
      "to ta sama firma, tylko błąd ocr - to cały czas Human Park Global",
      "Pomyłka, chodziło o 2024 rok.",
      "nie Kowalski, tylko Kowalska",
      "Korekta: kwota to 12 000 zł"
    ]) {
      expect(isFactCorrection(thread(text))).toBe(true);
    }
    for (const text of [
      "Kontynuuj.",
      "to ta sama firma? sprawdź to",
      "to ta sama firma, przeanalizuj jeszcze raz umowę",
      "Przygotuj odpowiedź na wezwanie",
      "x".repeat(401) + " to ta sama firma"
    ]) {
      expect(isFactCorrection(thread(text))).toBe(false);
    }
    expect(isFactCorrection("to ta sama firma, tylko błąd ocr")).toBe(false);
  });

  it("keeps the correction in the case's register, in the user's words", () => {
    const items = recordCaseWork([], { now: "2026-10-22T12:00:00.000Z", corrections: ["to ta sama firma, tylko błąd ocr - to cały czas Human Park Global"] });
    expect(items).toHaveLength(1);
    expect(caseWorkLine(items[0]!)).toBe("KOREKTA UŻYTKOWNIKA (obowiązuje): „to ta sama firma, tylko błąd ocr - to cały czas Human Park Global”, 2026-10-22");
  });
});
