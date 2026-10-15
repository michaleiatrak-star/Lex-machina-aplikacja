import { describe, expect, it } from "vitest";
import { addMissingVerificationMarkers, FinalizationGate, markUnverifiedReferences } from "../src/finalization-gate.js";
import { compactActAbbreviations } from "../src/legal-act-abbreviations.js";
import { VerificationLedger } from "../src/verification-ledger.js";

const verified = (claims: string[]) => {
  const ledger = new VerificationLedger();
  for (const claim of claims) {
    ledger.add({ claim, kind: "statute", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/1/text.pdf", fetchedAt: "2026-10-15T10:00:00.000Z", sourceTier: "R1", verificationMethod: "mcp_call" });
  }
  return ledger;
};
const marked = (text: string, ledger: VerificationLedger) => {
  const report = new FinalizationGate().evaluate(text, ledger);
  return addMissingVerificationMarkers(markUnverifiedReferences(text, report), report);
};

describe("a provision verified in the session is recognized however the answer writes it", () => {
  it("codes named in words and superscript article numbers are the registry's provisions", () => {
    expect(compactActAbbreviations("art. 484 § 2 Kodeksu cywilnego")).toBe("art. 484 § 2 KC");
    expect(compactActAbbreviations("art. 101² § 1 kodeksem pracy")).toBe("art. 101^2 § 1 KP");
    expect(compactActAbbreviations("art. 187 Kodeksu postępowania cywilnego")).toBe("art. 187 KPC");
    const text = "Wynika to z art. 101² § 1 Kodeksu pracy.\nKara: art. 484 § 2 Kodeksu cywilnego.";
    const out = marked(text, verified(["art. 101² § 1 KP", "art. 484 § 2 KC"]));
    expect(out).not.toContain("NIEWERYFIKOWANE");
    expect(out.match(/✅ \[VER:/gu)).toHaveLength(2);
    // The marker never splits the article number.
    expect(out).toContain("art. 101² § 1 Kodeksu pracy.");
  });

  it("an act named in words matches its verified article; a different unit stays unverified", () => {
    const ledger = verified([
      "art. 11 ustawy z dnia 16 kwietnia 1993 r. o zwalczaniu nieuczciwej konkurencji",
      "art. 12 ust. 2 ustawy o ochronie konkurencji"
    ]);
    const out = marked("Przesłanki z art. 11 ustawy o zwalczaniu nieuczciwej konkurencji.\nPor. art. 12 ustawy o ochronie konkurencji.", ledger);
    expect(out.split("\n")[0]).toContain("✅ [VER:");
    expect(out.split("\n")[1]).toContain("art. 12 ⚠️ [NIEWERYFIKOWANE]");
  });

  it("art. 101² is never art. 1012", () => {
    const out = marked("Zob. art. 1012 KP.", verified(["art. 101² KP"]));
    expect(out).toContain("NIEWERYFIKOWANE");
  });
});
