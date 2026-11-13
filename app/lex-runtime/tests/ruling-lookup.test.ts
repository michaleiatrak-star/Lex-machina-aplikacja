import { describe, expect, it } from "vitest";
import { signatureQuery } from "../src/case-law-search.js";
import type { NormalizedToolCall, NormalizedToolResult } from "../src/providers/types.js";
import {
  RULING_LEAD_MARKER,
  askedRulingSignatures,
  asksForCaseLaw,
  caseLawSearchPhrase,
  lookupRulings,
  rulingLookupPrompt,
  searchCaseLawLeads
} from "../src/ruling-lookup.js";
import { stripUnbackedVerificationMarkers } from "../src/status-consistency-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { SEARCH_PROVIDERS, normalizeSearxngUrl } from "../src/google-search-key.js";
import { PublicWebSearch } from "../src/web-search.js";
import { runSearchBenchmark, scoreHits } from "../src/web-search-benchmark.js";

// 2026-11-10: SDI 9/12 opisany przez Bielika z pamięci, z własnym ✅. Aplikacja szuka orzeczenia
// sama (sn.pl → CBOSA → SAOS po sygnaturze → wyszukiwarka), zanim model odpowie.

type Answer = (call: NormalizedToolCall) => unknown;
const runner = (answer: Answer, log: NormalizedToolCall[] = []) => async (calls: NormalizedToolCall[]): Promise<NormalizedToolResult[]> =>
  calls.map((call) => {
    log.push(call);
    return { tool_use_id: call.id, content: JSON.stringify(answer(call)) } as unknown as NormalizedToolResult;
  });

describe("orzeczenia wskazane w pytaniu", () => {
  it("rozpoznaje pytanie o cudzy wyrok, nie o własną sprawę; wielkość liter bez znaczenia", () => {
    expect(askedRulingSignatures("O czym mówi wyrok Sądu Najwyższego sygn. SDI 9/12?", ["SDI 9/12"])).toEqual(["SDI 9/12"]);
    expect(askedRulingSignatures("o czym jest wyrok sa w krakowie i aca 1003/19", ["I ACa 1003/19"])).toEqual(["I ACa 1003/19"]);
    expect(askedRulingSignatures("W mojej sprawie I C 12/24 sąd wydał wyrok. Co dalej?", ["I C 12/24"])).toEqual([]);
  });

  it("SN: sn.pl zablokowany → SAOS po sygnaturze daje trop z fragmentem i znacznikiem ⚠️", async () => {
    const ledger = new VerificationLedger();
    const log: NormalizedToolCall[] = [];
    const found = await lookupRulings({
      signatures: ["SDI 9/12"],
      ledger,
      runVerification: runner((call) =>
        call.name === "verify_case_reference"
          ? { status: "BLOCKED", reason: "SN_WERYFIKACJA_WYMAGANA" }
          : { candidates: [{ caseNumbers: ["SDI 9/12"], sourceUrl: "https://www.saos.org.pl/judgments/1", court: "SN", excerpt: "kasacja w sprawie dyscyplinarnej radcy prawnego" }] }
      , log)
    });
    expect(found[0]).toMatchObject({ outcome: "LEAD", source: "SAOS (R3, kopia nieurzędowa)", url: "https://www.saos.org.pl/judgments/1" });
    expect(log.map((call) => call.name)).toEqual(["verify_case_reference", "search_case_law"]);
    expect(log[1]!.input).toMatchObject({ query: "SDI 9/12", source: "SAOS" });
    expect([...ledger.caseMarkers().values()]).toEqual([RULING_LEAD_MARKER("SAOS")]);
    expect(rulingLookupPrompt(found)).toContain("radcy prawnego");
  });

  it("brak trafień: NOT_FOUND z listą sprawdzonych źródeł, prompt zakazuje opisu z pamięci", async () => {
    const ledger = new VerificationLedger();
    const found = await lookupRulings({
      signatures: ["I ACa 1003/19"],
      ledger,
      runVerification: runner(() => ({ candidates: [] })),
      runWebSearch: runner(() => ({ results: [{ title: "Inny wyrok", url: "https://example.com", snippet: "I ACa 1/19" }] }))
    });
    expect(found[0]).toMatchObject({ outcome: "NOT_FOUND", tried: ["SAOS", "wyszukiwarka"] });
    expect(rulingLookupPrompt(found)).toContain("Nie opisuj treści tego orzeczenia");
  });

  it("trafienie tylko w wyszukiwarce = trop, nie ✅", async () => {
    const ledger = new VerificationLedger();
    const found = await lookupRulings({
      signatures: ["I ACa 1003/19"],
      ledger,
      runVerification: runner(() => ({ candidates: [] })),
      runWebSearch: runner(() => ({ results: [{ title: "Wyrok SA w Krakowie I ACa 1003/19", url: "https://orzeczenia.ms.gov.pl/x" }] }))
    });
    expect(found[0]).toMatchObject({ outcome: "LEAD", url: "https://orzeczenia.ms.gov.pl/x" });
    expect([...ledger.caseMarkers().values()][0]).toContain("NIEWERYFIKOWANE");
  });
});

