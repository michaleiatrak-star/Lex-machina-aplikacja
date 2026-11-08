import { describe, expect, it } from "vitest";
import { COURT_BASE } from "../src/courts/court-base-data.js";
import { COURT_BASE_AMENDMENTS } from "../src/courts/court-base-amendments.js";
import { amendmentsInForce, applyCourtAmendments, regionalCourt, type CourtBase } from "../src/courts/court-base.js";

const copy = (): CourtBase => JSON.parse(JSON.stringify(COURT_BASE)) as CourtBase;

describe("court base: amendments after the consolidated text, from the day in force", () => {
  it("Dz.U. 2026 poz. 1448: gmina Pokrówka (formerly Chełm) in SR Chełm from 1.01.2027, the same TERC", () => {
    const before = applyCourtAmendments(copy(), new Date("2026-12-31T12:00:00Z")).sr.find((court) => court.nazwa === "Sąd Rejonowy w Chełmie")!;
    const after = applyCourtAmendments(copy(), new Date("2027-01-01T12:00:00Z")).sr.find((court) => court.nazwa === "Sąd Rejonowy w Chełmie")!;
    expect(before.obszar.gminy).toContain("Chełm");
    expect(after.obszar.gminy).toContain("Pokrówka");
    expect(after.obszar.gminy).not.toContain("Chełm");
    expect(after.obszar_tekst).toMatch(/Kamień, Pokrówka, Ruda-Huta/u);
    expect(after.terc).toEqual(before.terc);
    expect(after.zakres).toEqual(before.zakres);
    expect(amendmentsInForce(new Date("2026-12-31T12:00:00Z"))).toEqual([]);
    expect(amendmentsInForce(new Date("2027-01-01T12:00:00Z")).map((amendment) => amendment.eli)).toEqual(["DU/2026/1448"]);
  });

  it("every amendment names a court of the base and a day", () => {
    for (const amendment of COURT_BASE_AMENDMENTS) {
      expect(regionalCourt(amendment.court), amendment.eli).not.toBeNull();
      expect(amendment.od).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
      expect(amendment.eli).toMatch(/^DU\/\d{4}\/\d+$/u);
    }
  });
});
