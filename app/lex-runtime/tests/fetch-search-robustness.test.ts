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
