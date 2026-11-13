import type { SearchProviderId } from "./google-search-key.js";
import { classifyKnownLegalSourceUrl } from "./legal-source-policy.js";
import type { WebSearchHit } from "./web-search.js";

/**
 * Comparison test of the search providers on legal questions (Ustawienia -> Integracje).
 * Per question 0-10: 5 for official sources among the first five hits (R1/R2A 2 each, R2B 1,
 * other 0.5), 3 when the hits name what was asked (the signature, the article), 2 for speed
 * (under 2 s; 1 under 5 s). A refusal, a bot check or no hits scores 0.
 */

export type BenchmarkQuestion = { id: string; query: string; expect: RegExp; label: string };

export const BENCHMARK_QUESTIONS: BenchmarkQuestion[] = [
  { id: "kk-280", label: "Przepis: art. 280 KK", query: "art. 280 kodeksu karnego rozbój", expect: /280/u },
  { id: "kw-119", label: "Przepis: art. 119 KW", query: "kradzież do 800 zł wykroczenie art. 119 kodeksu wykroczeń", expect: /119/u },
  { id: "sn-sdi", label: "Wyrok SN po sygnaturze", query: "wyrok Sąd Najwyższy SDI 9/12", expect: /SDI\s*9\/12/iu },
  { id: "sa-aca", label: "Wyrok SA po sygnaturze", query: "wyrok I ACa 1003/19", expect: /ACa\s*1003\/19/iu },
  { id: "zachowek", label: "Orzecznictwo: zachowek", query: "zachowek doliczenie darowizny orzecznictwo Sądu Najwyższego", expect: /zachow/iu },
  { id: "mobbing", label: "Orzecznictwo: mobbing", query: "mobbing rozstrój zdrowia zadośćuczynienie wyrok sygn.", expect: /mobbing/iu }
];

export type QuestionScore = { id: string; label: string; score: number; hits: number; official: number; matched: boolean; ms: number; error?: string; top?: string[] };
export type ProviderScore = { provider: SearchProviderId; score: number; questions: QuestionScore[] };

export function scoreHits(hits: WebSearchHit[], question: BenchmarkQuestion, ms: number): Omit<QuestionScore, "id" | "label"> {
  if (!hits.length) return { score: 0, hits: 0, official: 0, matched: false, ms };
  const top = hits.slice(0, 5);
  let sources = 0;
  let official = 0;
  for (const hit of top) {
    const tier = classifyKnownLegalSourceUrl(hit.url);
    if (tier === "R1" || tier === "R2A") official += 1;
    sources += tier === "R1" || tier === "R2A" ? 2 : tier === "R2B" ? 1 : 0.5;
  }
  const matched = hits.some((hit) => question.expect.test(`${hit.title} ${hit.snippet} ${decodeURIComponent(hit.url)}`));
  const speed = ms < 2000 ? 2 : ms < 5000 ? 1 : 0;
  const score = Math.round((Math.min(5, sources) + (matched ? 3 : 0) + speed) * 10) / 10;
  return { score, hits: hits.length, official, matched, ms, top: top.map((hit) => hit.url) };
}

export async function runSearchBenchmark(args: {
  providers: SearchProviderId[];
  search: (provider: SearchProviderId, query: string) => Promise<WebSearchHit[]>;
  questions?: BenchmarkQuestion[];
  now?: () => number;
}): Promise<ProviderScore[]> {
  const questions = args.questions ?? BENCHMARK_QUESTIONS;
  const now = args.now ?? Date.now;
  const out: ProviderScore[] = [];
  for (const provider of args.providers) {
    const scores: QuestionScore[] = [];
    for (const question of questions) {
      const started = now();
      try {
        const hits = await args.search(provider, question.query);
        scores.push({ id: question.id, label: question.label, ...scoreHits(hits, question, now() - started) });
      } catch (error) {
        scores.push({ id: question.id, label: question.label, score: 0, hits: 0, official: 0, matched: false, ms: now() - started, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const score = Math.round((scores.reduce((sum, item) => sum + item.score, 0) / Math.max(1, scores.length)) * 10) / 10;
    out.push({ provider, score, questions: scores });
  }
  return out.sort((a, b) => b.score - a.score);
}
