import { describe, expect, it } from "vitest";
import { hearingInCalendar } from "./CaseCourtCard.js";
import { DEPARTMENTS, composeSignature, repertoriesFor, signatureYears, splitSignature } from "./case-signature.js";

describe("sygnatura jak w sądzie: wydział, repertorium, numer, rok", () => {
  it("składa zapis sądowy z pól (rok dwucyfrowo) i rozkłada go z powrotem", () => {
    expect(composeSignature({ wydzial: "XI", repertorium: "C", numer: "1768", rok: "2026" })).toBe("XI C 1768/26");
    expect(composeSignature({ wydzial: "i", repertorium: "ACa", numer: "0804", rok: "2025" })).toBe("I ACa 804/25");
    expect(composeSignature({ wydzial: "II", repertorium: "1Ca", numer: "45", rok: "2025" })).toBe("II 1Ca 45/25");
    expect(splitSignature("sygn. akt XI C 1768/26")).toEqual({ wydzial: "XI", repertorium: "C", numer: "1768", rok: "2026" });
    expect(splitSignature("V RC 631/2026")).toEqual({ wydzial: "V", repertorium: "RC", numer: "631", rok: "2026" });
  });

  it("niepełna albo błędna sygnatura nie powstaje", () => {
    expect(composeSignature({ wydzial: "XI", repertorium: "C", numer: "", rok: "2026" })).toBeNull();
    expect(composeSignature({ wydzial: "11", repertorium: "C", numer: "1768", rok: "2026" })).toBeNull();
    expect(composeSignature({ wydzial: "XI", repertorium: "c", numer: "1768", rok: "2026" })).toBeNull();
    expect(splitSignature("III CZP 12")).toBeNull();
  });

  it("listy: wydziały I–XXX, repertoria według rodzaju sądu, lata wstecz", () => {
    expect(DEPARTMENTS[0]).toBe("I");
    expect(DEPARTMENTS[13]).toBe("XIV");
    expect(DEPARTMENTS).toHaveLength(30);
    expect(repertoriesFor("Sąd Apelacyjny w Krakowie")).toContain("ACa");
    expect(repertoriesFor("Sąd Apelacyjny w Krakowie")).not.toContain("C");
    expect(repertoriesFor("Sąd Okręgowy w Krakowie")).toEqual(expect.arrayContaining(["C", "Ca", "Ka", "GC"]));
    expect(repertoriesFor("Sąd Rejonowy w Chełmie")).toEqual(expect.arrayContaining(["C", "Nc", "K", "W", "RC"]));
    expect(signatureYears(new Date("2026-11-05T12:00:00Z")).slice(0, 2)).toEqual(["2026", "2025"]);
  });
});

describe("termin z wokandy a kalendarz sprawy", () => {
  it("rozprawa o tej samej minucie już w kalendarzu: bez ponownego dodania", () => {
    const hearing = { data: "2026-11-05", godzina: "08:00" };
    const at = new Date("2026-11-05T08:00:00").toISOString();
    expect(hearingInCalendar(hearing, [{ kind: "COURT_HEARING", startsAt: at }])).toBe(true);
    expect(hearingInCalendar(hearing, [{ kind: "CLIENT_MEETING", startsAt: at }])).toBe(false);
    expect(hearingInCalendar(hearing, [{ kind: "COURT_HEARING", startsAt: new Date("2026-11-05T09:00:00").toISOString() }])).toBe(false);
  });
});
