import { detectLegalReferences } from "./finalization-gate.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "./skill-selection.js";

/**
 * Session quality benchmark: anonymized questions (some in multi-message
 * threads) asked through the real HTTP API, scored on verification of
 * provisions, completeness, continuity in the thread, time and tokens.
 */
export type SessionQualityTurn = {
  question: string;
  // Acts the answer should rely on (abbreviations, see ACT_PATTERNS).
  expectedActs: string[];
  // Each topic: alternative keywords (lowercase, diacritics optional).
  topics: string[][];
  // Facts from earlier turns the answer should still know.
  mustRecall?: string[][];
  // Provisions that must be shown verified ("art. 415 KC"); added by a
  // lawyer after checking them in ELI, never from memory.
  expectedProvisions?: string[];
};

export type SessionQualityCase = {
  id: string;
  domain: string;
  turns: SessionQualityTurn[];
};

export type SessionQualityCorpus = {
  schemaVersion: 1;
  kind: "LEX_MACHINA_SESSION_QUALITY_BENCHMARK";
  corpusId: string;
  corpusVersion: string;
  confidentiality: "SYNTHETIC" | "EXPERT_PRIVATE";
  note?: string;
  cases: SessionQualityCase[];
};

export type SessionTurnObservation = {
  status: string;
  answer: string;
  timeMs: number;
  usage?: { inputTokens: number; outputTokens: number; modelCalls: number; unmeteredCalls: number };
  error?: string;
};

