import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CaseLawDatabase } from "./case-law-db.js";
import { searchLocalDatabase } from "./case-law-search.js";
import { SyncContext, runAdapter, snAdapter, spAdapter, spSearchUrl, type SyncFetch } from "./case-law-sync.js";

const database = () => new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-sync-")));
const now = () => new Date("2026-01-03T12:00:00Z");

function spListing(day: string, ids: string[], total: number): string {
  return `<span class="big_number">${total}</span>` + ids.map((id) => `<div class="single_result"><div class="title"><h4><a href="/details/$N/${id}">I C ${id}/25</a></h4><p>wyrok</p><p>Sąd Rejonowy w Testowie</p><p>Data orzeczenia: ${day}</p><p>Data publikacji: ${day}</p></div></div>`).join("");
}

/** A Portal Orzeczeń stand-in: two rulings on 2026-01-02, none on other days, text pages per id. */
function spPortal(calls: string[]): SyncFetch {
  return async (url) => {
    calls.push(url);
    if (url.includes("/content/")) return new Response(`<div class="single_result">Treść orzeczenia ${url.split("/").pop()} ${"uzasadnienie ".repeat(10)}</div>Deklaracja dostępności`);
    if (url === spSearchUrl("2026-01-02", "2026-01-02", 1)) return new Response(spListing("2026-01-02", ["1", "2"], 2));
    if (url.includes("datapublikacji")) return new Response(spListing("2026-01-02", ["1"], 1));
    return new Response(url.includes("2026-01-01/2026-01-31") ? spListing("2026-01-02", ["1"], 2) : `<span class="big_number">0</span>`);
  };
}

describe("pobieranie całych baz: wznawianie i deduplikacja", () => {
  it("przerwany przebieg wznawia się od zapisanego miejsca, a po komplecie dociąga tylko nowe", async () => {
    const db = database();
    db.saveState("SP", { phase: "FULL", day: "2026-01-01", page: 1, since: null });
    const calls: string[] = [];
    const first = await runAdapter(spAdapter, db, spPortal(calls), 4, 0, now);
    expect(first.stored).toBe(1);
    const second = await runAdapter(spAdapter, db, spPortal(calls), 20, 0, now);
    expect(second.stored).toBe(1);
    expect(db.count("SP")).toBe(2);
    expect(db.state<{ phase: string }>("SP")?.phase).toBe("INCREMENTAL");
    const third = await runAdapter(spAdapter, db, spPortal(calls), 20, 0, now);
    expect(third.stored).toBe(0);
  });

  it("to samo orzeczenie z drugiej oficjalnej bazy nie jest zapisywane drugi raz", () => {
    const db = database();
    const ctx = new SyncContext(db, (async () => new Response("")) as SyncFetch, 10, 0, now);
    const card = { courtType: "ADMINISTRATIVE", division: null, signatures: ["II SA/Wa 1/25"], date: "2025-02-01", kind: "wyrok", judges: [], keywords: [], legalBases: [], summary: null, modified: null };
    expect(ctx.store({ ...card, source: "CBOSA", sourceId: "A", court: "WSA w Warszawie", url: "https://orzeczenia.nsa.gov.pl/doc/A" }, "treść ".repeat(20))).toBe(true);
    expect(ctx.store({ ...card, source: "SP", sourceId: "B", court: "WSA w Warszawie", url: "https://orzeczenia.ms.gov.pl/details/$N/B" }, "treść ".repeat(20))).toBe(false);
    expect(ctx.duplicates).toBe(1);
  });

  it("SN bez sesji z okna sn.pl czeka na potwierdzenie i niczego nie gubi", async () => {
    const db = database();
    const blocked: SyncFetch = async () => new Response("<html>captcha</html>", { status: 403 });
    const run = await runAdapter(snAdapter, db, blocked, 10, 0, now);
    expect(run.waiting).toMatch(/oknie sn\.pl/u);
    expect(run.error).toBeUndefined();
    expect(snAdapter.progress(db)).toMatch(/czeka na potwierdzenie/u);
  });

  it("wyszukiwanie orzeczeń czyta najpierw bazę serwera", () => {
    const db = database();
    db.upsert({ source: "SP", sourceId: "X", court: "Sąd Okręgowy w Testowie", courtType: "COMMON", division: null, signatures: ["I C 5/25"], date: "2025-03-01", kind: "wyrok", judges: [], keywords: [], legalBases: [], summary: null, url: "https://orzeczenia.ms.gov.pl/details/$N/X", modified: null }, "zachowek darowizna doliczenie ".repeat(5), []);
    const result = searchLocalDatabase({ source: "SAOS", query: "zachowek darowizna" }, "zachowek darowizna", 5, db);
    expect(result?.candidates[0]?.sourceUrl).toBe("https://orzeczenia.ms.gov.pl/details/$N/X");
    expect(searchLocalDatabase({ source: "CBOSA", query: "zachowek" }, "zachowek", 5, db)).toBeNull();
  });
});

