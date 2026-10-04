import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CoreLawIndex,
  extractCoreActs,
  htmlToText,
  splitArticles
} from "../src/core-law-index.js";
import { CoreLawToolRuntime, coreLawRetrievalPrompt } from "../src/core-law-tool-runtime.js";

const roots: string[] = [];

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  while (roots.length) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

function corpus(): string {
  const root = tempDir("lex-core-corpus-");
  fs.mkdirSync(path.join(root, "dr-03-karne"));
  fs.writeFileSync(
    path.join(root, "dr-03-karne", "MAPA-AKTOW.md"),
    [
      "**Baza KK:** Dz.U. 2025 poz. 383 t.j. ✅",
      "⛔ KROK 2C: nowelizacje po tekście jednolitym — Dz.U. 2026 poz. 421, 638, 2026 poz. 901.",
      "| Kodeks wykroczeń | Dz.U. 2025 poz. 734 t.j. ze zm. | `mod-KW` | ✅ |",
      "| Stary akt | poprzedni t.j. 2016.283 NIEAKTUALNY | x | x |"
    ].join("\n")
  );
  fs.mkdirSync(path.join(root, "prawo-polskie-v2"));
  fs.writeFileSync(
    path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"),
    "| Konstytucja RP | Dz.U. 1997 nr 78 poz. 483 | x | x |\n"
  );
  return root;
}

const KK_HTML =
  "<html><head><style>x{}</style></head><body><p>Art. 1. § 1. Odpowiedzialności karnej podlega ten tylko, kto popełnia czyn zabroniony.</p>" +
  "<p>Art. 148. § 1. Kto zabija człowieka,</p><p>podlega karze pozbawienia wolności&nbsp;na czas nie krótszy od lat 10.</p>" +
  "<p>Art. 148a. § 1. Kto zabija człowieka ze szczególnym okrucieństwem</p></body></html>";

function fakeEli(
  options: { deny?: boolean; references?: Record<string, unknown>; emptyKkHtml?: boolean; amendmentText?: boolean } = {}
) {
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    if (options.deny) return new Response("", { status: 403 });
    const references = /\/acts\/(DU\/\d+\/\d+)\/references$/.exec(url);
    if (references) return Response.json(options.references?.[references[1]!] ?? {});
    if (options.amendmentText && url.endsWith("/DU/2026/999")) {
      return Response.json({ title: "Ustawa o zmianie ustawy — Kodeks karny", textHTML: true });
    }
    if (options.amendmentText && url.endsWith("/DU/2026/999/text.html")) {
      return new Response("<p>Art. 1. W ustawie Kodeks karny dodaje się przepis o czynnym żalu sprawcy kradzieży.</p>");
    }
    if (url.endsWith("/DU/2026/1500")) {
      return Response.json({ title: "Obwieszczenie — Kodeks karny (nowszy t.j.)", textHTML: true });
    }
    if (url.endsWith("/DU/2026/1500/text.html")) {
      return new Response("<p>Art. 148. § 1. Kto zabija człowieka, podlega karze w nowym brzmieniu.</p>");
    }
    if (url.endsWith("/DU/2025/383")) {
      return Response.json({ title: "Obwieszczenie — Kodeks karny", status: "akt jednorazowy", textHTML: true, textPDF: true });
    }
    if (url.endsWith("/DU/2025/383/text.html")) return new Response(options.emptyKkHtml ? "" : KK_HTML);
    if (url.endsWith("/DU/2025/383/text.pdf")) return new Response(new Uint8Array([4, 5, 6]));
    if (url.endsWith("/DU/2025/734")) {
      return Response.json({ title: "Kodeks wykroczeń", status: "obowiązujący", textHTML: false, textPDF: true });
    }
    if (url.endsWith("/DU/2025/734/text.pdf")) return new Response(new Uint8Array([1, 2, 3]));
    return Response.json({ title: "Inny akt", textHTML: false, textPDF: false });
  };
  const pdf = {
    extract: async () => ({
      text: "Art. 51. § 1. Kto krzykiem, hałasem zakłóca spokój,\npodlega karze aresztu.",
      pages: 1,
      truncated: false
    })
  };
  return { fetcher, pdf, requested };
}

