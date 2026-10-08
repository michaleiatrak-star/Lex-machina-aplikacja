import fs from "node:fs";
import path from "node:path";
import { isTrivialChatCommand } from "./execution-engine.js";
import { assessMatterComplexity } from "./matter-complexity.js";
import { criminalMatter } from "./matter-signals.js";
import { analysisRequested, pathProfile, type PathProfile } from "./mandatory-path.js";
import { detectQueryMode, parseModeSignals, type ModeSignals, type QueryModeDecision } from "./query-mode.js";
import { TurnRouter } from "./routing-benchmark.js";
import { classifyTask, parseRoutingTable, type TaskRoute } from "./task-routing.js";
import { isNonLegalMessage } from "./turn-gate.js";
import { threadUserText } from "./skill-selection.js";
import { parseFlashRouting, type FlashRoute } from "./domain-module-map.js";
import { buildAccentMap, restoreAccents, type AccentMap } from "./accent-restoration.js";
import { executiveSkillTexts } from "./accent-restoration-corpus.js";

/**
 * What one chat turn ends in, decided the way the application decides it for an
 * API model in AUTO (no model call): the chat's direct document request, the
 * trivial and non-legal gates, the executive skill, the LAIK/PRAWNIK mode and
 * the mandatory path profile.
 *
 *   DOKUMENT       a file is generated (direct request, simple letter, pleading pipeline)
 *   ANALIZA        full legal analysis (profile PEŁNY or an analysis skill)
 *   PROSTA         a simple legal answer (profile LEKKI)
 *   OGOLNA         a general answer without legal skills
 *   PYTANIE_O_TRYB the model must first ask whether the user is a lawyer (no answer yet)
 */
export type TurnOutcome = "DOKUMENT" | "ANALIZA" | "PROSTA" | "OGOLNA" | "PYTANIE_O_TRYB";

export type TurnOutcomeDecision = {
  outcome: TurnOutcome;
  legal: boolean;
  domains: string[];
  executive: string | null;
  criminal: boolean;
  mode: QueryModeDecision | null;
  profile: PathProfile | null;
  complexity: string;
};

const DOCUMENT_SKILLS = new Set(["pisma-proste-v2", "pisma-procesowe-v3"]);
const ANALYSIS_SKILLS = new Set([
  "analiza-sadowa-v6",
  "analizator-dowodow-v3",
  "analizator-przepisow-v2",
  "orzeczenia-sadowe-v2",
  "chronologia-sprawy-v1",
  "raport-klienta-v1",
  "raport-sytuacyjny-v2",
  "przesluchanie-swiadkow-v2-min90"
]);
const DRAFT_VERB = /(?<![\p{L}])(?:napisz|przygotuj|sporządź|stwórz|utwórz|opracuj|zredaguj|wygeneruj)(?![\p{L}])/iu;

export class TurnOutcomeModel {
  readonly router: TurnRouter;
  private readonly signals: ModeSignals;
  private readonly routes: TaskRoute[];
  private readonly flash: FlashRoute[];
  private readonly accents: AccentMap;

  /** `documentRequest`: the chat's own check for a file asked as the result (lex-web). */
  constructor(corpusRoot: string, private readonly documentRequest: (message: string) => boolean = () => false) {
    const read = (file: string) => fs.readFileSync(path.join(corpusRoot, file), "utf8");
    this.router = new TurnRouter(corpusRoot);
    this.signals = parseModeSignals(read("prawny-router-v3/references/KROK1-detekcja.md"));
    this.routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
    this.flash = parseFlashRouting(read("prawo-polskie-v2/SKILL.md"));
    this.accents = buildAccentMap(executiveSkillTexts(this.router.registry));
  }

  /** `query`: the conversation as the chat sends it; `message`: the latest message (auxiliaryText). */
  decide(query: string, message: string): TurnOutcomeDecision {
    const none = { domains: [], executive: null, criminal: false, mode: null, profile: null };
    if (this.documentRequest(message)) {
      const routing = this.router.route(query);
      return { ...none, outcome: "DOKUMENT", legal: true, domains: routing.domains, executive: routing.executive, criminal: routing.criminal, complexity: "-" };
    }
    if (isTrivialChatCommand(query) || isNonLegalMessage(query, this.flash)) {
      return { ...none, outcome: "OGOLNA", legal: false, complexity: "TRIVIAL" };
    }
    const routing = this.router.route(query);
    const complexity = assessMatterComplexity({ query });
    const mode = detectQueryMode(message, this.signals, null);
    // session-executor: the question itself, or the thread when no message is given apart.
    const criminal = criminalMatter(message) || criminalMatter(threadUserText(query));
    const taskQuery = /[ąćęłńóśźż]/iu.test(message) ? message : restoreAccents(message, this.accents);
    const verification = classifyTask(this.routes, taskQuery)?.route.id === "11";
    const profile = pathProfile({ mode: mode.mode, simple: complexity.level === "SIMPLE", criminal, documentGeneration: false, verification, analysis: analysisRequested(message) });
    const executive = routing.executive;
    const base = { legal: true, domains: routing.domains, executive, criminal, mode, profile, complexity: complexity.level };
    if (executive && DOCUMENT_SKILLS.has(executive)) return { ...base, outcome: "DOKUMENT" };
    if (executive === "analizator-umow-v1" && DRAFT_VERB.test(taskQuery)) return { ...base, outcome: "DOKUMENT" };
    if (mode.decision === "NIEROZSTRZYGNIETY") return { ...base, outcome: "PYTANIE_O_TRYB" };
    if (profile === "PELNY" || (executive && ANALYSIS_SKILLS.has(executive))) return { ...base, outcome: "ANALIZA" };
    return { ...base, outcome: "PROSTA" };
  }
}