describe("sądy dyscyplinarne izb: sygnatura i data z treści", () => {
  it("sygnatura z treści, z etykiety albo z nazwy pliku; data tylko z nagłówka orzeczenia", async () => {
    const { disciplinarySignature, rulingDate } = await import("./case-law-sync.js");
    expect(disciplinarySignature("Pobierz PDF", "Sygn. akt OS 1/26 POSTANOWIENIE")).toBe("OS 1/26");
    expect(disciplinarySignature("OSD 32 25")).toBe("OSD 32/25");
    expect(disciplinarySignature("Pobierz PDF", "", "OS-1_26-an.pdf")).toBe("OS 1/26");
    expect(rulingDate("POSTANOWIENIE z dnia (…) r. w składzie: … ustawy z dnia 6 lipca 1982 r.")).toBeNull();
    expect(rulingDate("ORZECZENIE z dnia 14 maja 2024 r. w składzie")).toBe("2024-05-14");
  });
});

describe("sądy dyscyplinarne izb: PDF wysłany jako application/octet-stream", () => {
  it("plik rozpoznany po pierwszych bajtach trafia do odczytu PDF (OCR dla skanu)", async () => {
    const { SyncContext, disciplinaryAdapter, DISCIPLINARY_SEEDS } = await import("./case-law-sync.js");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const { CaseLawDatabase } = await import("./case-law-db.js");
    const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-osd-")));
    const index = DISCIPLINARY_SEEDS.findIndex((seed) => seed.id === "oirp-rzeszow");
    db.saveState("OSD", { seed: index, rounds: 0, lastRoundAt: null });
    const pdf = new TextEncoder().encode("%PDF-1.4 skan");
    const seen: number[][] = [];
    const ocr = { recognizePages: async (_data: Uint8Array, pages: number[]) => { seen.push(pages); return pages.map((page) => ({ page, text: "ORZECZENIE Sygn. akt OSD 39/21 z dnia 12 maja 2021 r. w składzie" })); } };
    const fetcher = (async (url: string) => {
      if (url.includes("item.php")) return new Response(pdf, { headers: { "content-type": "application/octet-stream" } });
      return new Response('<a href="/item.php?id=1240">OSD 39 21</a>', { headers: { "content-type": "text/html" } });
    }) as never;
    const extractor = await import("./pdf-text-extractor.js");
    const original = extractor.LocalPdfTextExtractor.prototype.extract;
    extractor.LocalPdfTextExtractor.prototype.extract = async () => ({ text: "", pages: 1, bytes: pdf.length, pageTexts: [""] });
    try {
      const ctx = new SyncContext(db, fetcher, 2, 0, () => new Date("2026-11-14T00:00:00Z"), ocr as never);
      await disciplinaryAdapter.run(ctx);
    } finally {
      extractor.LocalPdfTextExtractor.prototype.extract = original;
    }
    expect(seen).toEqual([[1]]);
    expect(db.count("OSD")).toBe(1);
  });
});

describe("NIL na sesji użytkownika i tekst DOCX", () => {
  it("DOCX: tekst z word/document.xml; NIL bez sesji z okna czeka, nie pobiera", async () => {
    const { docxText, nilAdapter, runAdapter } = await import("./case-law-sync.js");
    const docx = Buffer.from("UEsDBBQAAAAIACx0bl3HHBc8CgAAAAgAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLMJqSxILda3AwBQSwMEFAAAAAgALHRuXVBLvCF2AAAAsAAAABEAAAB3b3JkL2RvY3VtZW50LnhtbLMpt0rJTy7NTc0rsbMpt0rKT6kE0QUgoghElNj5B0W5Oke5+nm6KgRXpufpKSRmlyj4BfsoBKUW6CkY6xuZ2OiD1IHIIjBZgG5ElUJKXmaigrlCbmJRcqKCkYGRiUKRnkK5QnH20abElKrMVCxG6MOco4/kRgBQSwECFAMUAAAACAAsdG5dxxwXPAoAAAAIAAAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIACx0bl1QS7whdgAAALAAAAARAAAAAAAAAAAAAACAATsAAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAAAgACAIAAAADgAAAAAAA=", "base64");
    expect(docxText(new Uint8Array(docx))).toContain("NSL Rep. 3/24");
    const fetcher = (async () => {
      throw new Error("bez sesji nic nie powinno być pobierane");
    }) as never;
    const run = await runAdapter(nilAdapter, database(), fetcher, 10, 0, now);
    expect(run.waiting).toMatch(/folderu NIL/u);
    expect(run.requests).toBe(0);
  });
});