describe("core law index", () => {
  it("reads 'Nr X, poz.' and 'a i b' lists, and re-reads the maps after a skill update", () => {
    const root = corpus();
    fs.writeFileSync(
      path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"),
      "| Timeshare | Dz.U. 2011 Nr 230, poz. 1370 | x | ✅ |\n| KK | nowelizacje Dz.U. 2026 poz. 760, 882 i 901 | x | ✅ |\n"
    );
    expect(extractCoreActs(root).map((act) => act.eli)).toEqual(expect.arrayContaining(["DU/2011/1370", "DU/2026/760", "DU/2026/882"]));
    const index = new CoreLawIndex(tempDir("lex-core-reload-"));
    index.load(root);
    expect(index.reloadMapsIfChanged()).toEqual([]);
    const map = path.join(root, "dr-03-karne", "MAPA-AKTOW.md");
    fs.appendFileSync(map, "\n| Taryfikator | Dz.U. 2013 poz. 1624 t.j. | `mod-x` | ✅ |\n");
    fs.utimesSync(map, new Date(), new Date(Date.now() + 5_000));
    expect(index.reloadMapsIfChanged()).toEqual(["DU/2013/1624"]);
  });

  it("collects every Dz.U. act from the domain maps and the routing map", () => {
    const acts = extractCoreActs(corpus());
    expect(acts.map((act) => act.eli)).toEqual([
      "DU/2025/383",
      "DU/2025/734",
      "DU/1997/483",
      "DU/2026/421",
      "DU/2026/638",
      "DU/2026/901"
    ]);
    const kk = acts[0]!;
    expect(kk.consolidated).toBe(true);
    expect(kk.labels).toEqual(["KK"]);
    // Shorthand references to superseded texts are not treated as core acts.
    expect(acts.some((act) => act.eli === "DU/2016/283")).toBe(false);
  });

  it("turns ELI HTML into text and splits articles", () => {
    const { order, articles } = splitArticles(htmlToText(KK_HTML));
    expect(order).toEqual(["1", "148", "148a"]);
    expect(articles["148"]).toBe(
      "Art. 148. § 1. Kto zabija człowieka,\npodlega karze pozbawienia wolności na czas nie krótszy od lat 10."
    );
  });

  it("downloads HTML and PDF texts, then serves articles to every model", async () => {
    const eli = fakeEli();
    const index = new CoreLawIndex(tempDir("lex-core-store-"), eli.fetcher as never, eli.pdf as never, () => Date.parse("2026-09-23T12:00:00Z"), 0);
    index.load(corpus());
    await index.refresh();

    const tools = new CoreLawToolRuntime(index);
    const [kk, kw, search, missing] = await tools.runTools([
      { id: "1", name: "read_core_law_article", input: { act: "KK", article: "148" } },
      { id: "2", name: "read_core_law_article", input: { act: "Dz.U. 2025 poz. 734", article: "art. 51" } },
      { id: "3", name: "search_core_law", input: { query: "zabija czlowieka" } },
      { id: "4", name: "read_core_law_article", input: { act: "KK", article: "999" } }
    ]);
    expect(JSON.parse(kk!.content)).toMatchObject({
      status: "OK",
      eli: "DU/2025/383",
      consolidatedText: true,
      text: expect.stringContaining("Kto zabija człowieka"),
      mapNotes: [expect.stringContaining("Baza KK")]
    });
    expect(JSON.parse(kw!.content)).toMatchObject({
      status: "OK",
      title: "Kodeks wykroczeń",
      text: expect.stringContaining("zakłóca spokój")
    });
    expect(JSON.parse(search!.content).hits.map((hit: { article: string }) => hit.article).sort()).toEqual(["148", "148a"]);
    // Ranked, and inflected question words still find the article.
    expect(index.search("zabił człowieka ze szczególnym okrucieństwem")[0]).toMatchObject({ article: "148a" });
    expect(index.search("kara za zakłócanie spokoju krzykiem")[0]).toMatchObject({ eli: "DU/2025/734", article: "51" });
    // Local models get the best articles in the prompt; small talk gets none.
    const rag = coreLawRetrievalPrompt(index, "Czy [PII:PERSON:0001|NOM] zakłócał spokój krzykiem i hałasem?");
    expect(rag).toContain("[DU/2025/734] Kodeks wykroczeń — art. 51");
    expect(rag).not.toContain("PII:");
    expect(coreLawRetrievalPrompt(index, "Napisz ok")).toBeNull();
    expect(JSON.parse(missing!.content)).toEqual({ status: "BLOCKED", error: "CORE_LAW_ARTICLE_NOT_FOUND" });
  });

  const DAY = 25 * 60 * 60 * 1000;

  async function downloadedIndex(store: string, start: number) {
    const eli = fakeEli();
    const index = new CoreLawIndex(store, eli.fetcher as never, eli.pdf as never, () => start, 0);
    index.load(corpus());
    await index.refresh();
    return eli;
  }

  function later(store: string, now: number, options: Parameters<typeof fakeEli>[0]) {
    const eli = fakeEli(options);
    const index = new CoreLawIndex(store, eli.fetcher as never, eli.pdf as never, () => now, 0);
    index.load(corpus());
    return { eli, index };
  }

  it("downloads each text once and afterwards only checks ELI relations", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    const first = await downloadedIndex(store, start);
    expect(first.requested.filter((url) => url.endsWith("/references"))).toEqual([]);

    const { eli, index } = later(store, start + DAY, {});
    await index.refresh();
    // Only the consolidated texts are checked, and only their relations.
    expect(eli.requested).toEqual([
      "https://api.sejm.gov.pl/eli/acts/DU/2025/383/references",
      "https://api.sejm.gov.pl/eli/acts/DU/2025/734/references"
    ]);

    await index.refresh();
    expect(eli.requested).toHaveLength(2);
  });

  it("reads the consolidated text from PDF when ELI serves an empty text.html", async () => {
    const eli = fakeEli({ emptyKkHtml: true });
    const index = new CoreLawIndex(tempDir("lex-core-store-"), eli.fetcher as never, eli.pdf as never, () => Date.parse("2026-09-23T12:00:00Z"), 0);
    index.load(corpus());
    await index.refresh();
    const kk = index.currentRecord("DU/2025/383");
    expect(kk?.textSource).toBe("pdf");
    expect(kk?.sourceUrl).toBe("https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf");
    expect(kk?.articleOrder.length).toBeGreaterThan(0);
  });

  it("downloads again a copy without articles saved before extraction v2", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);
    const file = path.join(store, "DU_2025_734.json");
    const stale = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(stale.extraction).toBe(3);
    delete stale.extraction;
    stale.articleOrder = [];
    stale.articles = {};
    fs.writeFileSync(file, JSON.stringify(stale));

    const { eli, index } = later(store, start + 60_000, {});
    expect(index.currentRecord("DU/2025/734")).toBeNull();
    await index.refresh();
    expect(eli.requested).toContain("https://api.sejm.gov.pl/eli/acts/DU/2025/734/text.pdf");
    expect(index.currentRecord("DU/2025/734")?.articleOrder).toEqual(["51"]);
  });

  it("adopts an act verified at the source outside the maps and keeps it across restarts", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);
    const { eli, index } = later(store, start + 60_000, {});
    expect(index.summary("DU/2025/2000")).toBeNull();

    index.adopt({ eli: "DU/2025/2000", baseEli: "DU/1985/14", title: "o drogach publicznych" });
    await index.refresh();
    expect(eli.requested).toContain("https://api.sejm.gov.pl/eli/acts/DU/2025/2000");
    expect(index.summary("DU/2025/2000")?.labels).toEqual(["o drogach publicznych"]);

    const restarted = later(store, start + 120_000, {}).index;
    expect(restarted.summary("DU/2025/2000")).not.toBeNull();
    // Akt z map z tym samym t.j. nie jest dodawany drugi raz.
    restarted.adopt({ eli: "DU/2025/734", baseEli: "DU/1971/114", title: "Kodeks wykroczeń" });
    expect(restarted.summaries().filter((act) => act.eli === "DU/2025/734")).toHaveLength(1);
  });

  it("downloads a new amendment on its own and flags it on the article", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);

    const { eli, index } = later(store, start + DAY, {
      references: {
        "DU/2025/383": {
          "Nowelizacje po tekście jednolitym": [
            { act: { ELI: "DU/2026/999", title: "Ustawa o zmianie ustawy — Kodeks karny", promulgation: "2026-09-20" } }
          ]
        }
      }
    });
    await index.refresh();
    expect(eli.requested).toContain("https://api.sejm.gov.pl/eli/acts/DU/2026/999");
    expect(eli.requested).not.toContain("https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.html");

    const [read] = await new CoreLawToolRuntime(index).runTools([
      { id: "1", name: "read_core_law_article", input: { act: "KK", article: "148" } }
    ]);
    expect(JSON.parse(read!.content)).toMatchObject({
      eli: "DU/2025/383",
      amendmentsAfter: [{ eli: "DU/2026/999", title: "Ustawa o zmianie ustawy — Kodeks karny" }],
      warning: expect.stringContaining("nowelizac")
    });
  });

  it("replaces the copy when ELI publishes a newer consolidated text", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);

    const { index } = later(store, start + DAY, {
      references: {
        "DU/2025/383": {
          "Tekst jednolity dla aktu": [{ act: { ELI: "DU/1997/553" } }]
        },
        "DU/1997/553": {
          "Inf. o tekście jednolitym": [
            { act: { ELI: "DU/2025/383", status: "akt objęty tekstem jednolitym" } },
            { act: { ELI: "DU/2026/1500", status: "obowiązujący" } }
          ]
        }
      }
    });
    await index.refresh();

    const [read] = await new CoreLawToolRuntime(index).runTools([
      { id: "1", name: "read_core_law_article", input: { act: "KK", article: "148" } }
    ]);
    expect(JSON.parse(read!.content)).toMatchObject({
      eli: "DU/2026/1500",
      mapEli: "DU/2025/383",
      text: expect.stringContaining("w nowym brzmieniu"),
      amendmentsAfter: []
    });
  });

  it("keeps the texts it has when ELI refuses access", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);

    const { eli, index } = later(store, start + DAY, { deny: true });
    await index.refresh();
    expect(eli.requested).toHaveLength(2);
    expect(index.summary("DU/2025/383")).toMatchObject({ articleCount: 3, lastError: "ELI_HTTP_403" });
    expect(index.currentRecord("DU/2025/383")!.articles["148"]).toContain("Kto zabija");
  });

  it("pauses after five refusals in a row instead of hammering ELI", async () => {
    const store = tempDir("lex-core-store-");
    const { eli, index } = later(store, Date.parse("2026-09-23T12:00:00Z"), { deny: true });
    await index.refresh();
    expect(eli.requested).toHaveLength(5);
    await index.refresh();
    expect(eli.requested).toHaveLength(5);
  });

  const NEWER_TJ = {
    "DU/2025/383": {
      "Tekst jednolity dla aktu": [{ act: { ELI: "DU/1997/553" } }],
      "Nowelizacje po tekście jednolitym": [
        { act: { ELI: "DU/2026/999", title: "Ustawa o zmianie ustawy — Kodeks karny", promulgation: "2026-09-20" } }
      ]
    },
    "DU/1997/553": {
      "Inf. o tekście jednolitym": [
        { act: { ELI: "DU/2025/383", status: "akt objęty tekstem jednolitym" } },
        { act: { ELI: "DU/2026/1500", status: "obowiązujący" } }
      ]
    }
  };

  it("bez automatycznych aktualizacji sprawdzenie tylko wykrywa zmiany; zastosowanie podmienia t.j.", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);

    const { eli, index } = later(store, start + DAY, { references: NEWER_TJ });
    index.setAutoApply(false);
    await index.checkNow();
    // Found, not downloaded.
    expect(eli.requested).not.toContain("https://api.sejm.gov.pl/eli/acts/DU/2026/1500/text.html");
    const found = index.status();
    expect(found.autoApply).toBe(false);
    expect(found.pending).toEqual({ consolidated: 1, amendments: 1 });
    expect(found.acts.find((act) => act.eli === "DU/2025/383")).toMatchObject({
      state: "UPDATE_AVAILABLE",
      currentEli: "DU/2025/383",
      pendingConsolidated: { eli: "DU/2026/1500" }
    });
    const [stale] = await new CoreLawToolRuntime(index).runTools([
      { id: "1", name: "read_core_law_article", input: { act: "KK", article: "148" } }
    ]);
    expect(JSON.parse(stale!.content)).toMatchObject({
      eli: "DU/2025/383",
      pendingUpdate: { consolidated: { eli: "DU/2026/1500" } },
      warning: expect.stringContaining("niezastosowane")
    });

    await index.applyUpdates(["DU/2025/383"]);
    const applied = index.status();
    expect(applied.pending).toEqual({ consolidated: 0, amendments: 0 });
    expect(applied.recent[0]).toMatchObject({ kind: "CONSOLIDATED", actEli: "DU/2025/383", eli: "DU/2026/1500" });
    const [current] = await new CoreLawToolRuntime(index).runTools([
      { id: "1", name: "read_core_law_article", input: { act: "KK", article: "148" } }
    ]);
    expect(JSON.parse(current!.content)).toMatchObject({
      eli: "DU/2026/1500",
      text: expect.stringContaining("w nowym brzmieniu")
    });
  });

  it("zastosowana nowelizacja jest osobnym dokumentem w wyszukiwaniu RAG", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);

    const { index } = later(store, start + DAY, {
      amendmentText: true,
      references: {
        "DU/2025/383": {
          "Nowelizacje po tekście jednolitym": [
            { act: { ELI: "DU/2026/999", title: "Ustawa o zmianie ustawy — Kodeks karny", promulgation: "2026-09-20" } }
          ]
        }
      }
    });
    await index.refresh();
    expect(index.status()).toMatchObject({
      counts: { amendments: 1 },
      recent: [{ kind: "AMENDMENT", eli: "DU/2026/999" }]
    });
    expect(index.search("czynnym żalu sprawcy kradzieży").map((hit) => hit.eli)).toContain("DU/2026/999");
  });
  it("pobiera ponownie kopię sprzed kotwic jednostek; link do artykułu prowadzi do jednostki w ELI", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);
    const file = path.join(store, "DU_2025_734.json");
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(old.articleAnchors).toEqual({ "51": "page=1" });
    old.extraction = 2;
    delete old.articleAnchors;
    fs.writeFileSync(file, JSON.stringify(old));

    const { eli, index } = later(store, start + 60_000, {});
    expect(index.currentRecord("DU/2025/734")?.articleAnchors).toBeUndefined();
    await index.refresh();
    // Tylko kopia bez kotwic: KK (z kotwicami) nie jest pobierany ponownie.
    expect(eli.requested).toEqual([
      "https://api.sejm.gov.pl/eli/acts/DU/2025/734",
      "https://api.sejm.gov.pl/eli/acts/DU/2025/734/text.pdf"
    ]);
    const record = index.currentRecord("DU/2025/734")!;
    expect(record).toMatchObject({ extraction: 3, articleAnchors: { "51": "page=1" } });

    await index.refresh();
    expect(eli.requested).toHaveLength(2);
    const [read] = await new CoreLawToolRuntime(index).runTools([
      { id: "1", name: "read_core_law_article", input: { act: "Dz.U. 2025 poz. 734", article: "51" } }
    ]);
    expect(JSON.parse(read!.content)).toMatchObject({
      sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/734/text.pdf",
      sourceAnchorUrl: "https://api.sejm.gov.pl/eli/acts/DU/2025/734/text.pdf#page=1"
    });
  });

  it("przy użyciu kopii sprawdza ELI: nowszy t.j. jest wykrywany i od razu pobierany", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);

    // Pół godziny po pobraniu (przed dobowym sprawdzeniem) ELI ma nowszy t.j.
    const { eli, index } = later(store, start + 30 * 60_000, { references: NEWER_TJ });
    const tools = new CoreLawToolRuntime(index);
    const [stale] = await tools.runTools([
      { id: "1", name: "read_core_law_article", input: { act: "KK", article: "148" } }
    ]);
    expect(eli.requested).toContain("https://api.sejm.gov.pl/eli/acts/DU/2025/383/references");
    expect(JSON.parse(stale!.content)).toMatchObject({
      eli: "DU/2025/383",
      liveCheck: { state: "UPDATE_FOUND" },
      pendingUpdate: { consolidated: { eli: "DU/2026/1500" } },
      warning: expect.stringContaining("niezastosowane")
    });

    // Automatyczne aktualizacje: odświeżenie kopii ruszyło w tle.
    for (let i = 0; i < 50 && index.status().refreshing; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(index.summary("DU/2025/383")).toMatchObject({ currentEli: "DU/2026/1500", pendingConsolidated: null });
    const requests = eli.requested.length;
    const [fresh] = await tools.runTools([
      { id: "2", name: "read_core_law_article", input: { act: "KK", article: "148" } }
    ]);
    expect(JSON.parse(fresh!.content)).toMatchObject({
      eli: "DU/2026/1500",
      liveCheck: { state: "CURRENT" },
      text: expect.stringContaining("w nowym brzmieniu")
    });
    // Sprawdzone przed chwilą: bez ponownego zapytania do ELI.
    expect(eli.requested).toHaveLength(requests);
  });

  it("gdy ELI nie odpowiada przy użyciu kopii, tekst z kopii ma datę i informację o niedostępności", async () => {
    const store = tempDir("lex-core-store-");
    const start = Date.parse("2026-09-23T12:00:00Z");
    await downloadedIndex(store, start);

    const { index } = later(store, start + 30 * 60_000, { deny: true });
    const [read] = await new CoreLawToolRuntime(index).runTools([
      { id: "1", name: "read_core_law_article", input: { act: "KK", article: "148" } }
    ]);
    const payload = JSON.parse(read!.content);
    expect(payload).toMatchObject({
      status: "OK",
      eli: "DU/2025/383",
      liveCheck: { state: "UNREACHABLE" },
      text: expect.stringContaining("Kto zabija")
    });
    expect(payload.liveCheck.notice).toContain("ELI niedostępne (ELI_HTTP_403)");
    expect(payload.liveCheck.notice).toContain("z dnia 2026-09-23");
  });
});
