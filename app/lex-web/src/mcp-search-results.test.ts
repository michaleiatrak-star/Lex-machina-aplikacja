import { describe, expect, it } from "vitest";
import { appendDocument, nextPageArgs, readSearchResult } from "./mcp-search-results.js";

const CBOSA_TOOLS = ["cbosa_szukaj", "cbosa_pobierz", "cbosa_sprawdz_sygnature"];

describe("wynik MCP jako strona wyników", () => {
  it("CBOSA: lista kandydatów z linkiem, treścią do pobrania i kolejną stroną", () => {
    const args = { fraza: "podatek od nieruchomości" };
    const page = readSearchResult("cbosa_szukaj", args, {
      status: "AMBIGUOUS",
      liczba_trafien: 25,
      strona: 1,
      kandydaci: [
        { doc_id: "A1", url_zrodlowy: "https://orzeczenia.nsa.gov.pl/doc/A1", rola: "KANDYDAT" },
        { doc_id: "B2", url_zrodlowy: "https://orzeczenia.nsa.gov.pl/doc/B2", rola: "KANDYDAT" }
      ]
    }, CBOSA_TOOLS);
    expect(page).toMatchObject({ status: "AMBIGUOUS", total: 25, page: 1 });
    expect(page.items[0]).toMatchObject({
      key: "A1",
      url: "https://orzeczenia.nsa.gov.pl/doc/A1",
      detail: { tool: "cbosa_pobierz", args: { doc_id: "A1" } }
    });
    expect(nextPageArgs(args, page, 2, ["fraza", "strona"])).toEqual({ ...args, strona: 2 });
    expect(nextPageArgs(args, page, 25, ["fraza", "strona"])).toBeNull();
    expect(nextPageArgs(args, page, 2, ["fraza"])).toBeNull();
  });

  it("UODO: ostatnia strona nie ma kolejnej", () => {
    const page = readSearchResult("uodo_szukaj", { fraza: "monitoring", strona: 3 }, {
      status: "AMBIGUOUS", liczba_trafien: 60, strona: 3, stron: 3,
      kandydaci: [{ identyfikator: "DKN.5101.1.2020", sad: "Prezes UODO", prawomocnosc: "prawomocna" },
        { identyfikator: "DKN.5101.2.2020" }]
    }, ["uodo_szukaj", "uodo_pobierz"]);
    expect(page.items[0].meta).toContain("prawomocna");
    expect(page.items[0].detail).toEqual({ tool: "uodo_pobierz", args: { urn_lub_sygnatura: "DKN.5101.1.2020" } });
    expect(nextPageArgs({ fraza: "monitoring", strona: 3 }, page, 2, ["fraza", "strona"])).toBeNull();
  });

  it("pojedyncze trafienie wyszukiwarki jest pozycją listy, nie dokumentem", () => {
    const page = readSearchResult("eureka_szukaj", {}, {
      status: "FOUND", liczba_trafien: 1, result: { id_eureka: "123", sygnatura: "0111-KDIB1", teza: "Teza" }
    }, ["eureka_szukaj", "eureka_pobierz"]);
    expect(page.document).toBeNull();
    expect(page.items[0].detail).toEqual({ tool: "eureka_pobierz", args: { id: "123" } });
  });

  it("dokument porcjowany: sekcje i argumenty dalszej części", () => {
    const args = { id: "123" };
    const first = readSearchResult("eureka_pobierz", args, {
      status: "FOUND", result: { sygnatura: "0111-KDIB1", tresc: "abc", tresc_offset: 0, tresc_kompletna: false }
    }, []);
    expect(first.document?.sections).toEqual([{ label: "Treść", text: "abc" }]);
    expect(first.document?.continuation).toEqual({ id: "123", offset: 3 });
    const second = readSearchResult("eureka_pobierz", first.document!.continuation!, {
      status: "FOUND", result: { tresc: "def", tresc_offset: 3, tresc_kompletna: true }
    }, []);
    const merged = appendDocument(first.document!, second.document!);
    expect(merged.sections).toEqual([{ label: "Treść", text: "abcdef" }]);
    expect(merged.continuation).toBeNull();
  });

  it("wynik rejestru (biała lista VAT) pokazuje pola zamiast surowego JSON", () => {
    const page = readSearchResult("wl_sprawdz_nip", {}, {
      status: "FOUND",
      result: { identyfikator: "NIP 5260250274", tytul_lub_nazwa: "Firma", status_vat: "Czynny", rachunki: ["1", "2"] }
    }, []);
    expect(page.items[0].title).toBe("Firma");
    expect(page.items[0].facts).toEqual([["status vat", "Czynny"], ["rachunki", "1; 2"]]);
  });

  it("błąd źródła jako komunikat", () => {
    const page = readSearchResult("cbosa_szukaj", {}, { status: "ERROR", detail: "Przekroczono czas" }, CBOSA_TOOLS);
    expect(page).toMatchObject({ status: "ERROR", notice: "Przekroczono czas", items: [] });
  });
});
