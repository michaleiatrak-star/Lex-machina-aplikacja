import { describe, expect, it } from "vitest";
import { FinalizationGate } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { verificationMarker } from "../src/source-anchor.js";

// Wersja 0.1.27: uchwała SN zweryfikowana pod brzmieniem modelu "uchwała SN, sygn. I KZP 3/24",
// odpowiedź pisze "sygn. I KZP 3/24" -> G8 MISSING_LEDGER_RECORD i zamknięta sesja.
const record = {
  claim: "uchwała SN, sygn. I KZP 3/24",
  kind: "case" as const,
  status: "VERIFIED" as const,
  sourceUrl: "https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=r10zSJcBZvGrB8P_BYpV",
  sourceTier: "R1" as const,
  fetchedAt: "2026-10-13T10:00:00Z",
  toolCallId: "sn-1",
  verificationMethod: "web_fetch" as const,
  sourceFormat: "TEXT" as const,
  caseScope: "FULL_TEXT" as const,
  caseSignature: "I KZP 3/24"
};

describe("G8: case record found by its verified signature, not only by the model's wording", () => {
  it("passes the verified SN resolution written as sygn. / sygn. akt", () => {
    const ledger = new VerificationLedger();
    ledger.add(record);
    const marker = verificationMarker(record);
    for (const written of ["sygn. I KZP 3/24", "sygn. akt I KZP 3/24", "sygn. I KZP 3/24".replace(" 3", "  3")]) {
      const report = new FinalizationGate().evaluate(`Uchwała SN z 2.10.2024 r., ${written} ${marker}`, ledger);
      expect(report.findings.map((finding) => finding.status)).toEqual(["VERIFIED"]);
    }
  });

  it("does not take a different signature or a quote-only record", () => {
    const ledger = new VerificationLedger();
    ledger.add(record);
    expect(new FinalizationGate().evaluate("Uchwała SN, sygn. I KZP 4/24", ledger).findings[0]?.status).toBe("MISSING_LEDGER_RECORD");
    const quoteOnly = new VerificationLedger();
    quoteOnly.add({ ...record, claim: "cytat z uzasadnienia", caseScope: "EXACT_QUOTE", evidenceHash: "e", supportQuoteHash: "q", supportQuote: "x" } as never);
    expect(new FinalizationGate().evaluate("Uchwała SN, sygn. I KZP 3/24", quoteOnly).findings[0]?.status).toBe("MISSING_LEDGER_RECORD");
  });
});
