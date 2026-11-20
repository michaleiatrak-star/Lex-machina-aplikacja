import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CaseLawDatabase } from "../src/case-law-db.js";
import { SyncContext, rulingDate } from "../src/case-law-sync.js";
import { zusAdapter, zusArchiveLinks, zusListPage, zusListUrl } from "../src/case-law-zus.js";

const P = "_interpretationsportlet_WAR_interpretationsportlet_";
const fileUrl = (id: number, type: number) =>
  `https://bip.zus.pl/inne/interpretacje?p_p_id=interpretationsportlet_WAR_interpretationsportlet&amp;p_p_lifecycle=2&amp;p_p_resource_id=getFile&amp;${P}id=${id}&amp;${P}type=${type}`;
const item = (id: number, sign: string, day: string) =>
  `<li class="b-row b-table-row small-no-tr medium-no-tr"><div class="b-column twelve"><p class="fs-bigger">Sprawa numer: <span class="strong">${sign}</span></p>` +
  `<p class="fs-bigger">Wniosek: <a class="no-table strong" href="${fileUrl(id, 0)}">a.pdf</a></p>` +
  `<p class="fs-bigger">Decyzja: <a class="no-table strong" href="${fileUrl(id, 1)}">b.pdf</a></p>` +
  `<p class="fs-bigger">Ubezpieczenie chorobowe - działalność</p><div class="msg-st"><p class="cf-i small-font">Udostępnił: ZUS Oddział - ${day} r., godz. 14:38 </p></div></div></li>`;
const archivePage =
  '<a href="/documents/493361/494161/inne.rar/fc79" class="strong"><span>Pobierz Inne .RAR 27,3 MB</span></a>' +
  '<a href="/documents/493361/494131/ustawa.pdf/52ad">ustawa</a>';

describe("ZUS written interpretations (BIP)", () => {
  it("reads the archive links and the list items", () => {
    expect(zusArchiveLinks(archivePage)).toEqual([{ url: "https://bip.zus.pl/documents/493361/494161/inne.rar/fc79", label: "Pobierz Inne .RAR 27,3 MB" }]);
    const [first] = zusListPage(`<ul>${item(2868, "DI/200000/451/336/2013", "25.04.2013")}</ul>`);
    expect(first).toMatchObject({ id: "2868", sign: "DI/200000/451/336/2013", subject: "Ubezpieczenie chorobowe - działalność", published: "2013-04-25" });
    expect(first!.decisionUrl).toContain(`${P}type=1`);
    expect(zusListUrl("2013-01-01", "2026-11-20", 3)).toContain(`${P}cur=3`);
  });

  it("downloads the archive, then the list from 2013, then only what is new", async () => {
    const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-zus-")));
    const listed = [item(1, "DI/100000/1/1/2014", "02.01.2014"), item(2, "DI/100000/2/2/2015", "03.01.2015")];
    let newer = false;
    const asked: string[] = [];
    const fetcher = async (url: string) => {
      asked.push(url);
      if (url.endsWith("/inne/interpretacje")) return new Response(archivePage);
      if (url.includes("inne.rar")) return new Response(new Uint8Array([1, 2, 3]));
      if (url.includes("getFile")) return new Response(new TextEncoder().encode("%PDF- decyzja"));
      const page = Number(new URL(url).searchParams.get(`${P}cur`));
      const items = page === 1 ? (newer ? [...listed, item(3, "DI/100000/3/3/2026", "10.11.2026")] : listed) : [];
      return new Response(`<ul>${items.join("")}</ul>`);
    };
    const adapter = zusAdapter(
      {
        pdf: async () => "Decyzja nr DI/100000/1/1/2014 z dnia 2 stycznia 2014 r. w sprawie interpretacji przepisów o składkach na ubezpieczenia społeczne",
        archive: async function* () {
          yield { name: "inne/(inne-0001) FEP.pdf", bytes: new TextEncoder().encode("%PDF- archiwum") };
        }
      },
      rulingDate
    );
    const run = async () => {
      const ctx = new SyncContext(db, fetcher as never, 50, 0, () => new Date("2026-11-20T12:00:00Z"));
      await adapter.run(ctx);
      return ctx;
    };
    expect((await run()).stored).toBe(1);
    expect(adapter.progress(db)).toContain("archiwa RAR 1");
    expect((await run()).stored).toBe(2);
    expect(adapter.progress(db)).toMatch(/^pobrane w całości/u);
    newer = true;
    asked.length = 0;
    const third = await run();
    expect(third.stored).toBe(1);
    expect(asked.some((url) => url.includes(`${P}dateFrom=2026-10-20`))).toBe(true);
    expect(asked.filter((url) => url.includes("getFile"))).toHaveLength(1);
  });
});

describe("the RAR library in the application's process", () => {
  it("leaves no process-wide error handlers behind", async () => {
    const { rarDocuments } = await import("../src/case-law-zus.js");
    const count = () => [process.listenerCount("uncaughtException"), process.listenerCount("unhandledRejection")];
    const before = count();
    try {
      for await (const file of rarDocuments(new Uint8Array([82, 97, 114, 33, 26, 7, 0]))) void file;
    } catch {
      // A broken archive is refused; what matters here is the process.
    }
    expect(count()).toEqual(before);
  });
});

describe("a .doc that is a pasted scan", () => {
  it("is read through the picture OCR, page after page", async () => {
    const db = new CaseLawDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "lex-zus-doc-")));
    const doc = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]);
    const pages = ["Znak: DI/200000/451/360/2011 Decyzja nr 360/2011 z dnia 7 czerwca 2011 r.", "Uzasadnienie W dniu 31.05.2011 r. wpłynął wniosek przedsiębiorcy"];
    const adapter = zusAdapter(
      {
        pdf: async () => "",
        doc: async () => "",
        docImages: async () => pages.map((_, index) => ({ name: `Data/${index + 1}`, mediaType: "image/png" as const, data: new Uint8Array([index]) })),
        imageOcr: () => ({ recognizeImage: async (data: Uint8Array) => ({ page: 1, text: pages[data[0]!]!, confidence: 0.9 }) }) as never,
        archive: async function* () {
          yield { name: "inne/(inne-0001) FEP.doc", bytes: doc };
        }
      },
      rulingDate
    );
    const fetcher = async (url: string) => (url.endsWith("/inne/interpretacje") ? new Response(archivePage) : new Response(new Uint8Array([1])));
    const ctx = new SyncContext(db, fetcher as never, 10, 0, () => new Date("2026-11-20T12:00:00Z"));
    await adapter.run(ctx);
    expect(ctx.stored).toBe(1);
    const [hit] = db.search("przedsiębiorcy");
    expect(hit?.signatures).toEqual(["DI/200000/451/360/2011"]);
    expect(hit?.date).toBe("2011-06-07");
  });
});

