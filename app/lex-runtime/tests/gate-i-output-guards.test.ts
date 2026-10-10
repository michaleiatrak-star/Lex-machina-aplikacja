import { describe, expect, it } from "vitest";
import { evaluateDomainLock, evaluateRateCompleteness } from "../src/gate-i-output-guards.js";

describe("G39I output guards", () => {
  it("rozpoznaje stawki zapisane z % i zł oraz kwotę łączną", () => {
    const report = evaluateRateCompleteness(
      "Odsetki ustawowe za opóźnienie wynoszą 11,25%.\nOdsetki: 1 000 zł.\nŁącznie do zapłaty z odsetkami 1 250 zł."
    );
    expect(report.triggered).toBe(true);
    expect(report.numericRateLines).toBe(3);
    expect(report.unverifiedNumericRateLines).toBe(3);
    expect(report.aggregateClaim).toBe(true);
    expect(report.missing).toEqual(["RATE_LINE_VERIFICATION_MARKER", "RATE_INTERVAL", "RATE_SERIES_TABLE"]);
    expect(evaluateRateCompleteness("Odsetki naliczane od kwoty 100 złotych.").numericRateLines).toBe(1);
    expect(evaluateRateCompleteness("Odsetki naliczane od kwoty 100 złożonej w banku.").numericRateLines).toBe(0);
  });

  it("rozpoznaje powołanie karne zapisane jako k.k.", () => {
    const report = evaluateDomainLock({ text: "Czyn wyczerpuje znamiona art. 148 § 1 k.k.", loadedSkills: [] });
    expect(report.criminalLegalReferences).toEqual(["art. 148 § 1 KK"]);
    expect(report.result).toBe("BLOCKED");
    expect(evaluateDomainLock({ text: "Zob. art.148 KK.", loadedSkills: ["dr-03-prawo-karne-wykroczenia-egzekucja"] }).result).toBe("PASS");
  });
});
