import { describe, expect, it } from "vitest";
import { portalPhrase, portalQueries, portalSearchPrompt, portalSignatures, portalTopics, searchOfficialPortals } from "./official-portal-search.js";

describe("searching the official portals before the answer (user 2026-11-15)", () => {
  it("case law, interpretations and authorities' decisions each get their portals and one open query", () => {
    expect(portalTopics("Podaj orzecznictwo SN o miarkowaniu kary umownej")).toEqual(["CASE_LAW"]);
    expect(portalTopics("Czy jest interpretacja KIS o VAT od usług szkoleniowych?")).toEqual(["INTERPRETATION"]);
    expect(portalTopics("Decyzje UODO o monitoringu pracowników")).toEqual(["AUTHORITY"]);
    expect(portalTopics("Ile wynosi termin na apelację?")).toEqual([]);
    const queries = portalQueries("Podaj orzecznictwo SN o miarkowaniu kary umownej za zakaz konkurencji");
    expect(queries.map((item) => item.site)).toEqual(["orzeczenia.ms.gov.pl", "sn.pl", "orzeczenia.nsa.gov.pl", null]);
    expect(queries[0]!.query).toBe("SN miarkowaniu kary umownej zakaz konkurencji site:orzeczenia.ms.gov.pl");
    expect(portalQueries("Interpretacja KIS: VAT od usług szkoleniowych").map((item) => item.site)).toContain("eureka.mf.gov.pl");
  });

  it("no personal data, amounts or dates in the query", () => {
    expect(portalPhrase("Wyrok w sprawie [PII:PERSON:1] o zapłatę 20 000 zł z 12.03.2025 dotyczący kary umownej")).toBe("zapłatę kary umownej");
  });

  it("official hits first, signatures from them to the registries, leads after", async () => {
    const search = async (query: string) =>
      query.includes("site:sn.pl")
        ? [{ title: "Wyrok SN z 7.07.2011, III CZP 25/11", url: "https://www.sn.pl/sites/orzecznictwo/orzeczenia3/iii%20czp%2025-11.pdf", snippet: "uchwała składu siedmiu sędziów" }]
        : query.includes("site:")
          ? []
          : [{ title: "Kara umowna – komentarz kancelarii", url: "https://kancelaria.example.pl/kara", snippet: "SN w wyroku I CSK 1/20 wskazał…" }];
    const result = await searchOfficialPortals("Podaj orzecznictwo SN o miarkowaniu kary umownej", search);
    expect(result.hits.map((hit) => hit.official)).toEqual([true, false]);
    expect(portalSignatures(result.hits.filter((hit) => hit.official)).cases).toEqual(["III CZP 25/11"]);
    const prompt = portalSearchPrompt(result);
    expect(prompt.indexOf("sn.pl")).toBeLessThan(prompt.indexOf("kancelaria.example.pl"));
    expect(prompt).toContain("Tropy");
  });

  it("a search that fails or hangs gives no hits, never an error", async () => {
    const result = await searchOfficialPortals("Podaj orzecznictwo NSA o podatku od nieruchomości", async () => {
      throw new Error("RATE_LIMITED");
    });
    expect(result.hits).toEqual([]);
    const slow = await searchOfficialPortals("Podaj orzecznictwo NSA o podatku od nieruchomości", () => new Promise(() => {}), 10);
    expect(slow.hits).toEqual([]);
  });

  it("disciplinary case law, the TK, more interpretations and the authorities' decisions (user 2026-11-15)", () => {
    const sites = (question: string) => portalQueries(question).map((item) => item.site);
    expect(portalTopics("Orzeczenia sądu dyscyplinarnego adwokatury o tajemnicy adwokackiej")).toContain("DISCIPLINARY");
    expect(sites("Orzeczenia sądu dyscyplinarnego adwokatury o tajemnicy adwokackiej")).toContain("wsd.adwokatura.pl");
    expect(sites("Odpowiedzialność zawodowa lekarza przed sądem lekarskim — orzecznictwo")).toContain("nil.org.pl");
    expect(sites("Postępowanie dyscyplinarne komornika — orzeczenia")).toContain("komornik.pl");
    expect(sites("Wyrok TK o niezgodności z Konstytucją przepisu o opłacie")).toEqual(expect.arrayContaining(["ipo.trybunal.gov.pl", "trybunal.gov.pl"]));
    expect(sites("Interpretacja ZUS o składkach od umowy zlecenia")).toContain("zus.pl");
    expect(sites("Wiążąca informacja taryfowa WIT — interpretacja celna")).toContain("puesc.gov.pl");
    expect(sites("Opinia prawna UZP i interpretacja przepisów zamówień publicznych")).toContain("gov.pl/web/uzp");
    expect(sites("Decyzje Prezesa URE o karach dla przedsiębiorstw energetycznych")).toContain("ure.gov.pl");
    expect(sites("Decyzje UOKiK o klauzulach niedozwolonych")).toContain("decyzje.uokik.gov.pl");
    expect(sites("Rozstrzygnięcia nadzorcze RIO o uchwałach budżetowych")).toContain("rio.gov.pl");
    // At most 8 queries, the open one always last.
    const many = portalQueries("Orzecznictwo SN, wyroki TK, interpretacje KIS i decyzje UODO o RODO w sprawach dyscyplinarnych adwokatów");
    expect(many.length).toBeLessThanOrEqual(8);
    expect(many.at(-1)!.site).toBeNull();
    expect(new Set(many.map((item) => item.site)).size).toBe(many.length);
  });
});
