import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CoreLawIndex,
  coreLawEliCaution,
  repairDzuPdfEncoding,
  splitArticles,
  stripPdfPageHeaders
} from "../src/core-law-index.js";
import { verifyFromCoreLaw } from "../src/core-law-verification.js";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("PDF text of old Dz.U.", () => {
  it("repairs the font encoding of Dz.U. PDFs from 2003-2011", () => {
    expect(repairDzuPdfEncoding("UMOWA mi´dzy Rzàdem o zasadach ma∏ego ruchu; oÊwiadczam, ˝e postanowieƒ")).toBe(
      "UMOWA między Rządem o zasadach małego ruchu; oświadczam, że postanowień"
    );
    // Poprawny tekst (także z obcymi znakami) zostaje bez zmian.
    expect(repairDzuPdfEncoding("Café à la carte, małego")).toBe("Café à la carte, małego");
  });

  it("removes Dz.U. page headers, also split by OCR into two lines", () => {
    const text = stripPdfPageHeaders(
      "Dziennik Ustaw Nr 103 — 7711 — Poz. 858\nArtykuł 2\nDziennik Ustaw Nr 103 — 7712 —\nPoz. 858\ntreść\nwww.rcl.gov.pl"
    );
    expect(text).toBe("Artykuł 2\ntreść");
  });

  it("splits treaties by 'Artykuł N'", () => {
    const { order, articles } = splitArticles("uzgodniły, co następuje:\nArtykuł 1\nZasady.\nArtykuł 2\n1. Definicje.");
    expect(order).toEqual(["1", "2"]);
    expect(articles["2"]).toBe("Artykuł 2\n1. Definicje.");
  });
});

const HEADER = (page: number) => `Dziennik Ustaw Nr 103 — ${7709 + page} — Poz. 858 www.rcl.gov.pl`;

function fakeEli(meta: Record<string, Record<string, unknown>>) {
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    const match = /\/acts\/(DU\/\d+\/\d+)(\/references|\/text\.pdf)?$/.exec(url);
    if (!match || !meta[match[1]!]) return new Response("", { status: 404 });
    if (match[2] === "/references") return Response.json({});
    if (match[2] === "/text.pdf") return new Response(new Uint8Array([37, 80, 68, 70]));
    return Response.json(meta[match[1]!]);
  };
  return { fetcher, requested };
}

