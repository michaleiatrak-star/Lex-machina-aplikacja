import { describe, expect, it } from "vitest";
import { isBlockedCountry, isBlockedHost, isBlockedUrl } from "../src/blocked-jurisdictions.js";
import { parseAuxiliarySourceUrl } from "../src/auxiliary-source-fetcher.js";
import { assertPublicWebSearchQuery } from "../src/web-search.js";
import { readNationalLaw } from "../src/eli/national-law.js";
import { ELI_COUNTRIES } from "../src/eli/eli-countries.js";

describe("technical block: Russian Federation is outside the system", () => {
  it("blocks .ru, .su and .рф hosts, not look-alikes", () => {
    for (const host of ["pravo.gov.ru", "www.consultant.ru", "ksrf.ru.", "kremlin.su", "xn--p1ai", "президент.рф", "xn--d1abbgf6aiiy.xn--p1ai"]) expect(isBlockedHost(host)).toBe(true);
    for (const host of ["eur-lex.europa.eu", "ru.wikipedia.org", "rus.example.com", "peru.gov.pe", "isap.sejm.gov.pl"]) expect(isBlockedHost(host)).toBe(false);
    expect(isBlockedUrl("https://pravo.gov.ru/proxy/ips/")).toBe(true);
    expect(isBlockedCountry("ru")).toBe(true);
    expect(isBlockedCountry("PL")).toBe(false);
  });

  it("no reader, no fetch, no site: search", async () => {
    expect(ELI_COUNTRIES.some((country) => country.code === "RU")).toBe(false);
    await expect(readNationalLaw({ url: "https://pravo.gov.ru/proxy/ips/?docbody=&nd=102027595" })).rejects.toThrow("JURISDICTION_BLOCKED");
    await expect(readNationalLaw({ url: "https://www.legislation.gov.uk/ukpga/1979/54/section/14", country: "RU" })).rejects.toThrow("JURISDICTION_BLOCKED");
    expect(() => parseAuxiliarySourceUrl("https://www.consultant.ru/document/cons_doc_LAW_5142/")).toThrow(expect.objectContaining({ code: "AUX_SOURCE_JURISDICTION_BLOCKED" }));
    expect(() => assertPublicWebSearchQuery("гражданский кодекс site:consultant.ru")).toThrow(expect.objectContaining({ code: "WEB_SEARCH_JURISDICTION_BLOCKED" }));
    expect(assertPublicWebSearchQuery("kodeks cywilny site:isap.sejm.gov.pl")).toBe("kodeks cywilny site:isap.sejm.gov.pl");
  });
});

describe("technical block in search results", () => {
  it("drops hits on blocked hosts before they reach the model", async () => {
    const { PublicWebSearch } = await import("../src/web-search.js");
    const payload = JSON.stringify({ web: { results: [
      { title: "ГК РФ", url: "https://www.consultant.ru/document/cons_doc_LAW_5142/", description: "x" },
      { title: "KC", url: "https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19640160093", description: "y" }
    ] } });
    const fetchImpl = (async () => new Response(payload, { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const search = new PublicWebSearch({ LEX_WEB_SEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "k" } as NodeJS.ProcessEnv, fetchImpl);
    const answer = await search.search("kodeks cywilny", 5);
    expect(answer.hits.map((hit) => hit.url)).toEqual(["https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19640160093"]);
  });
});
