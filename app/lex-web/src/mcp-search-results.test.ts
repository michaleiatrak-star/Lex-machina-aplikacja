import { describe, expect, it } from "vitest";
import { appendDocument, nextPageArgs, readSearchResult } from "./mcp-search-results.js";

const CBOSA_TOOLS = ["cbosa_szukaj", "cbosa_pobierz", "cbosa_sprawdz_sygnature"];

describe("wynik MCP jako strona wyników", () => {
  it("CBOSA: lista kandydatów z linkiem i podglądem źródła (bez „Pokaż treść”), kolejna strona", () => {
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
      preview: { kind: "url", url: "https://orzeczenia.nsa.gov.pl/doc/A1" },
      detail: null
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

  it("KRS i NBP: podgląd z oficjalnego API, „Otwórz w źródle” to wyszukiwarka/strona tabel", () => {
    const krs = readSearchResult("krs_lookup", { numerKrs: "28860" }, {
      status: "FOUND",
      result: {
        identyfikator: "KRS 0000028860",
        tytul_lub_nazwa: "ORLEN SPÓŁKA AKCYJNA",
        url_zrodlowy: "https://wyszukiwarka-krs.ms.gov.pl/",
        url_podgladu: "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000028860?rejestr=P&format=json"
      }
    }, ["krs_lookup"]);
    expect(krs.items[0]).toMatchObject({
      url: "https://wyszukiwarka-krs.ms.gov.pl/",
      preview: { kind: "url", url: "https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/0000028860?rejestr=P&format=json" }
    });
    expect(krs.items[0]!.facts.map(([label]) => label)).not.toContain("url podgladu");
  });

  it("biała lista VAT: podgląd rekordu z odpowiedzi API, bez ponownego zapytania", () => {
    const page = readSearchResult("wl_sprawdz_nip", { nip: "7740001454" }, {
      status: "FOUND",
      retrieved_at: "2026-10-01T16:00:00.000Z",
      result: { identyfikator: "NIP 7740001454", tytul_lub_nazwa: "ORLEN <S.A.>", status_vat: "Czynny", url_zrodlowy: "https://www.podatki.gov.pl/wykaz-podatnikow-vat-wyszukiwarka" }
    }, ["wl_sprawdz_nip"]);
    const preview = page.items[0]!.preview;
    expect(preview?.kind).toBe("record");
    const html = preview?.kind === "record" ? preview.html : "";
    expect(html).toContain("Czynny");
    expect(html).toContain("ORLEN &lt;S.A.&gt;");
    expect(html).toContain("wl-api.mf.gov.pl");
    expect(html).not.toContain("<S.A.>");
  });

  it("ISAP: „Pokaż treść” przez isap_tekst po ELI", () => {
    const page = readSearchResult("isap_lookup", { query: "kodeks karny" }, {
      status: "AMBIGUOUS",
      kandydaci: [{ identyfikator: "DU 2025 poz. 383", eli: "DU/2025/383", url_zrodlowy: "https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU20250000383" }]
    }, ["isap_lookup", "isap_tekst"]);
    expect(page.items[0]!.detail).toEqual({ tool: "isap_tekst", args: { eli: "DU/2025/383" } });
  });

  it("SUDOP: zlecenie w kolejce to oczekiwanie na wynik, nie błąd", () => {
    const page = readSearchResult("sudop_szukaj_pomocy", { nip: "7740001454" }, {
      status: "ERROR",
      detail: "PENDING",
      kolejka_id: "5cd15a24-75bf-4c2b-9b43-7e3ed58a6dc1",
      komunikat_serwera: "Przygotowywanie odpowiedzi, przewidywany czas to 60 sekund"
    }, ["sudop_szukaj_pomocy", "sudop_odbierz_wynik"]);
    expect(page.status).toBe("PENDING");
    expect(page.pending).toEqual({
      tool: "sudop_odbierz_wynik",
      args: { kolejka_id: "5cd15a24-75bf-4c2b-9b43-7e3ed58a6dc1" },
      message: "Przygotowywanie odpowiedzi, przewidywany czas to 60 sekund"
    });
    const failed = readSearchResult("sudop_szukaj_pomocy", {}, { status: "ERROR", detail: "HTTP 500" }, ["sudop_szukaj_pomocy", "sudop_odbierz_wynik"]);
    expect(failed.pending).toBeNull();
    expect(failed.status).toBe("ERROR");
  });

  it("KIO: lista z wyszukiwarki UZP, podgląd treści i „Pokaż treść” przez kio_pobierz", () => {
    const page = readSearchResult("kio_szukaj", { fraza: "rażąco niska cena" }, {
      status: "AMBIGUOUS", liczba_trafien: 8654, strona: 1, stron: 866,
      kandydaci: [{
        identyfikator: "KIO 4983/25", tytul_lub_nazwa: "wyrok KIO 4983/25", sad: "Krajowa Izba Odwoławcza",
        data_wyroku: "2026-12-07", fragment: "rażąco niskiej ceny", id_kio: "32291",
        url_zrodlowy: "https://orzeczenia.uzp.gov.pl/Home/Details/32291",
        url_podgladu: "https://orzeczenia.uzp.gov.pl/Home/ContentHtml/32291?Kind=KIO"
      }]
    }, ["kio_szukaj", "kio_pobierz"]);
    expect(page.items[0]).toMatchObject({
      key: "KIO 4983/25",
      url: "https://orzeczenia.uzp.gov.pl/Home/Details/32291",
      preview: { kind: "url", url: "https://orzeczenia.uzp.gov.pl/Home/ContentHtml/32291?Kind=KIO" },
      detail: { tool: "kio_pobierz", args: { id: "32291" } }
    });
    expect(nextPageArgs({ fraza: "x" }, page, 1, ["fraza", "strona"])).toEqual({ fraza: "x", strona: 2 });
  });
});

describe("court decisions: stable link, preview and full text", () => {
  it("shows the Portal Orzeczeń link, preview, date, kind and court of each candidate", () => {
    const page = readSearchResult("sp_sprawdz_sygnature", { sygnatura: "II K 1350/18" }, {
      status: "AMBIGUOUS",
      liczba_trafien: 2,
      kandydaci: [
        {
          docId: "151025200001006_II_K_001350_2018_Uz_2019-11-05_002",
          kodSadu: "151025200001006",
          sygnatura: "II K 1350/18",
          rodzaj: "uzasadnienie",
          data: "2019-11-05",
          sad: "Sąd Rejonowy w Bytomiu",
          url_orzeczenia: "https://orzeczenia.ms.gov.pl/content/$N/151025200001006_II_K_001350_2018_Uz_2019-11-05_002",
          url_metryki: "https://orzeczenia.ms.gov.pl/details/$N/151025200001006_II_K_001350_2018_Uz_2019-11-05_002",
          portal: "orzeczenia.ms.gov.pl"
        },
        {
          docId: "152505100001006_II_K_001350_2018_Uz_2019-06-10_002",
          sygnatura: "II K 1350/18",
          rodzaj: "uzasadnienie",
          data: "2019-06-10",
          url_orzeczenia: "https://orzeczenia.ms.gov.pl/content/$N/152505100001006_II_K_001350_2018_Uz_2019-06-10_002"
        }
      ]
    }, ["sp_sprawdz_sygnature", "sp_pobierz", "sp_szukaj"]);
    expect(page.items).toHaveLength(2);
    const [first, second] = page.items;
    expect(first!.url).toBe("https://orzeczenia.ms.gov.pl/content/$N/151025200001006_II_K_001350_2018_Uz_2019-11-05_002");
    expect(first!.preview).toEqual({ kind: "url", url: first!.url });
    expect(first!.meta).toEqual(["Sąd Rejonowy w Bytomiu", "data: 2019-11-05", "uzasadnienie"]);
    expect(first!.detail).toEqual({ tool: "sp_pobierz", args: { url_lub_id: first!.url } });
    expect(first!.key).not.toBe(second!.key);
    expect(second!.meta).toEqual(["data: 2019-06-10", "uzasadnienie"]);
  });

  it("SN: the card is the link; TK: the decision link with the signature check", () => {
    const sn = readSearchResult("sn_sprawdz_sygnature", { sygnatura: "III CZP 25/11" }, {
      status: "FOUND",
      result: { sygnatura: "III CZP 25/11", data_wydania: "2011-06-22", forma: "uchwała SN", id_karty: "123", url_karty: "https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=123" }
    }, ["sn_sprawdz_sygnature", "sn_pobierz"]);
    expect(sn.items[0]).toMatchObject({
      url: "https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=123",
      meta: ["wydanie: 2011-06-22", "uchwała SN"],
      detail: { tool: "sn_pobierz", args: { karta: "https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=123" } }
    });
    const tk = readSearchResult("tk_sprawdz_sygnature", { sygnatura: "K 33/07" }, {
      status: "FOUND",
      result: { sygnatura: "K 33/07", url_orzeczenia: "https://otkzu.trybunal.gov.pl/2008/A/88" }
    }, ["tk_sprawdz_sygnature", "tk_pobierz"]);
    expect(tk.items[0]).toMatchObject({
      url: "https://otkzu.trybunal.gov.pl/2008/A/88",
      detail: { tool: "tk_pobierz", args: { url: "https://otkzu.trybunal.gov.pl/2008/A/88", sygnatura: "K 33/07" } }
    });
  });
});
