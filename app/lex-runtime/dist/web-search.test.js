import { describe, expect, it } from "vitest";
import { LegalFederationToolRuntime } from "./legal-federation-tool-runtime.js";
import { PublicWebSearch, geminiQuotaRefusal, assertPublicWebSearchQuery, classifyWebSearchHits, parseDuckDuckGoHtml, pickGeminiSearchModel } from "./web-search.js";
const DDG_HTML = `
<div class="result">
  <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fisap.sejm.gov.pl%2Fisap.nsf%2Fdocument.xsp&amp;rut=x">Kodeks <b>cywilny</b></a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">Ustawa z dnia 23 kwietnia 1964 r. &amp; zmiany</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://example.com/artykul">Komentarz</a>
  <a class="result__snippet" href="https://example.com/artykul">Opis</a>
</div>`;
describe("web_search", () => {
    it("parses DuckDuckGo HTML results and decodes redirect URLs", () => {
        expect(parseDuckDuckGoHtml(DDG_HTML, 5)).toEqual([
            {
                title: "Kodeks cywilny",
                url: "https://isap.sejm.gov.pl/isap.nsf/document.xsp",
                snippet: "Ustawa z dnia 23 kwietnia 1964 r. & zmiany"
            },
            {
                title: "Komentarz",
                url: "https://example.com/artykul",
                snippet: "Opis"
            }
        ]);
    });
    it("classifies hits into source tiers and never treats unknown hosts above R3", () => {
        const [official, unknown] = classifyWebSearchHits(parseDuckDuckGoHtml(DDG_HTML, 5));
        expect(official?.sourceTier).toBe("R1");
        expect(official?.nextStep).toContain("verify_legal_reference");
        expect(unknown?.sourceTier).toBe("R3");
        expect(unknown?.nextStep).toContain("fetch_auxiliary_legal_source");
    });
    it("blocks queries carrying pseudonymized case data", () => {
        expect(() => assertPublicWebSearchQuery("wyrok [PII:PERSON:0001] alimenty")).toThrow("WEB_SEARCH_CASE_DATA_FORBIDDEN");
        expect(() => assertPublicWebSearchQuery("x".repeat(301))).toThrow("WEB_SEARCH_QUERY_INVALID");
        expect(assertPublicWebSearchQuery("  termin  apelacji  ")).toBe("termin apelacji");
    });
    it("can be disabled by configuration", async () => {
        await expect(new PublicWebSearch({ LEX_WEB_SEARCH_PROVIDER: "off" }).search("x", 1)).rejects.toThrow("WEB_SEARCH_DISABLED");
    });
    it("is exposed through the provider-agnostic Lex tool runtime", async () => {
        const provider = {
            search: async () => ({
                provider: "duckduckgo",
                hits: parseDuckDuckGoHtml(DDG_HTML, 5)
            })
        };
        const runtime = new LegalFederationToolRuntime(undefined, provider);
        expect(runtime.handles("web_search")).toBe(true);
        expect(runtime.systemPromptAppendix()).toContain("web_search");
        const [ok, blocked] = await runtime.runTools([
            {
                id: "s1",
                name: "web_search",
                input: { query: "kodeks cywilny" }
            },
            {
                id: "s2",
                name: "web_search",
                input: { query: "[PII:PERSON:0001] rozwód" }
            }
        ]);
        const payload = JSON.parse(ok.content);
        expect(payload.status).toBe("OK");
        expect(payload.results.map((item) => item.sourceTier)).toEqual(["R1", "R3"]);
        expect(JSON.parse(blocked.content).status).toBe("POLICY_BLOCKED");
    });
});
describe("Gemini + Google i Firecrawl", () => {
    it("wybiera aktualny model Flash z listy modeli klucza", () => {
        expect(pickGeminiSearchModel([
            { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-3.1-flash-lite", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-3.1-flash-preview", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-3.1-flash", supportedGenerationMethods: ["generateContent"] },
            { name: "models/gemini-3.1-flash-image", supportedGenerationMethods: ["generateContent"] },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] }
        ])).toBe("gemini-3.1-flash");
        expect(pickGeminiSearchModel([{ name: "models/gemini-3-pro", supportedGenerationMethods: ["generateContent"] }])).toBeNull();
    });
    it("404 dla modelu: pobiera listę modeli i ponawia z aktualnym (zamiast HTTP_404)", async () => {
        const asked = [];
        const fetchImpl = (async (input, init) => {
            const url = String(input);
            asked.push(url.replace("https://generativelanguage.googleapis.com/v1beta/", ""));
            if (url.includes("/models?")) {
                return new Response(JSON.stringify({ models: [{ name: "models/gemini-9.0-flash", supportedGenerationMethods: ["generateContent"] }] }), { status: 200 });
            }
            if (url.includes("gemini-2.5-flash"))
                return new Response("{}", { status: 404 });
            expect(JSON.parse(String(init?.body)).tools).toEqual([{ google_search: {} }]);
            return new Response(JSON.stringify({
                candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://isap.sejm.gov.pl/x", title: "isap.sejm.gov.pl" } }] } }]
            }), { status: 200 });
        });
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
        try {
            const hits = await new PublicWebSearch({}, fetchImpl).searchEngine("gemini", "kodeks cywilny", 3);
            expect(asked).toEqual(["models/gemini-2.5-flash:generateContent", "models?pageSize=200", "models/gemini-9.0-flash:generateContent"]);
            expect(hits.map((hit) => hit.url)).toEqual(["https://isap.sejm.gov.pl/x"]);
        }
        finally {
            delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        }
    });
    it("Gemini 429: rodzaj limitu z odpowiedzi Google (minutowy, dzienny, zerowy)", () => {
        const body = (quotaId, message = "Quota exceeded", retry = "37s") => JSON.stringify({
            error: {
                message,
                details: [
                    { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId }] },
                    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: retry }
                ]
            }
        });
        expect(geminiQuotaRefusal(body("GenerateRequestsPerMinutePerProjectPerModel-FreeTier"))).toEqual({ kind: "MINUTE", retryMs: 37000 });
        expect(geminiQuotaRefusal(body("GenerateRequestsPerDayPerProjectPerModel-FreeTier")).kind).toBe("DAY");
        expect(geminiQuotaRefusal(body("GenerateRequestsPerDayPerProjectPerModel-FreeTier", "Quota exceeded for metric ..., limit: 0, model: gemini-2.5-pro")).kind).toBe("ZERO");
        expect(geminiQuotaRefusal("not json").kind).toBe("OTHER");
    });
    it("Gemini: wyczerpany dzienny limit Flash — druga próba na Flash-Lite; obu brak — QUOTA_DAILY / QUOTA_ZERO", async () => {
        const daily = JSON.stringify({ error: { message: "Quota exceeded", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });
        const ok = JSON.stringify({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://isap.sejm.gov.pl/y", title: "isap" } }] } }] });
        let liteWorks = true;
        const asked = [];
        const fetchImpl = (async (input) => {
            const url = String(input);
            asked.push(/models\/([^:]+):/u.exec(url)?.[1] ?? url);
            if (url.includes("flash-lite"))
                return liteWorks ? new Response(ok, { status: 200 }) : new Response(daily.replace("Quota exceeded", "limit: 0"), { status: 429 });
            return new Response(daily, { status: 429 });
        });
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
        try {
            const hits = await new PublicWebSearch({ LEX_GEMINI_SEARCH_MODEL: "" }, fetchImpl).searchEngine("gemini", "kodeks cywilny", 3);
            expect(asked.at(-1)).toBe("gemini-2.5-flash-lite");
            expect(hits.map((hit) => hit.url)).toEqual(["https://isap.sejm.gov.pl/y"]);
            liteWorks = false;
            await expect(new PublicWebSearch({}, fetchImpl).searchEngine("gemini", "kodeks cywilny", 3)).rejects.toThrow(/^QUOTA_ZERO$/u);
        }
        finally {
            delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        }
    });
    it("Gemini: limit minutowy po odczekaniu nadal wyczerpany — QUOTA_MINUTE (nie ogólne RATE_LIMITED)", async () => {
        const minute = JSON.stringify({ error: { message: "Quota exceeded", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" }] } });
        let calls = 0;
        const fetchImpl = (async () => {
            calls += 1;
            return new Response(minute, { status: 429 });
        });
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key";
        try {
            await expect(new PublicWebSearch({}, fetchImpl).searchEngine("gemini", "kodeks cywilny", 3)).rejects.toThrow(/^QUOTA_MINUTE$/u);
            expect(calls).toBe(2);
        }
        finally {
            delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
        }
    });
    it("Firecrawl z limitem API: wyniki ze strony wyników DuckDuckGo (scrapowanie), nie błąd", async () => {
        const asked = [];
        const fetchImpl = (async (input) => {
            const url = String(input);
            asked.push(new URL(url).host);
            if (url.includes("api.firecrawl.dev"))
                return new Response("", { status: 429 });
            return new Response('<div class="result"><a class="result__a" href="https://isap.sejm.gov.pl/isap.nsf/x">Kodeks cywilny</a><a class="result__snippet">art. 415</a></div>', { headers: { "content-type": "text/html" } });
        });
        const result = await new PublicWebSearch({ FIRECRAWL_API_KEY: "fc-test1234567890", LEX_WEB_SEARCH_PROVIDER: "firecrawl" }, fetchImpl).search("kodeks cywilny art. 415", 3);
        expect(result.provider).toBe("duckduckgo");
        expect(asked).toEqual(["api.firecrawl.dev", "html.duckduckgo.com"]);
    });
});