async function settled(index: CoreLawIndex) {
  for (let i = 0; i < 100 && index.status().refreshing; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("scanned ELI PDFs", () => {
  it("shows OCR progress and resumes an interrupted OCR from the saved pages", async () => {
    const pageTexts = [`${HEADER(1)}\nArtykuł 1\nNiniejsza Umowa określa zasady małego ruchu granicznego.`, ...Array.from({ length: 30 }, (_, index) => HEADER(index + 2))];
    const pdf = { extract: async () => ({ text: "", pages: pageTexts.length, bytes: 4, pageTexts }) };
    const seen: number[][] = [];
    let fail = true;
    let progress: unknown = null;
    const store = tempDir("lex-core-scan-");
    let index: CoreLawIndex;
    const ocr = {
      recognizePages: async (_data: Uint8Array, pages: number[], onPage?: (done: number) => void) => {
        seen.push(pages);
        onPage?.(1);
        progress = index.status().progress;
        if (fail && pages[0] !== 2) throw new Error("worker crashed");
        return pages.map((page) => ({ page, text: page === 2 ? "Artykuł 2\nDefinicje." : `strona ${page}` }));
      }
    };
    const { fetcher } = fakeEli({ "DU/2009/858": { title: "Umowa", status: "obowiązujący", textPDF: true } });
    index = new CoreLawIndex(store, fetcher, pdf, () => Date.parse("2026-10-02T10:00:00Z"), 0, ocr);
    index.load(tempDir("lex-core-scan-corpus-"));
    index.addUserAct({ currentEli: "DU/2009/858", baseEli: "DU/2009/858", title: "Umowa" }, "admin");
    await settled(index);
    expect(progress).toEqual({ eli: "DU/2009/858", phase: "ocr", done: 26, total: 30 });
    expect(index.summary("DU/2009/858")!.lastError).toContain("worker crashed");
    expect(index.status().progress).toBeNull();

    // Drugie podejście czyta tylko strony, których OCR nie zapisał.
    fail = false;
    seen.length = 0;
    await index.refresh({ force: true, only: ["DU/2009/858"] });
    expect(seen).toEqual([[27, 28, 29, 30, 31]]);
    expect(index.currentRecord("DU/2009/858")?.articleOrder).toEqual(["1", "2"]);
    expect(fs.readdirSync(path.join(store, "ocr-cache"))).toEqual([]);
  });

  it("reads image pages with local OCR in batches and keeps the copy unverified", async () => {
    // DU/2009/858: strona 1 z warstwą tekstową (złe kodowanie), strony 2-46 to skany z samym nagłówkiem.
    const pageTexts = [
      `${HEADER(1)}\nUMOWA mi´dzy Rzàdem\nuzgodni∏y, co nast´puje:\nArtykuł 1\nNiniejsza Umowa okreÊla zasady ma∏ego ruchu granicznego.`,
      ...Array.from({ length: 45 }, (_, index) => HEADER(index + 2))
    ];
    const pdf = { extract: async () => ({ text: pageTexts.join("\n"), pages: pageTexts.length, bytes: 4, pageTexts }) };
    const batches: number[][] = [];
    const ocr = {
      recognizePages: async (_data: Uint8Array, pages: number[]) => {
        batches.push(pages);
        return pages.map((page) => ({
          page,
          text:
            page === 2
              ? `Dziennik Ustaw Nr 103 — 7711 —\nPoz. 858\nArtykuł 2\n1. Na potrzeby niniejszej Umowy przyjmuje się definicje.`
              : `Wykaz miejscowości ${page}`
        }));
      }
    };
    const { fetcher } = fakeEli({ "DU/2009/858": { title: "Umowa o zasadach małego ruchu granicznego", status: "obowiązujący", textPDF: true } });
    const index = new CoreLawIndex(tempDir("lex-core-scan-"), fetcher, pdf, () => Date.parse("2026-10-02T10:00:00Z"), 0, ocr);
    index.load(tempDir("lex-core-scan-corpus-"));
    index.addUserAct({ currentEli: "DU/2009/858", baseEli: "DU/2009/858", title: "Umowa o zasadach małego ruchu granicznego" }, "admin");
    await settled(index);

    expect(batches).toEqual([
      Array.from({ length: 25 }, (_, i) => i + 2),
      Array.from({ length: 20 }, (_, i) => i + 27)
    ]);
    const record = index.currentRecord("DU/2009/858")!;
    expect(record.textSource).toBe("ocr");
    expect(record.ocrPages).toHaveLength(45);
    expect(record.articleOrder).toEqual(["1", "2"]);
    expect(record.articles["1"]).toContain("określa zasady małego ruchu");
    expect(record.articles["2"]).not.toContain("Dziennik Ustaw");
    expect(record.text).toContain("Wykaz miejscowości 46");

    const summary = index.summary("DU/2009/858")!;
    expect(summary.lastError).toBeNull();
    expect(coreLawEliCaution(summary)).toContain("OCR");
    const outcome = verifyFromCoreLaw({
      index,
      claim: "art. 2 umowy o małym ruchu granicznym",
      kind: "statute",
      act: "DU/2009/858",
      toolCallId: "t1"
    });
    expect(outcome).toEqual({ decision: "DENY", reason: "CORE_LAW_OCR_TEXT" });
  });

  it("reports an ELI scan without the act text and retries it only daily", async () => {
    // DU/1965/232: w ELI jest tylko strona numeru z odesłaniem do załącznika.
    const pdf = { extract: async () => ({ text: "", pages: 1, bytes: 4, pageTexts: [""] }) };
    const ocr = {
      recognizePages: async (_data: Uint8Array, pages: number[]) =>
        pages.map((page) => ({
          page,
          text: "KONWENCJA WIEDEŃSKA O STOSUNKACH DYPLOMATYCZNYCH\n(Tekst konwencji zamieszczony jest w załączniku do niniejszego ńumeru)."
        }))
    };
    let now = Date.parse("2026-10-02T10:00:00Z");
    const { fetcher, requested } = fakeEli({ "DU/1965/232": { title: "Konwencja wiedeńska o stosunkach dyplomatycznych", status: "obowiązujący", textPDF: true } });
    const index = new CoreLawIndex(tempDir("lex-core-scan-"), fetcher, pdf, () => now, 0, ocr);
    index.load(tempDir("lex-core-scan-corpus-"));
    index.addUserAct({ currentEli: "DU/1965/232", baseEli: "DU/1965/232", title: "Konwencja wiedeńska o stosunkach dyplomatycznych" }, "admin");
    await settled(index);

    // Brak tekstu w ELI to osobny stan, nie "błąd pobierania".
    const act = index.status().acts.find((item) => item.eli === "DU/1965/232")!;
    expect(act.state).toBe("UNAVAILABLE");
    expect(act.lastError).toBeNull();
    expect(act.unavailable).toContain("w załączniku do numeru; załącznika nie ma w ELI");
    expect(index.currentRecord("DU/1965/232")).toBeNull();

    const before = requested.length;
    now += 60 * 60 * 1000;
    await index.refresh();
    expect(requested.length).toBe(before);
    now += 24 * 60 * 60 * 1000;
    await index.refresh();
    expect(requested.length).toBeGreaterThan(before);
  });

  it("names a scanned PDF when no local OCR is available", async () => {
    const pdf = { extract: async () => ({ text: "", pages: 1, bytes: 4, pageTexts: [""] }) };
    const { fetcher } = fakeEli({ "DU/1965/232": { title: "Konwencja", status: "obowiązujący", textPDF: true } });
    const index = new CoreLawIndex(tempDir("lex-core-scan-"), fetcher, pdf, () => Date.parse("2026-10-02T10:00:00Z"), 0);
    index.load(tempDir("lex-core-scan-corpus-"));
    index.addUserAct({ currentEli: "DU/1965/232", baseEli: "DU/1965/232", title: "Konwencja" }, "admin");
    await settled(index);
    expect(index.summary("DU/1965/232")!.lastError).toBe("PDF w ELI jest skanem bez warstwy tekstowej, a lokalny OCR jest niedostępny.");
  });
});
