import { classifyKnownLegalSourceUrl } from "./legal-source-policy.js";
import { PAID_DATABASES, hostOf, type WebSearchHit } from "./web-search.js";
import type {
  SearchEngineName,
  SearchEngineScore,
  WebSearchTestResult
} from "./web-search-settings.js";

/**
 * Comparison test of internet search engines, run from this computer (the result depends on
 * its network: a data-centre address is refused by most engines). Fixed Polish legal queries,
 * each scored on four parts of a 0-10 scale:
 *   availability   0-3  share of queries answered with at least one result,
 *   sources        0-3  per answered query: 1 for an official source (R1/R2A) in the top 5, else
 *                       0.7 for a free legal page naming the key term (commentary, firm article,
 *                       free statute portal; a paid database behind a login does not count),
 *   relevance      0-2  share of top-5 results naming the query's key term,
 *   speed          0-2  median time: 2 at <= 2 s, 0 at >= 8 s, linear between.
 * Snippets stay discovery only; the test measures leads, not evidence.
 */
export type BenchmarkQuery = { query: string; terms: string[] };

export const BENCHMARK_QUERIES: BenchmarkQuery[] = [
  { query: "kradzież art. 278 kodeks karny", terms: ["kradzie", "278"] },
  { query: "rozbój art. 280 kk orzecznictwo Sądu Najwyższego", terms: ["rozb", "280"] },
  { query: "zasiedzenie nieruchomości art. 172 kodeksu cywilnego", terms: ["zasiedz", "172"] },
  { query: "termin do wniesienia apelacji art. 369 kpc", terms: ["apelac", "369"] },
  { query: "wypowiedzenie umowy o pracę art. 30 kodeksu pracy", terms: ["wypowiedz", "kodeks pracy"] },
  { query: "interpretacja indywidualna VAT sprzedaż działki budowlanej", terms: ["interpretac", "vat"] },
  { query: "wyrok NSA podatek od nieruchomości skarga kasacyjna", terms: ["nsa", "podat"] },
  { query: "ustawa o prawach konsumenta odstąpienie od umowy 14 dni", terms: ["konsument", "odstąpi"] }
];

export type EngineRunner = (
  engine: SearchEngineName,
  query: string,
  maxResults: number
) => Promise<WebSearchHit[]>;

// Paywalled commercial portals beyond the LEX/Legalis set (full text behind a subscription).
const PAYWALLED = new Set(["inforlex.pl"]);

type QueryOutcome = { ms: number; hits: WebSearchHit[] } | { ms: number; error: string };

const round = (value: number) => Math.round(value * 10) / 10;

export function scoreEngine(
  engine: SearchEngineName,
  outcomes: QueryOutcome[],
  queries: BenchmarkQuery[] = BENCHMARK_QUERIES
): SearchEngineScore {
  const answered = outcomes
    .map((outcome, index) => ({ outcome, query: queries[index]! }))
    .filter((item): item is { outcome: { ms: number; hits: WebSearchHit[] }; query: BenchmarkQuery } =>
      "hits" in item.outcome && item.outcome.hits.length > 0);
  const total = outcomes.length || 1;
  const availability = answered.length / total;
  const matches = (hit: WebSearchHit, query: BenchmarkQuery) => {
    const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLocaleLowerCase("pl");
    return query.terms.some((term) => text.includes(term.toLocaleLowerCase("pl")));
  };
  const isOfficial = (hit: WebSearchHit) => {
    const tier = classifyKnownLegalSourceUrl(hit.url);
    return tier === "R1" || tier === "R2A";
  };
  const isFreeLegal = (hit: WebSearchHit, query: BenchmarkQuery) => {
    const host = hostOf(hit.url);
    return !PAID_DATABASES.has(host) && !PAYWALLED.has(host) && matches(hit, query);
  };
  let officialQueries = 0;
  let freeQueries = 0;
  for (const { outcome, query } of answered) {
    const top = outcome.hits.slice(0, 5);
    if (top.some(isOfficial)) officialQueries += 1;
    else if (top.some((hit) => isFreeLegal(hit, query))) freeQueries += 1;
  }
  const official = answered.length ? officialQueries / answered.length : 0;
  const free = answered.length ? freeQueries / answered.length : 0;
  const sources = official + 0.7 * free;
  let relevantHits = 0;
  let countedHits = 0;
  for (const { outcome, query } of answered) {
    for (const hit of outcome.hits.slice(0, 5)) {
      countedHits += 1;
      if (matches(hit, query)) relevantHits += 1;
    }
  }
  const relevance = countedHits ? relevantHits / countedHits : 0;
  const times = answered.map(({ outcome }) => outcome.ms).sort((left, right) => left - right);
  const medianMs = times.length ? times[Math.floor((times.length - 1) / 2)]! : null;
  const speed = medianMs === null ? 0 : Math.max(0, Math.min(1, (8_000 - medianMs) / 6_000));
  const score = availability ? 3 * availability + 3 * sources + 2 * relevance + 2 * speed : 0;
  const firstError = outcomes.find((outcome): outcome is { ms: number; error: string } => "error" in outcome)?.error;
  return {
    engine,
    score: round(score),
    availability: round(availability * 100),
    officialSources: round(official * 100),
    freeSources: round(free * 100),
    relevance: round(relevance * 100),
    medianMs,
    queries: outcomes.length,
    answered: answered.length,
    ...(answered.length < outcomes.length && firstError ? { error: firstError.slice(0, 160) } : {})
  };
}

/**
 * Engines run in parallel; queries of one engine one after another with a short pause, so the
 * test does not look like a flood (which would itself trigger a bot check).
 */
export async function runWebSearchBenchmark(
  engines: SearchEngineName[],
  run: EngineRunner,
  options: { queries?: BenchmarkQuery[]; pauseMs?: number; now?: () => Date } = {}
): Promise<WebSearchTestResult> {
  const queries = options.queries ?? BENCHMARK_QUERIES;
  const pauseMs = options.pauseMs ?? 700;
  const scores = await Promise.all(
    engines.map(async (engine) => {
      const outcomes: QueryOutcome[] = [];
      for (const [index, item] of queries.entries()) {
        if (index > 0 && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
        const started = Date.now();
        try {
          const hits = await run(engine, item.query, 8);
          outcomes.push({ ms: Date.now() - started, hits });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          outcomes.push({ ms: Date.now() - started, error: message });
          // Not configured: the remaining queries would fail the same way.
          if (message === "NOT_CONFIGURED") {
            while (outcomes.length < queries.length) outcomes.push({ ms: 0, error: message });
            break;
          }
        }
      }
      return scoreEngine(engine, outcomes, queries);
    })
  );
  return {
    testedAt: (options.now ?? (() => new Date()))().toISOString(),
    scores: scores.sort((left, right) => right.score - left.score)
  };
}
