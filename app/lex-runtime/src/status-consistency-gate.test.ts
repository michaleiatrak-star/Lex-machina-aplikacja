import { describe, expect, it } from "vitest";
import { FinalizationGate } from "./finalization-gate.js";
import {
  evaluateStatusConsistency,
  reconcileStatusMarkers
} from "./status-consistency-gate.js";
import { VerificationLedger } from "./verification-ledger.js";

const KK = "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf";
const VER_233 = `✅ [VER: ${KK}#page=97, 2026-10-02]`;
const VER_234 = `✅ [VER: ${KK}#page=98, 2026-10-02]`;

function ledgerWithKk(): VerificationLedger {
  const ledger = new VerificationLedger();
  for (const [claim, page] of [
    ["art. 233 KK", 97],
    ["art. 234 KK", 98]
  ] as const) {
    ledger.add({
      claim,
      kind: "statute",
      status: "VERIFIED",
      sourceUrl: KK,
      sourceAnchorUrl: `${KK}#page=${page}`,
      sourceTier: "R1",
      fetchedAt: "2026-10-02T10:00:00.000Z",
      verificationMethod: "web_fetch_pdf",
      sourceFormat: "PDF",
      temporalMode: "CURRENT",
      temporalFreshnessStatus: "CURRENT"
    });
  }
  return ledger;
}

// Odpowiedź z błędu zgłoszonego 2026-10-02: najpierw ✅, w podsumowaniu ⚠️ i „potencjalnie”.
const CONTRADICTORY_ANSWER = [
  `Fałszywe zeznania: art. 233 KK ${VER_233}`,
  `Fałszywe oskarżenie: art. 234 KK ${VER_234}`,
  "",
  "Podsumowanie: potencjalnie art. 233 i 234 KK ⚠️ [NIEWERYFIKOWANE]"
].join("\n");

describe("G39I status consistency gate", () => {
  it("detects a provision marked VERIFIED and later NIEWERYFIKOWANE", () => {
    const report = evaluateStatusConsistency(CONTRADICTORY_ANSWER, new VerificationLedger());

    expect(report.result).toBe("BLOCKED");
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "art. 233 kk", code: "CONFLICTING_STATUS", lines: [1, 4] }),
        expect.objectContaining({ key: "art. 234 kk", code: "CONFLICTING_STATUS", lines: [2, 4] })
      ])
    );
  });

  it("names the contradiction with the ledger and the mixing with application assessment", () => {
    const report = evaluateStatusConsistency(CONTRADICTORY_ANSWER, ledgerWithKk());
    const codes = report.findings.map((finding) => `${finding.key}:${finding.code}`);

    expect(codes).toEqual(
      expect.arrayContaining([
        "art. 233 kk:STATUS_CONTRADICTS_LEDGER",
        "art. 233 kk:STATUS_MIXED_WITH_APPLICATION",
        "art. 234 kk:STATUS_CONTRADICTS_LEDGER"
      ])
    );
  });

  it("repairs the summary from the ledger so each provision has one status", () => {
    const ledger = ledgerWithKk();
    const repaired = reconcileStatusMarkers(CONTRADICTORY_ANSWER, ledger);

    expect(repaired.repaired).toBe(1);
    expect(repaired.text).not.toContain("NIEWERYFIKOWANE");
    expect(repaired.text.split("\n")[3]).toBe(
      `Podsumowanie: potencjalnie art. 233 i 234 KK ${VER_233} ${VER_234}`
    );
    expect(evaluateStatusConsistency(repaired.text, ledger).result).toBe("PASS");
    expect(new FinalizationGate().evaluate(repaired.text, ledger).result).toBe("PASS");
  });

  it("flags two contradictory markers on one line", () => {
    const text = `Art. 233 KK ${VER_233} – ocena: ⚠️ [NIEWERYFIKOWANE]`;

    const report = evaluateStatusConsistency(text, new VerificationLedger());
    expect(report.findings[0]).toMatchObject({
      key: "art. 233 kk",
      code: "CONFLICTING_STATUS",
      statuses: ["CONFLICT"]
    });

    const repaired = reconcileStatusMarkers(text, ledgerWithKk());
    expect(repaired.text).toBe(`Art. 233 KK ${VER_233} – ocena:`);
  });

  it("keeps NIEWERYFIKOWANE for the unverified provision in a mixed group", () => {
    const text = "Zob. art. 233 KK i art. 999 KK ⚠️ [NIEWERYFIKOWANE]";
    const ledger = ledgerWithKk();
    const repaired = reconcileStatusMarkers(text, ledger);

    expect(repaired.text).toBe(
      `Zob. art. 233 KK ${VER_233} i art. 999 KK ⚠️ [NIEWERYFIKOWANE]`
    );
    expect(evaluateStatusConsistency(repaired.text, ledger).result).toBe("PASS");
  });

  it("drops an invented VER marker and keeps the unverified status", () => {
    const text = "Znaczenie ma art. 5 KC ⚠️ [NIEWERYFIKOWANE]. ✅ [VER: https://eli.gov.pl/fake, 2026-09-15]";

    const repaired = reconcileStatusMarkers(text, ledgerWithKk());
    expect(repaired.text).toBe("Znaczenie ma art. 5 KC ⚠️ [NIEWERYFIKOWANE].");
    expect(evaluateStatusConsistency(repaired.text, ledgerWithKk()).result).toBe("PASS");
  });

  it("does not invent VERIFIED without a ledger record", () => {
    const text = [
      `Art. 233 KK ${VER_233}`,
      "Podsumowanie: art. 233 KK ⚠️ [NIEWERYFIKOWANE]"
    ].join("\n");

    const repaired = reconcileStatusMarkers(text, new VerificationLedger());
    expect(repaired).toEqual({ text, repaired: 0 });
    expect(evaluateStatusConsistency(text, new VerificationLedger()).result).toBe("BLOCKED");
  });

  it("resolves a bare article to the only act it is cited with", () => {
    const text = [
      `Art. 233 KK ${VER_233}`,
      "Wniosek: art. 233 ⚠️ [NIEWERYFIKOWANE]"
    ].join("\n");

    const report = evaluateStatusConsistency(text, new VerificationLedger());
    expect(report.findings[0]).toMatchObject({ key: "art. 233 kk", code: "CONFLICTING_STATUS" });
  });

  it("passes a consistent answer and reports an unattributable marker without blocking", () => {
    const text = [
      `Art. 233 KK ${VER_233}`,
      `Podsumowanie: art. 233 KK ${VER_233}`,
      "Pozycje oznaczone ⚠️ [NIEWERYFIKOWANE] wymagają sprawdzenia."
    ].join("\n");

    const report = evaluateStatusConsistency(text, ledgerWithKk());
    expect(report.result).toBe("PASS");
    expect(report.provisions).toEqual([
      { key: "art. 233 kk", status: "VERIFIED", lines: [1, 2] }
    ]);
    expect(report.orphanUnverifiedLines).toEqual([3]);
  });

  it("treats a hyphenated range as one citation, not separate provisions", () => {
    const report = evaluateStatusConsistency(
      "Art. 233–234 KK ⚠️ [NIEWERYFIKOWANE]",
      new VerificationLedger()
    );
    expect(report.provisions.map((item) => item.key)).toEqual(["art. 233 kk"]);
  });
});
