import { describe, expect, it } from "vitest";
import { FinalizationGate, addMissingVerificationMarkers, expectedVerificationMarker, markUnverifiedReferences, UNVERIFIED_MARKER_TEXT } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

const MARKER = "✅ [VER: https://eli.gov.pl/a286, 2026-10-22]";

function ledger(): VerificationLedger {
  const result = new VerificationLedger();
  result.add({
    claim: "art. 286 KK", kind: "statute", status: "VERIFIED", sourceUrl: "https://eli.gov.pl/a286", sourceTier: "R1", fetchedAt: "2026-10-22T00:00:00Z", toolCallId: "v286",
    evidence: "Art. 286. § 1. Kto, w celu osiągnięcia korzyści majątkowej, doprowadza inną osobę do niekorzystnego rozporządzenia własnym lub cudzym mieniem za pomocą wprowadzenia jej w błąd, podlega karze pozbawienia wolności od 6 miesięcy do lat 8. § 3. W wypadku mniejszej wagi sprawca podlega grzywnie, karze ograniczenia wolności albo pozbawienia wolności do lat 2."
  });
  return result;
}

describe("a verified article covers its units, its quoted text and its penalties", () => {
  it("does not mark art. 286 § 1 KK, the quoted 'Art. 286.' or 'do lat 2' as unverified", () => {
    const text = [
      `Analiza art. 286 Kodeksu karnego (KK) ${MARKER}`,
      "> Art. 286. § 1. Kto, w celu osiągnięcia korzyści majątkowej, doprowadza inną osobę do niekorzystnego rozporządzenia",
      "> § 3. W wypadku mniejszej wagi sprawca podlega grzywnie, karze ograniczenia wolności albo pozbawienia wolności do lat 2.",
      "* § 3 (wypadek mniejszej wagi): grzywna, ograniczenie wolności lub pozbawienie wolności do lat 2.",
      `Kwalifikacja: Art. 286 §1 KK (wprowadzenie w błąd). ${MARKER}`
    ].join("\n");
    const records = ledger();
    const gate = new FinalizationGate();
    const before = gate.evaluate(text, records);
    const repaired = addMissingVerificationMarkers(markUnverifiedReferences(text, before), before);
    expect(repaired).not.toContain(UNVERIFIED_MARKER_TEXT);
    expect(gate.evaluate(repaired, records).findings.every((finding) => finding.status === "VERIFIED")).toBe(true);
  });

  it("still marks a unit of an unverified article, a unit missing from the fetched text and an act-less article next to a named regulation", () => {
    const records = ledger();
    const report = new FinalizationGate().evaluate(
      ["Art. 287 § 1 KK — oszustwo komputerowe.", "Art. 286 § 9 KK — taki paragraf nie istnieje.", "Rozporządzenie Rady Ministrów: art. 5."].join("\n"),
      records
    );
    expect(report.findings.map((finding) => finding.status)).toEqual(["MISSING_LEDGER_RECORD", "MISSING_LEDGER_RECORD", "MISSING_LEDGER_RECORD"]);
  });
});

describe("history of a provision's changes (statute analyzer widget)", () => {
  it("accepts the marker of each verified version on its own line (art. 276 KK, VERIFICATION_MARKER_MISMATCH in line 3)", () => {
    const records = new VerificationLedger();
    const current = { claim: "art. 276 KK", kind: "statute" as const, status: "VERIFIED" as const, sourceUrl: "https://eli.gov.pl/kk-2026", sourceTier: "R1" as const, fetchedAt: "2026-10-22T10:00:00Z", toolCallId: "v1" };
    const past = { ...current, sourceUrl: "https://eli.gov.pl/kk-2017", asOf: "2018-01-01", fetchedAt: "2026-10-22T10:01:00Z", toolCallId: "v2" };
    records.add(current);
    records.add(past);
    const text = ["# Historia zmian", "", `Art. 276 KK (brzmienie obecne) ${expectedVerificationMarker(current)}`, `Brzmienie na 2018-01-01: art. 276 KK ${expectedVerificationMarker(past)}`].join("\n");
    const gate = new FinalizationGate();
    const report = gate.evaluate(text, records);
    expect(report.findings.map((finding) => finding.status)).toEqual(["VERIFIED", "VERIFIED"]);
    expect(addMissingVerificationMarkers(text, report)).toBe(text);
    // A marker of no record of this claim still fails.
    const forged = text.replace("https://eli.gov.pl/kk-2026", "https://eli.gov.pl/inny");
    expect(gate.evaluate(forged, records).findings[0]!.status).toBe("VERIFICATION_MARKER_MISMATCH");
  });
});
