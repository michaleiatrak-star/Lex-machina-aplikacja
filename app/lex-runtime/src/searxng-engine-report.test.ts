import { describe, expect, it } from "vitest";
import { PublicWebSearch, resetSearxngEngineReport, searxngEngineReport } from "./web-search.js";

describe("raport silników SearXNG", () => {
  it("zbiera silniki z wynikami i te, które odmówiły (bez tych, które w innym zapytaniu odpowiedziały)", async () => {
    const replies = [
      { results: [{ url: "https://orzeczenia.ms.gov.pl/a", title: "A", engines: ["brave", "bing"] }], unresponsive_engines: [["google", "access denied"], ["bing", "timeout"]] },
      { results: [{ url: "https://sn.pl/b", title: "B", engines: ["brave"] }], unresponsive_engines: [["duckduckgo", "CAPTCHA"]] }
    ];
    const fetchImpl = (async () => new Response(JSON.stringify(replies.shift()), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const settings = () => ({ searxngUrl: "http://127.0.0.1:8888", order: [], lastTest: null, firecrawlConfigured: false, startpageSession: false, startpageSessionKeep: false, startpageSessionSaved: false, accountModelWebSearch: false });
    resetSearxngEngineReport();
    const search = new PublicWebSearch({}, fetchImpl, undefined, 0, settings);
    await search.searchEngine("searxng", "kara umowna", 5, settings());
    await search.searchEngine("searxng", "kara umowna", 5, settings());
    expect(searxngEngineReport()).toEqual({
      answered: [{ name: "brave", results: 2 }, { name: "bing", results: 1 }],
      refused: [{ name: "google", reason: "access denied" }, { name: "duckduckgo", reason: "CAPTCHA" }]
    });
  });
});
