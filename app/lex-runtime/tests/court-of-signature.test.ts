import { describe, expect, it, vi } from "vitest";
import { caseLinkProblem, courtOfSignature, misroutedSignature, signaturesIn } from "../src/court-of-signature.js";
import { SupremeCourtCaseVerifier } from "../src/case-law-verifier.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";

describe("the court of a signature", () => {
  it("reads the court from the repertory, case-sensitively for common courts", () => {
    expect(courtOfSignature("II CSKP 89/26")).toBe("SN");
    expect(courtOfSignature("III CZP 25/11")).toBe("SN");
    expect(courtOfSignature("II Cz 12/20")).toBe("POWSZECHNY");
    expect(courtOfSignature("V ACa 12/2024")).toBe("POWSZECHNY");
    expect(courtOfSignature("II AKa 7/21")).toBe("POWSZECHNY");
    expect(courtOfSignature("II OSK 1234/22")).toBe("NSA_WSA");
    expect(courtOfSignature("I SA/Wa 123/20")).toBe("NSA_WSA");
    expect(courtOfSignature("KIO 512/25")).toBe("KIO");
    expect(courtOfSignature("SK 3/20")).toBe("TK");
    expect(courtOfSignature("art. 45 ust. 1")).toBeNull();
    expect(signaturesIn("wyrok SN z 8.07.2026, sygn. II CSKP 89/26, oraz I SA/Wa 123/20").map((item) => item.court)).toEqual(["SN", "NSA_WSA"]);
  });

  it("redirects a signature searched where its court does not publish", () => {
    expect(misroutedSignature("cbosa", "II CSKP 89/26")).toMatchObject({ status: "OUT_OF_SCOPE", reason: "SIGNATURE_OF_OTHER_COURT", court: "Sąd Najwyższy" });
    expect(misroutedSignature("CBOSA", "sankcja kredytu darmowego II CSKP 89/26")?.useInstead).toContain("verify_case_reference");
    expect(misroutedSignature("cbosa", "II OSK 1234/22")).toBeNull();
    expect(misroutedSignature("cbosa", "sankcja kredytu darmowego")).toBeNull();
    expect(misroutedSignature("saos", "II OSK 1234/22")?.useInstead).toContain("CBOSA");
    expect(misroutedSignature("saos", "V ACa 12/2024")).toBeNull();
    expect(misroutedSignature("kio", "{\"sygnatura\":\"II CSKP 89/26\"}")?.court).toBe("Sąd Najwyższy");
  });

  it("recognizes links that are not sources and keeps the signature of an old SN PDF", () => {
    expect(caseLinkProblem("blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466")).toEqual({ kind: "BLOB" });
    expect(caseLinkProblem("https://www.sn.pl/sites/orzecznictwo/Orzeczenia3/II%20CSKP%2089-26.pdf")).toEqual({ kind: "SN_LEGACY_PDF", signature: "II CSKP 89/26" });
    expect(caseLinkProblem("https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg")).toBeNull();
  });
});

describe("case tools follow the court of the signature", () => {
  it("search_case_law does not search an SN signature in CBOSA", async () => {
    const runtime = new LegalVerificationToolRuntime(new VerificationLedger());
    const [result] = await runtime.runTools([{ id: "s1", name: "search_case_law", input: { query: "II CSKP 89/26", source: "CBOSA" } }]);
    expect(JSON.parse(result!.content)).toMatchObject({ status: "OUT_OF_SCOPE", reason: "SIGNATURE_OF_OTHER_COURT", court: "Sąd Najwyższy", candidates: [] });
  });

  it("verify_case_reference refuses a blob: link and redirects a non-SN signature", async () => {
    const runtime = new LegalVerificationToolRuntime(new VerificationLedger());
    const [blob, other] = await runtime.runTools([
      { id: "v1", name: "verify_case_reference", input: { claim: "wyrok SN", courtFamily: "SN", card_url: "blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466" } },
      { id: "v2", name: "verify_case_reference", input: { claim: "sygn. I SA/Wa 123/20", signature: "I SA/Wa 123/20", courtFamily: "SN" } }
    ]);
    expect(JSON.parse(blob!.content)).toMatchObject({ status: "OUT_OF_SCOPE", reason: "TEMPORARY_BLOB_LINK" });
    expect(JSON.parse(other!.content)).toMatchObject({ status: "OUT_OF_SCOPE", reason: "SIGNATURE_OF_OTHER_COURT", court: "NSA/WSA" });
  });

  it("reads the signature from an SN card given without one", async () => {
    const html = "<html><body><p>WYROK</p><p>Sygn. akt II CSKP 89/26</p><p>Sąd Najwyższy w składzie…</p></body></html>";
    const fetcher = vi.fn(async (input: string | URL) => {
      expect(String(input)).toContain("id=ZuUySp8Bw1HnVDW6c5lg");
      return new Response(JSON.stringify({ data: [{ success: true, data: { raw: Buffer.from(html, "utf8").toString("base64") } }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    const resolved = await new SupremeCourtCaseVerifier(fetcher).signatureFromCard("https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg");
    expect(resolved).toEqual({ signature: "II CSKP 89/26", cardUrl: "https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg" });
  });
});
