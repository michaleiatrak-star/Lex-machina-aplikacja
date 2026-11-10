import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_QUERIES, runWebSearchBenchmark, scoreEngine } from "./web-search-benchmark.js";
import { PublicWebSearch, parseSearxngResults } from "./web-search.js";
import {
  configureWebSearchSettings,
  effectiveSearchOrder,
  saveWebSearchTest,
  setSearxngUrl,
  webSearchSettings
} from "./web-search-settings.js";

const official = { title: "Kodeks karny art. 278 kradzież", url: "https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19970880553", snippet: "" };
const blog = { title: "Blog o kradzieży", url: "https://example.com/kradziez", snippet: "art. 278" };
const offTopic = { title: "Pogoda", url: "https://example.com/pogoda", snippet: "" };

describe("scoreEngine", () => {
  it("gives 10 for every query answered fast with an official, relevant top result", () => {
    const queries = BENCHMARK_QUERIES.slice(0, 2).map((item) => ({ ...item, terms: ["kradzie"] }));
    const score = scoreEngine("duckduckgo", [{ ms: 500, hits: [official] }, { ms: 900, hits: [official] }], queries);
    expect(score.score).toBe(10);
    expect(score.officialSources).toBe(100);
  });

  it("gives 0 when nothing answered and keeps the first error", () => {
    const score = scoreEngine("searxng", [{ ms: 10, error: "RATE_LIMITED" }, { ms: 10, error: "RATE_LIMITED" }]);
    expect(score.score).toBe(0);
    expect(score.error).toBe("RATE_LIMITED");
  });

  it("weighs availability, official sources, relevance and speed", () => {
    const queries = BENCHMARK_QUERIES.slice(0, 2).map((item) => ({ ...item, terms: ["kradzie"] }));
    // One of two answered (1.5), a free legal page counts 0.7 of the source part (2.1),
    // half relevant (1), median 5 s (1).
    const score = scoreEngine("duckduckgo", [{ ms: 5_000, hits: [blog, offTopic] }, { ms: 100, error: "HTTP_500" }], queries);
    expect(score.score).toBe(5.6);
    expect(score.freeSources).toBe(100);
    expect(score.answered).toBe(1);
  });

  it("does not count a paid database behind a login as a free source", () => {
    const queries = BENCHMARK_QUERIES.slice(0, 1).map((item) => ({ ...item, terms: ["kradzie"] }));
    const paid = { title: "Kodeks karny art. 278 kradzież", url: "https://sip.lex.pl/akty-prawne/kodeks-karny/art-278", snippet: "" };
    const score = scoreEngine("duckduckgo", [{ ms: 5_000, hits: [paid] }], queries);
    // Answered (3), no usable source (0), relevant (2), median 5 s (1).
    expect(score.score).toBe(6);
    expect(score.freeSources).toBe(0);
  });
});

describe("runWebSearchBenchmark", () => {
  it("ranks engines and marks an engine without an address as not configured", async () => {
    const result = await runWebSearchBenchmark(
      ["searxng", "duckduckgo"],
      async (engine) => {
        if (engine === "searxng") throw new Error("NOT_CONFIGURED");
        return [official];
      },
      { pauseMs: 0, now: () => new Date("2026-11-10T12:00:00Z") }
    );
    expect(result.scores.map((item) => item.engine)).toEqual(["duckduckgo", "searxng"]);
    expect(result.scores[1]).toMatchObject({ score: 0, answered: 0, error: "NOT_CONFIGURED" });
    expect(result.testedAt).toBe("2026-11-10T12:00:00.000Z");
  });
});

describe("SearXNG and the tested order", () => {
  let dir = "";
  afterEach(() => {
    configureWebSearchSettings(null);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parses SearXNG JSON results", () => {
    expect(parseSearxngResults({ results: [{ url: official.url, title: "Kodeks &amp; karny", content: "x" }, { url: "ftp://a", title: "b" }] }, 5))
      .toEqual([{ title: "Kodeks & karny", url: official.url, snippet: "x" }]);
  });

  it("uses the measured order: SearXNG first when it scored best", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
    configureWebSearchSettings(dir);
    setSearxngUrl("http://localhost:8888/");
    expect(webSearchSettings().searxngUrl).toBe("http://localhost:8888");
    expect(effectiveSearchOrder()).toEqual(["searxng", "duckduckgo"]);
    saveWebSearchTest({
      testedAt: "2026-11-10T12:00:00Z",
      scores: [
        { engine: "duckduckgo", score: 7.1, availability: 100, officialSources: 80, relevance: 70, medianMs: 1200, queries: 8, answered: 8 },
        { engine: "searxng", score: 8.4, availability: 100, officialSources: 90, relevance: 80, medianMs: 900, queries: 8, answered: 8 }
      ]
    });
    expect(webSearchSettings().order).toEqual(["searxng", "duckduckgo"]);

    const urls: string[] = [];
    const fakeFetch = (async (input: string | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ results: [{ url: official.url, title: official.title, content: "" }] }), { status: 200 });
    }) as typeof fetch;
    const response = await new PublicWebSearch({}, fakeFetch, 1_000, 0).search("kradzież art. 278 kk", 5);
    expect(response.provider).toBe("searxng");
    expect(urls[0]).toContain("http://localhost:8888/search?q=");
    expect(urls[0]).toContain("format=json");
  });

  it("falls back to DuckDuckGo when SearXNG refuses (rate limit)", async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
    configureWebSearchSettings(dir);
    setSearxngUrl("https://searx.example");
    const fakeFetch = (async (input: string | URL) => {
      if (String(input).startsWith("https://searx.example")) return new Response("", { status: 429 });
      return new Response('<a class="result__a" href="https://isap.sejm.gov.pl/x">Kodeks karny</a>', { status: 200 });
    }) as typeof fetch;
    const response = await new PublicWebSearch({}, fakeFetch, 1_000, 0).search("kradzież", 5);
    expect(response.provider).toBe("duckduckgo");
  });

  it("refuses an address that is not http(s)", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
    configureWebSearchSettings(dir);
    expect(() => setSearxngUrl("file:///etc/passwd")).toThrow("WEB_SEARCH_SEARXNG_URL_INVALID");
  });
});
