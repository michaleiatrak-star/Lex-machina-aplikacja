import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BENCHMARK_QUERIES, runWebSearchBenchmark, scoreEngine } from "./web-search-benchmark.js";
import { PublicWebSearch, parseFirecrawlResults, parseGeminiGrounding, parseSearxngResults } from "./web-search.js";
import { clearLawSourceSession, lawSourceSessionHeaders, setLawSourceSession } from "./eli/law-source-sessions.js";
import { configureGeminiSearchKey, configureWebSearchSettings, effectiveSearchOrder, saveWebSearchTest, setFirecrawlApiKey, setGoogleSession, setSearxngUrl, webSearchSettings } from "./web-search-settings.js";
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
        const result = await runWebSearchBenchmark(["searxng", "duckduckgo"], async (engine) => {
            if (engine === "searxng")
                throw new Error("NOT_CONFIGURED");
            return [official];
        }, { pauseMs: 0, now: () => new Date("2026-11-10T12:00:00Z") });
        expect(result.scores.map((item) => item.engine)).toEqual(["duckduckgo", "searxng"]);
        expect(result.scores[1]).toMatchObject({ score: 0, answered: 0, error: "NOT_CONFIGURED" });
        expect(result.testedAt).toBe("2026-11-10T12:00:00.000Z");
    });
});
describe("SearXNG and the tested order", () => {
    let dir = "";
    afterEach(() => {
        configureWebSearchSettings(null);
        if (dir)
            fs.rmSync(dir, { recursive: true, force: true });
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
        expect(effectiveSearchOrder()).toEqual(["google", "searxng", "duckduckgo", "gemini"]);
        saveWebSearchTest({
            testedAt: "2026-11-10T12:00:00Z",
            scores: [
                { engine: "duckduckgo", score: 7.1, availability: 100, officialSources: 80, relevance: 70, medianMs: 1200, queries: 8, answered: 8 },
                { engine: "searxng", score: 8.4, availability: 100, officialSources: 90, relevance: 80, medianMs: 900, queries: 8, answered: 8 }
            ]
        });
        expect(webSearchSettings().order).toEqual(["searxng", "duckduckgo"]);
        const urls = [];
        const fakeFetch = (async (input) => {
            urls.push(String(input));
            return new Response(JSON.stringify({ results: [{ url: official.url, title: official.title, content: "" }] }), { status: 200 });
        });
        const response = await new PublicWebSearch({}, fakeFetch, 1_000, 0).search("kradzież art. 278 kk", 5);
        expect(response.provider).toBe("searxng");
        expect(urls[0]).toContain("http://localhost:8888/search?q=");
        expect(urls[0]).toContain("format=json");
    });
    it("falls back to DuckDuckGo when SearXNG refuses (rate limit)", async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
        configureWebSearchSettings(dir);
        setSearxngUrl("https://searx.example");
        const fakeFetch = (async (input) => {
            if (String(input).startsWith("https://searx.example"))
                return new Response("", { status: 429 });
            return new Response('<a class="result__a" href="https://isap.sejm.gov.pl/x">Kodeks karny</a>', { status: 200 });
        });
        const response = await new PublicWebSearch({}, fakeFetch, 1_000, 0).search("kradzież", 5);
        expect(response.provider).toBe("duckduckgo");
    });
    it("refuses an address that is not http(s)", () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
        configureWebSearchSettings(dir);
        expect(() => setSearxngUrl("file:///etc/passwd")).toThrow("WEB_SEARCH_SEARXNG_URL_INVALID");
    });
});
describe("Firecrawl (optional, own key)", () => {
    let dir = "";
    afterEach(() => {
        configureWebSearchSettings(null);
        if (dir)
            fs.rmSync(dir, { recursive: true, force: true });
    });
    it("seals the key (not in the settings file), reports it configured and searches with it", async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
        configureWebSearchSettings(dir);
        expect(effectiveSearchOrder()).toEqual(["google", "duckduckgo", "gemini"]);
        setFirecrawlApiKey("fc-test1234567890");
        expect(fs.readFileSync(path.join(dir, "web-search.json"), "utf8")).not.toContain("fc-test1234567890");
        expect(webSearchSettings().firecrawlConfigured).toBe(true);
        expect(effectiveSearchOrder()).toEqual(["google", "duckduckgo", "firecrawl", "gemini"]);
        let auth = "";
        const fakeFetch = (async (_input, init) => {
            auth = String((init?.headers).Authorization);
            return new Response(JSON.stringify({ success: true, data: { web: [{ url: official.url, title: official.title, description: "art. 278" }] } }), { status: 200 });
        });
        const hits = await new PublicWebSearch({}, fakeFetch, 1_000, 0).searchEngine("firecrawl", "kradzież", 5);
        expect(auth).toBe("Bearer fc-test1234567890");
        expect(hits[0].url).toBe(official.url);
        setFirecrawlApiKey("");
        expect(webSearchSettings().firecrawlConfigured).toBe(false);
    });
    it("names a used-up free plan and rejects a malformed key", async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
        configureWebSearchSettings(dir);
        expect(() => setFirecrawlApiKey("not-a-key")).toThrow("WEB_SEARCH_FIRECRAWL_KEY_INVALID");
        const fakeFetch = (async () => new Response("{}", { status: 402 }));
        await expect(new PublicWebSearch({ FIRECRAWL_API_KEY: "fc-x12345678" }, fakeFetch, 1_000, 0).searchEngine("firecrawl", "q", 5)).rejects.toThrow("CREDITS_EXHAUSTED");
        expect(parseFirecrawlResults({ data: [{ url: "https://a.pl", title: "A" }] }, 5)).toHaveLength(1);
    });
});
describe("Google on the user's session (as sn.pl) and Gemini with Google Search", () => {
    let dir = "";
    afterEach(() => {
        configureWebSearchSettings(null);
        configureGeminiSearchKey(null);
        clearLawSourceSession("www.google.com");
        if (dir)
            fs.rmSync(dir, { recursive: true, force: true });
    });
    it("asks for the window when there is no session, and still answers from the next engine", async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
        configureWebSearchSettings(dir);
        const fakeFetch = (async () => new Response('<a class="result__a" href="https://isap.sejm.gov.pl/x">Kodeks karny</a>', { status: 200 }));
        const response = await new PublicWebSearch({}, fakeFetch, 1_000, 0).search("kradzież", 5);
        expect(response.provider).toBe("duckduckgo");
        expect(response.verificationRequired).toBe("LAW_SOURCE_VERIFICATION_REQUIRED:www.google.com");
    });
    it("searches Google with the window's cookies and drops the session on a captcha", async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
        configureWebSearchSettings(dir);
        setLawSourceSession("www.google.com", "NID=abc; SOCS=xyz", "Mozilla/5.0 Test");
        let cookie = "";
        const page = '<div><a href="https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19970880553" data-ved="1"><h3 class="LC20lb">Kodeks karny - ISAP</h3></a><div class="VwiC3b">Art. 278 kradzież</div><a href="https://www.google.com/preferences"><h3>Ustawienia</h3></a><a href="/url?q=https://lexlege.pl/kk/art-278/&amp;sa=U"><h3>Art. 278 KK</h3></a></div>';
        const ok = (async (_input, init) => {
            cookie = String((init?.headers).cookie);
            return new Response(page, { status: 200 });
        });
        const hits = await new PublicWebSearch({}, ok, 1_000, 0).searchEngine("google", "kradzież art 278", 5);
        expect(cookie).toBe("NID=abc; SOCS=xyz");
        expect(hits.map((hit) => hit.url)).toEqual(["https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU19970880553", "https://lexlege.pl/kk/art-278/"]);
        expect(hits[0].snippet).toContain("kradzież");
        const captcha = (async () => new Response("Our systems have detected unusual traffic from your computer network", { status: 429 }));
        await expect(new PublicWebSearch({}, captcha, 1_000, 0).searchEngine("google", "q", 5)).rejects.toThrow("LAW_SOURCE_VERIFICATION_REQUIRED:www.google.com");
        expect(lawSourceSessionHeaders("www.google.com")).toBeNull();
    });
    it("can be turned off in Settings", () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-"));
        configureWebSearchSettings(dir);
        setGoogleSession(false);
        expect(effectiveSearchOrder()).toEqual(["duckduckgo", "gemini"]);
    });
    it("takes Gemini's grounding sources (not its answer), resolving the redirect links", async () => {
        configureGeminiSearchKey(async () => "AIza-test");
        let key = "";
        const fakeFetch = (async (input, init) => {
            if (String(input).includes("generateContent")) {
                key = String((init?.headers)["x-goog-api-key"]);
                expect(JSON.parse(String(init?.body)).tools).toEqual([{ google_search: {} }]);
                return new Response(JSON.stringify({
                    candidates: [{ groundingMetadata: {
                                groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "isap.sejm.gov.pl" } }],
                                groundingSupports: [{ segment: { text: "Kradzież: art. 278 k.k." }, groundingChunkIndices: [0] }]
                            } }]
                }), { status: 200 });
            }
            return new Response(null, { status: 302, headers: { location: official.url } });
        });
        const hits = await new PublicWebSearch({}, fakeFetch, 1_000, 0).searchEngine("gemini", "kradzież", 5);
        expect(key).toBe("AIza-test");
        expect(hits).toEqual([{ title: "isap.sejm.gov.pl", url: official.url, snippet: "Kradzież: art. 278 k.k." }]);
        expect(parseGeminiGrounding({}, 5)).toEqual([]);
    });
});
