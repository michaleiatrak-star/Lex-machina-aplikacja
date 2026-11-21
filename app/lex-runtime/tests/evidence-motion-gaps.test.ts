import { describe, expect, it } from "vitest";
import { evidenceMotionGaps } from "../src/pleading-standard.js";

const head = "Sąd Okręgowy w Katowicach\nSygn. akt XI P 27/26\n";
const body = [
  "\nUZASADNIENIE\n",
  "17 marca 2026 r. w protokole rozprawy w sprawie VII P 94/25 świadek zeznał: „Było zarządzenie wewnętrzne u pozwanej, żeby pracownicy nie kontaktowali się z powodem”.",
  "Pracownikom wysłano wiadomości do grup pracowniczych 29 września 2024 r."
].join("\n");

describe("evidence motions of a pleading (XI P 27/26, 2026-11-20)", () => {
  it("the opponent's documents and another case's record without their motions", () => {
    const gaps = evidenceMotionGaps(`${head}Wnoszę o:\n1. uwzględnienie stanowiska przy ocenie zeznań.${body}`).map((gap) => gap.element);
    expect(gaps).toEqual(expect.arrayContaining(["DOKUMENT U PRZECIWNIKA", "DOWÓD Z INNEJ SPRAWY"]));
  });

  it("with the motions (art. 248 for each document, the record of VII P 94/25): no gap", () => {
    const petitum = "Wnoszę o:\n1. dopuszczenie dowodu z protokołu rozprawy z 17 marca 2026 r., sygn. akt VII P 94/25;\n2. zobowiązanie pozwanej (art. 248 § 1 k.p.c.) do przedstawienia zarządzenia wewnętrznego oraz wiadomości wysłanych do grup pracowniczych.";
    expect(evidenceMotionGaps(`${head}${petitum}${body}`)).toEqual([]);
  });

  it("a variant on the party's own act and an unchecked form: ask, check", () => {
    const text = `${head}Wnoszę o: 1. ocenę zeznań.\nUZASADNIENIE\nJeśli wysłał ją Pan po tej rozprawie, sprzeczność znika. ⚠️ Nie sprawdziłem, czy pismo zawierające wyłącznie wnioski dowodowe podlega tym samym ograniczeniom.`;
    expect(evidenceMotionGaps(text).map((gap) => gap.element)).toEqual(expect.arrayContaining(["PYTANIE DO STRONY", "FORMA PISMA"]));
  });
});
