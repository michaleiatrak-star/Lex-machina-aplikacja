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
