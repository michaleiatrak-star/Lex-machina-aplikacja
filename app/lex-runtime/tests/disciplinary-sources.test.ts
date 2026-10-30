import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { courtOfSignature, officialCaseLawCall, signaturesIn } from "../src/court-of-signature.js";
import { detectLegalReferences } from "../src/finalization-gate.js";
import { legacyWordText } from "../src/auxiliary-source-fetcher.js";
import { mergeThreadEvidence, validThreadEvidence } from "../src/thread-evidence.js";

// RD 121/26: the bar's disciplinary case law and its code of ethics are outside the MCP
// connectors; the reference letter cited WSD 113/22, 77/22, 128/17 and SDI 9/12.
describe("disciplinary case law and ethics codes", () => {
  it("a WSD signature is the bar's disciplinary court, also without „sygn.”", () => {
    expect(courtOfSignature("WSD 113/22")).toBe("DYSCYPLINARNY");
    expect(courtOfSignature("SDI 9/12")).toBe("SN");
    expect(signaturesIn("WSD 77/22 i WSD 128/17").map((item) => item.signature)).toEqual(["WSD 77/22", "WSD 128/17"]);
    expect(detectLegalReferences("Tak też WSD 77/22 oraz SN, SDI 9/12.").filter((reference) => reference.kind === "case").map((reference) => reference.claim))
      .toEqual(["WSD 77/22", "SDI 9/12"]);
  });

  it("a ruling read on the court's own portal is an official anchor; a law firm's page is a lead", () => {
    expect(officialCaseLawCall({ name: "fetch_auxiliary_legal_source", input: { url: "https://wsd.adwokatura.pl/orzeczenia/wsd-113-22" } })).toBe(true);
    expect(officialCaseLawCall({ name: "fetch_auxiliary_legal_source", input: { url: "https://kancelaria.example.pl/wsd-113-22" } })).toBe(false);
  });

  it("reads the text of a Word 97 file (.doc), Polish letters and § kept", () => {
    const text = legacyWordText(new Uint8Array(fs.readFileSync(path.join(__dirname, "fixtures/kea-sample.doc"))));
    expect(text).toContain("§ 16. Adwokat w korespondencji zawodowej nie może grozić ściganiem karnym lub dyscyplinarnym.");
    expect(text).toContain("Zbiór Zasad Etyki Adwokackiej i Godności Zawodu");
  });

  it("the thread keeps the case's signatures for the file rendered later", () => {
    const first = mergeThreadEvidence(null, [], [], "2026-10-30T10:00:00Z", { caseReferences: ["VIII W 633/25"] });
    const second = mergeThreadEvidence(first, [], [], "2026-10-30T11:00:00Z", { caseReferences: ["VII P 94/25", "VIII W 633/25"] });
    expect(second.caseReferences).toEqual(["VIII W 633/25", "VII P 94/25"]);
    expect(validThreadEvidence(JSON.parse(JSON.stringify(second)))?.caseReferences).toEqual(["VIII W 633/25", "VII P 94/25"]);
  });
});
