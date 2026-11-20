import { describe, expect, it } from "vitest";
import { letterCaseMismatch } from "../src/courts/case-court.js";
import { normalizeCitationMarkers } from "../src/document-citations.js";
import { pausesForUser, questionsToUser } from "../src/workflow-wait.js";

// A reply to the court drafted by another model (2026-11-20): questions overruled by the correction
// rounds, raw single-bracket markers in the letter, the signature of an earlier case in the heading.
describe("questions to the user stop the correction rounds", () => {
  const asks = [
    "Ustalenia z akt są niepełne.",
    "Czy odpowiedź ma być skierowana do Sądu Okręgowego w Katowicach w sprawie X P 1/26 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]?",
    "Które korzystne kwestie mają być najważniejsze: rodzaj pracy czy wynagrodzenie?",
    "Czy chcesz wnosić o pominięcie zeznań świadka, czy tylko wykazać ich niespójność?"
  ].join("\n");

  it("recognises questions addressed to the user, not rhetorical ones", () => {
    expect(questionsToUser(asks)).toHaveLength(3);
    expect(pausesForUser(asks, false)).toBe(true);
    expect(pausesForUser("Czy świadek jest wiarygodny?\nZeznania są spójne.", false)).toBe(false);
  });

  it("a letter in the answer is not a pause", () => {
    expect(pausesForUser(asks, true)).toBe(false);
    expect(pausesForUser("[CZEKAM NA ODPOWIEDŹ]", true)).toBe(true);
  });
});

describe("single-bracket markers become the canonical marker", () => {
  it("joins a stand-alone marker to its quote", () => {
    expect(normalizeCitationMarkers("świadek: „koordynator” [LEXDOC:doc_a:1].")).toBe("świadek: „koordynator” [[LEXDOC:doc_a:1]].");
    expect(normalizeCitationMarkers("„dla strony pozwanej.”  \n> [LEXDOC:doc_b:1]\nNatomiast")).toBe("„dla strony pozwanej.” [[LEXDOC:doc_b:1]]\nNatomiast");
    expect(normalizeCitationMarkers("bez zmian [[LEXDOC:doc_c:0]]")).toBe("bez zmian [[LEXDOC:doc_c:0]]");
  });
});

describe("the letter heading against the case card", () => {
  const court = { at: "2026-11-20T00:00:00Z", nazwa: "Sąd Okręgowy w Katowicach", wydzial: "X Wydział Pracy", sygnatura: "X P 1/26", zrodlo: "AKTA" as const };

  it("flags another case's signature and a court that is not the case's", () => {
    const letter = "Sąd Rejonowy właściwy dla sprawy I P 9/25\nSygn. akt I P 9/25\n\nPISMO PROCESOWE POWODA\nw sprawie o sygn. akt I P 9/25 świadek zeznał…";
    const findings = letterCaseMismatch(letter, court);
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain("„I P 9/25”");
    expect(findings[1]).toContain("SĄD DO SPRAWDZENIA");
  });

  it("is silent for the case's own heading and for signatures quoted in the text", () => {
    const letter = "Sąd Okręgowy w Katowicach\nX Wydział Pracy\nSygn. akt X P 1/26\n\nPISMO PROCESOWE POWODA\nW sprawie o sygn. akt I P 9/25 świadek zeznał inaczej.";
    expect(letterCaseMismatch(letter, court)).toEqual([]);
  });
});
