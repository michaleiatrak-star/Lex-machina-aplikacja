import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { courtOfSignature, officialCaseLawCall, signaturesIn } from "../src/court-of-signature.js";
import { caseMaterialSignatures, detectLegalReferences } from "../src/finalization-gate.js";
import { astBlockLines } from "../src/session-executor.js";
import { planAutomaticLegalVerification } from "../src/gate-i-auto-verification.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { legacyWordText } from "../src/auxiliary-source-fetcher.js";
import { mergeThreadEvidence, validThreadEvidence } from "../src/thread-evidence.js";
import { PublicWebSearch } from "../src/web-search.js";

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

  it("the other professions' disciplinary courts publish on their own sites: an official anchor", () => {
    for (const url of ["https://nil.org.pl/orzeczenia/123", "https://www.komornik.pl/?page_id=212", "https://www.pibr.org.pl/pl/krajowy-sad-dyscyplinarny", "https://www.piib.org.pl/14-krajowy-sad-dyscyplinarny"]) {
      expect(officialCaseLawCall({ name: "fetch_auxiliary_legal_source", input: { url } })).toBe(true);
    }
  });

  it("a bot check of the search engine is tried once more before it counts as refused", async () => {
    let calls = 0;
    const page = '<div class="result"><a class="result__a" href="https://wsd.adwokatura.pl/x">WSD 113/22</a><a class="result__snippet">Orzeczenie WSD</a></div>';
    const fetchImpl = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("anomaly detected", { status: 202, headers: { "content-type": "text/html" } })
        : new Response(page, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const result = await new PublicWebSearch({ LEX_WEB_SEARCH_PROVIDER: "duckduckgo" }, fetchImpl, 5_000, 1).search("WSD 113/22", 5).catch((error: unknown) => error);
    expect(calls).toBe(2);
    expect(result).not.toBeInstanceOf(Error);
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

  it("a stored pleading's case-material signatures are read from their markers", () => {
    expect(caseMaterialSignatures("wyrok VIII W 633/25 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy] i sprawa VII P 94/25 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]; II CSK 1/20"))
      .toEqual(["VIII W 633/25", "VII P 94/25"]);
  });

  it("a document AST is verified block by block, not as one line of JSON (RD 121/26)", () => {
    const ast = JSON.stringify({ schemaVersion: "1", blocks: [
      { type: "paragraph", content: [{ type: "text", text: "Podstawa: art. 7 KPK i art. 24 § 1 KC." }] },
      { type: "paragraph", content: [{ type: "text", text: "Zob. art. 190a § 1 KK ⚠️ [NIEWERYFIKOWANE]." }] },
      { type: "list", items: [[{ type: "text", text: "art. 245 KK" }]] }
    ] });
    expect(planAutomaticLegalVerification(ast, new VerificationLedger()).calls).toHaveLength(0);
    const calls = planAutomaticLegalVerification(astBlockLines(ast), new VerificationLedger()).calls.map((call) => call.input.claim);
    expect(calls).toEqual(expect.arrayContaining(["art. 7 KPK", "art. 24 § 1 KC", "art. 245 KK"]));
    expect(calls).not.toContain("art. 190a § 1 KK");
  });

  it("an act named in words, then RODO later in the paragraph, is not RODO", () => {
    const calls = planAutomaticLegalVerification("Granice (art. 8 ust. 1 Prawa o adwokaturze). Te granice wyznaczają m.in. przepisy RODO.", new VerificationLedger()).calls;
    expect(calls.map((call) => call.input.act)).not.toContain("32016R0679");
  });
});
