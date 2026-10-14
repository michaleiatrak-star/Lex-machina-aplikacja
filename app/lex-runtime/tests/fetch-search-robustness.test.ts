import { describe, expect, it } from "vitest";
import { courtOfSignature } from "../src/court-of-signature.js";
import { decodeBody } from "../src/source-preview.js";
import { articleEvidence, claimArticle } from "../src/substitute-source.js";
import { PublicWebSearch, webSearchLeads } from "../src/web-search.js";

describe("Supreme Court repertories", () => {
  it.each(["II PSKP 12/21", "III USK 5/22", "I NSNc 5/21", "I NSNk 2/22", "II NSNp 3/23", "II KZ 1/22", "I NO 1/20", "III CZP 25/22"])("%s is SN", (signature) => {
    expect(courtOfSignature(signature)).toBe("SN");
  });
  it.each([["II Cz 123/20", "POWSZECHNY"], ["III Ko 5/21", "POWSZECHNY"], ["I Pz 3/21", "POWSZECHNY"], ["II OSK 1/20", "NSA_WSA"]])("%s stays %s", (signature, court) => {
    expect(courtOfSignature(signature)).toBe(court);
  });
});

describe("web search", () => {
  it("a bot check is reported as such, not as no results", async () => {
    const search = new PublicWebSearch(
      { LEX_WEB_SEARCH_PROVIDER: "duckduckgo" } as NodeJS.ProcessEnv,
      (async () => new Response("<html><body>Unfortunately, bots use DuckDuckGo too. anomaly</body></html>", { status: 202, headers: { "content-type": "text/html" } })) as typeof fetch
    );
    await expect(search.search("uchwała SN III CZP 25/22", 5)).rejects.toThrow(/BOT_CHECK/u);
  });

  it("reads LEX-style journal citations as leads", () => {
    expect(webSearchLeads("ustawa (Dz.U.2024.1061 t.j.)").journals).toEqual([{ citation: "Dz.U. 2024 poz. 1061", eli: "DU/2024/1061" }]);
    expect(webSearchLeads("Dz. U. z 2025 r. poz. 1071").journals).toEqual([{ citation: "Dz.U. 2025 poz. 1071", eli: "DU/2025/1071" }]);
  });
});

describe("fetched text", () => {
  it("decodes a windows-1250 page by its declared charset", () => {
    const bytes = Buffer.from([0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6, 0x20, 0x67, 0xea, 0x9c, 0x6c, 0xb9, 0x20, 0x6a, 0x61, 0x9f, 0xf1]);
    expect(decodeBody(bytes, "text/html; charset=windows-1250")).toBe("Zażółć gęślą jaźń");
    expect(decodeBody(Buffer.concat([Buffer.from('<meta charset="iso-8859-2">'), Buffer.from([0xb1])]), "text/html")).toContain("ą");
  });

  it("a substitute source keeps art. 11¹ apart from art. 11", () => {
    expect(claimArticle("art. 11¹ KC")).toBe("11^1");
    expect(claimArticle("art. 233 § 1 KK")).toBe("233");
    const page = "Art. 11. Pierwszy. Art. 11^1. Drugi z indeksem.";
    expect(articleEvidence(page, "11^1")).toContain("Drugi z indeksem");
    expect(articleEvidence(page, "11")).toMatch(/^Art\. 11\. Pierwszy/u);
  });
});

describe("auxiliary source: a PDF research page", () => {
  it("reads the text of a PDF locally", async () => {
    const { PdfDocument } = await import("../src/pdf-writer.js");
    const { SafeAuxiliarySourceFetcher } = await import("../src/auxiliary-source-fetcher.js");
    const doc = new PdfDocument({ title: "Opinia", created: new Date("2026-10-14T00:00:00Z") });
    doc.addPage().text(50, 50, "Glosa do wyroku dotyczy przedawnienia roszczen.");
    const pdf = new Uint8Array(doc.toBuffer());
    const fetcher = new SafeAuxiliarySourceFetcher(
      async () => [{ address: "93.184.216.34", family: 4 }],
      async () => ({ statusCode: 200, contentType: "application/pdf", body: pdf })
    );
    const result = await fetcher.fetch("https://source.example/glosa.pdf");
    expect(result.text).toContain("przedawnienia");
  });
});

describe("CBOSA: an unreadable document and a busy server", () => {
  it("keeps the readable hits and retries a 503", async () => {
    const { CaseLawSearchService } = await import("../src/case-law-search.js");
    let searches = 0;
    const doc = (signature: string) =>
      new Response(
        `<html><head><title>${signature} - Wyrok WSA</title></head><body><table><tr><td class="lista-label">Sąd</td><td class="info-list-value">Wojewódzki Sąd Administracyjny w Warszawie</td></tr></table></body></html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }
      );
    const fetcher = async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/cbo/query")) return new Response("<html>Formularz</html>", { status: 200, headers: { "set-cookie": "S=1; Path=/" } });
      if (url.endsWith("/cbo/search")) {
        searches += 1;
        if (searches === 1) return new Response("busy", { status: 503 });
        return new Response('<html>Znaleziono 2 orzeczenia <a href="/doc/AAAAAAAAAA">a</a><a href="/doc/BBBBBBBBBB">b</a></html>', { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.endsWith("/doc/AAAAAAAAAA")) return new Response("error", { status: 500 });
      if (url.endsWith("/doc/BBBBBBBBBB")) return doc("II SAB/Wa 7/26");
      throw new Error(url);
    };
    const result = await new CaseLawSearchService(fetcher as typeof fetch).search({ source: "CBOSA", query: "bezczynność", limit: 2 });
    expect(searches).toBe(2);
    expect(result.status).toBe("FOUND");
    expect(result.candidates.map((candidate) => candidate.caseNumbers)).toEqual([["II SAB/Wa 7/26"]]);
  }, 20_000);
});