export type Scenario = {
  q: string;
  history?: string;
  outcome: Exclude<TurnOutcome, "PYTANIE_O_TRYB">;
  dr: string | null;
  skill?: string;
  criminal: boolean;
  frame: string;
  variant: string;
};

export type Tally = { total: number; ok: number };
export type ScenarioReport = {
  total: number;
  outcome: Tally;
  confusion: Record<string, Record<string, number>>;
  byFrame: Record<string, Tally>;
  byVariant: Record<string, Tally>;
  domainTop1: Tally;
  documentSkill: Tally;
  criminal: Tally;
  failures: Array<{ q: string; history?: boolean; frame: string; expected: string; got: string; why: string }>;
  msPerTurn: number;
};

const tally = (bucket: Tally, ok: boolean) => {
  bucket.total += 1;
  if (ok) bucket.ok += 1;
};

/** The conversation as lex-web sends it: earlier turns, then the message. */
export function chatQuery(scenario: Pick<Scenario, "q" | "history">): string {
  return scenario.history ? `${scenario.history}\n\nUżytkownik: ${scenario.q}` : scenario.q;
}

export function runScenarioBenchmark(model: TurnOutcomeModel, scenarios: Scenario[]): ScenarioReport {
  const report: ScenarioReport = {
    total: scenarios.length,
    outcome: { total: 0, ok: 0 },
    confusion: {},
    byFrame: {},
    byVariant: {},
    domainTop1: { total: 0, ok: 0 },
    documentSkill: { total: 0, ok: 0 },
    criminal: { total: 0, ok: 0 },
    failures: [],
    msPerTurn: 0
  };
  const started = performance.now();
  for (const scenario of scenarios) {
    const got = model.decide(chatQuery(scenario), scenario.q);
    const ok = got.outcome === scenario.outcome;
    tally(report.outcome, ok);
    tally((report.byFrame[scenario.frame] ??= { total: 0, ok: 0 }), ok);
    tally((report.byVariant[scenario.variant] ??= { total: 0, ok: 0 }), ok);
    const row = (report.confusion[scenario.outcome] ??= {});
    row[got.outcome] = (row[got.outcome] ?? 0) + 1;
    if (!ok) {
      report.failures.push({
        q: scenario.q,
        ...(scenario.history ? { history: true } : {}),
        frame: scenario.frame,
        expected: scenario.outcome,
        got: got.outcome,
        why: `tryb ${got.mode?.mode ?? "-"}/${got.mode?.decision ?? "-"}, profil ${got.profile ?? "-"}, złożoność ${got.complexity}, skill ${got.executive ?? "-"}, karna ${got.criminal}`
      });
    }
    if (scenario.dr && got.legal && !scenario.history) {
      tally(report.domainTop1, got.domains[0]?.startsWith(scenario.dr) ?? false);
    }
    if (scenario.skill && scenario.outcome === "DOKUMENT" && got.outcome === "DOKUMENT" && got.executive) {
      tally(report.documentSkill, got.executive === scenario.skill);
    }
    if (scenario.criminal && scenario.outcome !== "OGOLNA") tally(report.criminal, got.criminal || got.outcome === "DOKUMENT");
  }
  report.msPerTurn = (performance.now() - started) / Math.max(scenarios.length, 1);
  return report;
}

const pct = (value: Tally) => (value.total ? `${((100 * value.ok) / value.total).toFixed(1)}% (${value.ok}/${value.total})` : "-");

export function formatScenarioReport(report: ScenarioReport): string {
  const outcomes: TurnOutcome[] = ["DOKUMENT", "ANALIZA", "PROSTA", "OGOLNA", "PYTANIE_O_TRYB"];
  return [
    `Tury: ${report.total}; ${report.msPerTurn.toFixed(2)} ms/turę (decyzja aplikacji, bez modelu)`,
    `Właściwy rodzaj wyniku: ${pct(report.outcome)}`,
    `Macierz (wiersz: oczekiwany, kolumny: ${outcomes.join(" / ")}):`,
    ...Object.entries(report.confusion).map(([expected, row]) => `  ${expected.padEnd(9)} ${outcomes.map((name) => String(row[name] ?? 0).padStart(5)).join(" ")}`),
    `Wg ramki:`,
    ...Object.entries(report.byFrame).sort().map(([frame, value]) => `  ${frame}: ${pct(value)}`),
    `Wg zapisu:`,
    ...Object.entries(report.byVariant).sort().map(([variant, value]) => `  ${variant}: ${pct(value)}`),
    `DR top-1 (pierwsza wiadomość): ${pct(report.domainTop1)}`,
    `Skill pisma zgodny z rodzajem pisma: ${pct(report.documentSkill)}`,
    `Sprawy karne rozpoznane jako karne: ${pct(report.criminal)}`
  ].join("\n");
}