describe("tropy orzecznictwa bez sygnatury", () => {
  it("wykrywa prośbę o orzecznictwo i buduje neutralną frazę bez danych osobowych", () => {
    expect(asksForCaseLaw("Znajdź orzecznictwo o zachowku od darowizny")).toBe(true);
    expect(asksForCaseLaw("Klient pobił sąsiada, jaka kwalifikacja?")).toBe(false);
    expect(caseLawSearchPhrase("Znajdź orzecznictwo o zachowku [PII:PERSON:0001] od darowizny?")).toBe("zachowku darowizny");
  });

  it("SAOS: najczęściej cytowane, limit 5; wyszukiwarka z frazą + „wyrok sygn.”", async () => {
    const log: NormalizedToolCall[] = [];
    const leads = await searchCaseLawLeads({
      phrase: "mobbing rozstrój zdrowia",
      runVerification: runner(() => ({ candidates: [{ caseNumbers: ["II PK 33/05"], sourceUrl: "https://www.saos.org.pl/judgments/2" }] }), log),
      runWebSearch: runner(() => ({ results: [{ title: "Mobbing — wyroki", url: "https://example.com/m" }] }), log)
    });
    expect(log[0]!.input).toMatchObject({ source: "SAOS", limit: 5, sort: "cited" });
    expect(log[1]!.input).toMatchObject({ query: "mobbing rozstrój zdrowia wyrok sygn." });
    expect(leads.map((lead) => lead.source)).toEqual(["SAOS", "wyszukiwarka"]);
  });
});

describe("SAOS i znaczniki", () => {
  it("sygnatura idzie do SAOS jako caseNumber, zwykła fraza jako pełny tekst", () => {
    expect(signatureQuery("sygn. akt SDI 9/12")).toBe("SDI 9/12");
    expect(signatureQuery("II PK 33/05")).toBe("II PK 33/05");
    expect(signatureQuery("mobbing rozstrój zdrowia")).toBeNull();
  });

  it("✅ bez adresu źródła przy orzeczeniu jest usuwany; z adresem zostaje", () => {
    const ledger = new VerificationLedger();
    const fake = stripUnbackedVerificationMarkers("Wyrok SN z 10.05.2012 r., SDI 9/12 ✅ [VER: SN.pl, karta sprawy]", ledger);
    expect(fake.text).not.toContain("✅");
    const real = stripUnbackedVerificationMarkers("Wyrok SN, SDI 9/12 ✅ [VER: https://www.sn.pl/x]", ledger);
    expect(real.text).toContain("✅ [VER: https://www.sn.pl/x]");
  });
});

const defaultOrder = () => [...SEARCH_PROVIDERS];

