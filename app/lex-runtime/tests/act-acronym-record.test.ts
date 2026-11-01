import { describe, expect, it } from "vitest";
import { VerificationLedger } from "../src/verification-ledger.js";
import { expectedVerificationMarker, FinalizationGate } from "../src/finalization-gate.js";
import { evaluateStatusConsistency, reconcileStatusMarkers, unifyConflictingProvisions } from "../src/status-consistency-gate.js";

const base = { kind: "statute" as const, status: "VERIFIED" as const, sourceTier: "R1" as const, fetchedAt: "2026-10-23T10:00:00Z", toolCallId: "t", verificationMethod: "file_read" as const };

function ledgerWith(claim: string, url: string, evidence: string): { ledger: VerificationLedger; marker: string } {
  const ledger = new VerificationLedger();
  ledger.add({ ...base, claim, sourceUrl: url, evidence } as never);
  return { ledger, marker: expectedVerificationMarker(ledger.latest(claim)!)! };
}

const ppsa = () => ledgerWith(
  "art. 52 § 3 Prawa o postępowaniu przed sądami administracyjnymi",
  "https://api.sejm.gov.pl/eli/acts/DU/2026/143/text.pdf",
  "§ 3. Jeżeli ustawa nie przewiduje środków zaskarżenia w sprawie będącej przedmiotem skargi, skarga może być wniesiona po wezwaniu."
);

describe("an act-less article whose act the line names by its acronym", () => {
  it("PPSA is the verified Prawo o postępowaniu przed sądami administracyjnymi (live B02-P04)", () => {
    const { ledger } = ppsa();
    // No marker of its own on the line: the record is found by the acronym, so the gate adds its ✅.
    const report = new FinalizationGate().evaluate("S3 akty powiązane — PPSA art. 52 § 3 i art. 16 KPA zweryfikowane.", ledger);
    expect(report.findings.find((finding) => finding.reference.claim === "art. 52 § 3")?.record?.claim).toBe("art. 52 § 3 Prawa o postępowaniu przed sądami administracyjnymi");
  });

  it("a verified ✅ is not unified to ⚠️ because another line names the act by acronym", () => {
    const { ledger, marker } = ppsa();
    const text = [
      `Co więcej, art. 52 § 3 Prawa o postępowaniu przed sądami administracyjnymi (PPSA) ${marker} pozwala wnieść skargę.`,
      "S3 akty powiązane — PPSA art. 52 § 3 ⚠️ [NIEWERYFIKOWANE] zweryfikowane i zacytowane."
    ].join("\n");
    const reconciled = reconcileStatusMarkers(text, ledger).text;
    const unified = unifyConflictingProvisions(reconciled, ledger).text;
    expect(unified).not.toContain("NIEWERYFIKOWANE");
    expect(unified.split(marker).length - 1).toBe(2);
    expect(evaluateStatusConsistency(unified, ledger).result).toBe("PASS");
  });

  it("any statute's acronym from its title, with no list of abbreviations (u.k.s.c.)", () => {
    const { ledger } = ledgerWith(
      "art. 8 ustawy o krajowym systemie cyberbezpieczeństwa",
      "https://api.sejm.gov.pl/eli/acts/DU/2026/700/text.pdf",
      "Art. 8. Podmiot kluczowy wdraża system zarządzania bezpieczeństwem."
    );
    const report = new FinalizationGate().evaluate("Obowiązek wynika z art. 8 u.k.s.c. i dotyczy podmiotów kluczowych.", ledger);
    expect(report.findings.find((finding) => finding.reference.claim.startsWith("art. 8"))?.record?.claim).toBe("art. 8 ustawy o krajowym systemie cyberbezpieczeństwa");
  });

  it("an acronym that is not the verified act's stays unverified", () => {
    const { ledger } = ppsa();
    const text = "Według XYZ art. 52 § 3 ⚠️ [NIEWERYFIKOWANE] skarga przysługuje.";
    const unified = unifyConflictingProvisions(reconcileStatusMarkers(text, ledger).text, ledger).text;
    expect(unified).toContain("⚠️ [NIEWERYFIKOWANE]");
    const report = new FinalizationGate().evaluate(text, ledger);
    expect(report.findings.find((finding) => finding.reference.claim === "art. 52 § 3")?.status).not.toBe("VERIFIED");
  });
});
