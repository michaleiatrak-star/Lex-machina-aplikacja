import { describe, expect, it } from "vitest";
import { hearingLine, hearingStartsAt } from "./CaseCourtCard.js";
import { wokandaGroup } from "./WokandaRegisterPanel.js";

const hearing = { sygnatura: "XI C 1768/26", wydzial: "XI Wydział Cywilny Rodzinny SO", data: "2026-11-05", godzina: "08:00", sala: "A-17", status: "", miejsce: "ul. Przy Rondzie 7", przewodniczacy: "SSO Anna Testowa", url: "https://krakow.so.gov.pl/wokanda,410" };

describe("wokanda w sprawie", () => {
  it("termin z wokandy: czas lokalny tego komputera i opis w jednej linii", () => {
    expect(new Date(hearingStartsAt(hearing)).getHours()).toBe(8);
    expect(hearingLine(hearing)).toBe("2026-11-05 08:00 · sala A-17 · ul. Przy Rondzie 7 · XI Wydział Cywilny Rodzinny SO · przewodniczący: SSO Anna Testowa");
  });

  it("rejestr: sądy jednej grupy, wyszukiwane bez polskich znaków, alfabetycznie", () => {
    const courts = [
      { nazwa: "Sąd Rejonowy w Żywcu", domena: "zywiec.sr.gov.pl", status: "PORTAL" as const },
      { nazwa: "Sąd Okręgowy w Krakowie", domena: "krakow.so.gov.pl", status: "PORTAL" as const },
      { nazwa: "Sąd Okręgowy w Olsztynie", domena: "olsztyn.so.gov.pl", status: "BROWSER" as const }
    ];
    expect(wokandaGroup(courts, "PORTAL", "").map((court) => court.nazwa)).toEqual(["Sąd Okręgowy w Krakowie", "Sąd Rejonowy w Żywcu"]);
    expect(wokandaGroup(courts, "PORTAL", "zywiec").map((court) => court.domena)).toEqual(["zywiec.sr.gov.pl"]);
    expect(wokandaGroup(courts, "BROWSER", "krakow")).toEqual([]);
  });
});