describe("kolejność wyszukiwarek", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("bez kluczy: DuckDuckGo; z kluczem Brave: Brave przed DuckDuckGo", async () => {
    const hosts: string[] = [];
    const fetchImpl = (async (url: URL | string) => {
      const host = new URL(String(url)).host;
      hosts.push(host);
      if (host.includes("brave")) return ok({ web: { results: [{ title: "Kodeks", url: "https://eli.gov.pl/x", description: "opis" }] } });
      return new Response('<div class="result"><a class="result__a" href="https://eli.gov.pl/y">Kodeks</a></div>', { status: 200 });
    }) as typeof fetch;
    const plain = await new PublicWebSearch({ LEX_WEB_SEARCH_PROVIDER: "auto" }, fetchImpl, 1000, 0, () => null, () => null, defaultOrder).search("kodeks cywilny", 3);
    expect(plain.provider).toBe("duckduckgo");
    const brave = await new PublicWebSearch({ LEX_WEB_SEARCH_PROVIDER: "auto", BRAVE_SEARCH_API_KEY: "BSAtestkey1234567890" }, fetchImpl, 1000, 0, () => null, () => null, defaultOrder).search("kodeks cywilny", 3);
    expect(brave.provider).toBe("brave");
  });

  it("Google (lista witryn) pierwszy, klucz w nagłówku, nie w adresie", async () => {
    let seen: { url: string; key: string | undefined } | null = null;
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      seen = { url: String(url), key: (init?.headers as Record<string, string>)["X-goog-api-key"] };
      return ok({ items: [{ title: "Wyrok", link: "https://www.sn.pl/a", snippet: "s" }] });
    }) as typeof fetch;
    const result = await new PublicWebSearch({}, fetchImpl, 1000, 0, () => ({ key: "AIzaTESTKEY_1234567890", cx: "abc123" }), () => null, defaultOrder).search("zachowek", 3);
    expect(result.provider).toBe("google");
    expect(seen!.key).toBe("AIzaTESTKEY_1234567890");
    expect(seen!.url).not.toContain("AIza");
  });
});

describe("SearXNG i test porównawczy", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("SearXNG (własna instancja) pierwszy; zapytanie w JSON po polsku", async () => {
    let asked = "";
    const fetchImpl = (async (url: URL | string) => {
      asked = String(url);
      return ok({ results: [{ title: "Art. 280 KK", url: "https://isap.sejm.gov.pl/x", content: "rozbój" }] });
    }) as typeof fetch;
    const result = await new PublicWebSearch({}, fetchImpl, 1000, 0, () => null, () => "http://127.0.0.1:8888", defaultOrder).search("art. 280 kk", 3);
    expect(result.provider).toBe("searxng");
    expect(asked).toContain("http://127.0.0.1:8888/search?q=");
    expect(asked).toContain("format=json");
  });

  it("odmowa instancji (429) przechodzi do następnej wyszukiwarki", async () => {
    const fetchImpl = (async (url: URL | string) =>
      String(url).includes("8888")
        ? new Response("Too Many Requests", { status: 429 })
        : new Response('<div class="result"><a class="result__a" href="https://eli.gov.pl/y">Kodeks</a></div>', { status: 200 })) as typeof fetch;
    const result = await new PublicWebSearch({}, fetchImpl, 1000, 0, () => null, () => "http://127.0.0.1:8888", defaultOrder).search("kodeks", 3);
    expect(result.provider).toBe("duckduckgo");
  });

  it("adres: https albo http tylko lokalnie", () => {
    expect(normalizeSearxngUrl("http://127.0.0.1:8888/")).toBe("http://127.0.0.1:8888");
    expect(normalizeSearxngUrl("https://szukaj.kancelaria.pl")).toBe("https://szukaj.kancelaria.pl");
    expect(() => normalizeSearxngUrl("http://searx.example.com")).toThrow("SEARXNG_URL_INVALID");
  });

  it("ocena 0-10: źródła urzędowe, trafienie w to, o co pytano, czas; blokada = 0", async () => {
    const question = { id: "x", label: "x", query: "SDI 9/12", expect: /SDI\s*9\/12/u };
    const full = scoreHits([{ title: "SDI 9/12", url: "https://www.sn.pl/a", snippet: "" }, { title: "b", url: "https://isap.sejm.gov.pl/b", snippet: "" }, { title: "c", url: "https://eli.gov.pl/c", snippet: "" }], question, 500);
    expect(full.matched).toBe(true);
    expect(full.score).toBeGreaterThanOrEqual(9);
    expect(scoreHits([{ title: "inne", url: "https://example.com", snippet: "" }], question, 6000).score).toBe(0.5);
    let t = 0;
    const ranked = await runSearchBenchmark({
      providers: ["duckduckgo", "searxng"],
      questions: [question],
      now: () => (t += 100),
      search: async (provider) => {
        if (provider === "duckduckgo") throw new Error("BOT_CHECK");
        return [{ title: "SDI 9/12", url: "https://www.sn.pl/a", snippet: "" }];
      }
    });
    expect(ranked.map((item) => [item.provider, item.score])).toEqual([["searxng", 7], ["duckduckgo", 0]]);
    expect(ranked[1]!.questions[0]!.error).toBe("BOT_CHECK");
  });
});
