import { describe, expect, it } from "vitest";
import { completeBareArticleActs, detectLegalReferences, expectedVerificationMarker, FinalizationGate, OUTSIDE_FILES_PROCEEDING_MARKER_TEXT, refreshVerMarkerDates, softenRemainingBlockers, UNCONFIRMED_CASE_MARKER_TEXT } from "../src/finalization-gate.js";
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

describe("a party's other proceeding named as a fact", () => {
  it("is marked as outside the files, a ruling relied on stays 'not confirmed in databases'", () => {
    const ledger = new VerificationLedger();
    const text = ["13.11.2026 r. w V P 3/26 świadek zeznał inaczej.", "Zob. wyrok SA z 3.03.2020 r., I ACa 999/20."].join("\n");
    const softened = softenRemainingBlockers(text, new FinalizationGate().evaluate(text, ledger)).text;
    expect(softened).toContain(`V P 3/26 ${OUTSIDE_FILES_PROCEEDING_MARKER_TEXT}`);
    expect(softened).toContain(`I ACa 999/20 ${UNCONFIRMED_CASE_MARKER_TEXT}`);
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

describe("a marker of this turn's reading carried over with an older date", () => {
  it("gets this turn's date in place; a link the turn did not read stays", () => {
    const ledger = new VerificationLedger();
    ledger.add({ ...base, claim: "art. 244 § 1 KPC", toolCallId: "v1", sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/468/text.pdf", evidence: "Art. 244. § 1. Dokumenty urzędowe …" });
    const marker = expectedVerificationMarker(ledger.latest("art. 244 § 1 KPC")!)!;
    const link = /^✅ \[VER: ([^,]+),/u.exec(marker)![1]!;
    const old = `(art. 244 § 1 KPC ✅ [VER: ${link}, 2020-01-01]) i (art. 5 KC ✅ [VER: https://example.org/x, 2020-01-01])`;
    expect(refreshVerMarkerDates(old, ledger)).toBe(`(art. 244 § 1 KPC ${marker}) i (art. 5 KC ✅ [VER: https://example.org/x, 2020-01-01])`);
  });
});
