import { describe, expect, it } from "vitest";
import { materialInWords } from "../src/session-executor.js";

// Test 500: a timeline or a described defence in the message was answered "dołącz materiał".
describe("material described in the message", () => {
  it("dated events are a timeline's material, described evidence a court analysis'", () => {
    expect(materialInWords("chronologia-sprawy-v1", "Chronologia: 10.01.2026 umowa pożyczki 30 000 zł, termin zwrotu 10.07.2026; 15.03 spłata 5 000 zł; 10.07 brak spłaty; 1.08 wezwanie do zapłaty; 20.09 pozew.")).toBe(true);
    expect(
      materialInWords(
        "analiza-sadowa-v6",
        "Obrona w sprawie karnej. Oskarżony (klient) zarzut z art. 158 § 1 KK – udział w bójce 14.06.2026 pod klubem w Łodzi, pokrzywdzony doznał złamania nosa. Świadek A (bramkarz) w postępowaniu przygotowawczym zeznał, że klient zadał pierwszy cios; na rozprawie, że nie widział początku zdarzenia. Świadek B mówi o trzech napastnikach, monitoring nagrał tylko fragment od 23:41."
      )
    ).toBe(true);
  });

  it("a bare request or a contract without its text still asks for the material", () => {
    expect(materialInWords("chronologia-sprawy-v1", "Zrób chronologię mojej sprawy.")).toBe(false);
    expect(materialInWords("analiza-sadowa-v6", "Przeanalizuj wyrok w mojej sprawie, mam termin 14 dni.")).toBe(false);
    expect(materialInWords("analizator-umow-v1", "Umowa z 2.02.2026, aneks 5.03.2026, wypowiedzenie 1.06.2026.")).toBe(false);
  });
});
