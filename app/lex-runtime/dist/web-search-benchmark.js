import { classifyKnownLegalSourceUrl } from "./legal-source-policy.js";
import { PAID_DATABASES, hostOf } from "./web-search.js";
export const BENCHMARK_QUERIES = [
    { query: "kradzież art. 278 kodeks karny", terms: ["kradzie", "278"] },
    { query: "rozbój art. 280 kk orzecznictwo Sądu Najwyższego", terms: ["rozb", "280"] },
    { query: "zasiedzenie nieruchomości art. 172 kodeksu cywilnego", terms: ["zasiedz", "172"] },
    { query: "termin do wniesienia apelacji art. 369 kpc", terms: ["apelac", "369"] },
    { query: "wypowiedzenie umowy o pracę art. 30 kodeksu pracy", terms: ["wypowiedz", "kodeks pracy"] },
    { query: "interpretacja indywidualna VAT sprzedaż działki budowlanej", terms: ["interpretac", "vat"] },
    { query: "wyrok NSA podatek od nieruchomości skarga kasacyjna", terms: ["nsa", "podat"] },
    { query: "ustawa o prawach konsumenta odstąpienie od umowy 14 dni", terms: ["konsument", "odstąpi"] }
];
// Paywalled commercial portals beyond the LEX/Legalis set (full text behind a subscription).
const PAYWALLED = new Set(["inforlex.pl"]);
const round = (value) => Math.round(value * 10) / 10;
export function scoreEngine(engine, outcomes, queries = BENCHMARK_QUERIES) {
    const answered = outcomes
        .map((outcome, index) => ({ outcome, query: queries[index] }))
        .filter((item) => "hits" in item.outcome && item.outcome.hits.length > 0);
    const total = outcomes.length || 1;
    const availability = answered.length / total;
    const matches = (hit, query) => {
        const text = `${hit.title} ${hit.snippet} ${hit.url}`.toLocaleLowerCase("pl");
        return query.terms.some((term) => text.includes(term.toLocaleLowerCase("pl")));
    };
    const isOfficial = (hit) => {
        const tier = classifyKnownLegalSourceUrl(hit.url);
        return tier === "R1" || tier === "R2A";
    };
    const isFreeLegal = (hit, query) => {
        const host = hostOf(hit.url);
        return !PAID_DATABASES.has(host) && !PAYWALLED.has(host) && matches(hit, query);
    };
    let officialQueries = 0;
    let freeQueries = 0;
    for (const { outcome, query } of answered) {
        const top = outcome.hits.slice(0, 5);
        if (top.some(isOfficial))
            officialQueries += 1;
        else if (top.some((hit) => isFreeLegal(hit, query)))
            freeQueries += 1;
    }
    const official = answered.length ? officialQueries / answered.length : 0;
    const free = answered.length ? freeQueries / answered.length : 0;
    const sources = official + 0.7 * free;
    let relevantHits = 0;
    let countedHits = 0;
    for (const { outcome, query } of answered) {
        for (const hit of outcome.hits.slice(0, 5)) {
            countedHits += 1;
            if (matches(hit, query))
                relevantHits += 1;
        }
    }
    const relevance = countedHits ? relevantHits / countedHits : 0;
    const times = answered.map(({ outcome }) => outcome.ms).sort((left, right) => left - right);
    const medianMs = times.length ? times[Math.floor((times.length - 1) / 2)] : null;
    const speed = medianMs === null ? 0 : Math.max(0, Math.min(1, (8_000 - medianMs) / 6_000));
    const score = availability ? 3 * availability + 3 * sources + 2 * relevance + 2 * speed : 0;
    const firstError = outcomes.find((outcome) => "error" in outcome)?.error;
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
export async function runWebSearchBenchmark(engines, run, options = {}) {
    const queries = options.queries ?? BENCHMARK_QUERIES;
    const pauseMs = options.pauseMs ?? 700;
    const scores = await Promise.all(engines.map(async (engine) => {
        const outcomes = [];
        for (const [index, item] of queries.entries()) {
            if (index > 0 && pauseMs > 0)
                await new Promise((resolve) => setTimeout(resolve, pauseMs));
            const started = Date.now();
            try {
                const hits = await run(engine, item.query, 8);
                outcomes.push({ ms: Date.now() - started, hits });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                outcomes.push({ ms: Date.now() - started, error: message });
                // Not configured: the remaining queries would fail the same way.
                if (message === "NOT_CONFIGURED") {
                    while (outcomes.length < queries.length)
                        outcomes.push({ ms: 0, error: message });
                    break;
                }
            }
        }
        return scoreEngine(engine, outcomes, queries);
    }));
    return {
        testedAt: (options.now ?? (() => new Date()))().toISOString(),
        scores: scores.sort((left, right) => right.score - left.score)
    };
}