describe("RPO na sesji użytkownika i sygnatury urzędów", () => {
  it("RPO bez sesji czeka; sygnatury URE i RPO rozpoznawane", async () => {
    const { rpoAdapter, runAdapter, authoritySignature } = await import("./case-law-sync.js");
    const run = await runAdapter(rpoAdapter, database(), (async () => { throw new Error("bez sesji nic nie pobieramy"); }) as never, 10, 0, now);
    expect(run.waiting).toMatch(/BIP RPO/u);
    expect(authoritySignature("(629 KB) Ciepło 289/2026 1 października 2026")).toBe("Ciepło 289/2026");
    expect(authoritySignature("EE 282/2025 23 grudnia 2025")).toBe("EE 282/2025");
    expect(authoritySignature("Minister Zdrowia VII.501.12.2025 2025-03-01")).toBe("VII.501.12.2025");
  });
});

describe("czat czyta bazę serwera: źródło BAZA i pełny tekst", () => {
  it("BAZA zwraca orzeczenia sądów dyscyplinarnych z kartą i bazą; tekst do doczytania po sygnaturze", async () => {
    const { setSharedCaseLawDatabase } = await import("./case-law-db.js");
    const { caseTextPortion } = await import("./case-law-texts.js");
    const db = database();
    db.upsert({ source: "OSD", sourceId: "K1", court: "Okręgowy Sąd Dyscyplinarny OIRP w Kielcach", courtType: "DISCIPLINARY", division: null, signatures: ["OSD 40/22"], date: "2022-11-10", kind: "orzeczenie", judges: [], keywords: [], legalBases: [], summary: null, url: "https://www.oirpkielce.pl/x/OSD_40-XI-22.pdf", modified: null }, "tajemnica zawodowa radcy prawnego naruszenie ".repeat(5), []);
    const baza = searchLocalDatabase({ source: "BAZA", query: "tajemnica zawodowa" }, "tajemnica zawodowa", 5, db);
    expect(baza?.candidates[0]).toMatchObject({ database: "OSD", sourceUrl: "https://www.oirpkielce.pl/x/OSD_40-XI-22.pdf" });
    expect(searchLocalDatabase({ source: "BAZA", query: "tajemnica zawodowa", bases: ["NIL"] }, "tajemnica zawodowa", 5, db)).toBeNull();
    expect(searchLocalDatabase({ source: "SAOS", query: "tajemnica zawodowa" }, "tajemnica zawodowa", 5, db)).toBeNull();
    setSharedCaseLawDatabase(db);
    try {
      expect(JSON.parse(caseTextPortion("OSD 40/22", 0))).toMatchObject({ status: "OK", source: "OSD" });
    } finally {
      setSharedCaseLawDatabase(null);
    }
  });
});

describe("KNF, UKE, RIO, KRRiT, RF: sygnatury i daty urzędów", () => {
  it("numer uchwały RIO, znak sprawy UKE, data z linii miejscowości; RF bez sesji czeka", async () => {
    const { authoritySignature, letterDate, rfAdapter, runAdapter, CASE_LAW_ADAPTERS } = await import("./case-law-sync.js");
    expect(authoritySignature("Garwolin (gmina) Uchwała Kolegium Nr 23.284.2026 z dnia 3 listopada 2026 r.")).toBe("Nr 23.284.2026");
    expect(authoritySignature("dr.wwm.6171.21.2026.91.PDF")).toBe("DR.WWM.6171.21.2026");
    expect(letterDate("PREZES UKE Warszawa, dnia 12 sierpnia 2026 r. DR.WWM.6171.21.2026 DECYZJA ... wniosku z dnia 9 listopada 2023 r.")).toBe("2026-08-12");
    const run = await runAdapter(rfAdapter, database(), (async () => { throw new Error("bez sesji nic nie pobieramy"); }) as never, 10, 0, now);
    expect(run.waiting).toMatch(/Rzecznika Finansowego/u);
    expect(CASE_LAW_ADAPTERS.map((adapter) => adapter.source)).toEqual(expect.arrayContaining(["KNF", "UKE", "RIO", "KRRIT", "RF"]));
  });
});

describe("biblioteka orzeczeń w czacie obejmuje bazę serwera", () => {
  it("search_case_law_library zwraca orzeczenie z bazy serwera także przy wyłączonej bibliotece", async () => {
    const { setSharedCaseLawDatabase } = await import("./case-law-db.js");
    const db = database();
    db.upsert({ source: "KNF", sourceId: "kary-2025", court: "Komisja Nadzoru Finansowego", courtType: "AUTHORITY", division: null, signatures: ["Wykaz kar nałożonych przez KNF w 2025"], date: null, kind: "wykaz kar", judges: [], keywords: [], legalBases: [], summary: null, url: "https://knf.gov.pl/knf/pl/komponenty/img/kary_KNF_2025.pdf", modified: null }, "kara pieniężna nałożona na dom maklerski ".repeat(5), []);
    setSharedCaseLawDatabase(db);
    try {
      const { searchCaseLawLibraryForTest } = await import("./verification-tool-runtime.js");
      const result = JSON.parse(searchCaseLawLibraryForTest({ query: "dom maklerski" }));
      expect(result.status).toBe("FOUND");
      expect(result.entries[0]).toMatchObject({ database: "KNF" });
    } finally {
      setSharedCaseLawDatabase(null);
    }
  });
});