export type SessionTurnScore = {
  caseId: string;
  turn: number;
  blocked: boolean;
  error?: string;
  references: number;
  verifiedMarkers: number;
  anchorMarkers: number;
  unverifiedMarkers: number;
  verificationRate: number | null;
  topicCoverage: number;
  actCoverage: number | null;
  recall: number | null;
  provisionsVerified: number | null;
  score: number;
  timeMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export function validateSessionQualityCorpus(value: unknown): SessionQualityCorpus {
  const corpus = value as SessionQualityCorpus;
  if (
    !corpus ||
    corpus.schemaVersion !== 1 ||
    corpus.kind !== "LEX_MACHINA_SESSION_QUALITY_BENCHMARK" ||
    !Array.isArray(corpus.cases) ||
    corpus.cases.length === 0
  ) {
    throw new Error("SESSION_QUALITY_CORPUS_INVALID");
  }
  const ids = new Set<string>();
  for (const item of corpus.cases) {
    if (!/^[a-z0-9-]{3,64}$/.test(item.id) || ids.has(item.id) || !Array.isArray(item.turns) || item.turns.length === 0) {
      throw new Error(`SESSION_QUALITY_CASE_INVALID:${item.id}`);
    }
    ids.add(item.id);
    for (const turn of item.turns) {
      if (
        typeof turn.question !== "string" ||
        turn.question.length < 10 ||
        !Array.isArray(turn.topics) ||
        !Array.isArray(turn.expectedActs) ||
        turn.expectedActs.some((act) => !ACT_PATTERNS[act])
      ) {
        throw new Error(`SESSION_QUALITY_TURN_INVALID:${item.id}`);
      }
    }
  }
  return corpus;
}

export const normalize = (value: string): string =>
  value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLowerCase();

const ACT_PATTERNS: Record<string, RegExp> = {
  KC: /\bk\.?\s?c\b|kodeks(?:u|iem|ie)? cywiln/,
  KPC: /\bk\.?\s?p\.?\s?c\b|kodeks(?:u|iem|ie)? postepowania cywiln/,
  KRO: /\bk\.?\s?r\.?\s?o\b|kodeks(?:u|iem|ie)? rodzinn/,
  KK: /\bk\.?\s?k\b|kodeks(?:u|iem|ie)? karn(?:y|ego|ym)\b/,
  KPK: /\bk\.?\s?p\.?\s?k\b|kodeks(?:u|iem|ie)? postepowania karn/,
  KW: /\bk\.?\s?w\b|kodeks(?:u|iem|ie)? wykroczen/,
  KPOW: /\bk\.?\s?p\.?\s?o\.?\s?w\b|kodeks(?:u|iem|ie)? postepowania w sprawach o wykroczenia/,
  KP: /\bk\.?\s?p\b(?!\.?\s?[a-z])|kodeks(?:u|iem|ie)? pracy/,
  KPA: /\bk\.?\s?p\.?\s?a\b|kodeks(?:u|iem|ie)? postepowania administracyjn/,
  PPSA: /\bp\.?\s?p\.?\s?s\.?\s?a\b|postepowaniu? przed sadami administracyjnymi/,
  PZP: /\bp\.?\s?z\.?\s?p\b|prawo zamowien publicznych|prawa zamowien publicznych/,
  RODO: /\brodo\b|\bgdpr\b|2016\/679/
};

const hit = (text: string, alternatives: string[]): boolean =>
  alternatives.some((keyword) => text.includes(normalize(keyword)));

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

export function scoreTurn(
  caseId: string,
  turnIndex: number,
  turn: SessionQualityTurn,
  observed: SessionTurnObservation
): SessionTurnScore {
  const answer = observed.answer ?? "";
  const text = normalize(answer);
  const blocked = observed.status === "BLOCKED" || Boolean(observed.error);
  const verifiedMarkers = count(answer, /✅\s*\[VER/g);
  const anchorMarkers = count(answer, /🟨\s*\[KOTWICA/g);
  const unverifiedMarkers = count(answer, /NIEWERYFIKOWANE/g);
  const marked = verifiedMarkers + unverifiedMarkers + anchorMarkers;
  const verificationRate = marked > 0 ? verifiedMarkers / marked : null;
  const topicCoverage = turn.topics.length ? turn.topics.filter((topic) => hit(text, topic)).length / turn.topics.length : 1;
  const actCoverage = turn.expectedActs.length
    ? turn.expectedActs.filter((act) => ACT_PATTERNS[act]!.test(text)).length / turn.expectedActs.length
    : null;
  const recall = turn.mustRecall?.length ? turn.mustRecall.filter((fact) => hit(text, fact)).length / turn.mustRecall.length : null;
  const lines = answer.split("\n");
  const provisionsVerified = turn.expectedProvisions?.length
    ? turn.expectedProvisions.filter((provision) =>
        lines.some((line) => normalize(line).includes(normalize(provision)) && /✅\s*\[VER/.test(line))
      ).length / turn.expectedProvisions.length
    : null;
  const parts = [topicCoverage, actCoverage, verificationRate, recall, provisionsVerified].filter(
    (value): value is number => value !== null
  );
  return {
    caseId,
    turn: turnIndex + 1,
    blocked,
    ...(observed.error ? { error: observed.error } : {}),
    references: detectLegalReferences(answer).length,
    verifiedMarkers,
    anchorMarkers,
    unverifiedMarkers,
    verificationRate,
    topicCoverage,
    actCoverage,
    recall,
    provisionsVerified,
    score: blocked ? 0 : parts.reduce((sum, value) => sum + value, 0) / parts.length,
    timeMs: observed.timeMs,
    inputTokens: observed.usage && observed.usage.unmeteredCalls === 0 ? observed.usage.inputTokens : null,
    outputTokens: observed.usage && observed.usage.unmeteredCalls === 0 ? observed.usage.outputTokens : null
  };
}

const mean = (values: Array<number | null>): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
};

const sum = (values: Array<number | null>): number | null =>
  values.some((value) => value === null) ? null : values.reduce<number>((total, value) => total + (value ?? 0), 0);

export type SessionQualitySummary = {
  turns: number;
  score: number;
  blockedRate: number;
  verificationRate: number | null;
  topicCoverage: number;
  actCoverage: number | null;
  continuity: number | null;
  meanTimeMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

export function summarizeScores(scores: SessionTurnScore[]): SessionQualitySummary {
  return {
    turns: scores.length,
    score: mean(scores.map((item) => item.score)) ?? 0,
    blockedRate: scores.filter((item) => item.blocked).length / Math.max(1, scores.length),
    verificationRate: mean(scores.map((item) => item.verificationRate)),
    topicCoverage: mean(scores.map((item) => item.topicCoverage)) ?? 0,
    actCoverage: mean(scores.map((item) => item.actCoverage)),
    continuity: mean(scores.map((item) => item.recall)),
    meanTimeMs: mean(scores.map((item) => item.timeMs)) ?? 0,
    inputTokens: sum(scores.map((item) => item.inputTokens)),
    outputTokens: sum(scores.map((item) => item.outputTokens))
  };
}

export type SessionQualityComparison = {
  metric: keyof SessionQualitySummary;
  baseline: number | null;
  current: number | null;
  delta: number | null;
  regression: boolean;
};

// Higher is better except these.
const LOWER_IS_BETTER = new Set<keyof SessionQualitySummary>(["blockedRate", "meanTimeMs", "inputTokens", "outputTokens"]);
const QUALITY_TOLERANCE = 0.05;

export function compareSummaries(baseline: SessionQualitySummary, current: SessionQualitySummary): SessionQualityComparison[] {
  return (Object.keys(current) as Array<keyof SessionQualitySummary>)
    .filter((metric) => metric !== "turns")
    .map((metric) => {
      const before = baseline[metric];
      const after = current[metric];
      const delta = before === null || after === null ? null : after - before;
      const relative = delta === null || !before ? null : delta / Math.abs(before);
      const regression =
        delta !== null &&
        (LOWER_IS_BETTER.has(metric)
          ? metric === "blockedRate"
            ? delta > QUALITY_TOLERANCE
            : relative !== null && relative > 0.25
          : delta < -QUALITY_TOLERANCE);
      return { metric, baseline: before, current: after, delta, regression };
    });
}

/**
 * The query the chat client sends: newest whole messages within the budget,
 * the omitted ones replaced by the client's note (lex-web conversation-context.ts).
 */
export function conversationQuery(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  next: string,
  budgetChars: number
): string {
  const current = `Użytkownik: ${next}`;
  const kept: string[] = [];
  let used = current.length;
  let index = history.length - 1;
  for (; index >= 0; index -= 1) {
    const text = `${history[index]!.role === "user" ? "Użytkownik" : "Asystent"}: ${history[index]!.content}`;
    if (used + text.length + 2 > budgetChars) break;
    kept.unshift(text);
    used += text.length + 2;
  }
  const dropped = index + 1;
  const note = dropped > 0 ? `[Wcześniejsza część rozmowy pominięta (${dropped} wiadomości) — nie mieści się w oknie modelu.]` : "";
  const body = history.length ? [note, ...kept, current].filter(Boolean).join("\n\n") : next;
  return `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: true, manual: [] })}\n${body}`;
}

// "HTTP_409:{"error":"CONTRACT_STATE_REQUIRED"}" -> CONTRACT_STATE_REQUIRED (with the reason when given).
export function errorCode(error: string): string {
  const reason = /"reason":"([A-Z0-9_]+)"/.exec(error)?.[1];
  const code = /"error":"([A-Z0-9_]+)"/.exec(error)?.[1] ?? /^([A-Z0-9_]+)/.exec(error)?.[1] ?? "?";
  return reason ? `${code}/${reason}` : code;
}

const percent = (value: number | null): string => (value === null ? "—" : `${Math.round(value * 100)}%`);

export function reportMarkdown(args: {
  provider: string;
  model: string;
  corpus: SessionQualityCorpus;
  scores: SessionTurnScore[];
  summary: SessionQualitySummary;
  comparison?: SessionQualityComparison[];
}): string {
  const rows = args.scores.map(
    (item) =>
      `| ${item.caseId} | ${item.turn} | ${item.error ? `BŁĄD ${errorCode(item.error)}` : item.blocked ? "BLOKADA" : "ok"} | ${percent(item.score)} | ${percent(item.verificationRate)} (${item.verifiedMarkers}/${item.unverifiedMarkers}) | ${percent(item.topicCoverage)} | ${percent(item.actCoverage)} | ${percent(item.recall)} | ${Math.round(item.timeMs / 1000)} s | ${item.inputTokens ?? "—"}/${item.outputTokens ?? "—"} |`
  );
  return [
    `# Miernik jakości sesji — ${args.corpus.corpusId} ${args.corpus.corpusVersion}`,
    "",
    `Model: ${args.provider}/${args.model}. Tury: ${args.summary.turns}.`,
    "",
    `Wynik ${percent(args.summary.score)}, blokady ${percent(args.summary.blockedRate)}, przepisy zweryfikowane ${percent(args.summary.verificationRate)}, kompletność ${percent(args.summary.topicCoverage)}, akty ${percent(args.summary.actCoverage)}, ciągłość wątku ${percent(args.summary.continuity)}, średni czas ${Math.round(args.summary.meanTimeMs / 1000)} s, tokeny ${args.summary.inputTokens ?? "—"}/${args.summary.outputTokens ?? "—"}.`,
    "",
    ...(args.comparison
      ? [
          "## Porównanie z poprzednim pomiarem",
          "",
          "| Miara | Przed | Po | Zmiana | Regresja |",
          "|---|---|---|---|---|",
          ...args.comparison.map(
            (item) =>
              `| ${item.metric} | ${item.baseline === null ? "—" : Number(item.baseline.toFixed(3))} | ${item.current === null ? "—" : Number(item.current.toFixed(3))} | ${item.delta === null ? "—" : Number(item.delta.toFixed(3))} | ${item.regression ? "TAK" : ""} |`
          ),
          ""
        ]
      : []),
    "| Sprawa | Tura | Stan | Wynik | Weryfikacja (VER/NIEWER.) | Kompletność | Akty | Ciągłość | Czas | Tokeny we/wy |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    ""
  ].join("\n");
}

export type BenchmarkCall = <T>(method: string, route: string, body?: unknown) => Promise<T>;

export type SessionQualityRun = {
  scores: SessionTurnScore[];
  answers: Array<{ caseId: string; turn: number; status: string; answer: string }>;
  summary: SessionQualitySummary;
  cancelled: boolean;
};

/**
 * One benchmark run through the runtime API: a matter per case, each turn
 * sent like the chat client and stored in the matter's thread. Matters are
 * archived afterwards. `call` carries the caller's session.
 */
export async function runSessionQuality(args: {
  call: BenchmarkCall;
  corpus: SessionQualityCorpus;
  provider: string;
  model: string;
  historyChars: number;
  cases?: string[];
  onTurn?: (progress: { caseId: string; turn: number; done: number; total: number; score: SessionTurnScore }) => void;
  cancelled?: () => boolean;
  messageId: () => string;
}): Promise<SessionQualityRun> {
  const cases = args.corpus.cases.filter((item) => !args.cases?.length || args.cases.includes(item.id));
  const total = cases.reduce((sum, item) => sum + item.turns.length, 0);
  const scores: SessionTurnScore[] = [];
  const answers: SessionQualityRun["answers"] = [];
  let cancelled = false;
  for (const item of cases) {
    if (args.cancelled?.()) {
      cancelled = true;
      break;
    }
    const created = await args.call<{ caseId: string }>("POST", "/api/cases", { displayName: `Miernik ${item.id}` });
    const history: Array<{ role: "user" | "assistant"; content: string }> = [];
    try {
      for (const [index, turn] of item.turns.entries()) {
        if (args.cancelled?.()) {
          cancelled = true;
          break;
        }
        const started = Date.now();
        let observed: SessionTurnObservation;
        try {
          const result = await args.call<{ status: string; answer?: string; usage?: SessionTurnObservation["usage"] }>(
            "POST",
            "/api/sessions/execute",
            {
              query: conversationQuery(history, turn.question, args.historyChars),
              auxiliaryText: turn.question,
              provider: args.provider,
              model: args.model,
              primarySkill: "AUTO",
              mode: "PRAWNIK",
              knowledge: { caseId: created.caseId, includeCase: false, includeFirm: false, limit: 8 }
            }
          );
          observed = { status: result.status, answer: result.answer ?? "", timeMs: Date.now() - started, ...(result.usage ? { usage: result.usage } : {}) };
        } catch (error) {
          observed = { status: "ERROR", answer: "", timeMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
        }
        const score = scoreTurn(item.id, index, turn, observed);
        scores.push(score);
        answers.push({ caseId: item.id, turn: index + 1, status: observed.status, answer: observed.answer || observed.error || "" });
        args.onTurn?.({ caseId: item.id, turn: index + 1, done: scores.length, total, score });
        // The thread of the matter, as the chat client keeps it.
        for (const message of [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: observed.answer || observed.error || "" }
        ]) {
          history.push(message);
          await args.call("POST", `/api/cases/${created.caseId}/workspace/thread/messages`, {
            messageId: args.messageId(),
            role: message.role,
            content: message.content.slice(0, 200_000),
            createdAt: new Date().toISOString()
          });
        }
      }
    } finally {
      await args.call("POST", `/api/cases/${created.caseId}/archive`, {}).catch(() => undefined);
    }
    if (cancelled) break;
  }
  return { scores, answers, summary: summarizeScores(scores), cancelled };
}
