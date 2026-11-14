import { describe, expect, it } from "vitest";
import { LegalFederationToolRuntime } from "./legal-federation-tool-runtime.js";
import { PublicWebSearch, assertPublicWebSearchQuery, classifyWebSearchHits, parseDuckDuckGoHtml, pickGeminiSearchModel } from "./web-search.js";
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
    it("uses Brave when a key is configured and falls back to DuckDuckGo", async () => {
        const requested = [];
        const fetchImpl = (async (input) => {
            const url = String(input);
            requested.push(new URL(url).hostname);
            if (url.includes("brave.com")) {
                return new Response("", { status: 500 });
            }
            return new Response(DDG_HTML, { status: 200 });
        });
        const search = new PublicWebSearch({ BRAVE_SEARCH_API_KEY: "key" }, fetchImpl);
        const response = await search.search("kodeks cywilny", 1);
        expect(requested).toEqual([
            "api.search.brave.com",
            "html.duckduckgo.com"
        ]);
        expect(response.provider).toBe("duckduckgo");
        expect(response.hits).toHaveLength(1);
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
describe("Gemini + Google i Brave", () => {
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
    it("Brave: odrzucony klucz, wyczerpany kredyt i limit jako czytelne kody", async () => {
        for (const [status, code] of [[401, "KEY_REJECTED"], [402, "CREDITS_EXHAUSTED"], [429, "RATE_LIMITED"]]) {
            const fetchImpl = (async () => new Response("", { status }));
            await expect(new PublicWebSearch({ BRAVE_SEARCH_API_KEY: "BSAtestkey1234567890" }, fetchImpl).searchEngine("brave", "x", 3)).rejects.toThrow(code);
        }
        await expect(new PublicWebSearch({}, (async () => new Response(""))).searchEngine("brave", "x", 3)).rejects.toThrow("NOT_CONFIGURED");
    });
});
