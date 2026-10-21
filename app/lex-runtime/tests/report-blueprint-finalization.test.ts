import { describe, expect, it } from "vitest";
import { FinalizationGate } from "../src/finalization-gate.js";
import { blueprintFinalizationText } from "../src/report-blueprint-finalization.js";
import { VerificationLedger } from "../src/verification-ledger.js";

function ledger(): VerificationLedger {
  const result = new VerificationLedger();
  result.add({ claim: "art. 286 § 1 KK", kind: "statute", status: "VERIFIED", sourceUrl: "https://eli.gov.pl/kk286", sourceTier: "R1", fetchedAt: "2026-10-21T00:00:00Z", toolCallId: "v286" });
  return result;
}

const answer = "## Podstawa\nart. 286 § 1 k.k. ✅ [VER: https://eli.gov.pl/kk286, 2026-10-21]";

describe("G8 on the situation report blueprint (raport-sytuacyjny-v2 E2E)", () => {
  it("passes a provision verified in this turn cited in the plain \"przepis\" field", () => {
    const text = blueprintFinalizationText(answer, { przepis: "art. 286 § 1 k.k.", s1rola: "pokrzywdzony" }, ledger());
    expect(new FinalizationGate().evaluate(text, ledger()).result).toBe("PASS");
  });

  it("still blocks a provision the turn did not verify", () => {
    const text = blueprintFinalizationText(answer, { przepis: "art. 284 § 1 k.k." }, ledger());
    expect(new FinalizationGate().evaluate(text, ledger()).result).toBe("BLOCKED");
  });
});
