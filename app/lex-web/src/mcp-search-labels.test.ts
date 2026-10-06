import { describe, expect, it } from "vitest";
import { MCP_FIELD_LABELS, MCP_TOOL_LABELS, orderFields, orderTools, sourceHasPhraseSearch } from "./mcp-search-labels.js";

// Narzędzia i pola 16 konektorów (audyt-systemu-v4 6.202, lex-mcp.mjs listTools).
const CATALOG: Record<string, string[]> = {"isap": ["isap_lookup", "isap_tekst"], "saos": ["saos_search", "saos_cytator"], "krs": ["krs_lookup", "krs_reprezentacja", "krs_szukaj"], "nbp": ["nbp_kurs_waluty"], "eurlex": ["eurlex_lookup", "eurlex_tsue"], "eureka": ["eureka_sprawdz_sygnature", "eureka_szukaj", "eureka_pobierz"], "sudop": ["sudop_szukaj_pomocy", "sudop_odbierz_wynik"], "ceidg": ["ceidg_szukaj_firmy"], "cbosa": ["cbosa_sprawdz_sygnature", "cbosa_szukaj", "cbosa_pobierz"], "sn": ["sn_sprawdz_sygnature", "sn_szukaj", "sn_pobierz", "sn_sesja_status", "sn_sesja_ustaw", "sn_captcha_auto"], "sp": ["sp_sprawdz_sygnature", "sp_pobierz", "sp_szukaj"], "tk": ["tk_sprawdz_sygnature", "tk_pobierz"], "kio": ["kio_szukaj", "kio_sprawdz_sygnature", "kio_pobierz", "kio_kontrola_sadowa"], "etpcz": ["etpcz_szukaj", "etpcz_pobierz"], "uodo": ["uodo_sprawdz_sygnature", "uodo_szukaj", "uodo_pobierz"], "wl": ["wl_sprawdz_nip", "wl_sprawdz_rachunek"]};
const FIELDS = ["artykul", "autorUzasadnienia", "celex", "cookie", "courtType", "data", "dataDo", "dataOd", "dataWDniu", "doDaty", "doc_id", "ecli", "eli", "forma", "fraza", "headless", "id", "izba", "karta", "kategoria", "kodWaluty", "kolejka_id", "limit", "naStrone", "nip", "numerKrs", "numer_skargi", "odDaty", "offset", "pageSize", "prawomocnosc", "przewodniczacy", "query", "rachunek", "regon", "rodzaj", "rozmiar", "sad", "sedzia", "sklad", "sprawozdawca", "strona", "sygnatura", "szukaj", "tresc", "tylkoAktualne", "url", "url_lub_id", "urn_lub_sygnatura", "userAgent", "wersja", "wspolsprawozdawca"];

describe("karta Wyszukiwanie: konektory po polsku, szukanie po frazie pierwsze", () => {
  it("każde narzędzie i pole ma polską nazwę (bez technicznych identyfikatorów)", () => {
    expect(Object.values(CATALOG).flat().filter((name) => !MCP_TOOL_LABELS[name])).toEqual([]);
    expect(FIELDS.filter((name) => !MCP_FIELD_LABELS[name])).toEqual([]);
  });

  it("w źródle z wyszukiwaniem po frazie to narzędzie jest pierwsze, obsługa dostępu ostatnia", () => {
    for (const [source, names] of Object.entries(CATALOG)) {
      const ordered = orderTools(names.map((name) => ({ name }))).map((tool) => tool.name);
      if (sourceHasPhraseSearch(source)) expect(MCP_TOOL_LABELS[ordered[0]!]?.fullText, source).toBe(true);
    }
    const sn = orderTools(CATALOG.sn!.map((name) => ({ name }))).map((tool) => tool.name);
    expect(sn[0]).toBe("sn_szukaj");
    expect(sn.slice(-3).every((name) => MCP_TOOL_LABELS[name]?.maintenance)).toBe(true);
  });

  it("pole frazy przed sygnaturą; wskazanie aktu w ISAP przed frazą", () => {
    const order = (names: string[], required: string[] = []) =>
      orderFields(names.map((name) => [name, {}] as [string, object]), new Set(required)).map(([name]) => name);
    expect(order(["sygnatura", "fraza", "courtType"])[0]).toBe("fraza");
    expect(order(["numer_skargi", "fraza"])[0]).toBe("fraza");
    expect(order(["tresc", "sygnatura", "forma"])[0]).toBe("tresc");
    expect(order(["eli", "artykul", "szukaj", "offset"], ["eli"]).slice(0, 2)).toEqual(["eli", "szukaj"]);
  });
});
