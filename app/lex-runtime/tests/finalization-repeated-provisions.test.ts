import { describe, expect, it } from "vitest";
import { FinalizationGate, addMissingVerificationMarkers, markUnverifiedReferences } from "../src/finalization-gate.js";
import { evaluateStatusConsistency, reconcileStatusMarkers } from "../src/status-consistency-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";

function ledger(): VerificationLedger {
  const result = new VerificationLedger();
  for (const [article, url] of [["233 § 1", "https://eli.gov.pl/a233"], ["234", "https://eli.gov.pl/a234"], ["238", "https://eli.gov.pl/a238"]] as const) {
    result.add({ claim: `art. ${article} KK`, kind: "statute", status: "VERIFIED", sourceUrl: url, sourceTier: "R1", fetchedAt: "2026-10-03T00:00:00Z", toolCallId: `v${article}` });
  }
  return result;
}

function finalize(text: string, records: VerificationLedger) {
  const gate = new FinalizationGate();
  const before = gate.evaluate(text, records);
  const repaired = reconcileStatusMarkers(addMissingVerificationMarkers(markUnverifiedReferences(text, before), before), records).text;
  return { before, text: repaired, after: gate.evaluate(repaired, records), consistency: evaluateStatusConsistency(repaired, records) };
}

describe("G8: verified provisions cited again (233/234/238 KK comparison)", () => {
  it("adds the ledger markers to repeated mentions and a comparison table instead of blocking", () => {
    const text = [
      "Art. 233 § 1 KK — fałszywe zeznania. ✅ [VER: https://eli.gov.pl/a233, 2026-10-03]",
      "Art. 234 KK — fałszywe oskarżenie. ✅ [VER: https://eli.gov.pl/a234, 2026-10-03]",
      "Art. 238 KK — fałszywe zawiadomienie. ✅ [VER: https://eli.gov.pl/a238, 2026-10-03]",
      "",
      "| Cecha | art. 233 § 1 KK | art. 234 KK | art. 238 KK |",
      "|---|---|---|---|",
      "W odróżnieniu od art. 238 KK przepis art. 234 KK wymaga wskazania osoby."
    ].join("\n");
    const result = finalize(text, ledger());
    expect(result.before.result).toBe("BLOCKED");
    expect(result.after.result).toBe("PASS");
    expect(result.consistency.result).toBe("PASS");
    const table = result.text.split("\n")[4]!;
    expect(table.endsWith("|")).toBe(true);
    expect(table).toContain("https://eli.gov.pl/a234");
  });

  it("keeps blocking a fabricated verification marker", () => {
    const text = "Art. 233 § 1 KK — fałszywe zeznania. ✅ [VER: https://example.com/zmyslone, 2026-10-03]";
    expect(finalize(text, ledger()).after.result).toBe("BLOCKED");
  });
});
