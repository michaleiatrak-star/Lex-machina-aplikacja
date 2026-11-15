import { describe, expect, it } from "vitest";
import { searchLocalDatabase } from "./case-law-search.js";
const card = (source, signature) => ({ id: `${source}-${signature}`, source, signatures: [signature], url: `https://example.gov.pl/${signature}`, court: "Sąd", courtType: "COMMON", date: "2024-01-01", kind: "wyrok" });
const database = { search: () => [card("SP", "I ACa 143/22"), card("SN", "II CSKP 12/21"), card("CBOSA", "I OSK 1/20")] };
describe("SAOS jako zapas: najpierw lokalne wyroki, także z filtrem typu sądu", () => {
    it("SAOS courtType=COMMON: trafienie z lokalnej bazy sądów powszechnych zamiast SAOS", () => {
        const local = searchLocalDatabase({ query: "kara umowna", source: "SAOS", saos: { courtType: "COMMON" } }, "kara umowna", 5, database);
        expect(local?.reason).toBe("LOCAL_DATABASE");
        expect(local?.candidates.map((item) => item.caseNumbers[0])).toEqual(["I ACa 143/22"]);
    });
    it("SAOS courtType=SUPREME: tylko lokalne SN; typ sądu bez lokalnej bazy (administracyjne): bez skrótu", () => {
        expect(searchLocalDatabase({ query: "kara umowna", source: "SAOS", saos: { courtType: "SUPREME" } }, "kara umowna", 5, database)?.candidates.map((item) => item.caseNumbers[0])).toEqual(["II CSKP 12/21"]);
        expect(searchLocalDatabase({ query: "kara umowna", source: "SAOS", saos: { courtType: "ADMINISTRATIVE" } }, "kara umowna", 5, database)).toBeNull();
    });
});
import { CaseLawSearchService, commonCourtsCandidates, configureCommonCourtsSearch } from "./case-law-search.js";
describe("sądy powszechne: portal orzeczeń przed SAOS", () => {
    it("SAOS courtType=COMMON: kandydaci z portalu, SAOS nie jest pytany; brak trafień w portalu: SAOS", async () => {
        const asked = [];
        const fetcher = (async (input) => {
            asked.push(new URL(String(input)).host);
            return new Response(JSON.stringify({ items: [], info: { totalResults: 0 } }), { headers: { "content-type": "application/json" } });
        });
        configureCommonCourtsSearch(async (query, limit) => commonCourtsCandidates({ status: "AMBIGUOUS", kandydaci: [{ sygnatura: "V ACa 143/22", data: "2023-02-23", sad: "warszawa.sa", url_orzeczenia: "https://orzeczenia.warszawa.sa.gov.pl/content/$N/1" }] }, query, limit));
        try {
            const hit = await new CaseLawSearchService(fetcher).search({ query: "miarkowanie kary umownej", source: "SAOS", saos: { courtType: "COMMON" } });
            expect(hit.reason).toBe("OFFICIAL_BEFORE_SAOS");
            expect(hit.candidates[0]?.caseNumbers).toEqual(["V ACa 143/22"]);
            expect(asked).toEqual([]);
            configureCommonCourtsSearch(async () => null);
            await new CaseLawSearchService(fetcher).search({ query: "miarkowanie kary umownej", source: "SAOS", saos: { courtType: "COMMON" } });
            expect(asked).toContain("www.saos.org.pl");
        }
        finally {
            configureCommonCourtsSearch(null);
        }
    });
});
