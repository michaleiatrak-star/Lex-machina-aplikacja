import { describe, expect, it } from "vitest";
import { classifyDocument, unicodeWordBoundaries } from "../src/document-kind.js";

// RD 121/26 (2026-11-17): "\b" in JavaScript knows only ASCII letters, so "PROTOKÓŁ" at the end of
// a line had no word boundary and the protocol read as "nierozpoznany"; the report to the bar
// council and the advocate's explanations had no rule at all. All three fell out of the matrix.
describe("document kinds with Polish letters", () => {
  it("a word boundary after a Polish letter", () => {
    expect(/PROTOKÓŁ\b/u.test("PROTOKÓŁ\nrozprawy")).toBe(false);
    expect(unicodeWordBoundaries(/PROTOKÓŁ\b/u).test("PROTOKÓŁ\nrozprawy")).toBe(true);
    expect(unicodeWordBoundaries(/\bŁ\p{L}+/u).test("na Łodzi")).toBe(true);
    // An escaped backslash before "b" stays a literal.
    expect(unicodeWordBoundaries(/a\\b/u).test("a\\b")).toBe(true);
  });

  it("the protocol of a hearing", () => {
    const text = "Sąd Rejonowy\nSygn. akt VII P 94/25\nPROTOKÓŁ\nrozprawy z dnia 16 października 2025 r.\nPrzewodniczący: SSR\nŚwiadek zeznał, że każda taka sytuacja będzie traktowana jako nękanie.";
    expect(classifyDocument({ text }).kind).toMatch(/^PROTOKOL/);
  });

  it("a report of a disciplinary wrongdoing and the advocate's explanations", () => {
    const report = "Okręgowa Rada Adwokacka w Warszawie\nZAWIADOMIENIE\no podejrzeniu popełnienia przewinienia dyscyplinarnego przez adwokata\nZawiadamiam, że adwokat w piśmie z 4 maja 2026 r. powołał się na RODO.";
    expect(classifyDocument({ text: report }).kind).toBe("ZAWIADOMIENIE");
    const explanations = "Rzecznik Dyscyplinarny Izby Adwokackiej\nWYJAŚNIENIA\nW odpowiedzi na zawiadomienie wyjaśniam, że pismo z 4 maja 2026 r. nie powoływało RODO.";
    expect(classifyDocument({ text: explanations }).kind).toBe("WYJASNIENIA");
  });
});
