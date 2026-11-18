import { describe, expect, it } from "vitest";
import { completeBareArticleActs, detectLegalReferences, FinalizationGate } from "../src/finalization-gate.js";
import { compactActAbbreviations } from "../src/legal-act-abbreviations.js";
import { VerificationLedger } from "../src/verification-ledger.js";

// Control run of a pleading (0.2.0): markers the final layer got wrong. Universal patterns only.
const base = { kind: "statute" as const, status: "VERIFIED" as const, sourceTier: "R1" as const, fetchedAt: "2026-11-18T00:00:00Z" };

describe("a code written lower case without dots after an article", () => {
  it("is the same code: 'art. 190a kk' reads as 'art. 190a KK', other words stay", () => {
    expect(compactActAbbreviations("powołanie art. 190a kk nie jest oceną")).toBe("powołanie art. 190a KK nie jest oceną");
    expect(compactActAbbreviations("art. 5 § 1 kc.")).toBe("art. 5 § 1 KC.");
    expect(compactActAbbreviations("zespół kk nie jest kodeksem")).toBe("zespół kk nie jest kodeksem");
  });

  it("is not a bare article: no second code is written after it", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, claim: "art. 190a KK", toolCallId: "v1", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/1342/text.pdf" });
    const text = "W tym kontekście powołanie art. 190a kk nie jest neutralną oceną.";
    expect(completeBareArticleActs(text, ledger).text).toBe(text);
  });
});

describe("an article named with the act of its verified unit", () => {
  it("'art. 88a Prawa o adwokaturze' is covered by the verified 'art. 88a ust. 4 Prawa o adwokaturze'", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, claim: "art. 88a ust. 4 Prawa o adwokaturze", toolCallId: "v1", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2024/1564/text.html", evidence: "Art. 88a. 1. … 4. Od orzeczeń …" });
    const text = "- S1: sąsiedztwo art. 88a Prawa o adwokaturze — ust. 2–3 dotyczą uzasadnienia.";
    const finding = new FinalizationGate().evaluate(text, ledger).findings.find((item) => item.reference.claim.startsWith("art. 88a"));
    expect(finding?.record?.claim).toBe("art. 88a ust. 4 Prawa o adwokaturze");
  });
});

describe("the amending act named as the source of the wording", () => {
  it("'(Dz.U. 2026 poz. 1290)' of the amendment a verified provision was read with is verified", () => {
    const ledger = new VerificationLedger();
    ledger.add({
      ...base,
      claim: "art. 91 ust. 2 Prawa o adwokaturze",
      toolCallId: "v1",
      sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2024/1564/text.html",
      currentEli: "DU/2024/1564",
      amendedBy: ["DU/2026/1290"]
    });
    const text = "Przepis obowiązuje w brzmieniu nadanym ustawą z 2026 r. (Dz.U. 2026 poz. 1290).";
    const journal = detectLegalReferences(text).find((reference) => reference.kind === "journal");
    expect(journal).toBeDefined();
    const report = new FinalizationGate().evaluate(text, ledger);
    expect(report.findings.find((finding) => finding.reference.kind === "journal")?.status).toBe("VERIFIED");
  });
});
