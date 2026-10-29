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

  it("a unit of an article verified as a whole under the act's name in words (RD 121/26)", () => {
    const ledger = new VerificationLedger();
    ledger.add({ claim: "art. 95n Prawa o adwokaturze", kind: "statute", status: "VERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2024/1564/text.html", fetchedAt: "2026-10-29T10:00:00.000Z", sourceTier: "R1", verificationMethod: "mcp_call", evidence: "Art. 95n. W sprawach nieuregulowanych w ustawie do postępowania dyscyplinarnego stosuje się odpowiednio przepisy: 1) Kodeksu postępowania karnego; 2) rozdziałów I-III Kodeksu karnego." });
    const out = marked("Stosowany odpowiednio na podstawie art. 95n pkt 1 Prawa o adwokaturze.\nZob. art. 95n pkt 3 Prawa o adwokaturze.", ledger);
    expect(out.split("\n")[0]).toContain("✅ [VER:");
    expect(out.split("\n")[0]).not.toContain("NIEWERYFIKOWANE");
    // No point 3 in the fetched article: not taken as verified.
    expect(out.split("\n")[1]).toContain("NIEWERYFIKOWANE");
  });

  it("the ⚠️ goes after the act's short name, not inside the citation (RD 121/26)", () => {
    const out = marked("Dane osobowe (art. 4 pkt 1 RODO). Podstawa: art. 95n pkt 1 Prawa o adwokaturze i art. 105 Prawa bankowego.", new VerificationLedger());
    expect(out).toContain("art. 4 pkt 1 RODO ⚠️ [NIEWERYFIKOWANE])");
    expect(out).toContain("art. 95n pkt 1 Prawa o adwokaturze ⚠️ [NIEWERYFIKOWANE]");
    expect(out).toContain("art. 105 Prawa bankowego ⚠️ [NIEWERYFIKOWANE]");
  });

  it("art. 101² is never art. 1012", () => {
    const out = marked("Zob. art. 1012 KP.", verified(["art. 101² KP"]));
    expect(out).toContain("NIEWERYFIKOWANE");
  });

  it("the marker never splits a superscript paragraph or a range (C12-007: „§ 2 ⚠️¹”, „§ 2 ⚠️–3”)", () => {
    const out = marked("Okres kończy się (art. 30 § 2¹ Kodeksu pracy).\nZob. art. 264 § 2–3 KP.", new VerificationLedger());
    expect(out).toContain("art. 30 § 2¹ Kodeksu pracy ⚠️ [NIEWERYFIKOWANE]");
    expect(out).toContain("art. 264 § 2–3 KP ⚠️ [NIEWERYFIKOWANE]");
  });

  it("a verified § 2¹ is its own paragraph, not § 2", () => {
    const out = marked("Okres: art. 30 § 2¹ KP.", verified(["art. 30 § 2 KP"]));
    expect(out).toContain("art. 30 § 2¹ KP ⚠️ [NIEWERYFIKOWANE]");
    expect(marked("Okres: art. 30 § 2¹ KP.", verified(["art. 30 § 2¹ KP"]))).not.toContain("NIEWERYFIKOWANE");
  });

  it("a code named in words on the line is that code, not another act (live C13-019)", () => {
    const text = "Chodzi o art. 177 Kodeksu pracy.\nWobec kobiet w ciąży (osób chronionych przez art. 177) ta reguła nie działa, z wyjątkiem przyczyn z art. 41¹ Kodeksu pracy.";
    const out = marked(text, verified(["art. 177 KP", "art. 41^1 KP"]));
    expect(out).not.toContain("NIEWERYFIKOWANE");
  });

  it("a statute written as a dotted abbreviation is that statute, never the answer's only code (E2E W3: u.k.k. read as KC)", () => {
    const ledger = verified(["art. 720^2 KC", "art. 36a ust. 1 ustawy o kredycie konsumenckim", "art. 5 pkt 7 ustawy o kredycie konsumenckim"]);
    ledger.add({ claim: "art. 36a ust. 1 KC", kind: "statute", status: "UNVERIFIED", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.pdf", fetchedAt: "2026-10-15T10:00:00.000Z", sourceTier: "R1", verificationMethod: "mcp_call" });
    const text = "Do pożyczki nie stosuje się art. 720² KC.\nLimit kosztów: art. 36a ust. 1 u.k.k.\nKoszty: art. 5 pkt 7 u. k. k.";
    const out = marked(text, ledger);
    expect(out.split("\n")[1]).toContain("✅ [VER:");
    expect(out.split("\n")[2]).toContain("✅ [VER:");
    expect(out).not.toContain("NIEWERYFIKOWANE");
    // An abbreviation without a known title: the article is not borrowed into KC.
    const other = new FinalizationGate().evaluate("Zob. art. 720² KC.\nOraz art. 12 u.x.y.", verified(["art. 720^2 KC", "art. 12 KC"]));
    expect(other.references.map((reference) => reference.claim)).not.toContain("art. 12 KC");
  });
});
