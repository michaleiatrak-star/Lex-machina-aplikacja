import { asksAbout, asksToDraft, draftingSchema, matchSchema, repliesToDemand, type SchemaEntry } from "./skill-schema-catalog.js";
import { provisionsForDetection } from "./legal-act-abbreviations.js";

// Router KROK 2 — ROUTING [1]–[11], read from prawny-router-v3/SKILL.md: each row
// has its trigger phrases and the PRIMARY executive skill. The application uses it
// in AUTO to name the executive skill the router requires for the task, so the
// skill is loaded mechanically instead of being left to the model's choice.

export type TaskRoute = {
  id: string;
  title: string;
  phrases: string[];
  primary: string;
  secondary: string[];
};

const ROW = /^###\s+\[(\d{1,2})\]\s+(.+)$/u;

export function parseRoutingTable(router: string): TaskRoute[] {
  const section = /## KROK 2 — ROUTING \[1\]–\[11\][\s\S]*?(?=\n## )/u.exec(router)?.[0] ?? "";
  const routes: TaskRoute[] = [];
  let current: TaskRoute | null = null;
  let pending: string | null = null;
  const addPhrases = (raw: string) =>
    current!.phrases.push(
      ...raw
        .split(/\s+\/\s+|^\/\s+|\s+\/$/u)
        .map((phrase) => phrase.replace(/["„”`]/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl"))
        .filter((phrase) => phrase.length >= 3)
    );
  for (const line of section.split("\n")) {
    const row = ROW.exec(line);
    if (row) {
      if (current?.primary) routes.push(current);
      current = { id: row[1]!, title: row[2]!.trim(), phrases: [], primary: "", secondary: [] };
      pending = null;
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    // The phrase list is one backtick span, possibly over several lines.
    if (pending !== null) {
      const end = trimmed.indexOf("`");
      if (end < 0) {
        pending += ` ${trimmed}`;
        continue;
      }
      addPhrases(`${pending} ${trimmed.slice(0, end)}`);
      pending = null;
      continue;
    }
    if (!current.phrases.length && trimmed.startsWith("`") && !trimmed.startsWith("``")) {
      const end = trimmed.indexOf("`", 1);
      if (end < 0) pending = trimmed.slice(1);
      else addPhrases(trimmed.slice(1, end));
      continue;
    }
    const primary = /→\s*PRIMARY:\s*`view\s+([a-z0-9-]+)\/SKILL\.md`/u.exec(line);
    if (primary) current.primary = primary[1]!;
    const secondary = /→\s*SECONDARY:\s*(.+)$/u.exec(line);
    if (secondary) current.secondary = [...secondary[1]!.matchAll(/`([a-z0-9-]+)`/gu)].map((match) => match[1]!);
  }
  if (current?.primary) routes.push(current);
  return routes;
}

const ARTICLE = /\bart\.?\s*\d+|§\s*\d+/iu;

function stemPhrase(phrase: string): RegExp | null {
  if (phrase === "art. x") return ARTICLE;
  if (phrase === "§ y") return null;
  // Word starts: "wyrok" matches "wyroku", "apelacja" matches "apelację";
  // a mobile "e" drops: "świadek" matches "świadka", "pozew" matches "pozwu".
  const words = phrase
    .split(/\s+/u)
    .map((word) => word.replace(/[^\p{L}\p{N}.-]/gu, ""))
    .filter(Boolean)
    .map((word) => {
      const base = (word.length >= 8 ? word.slice(0, word.length - 2) : word.length >= 5 ? word.slice(0, word.length - 1) : word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const dropped = /e[^aeiouyąęó\W\d]$/iu.test(word) && word.length >= 5 ? (word.slice(0, -2) + word.slice(-1)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
      return dropped ? `(?:${base}|${dropped})` : base;
    });
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}])${words.join("\\p{L}*\\s+")}`, "iu");
}

/**
 * The route whose phrases match the question best (longest matched phrases win;
 * [10] is the domain router, already in the context, and does not name an
 * executive skill). Null when no executive route matches.
 */
const EVIDENCE_MEDIA = /^(?:maile|sms|nagrania)$/u;
const EVIDENCE_INTENT = /(?<![\p{L}])(?:dow[oó]d\p{L}*|ocen\p{L}*|oceń|przeanalizuj|analiz\p{L}*|wykorzyst\p{L}*|użyć|sprawdź|zweryfikuj)(?![\p{L}])/iu;

// "Pracuję na umowie zlecenie / o pracę": the person's employment, not a contract to analyse.
const EMPLOYMENT_BASIS = /(?<![\p{L}])na\s+umowi\p{L}*\s+(?:o\s+prac\p{L}*|o\s+dzieło|zlecen\p{L}*|b2b|śmieciow\p{L}*)/giu;

export function classifyTask(routes: TaskRoute[], rawQuestion: string): { route: TaskRoute; matched: string[] } | null {
  // "233 kk" is "art. 233 KK" for the article row.
  const question = provisionsForDetection(rawQuestion).replace(EMPLOYMENT_BASIS, " ");
  let best: { route: TaskRoute; matched: string[]; score: number } | null = null;
  for (const route of routes) {
    if (route.primary === "prawo-polskie-v2") continue;
    const matched = route.phrases.filter((phrase) => stemPhrase(phrase)?.test(question));
    if (!matched.length) continue;
    // "SMS-y i śledzenie" tells the story; "czy te SMS-y są dowodem" asks about evidence.
    if (matched.every((phrase) => EVIDENCE_MEDIA.test(phrase)) && !EVIDENCE_INTENT.test(question)) continue;
    const score = matched.reduce((sum, phrase) => sum + phrase.length, 0);
    if (!best || score > best.score) best = { route, matched, score };
  }
  return best ? { route: best.route, matched: best.matched } : null;
}

// shared/ACTIVATION-MATRIX.md: phrase or delivered material -> PRIMARY entry point.
// Its own priority rule: a matrix row beats the router table [1]–[11].
export type MatrixRule = {
  signal: string;
  phrases: string[];
  // What the user delivers ("dostarcza akta / wyrok / pismo przeciwnika").
  delivers: string[];
  withoutPleading: boolean;
  primary: string;
  // "analiza-sadowa-v6 (W1) → pisma-procesowe-v3 (W2)": the next skill of the pipeline.
  then: string | null;
};

export function parseActivationMatrix(markdown: string): MatrixRule[] {
  const section = /## MACIERZ AKTYWACJI[\s\S]*?(?=\n## )/u.exec(markdown)?.[0] ?? "";
  const rules: MatrixRule[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4 || !cells[2]!.includes("`")) continue;
    const signal = cells[1]!;
    const skills = [...cells[2]!.matchAll(/`([a-z0-9-]+)`/gu)].map((match) => match[1]!);
    if (!skills[0] || !/-v\d|min90/.test(skills[0])) continue;
    const quoted = [...signal.matchAll(/"([^"]+)"/gu)].map((match) => match[1]!);
    // Rows without quotes ("świadek / pytania do przesłuchania / cross-examination",
    // "chronologia / oś czasu / timeline") are phrase lists too; "dostarcza ..." and
    // "a + b" rows describe materials and combinations, not phrases.
    const plain = !quoted.length && !/dostarcz|\+/iu.test(signal) ? [signal.replace(/\(.*?\)/gu, "")] : [];
    const phrases = [...quoted, ...plain].flatMap((text) =>
      text.split(/\s*\/\s*/u).map((phrase) => phrase.trim().toLocaleLowerCase("pl")).filter((phrase) => phrase.length >= 4)
    );
    // "napisz pozew / apelację / zażalenie" in quotes is one verb with alternatives.
    const expanded = phrases.flatMap((phrase, index) => {
      const head = phrases[0]!.split(/\s+/u)[0]!;
      return index > 0 && !phrase.includes(" ") && phrases[0]!.includes(" ") ? [`${head} ${phrase}`] : [phrase];
    });
    const deliveryText = /dostarcz\p{L}*\s+([^|]+)/iu.exec(signal)?.[1] ?? (/\+\s*dostarczone\s+(\p{L}+)/iu.exec(signal)?.[1] ?? "");
    const delivers = deliveryText
      .replace(/\(.*?\)/gu, "")
      .split(/\s*\/\s*|\s+bez\s+/u)
      .map((item) => item.trim().toLocaleLowerCase("pl"))
      .filter((item) => item.length >= 3 && item !== "pisma");
    const pleadingTask = /pismo\s+procesowe\s*\+/iu.test(signal);
    rules.push({
      signal,
      phrases: expanded,
      delivers: pleadingTask ? ["akta"] : delivers,
      withoutPleading: /bez\s+pisma/iu.test(signal),
      primary: skills[0]!,
      then: skills[1] && /→/u.test(cells[2]!) ? skills[1]! : null
    });
  }
  return rules;
}

export type DeliveredMaterial = { category: string; evidence: boolean; label: string; kind?: string };

// What a delivered document counts as in the matrix's words.
function deliveryWords(material: DeliveredMaterial): string[] {
  switch (material.category) {
    case "AKTA":
      return ["akta"];
    case "ORZECZENIE":
      return ["akta", "wyrok", material.label];
    case "PISMO_PROCESOWE":
      return ["akta", "pismo przeciwnika", material.label];
    default:
      return material.evidence ? ["dowody", material.label] : [material.label];
  }
}

export type TaskDecision = {
  source: "MATRIX" | "ROUTER" | "SKILL";
  primary: string;
  then: string | null;
  reason: string;
  route?: TaskRoute;
  // Modules the decision itself requires (e.g. MOD-REDAKCJA for editing a finished pleading).
  modules?: string[];
};

/**
 * pisma-procesowe-v3 KROK 0, Test A: editing an existing pleading (form, style,
 * length, tone) goes to modules/MOD-REDAKCJA.md, not W1–W3. Signals read from
 * the skill's own "Sygnały:" line.
 */
export type RedactionTest = { skill: string; module: string; signals: string[] };

export function parseRedactionTest(skillMarkdown: string, skill = "pisma-procesowe-v3"): RedactionTest | null {
  const section = /### Test A[\s\S]*?(?=\n### )/u.exec(skillMarkdown)?.[0] ?? "";
  const signalsText = /Sygnały:([\s\S]*?)(?:\n\s*\n|→)/u.exec(section)?.[1] ?? "";
  const signals = [...signalsText.matchAll(/"([^"]+)"/gu)].map((match) => match[1]!.toLocaleLowerCase("pl").split(/\s+na\s+/u)[0]!.trim()).filter(Boolean);
  const module = /`(modules\/MOD-REDAKCJA\.md)`/u.exec(section)?.[1];
  return signals.length && module ? { skill, module: `${skill}/${module}`, signals } : null;
}

// A request to analyse or assess (not to prepare or draft).
export const ANALYSIS_INTENT = /(?<![\p{L}])(?:przeanalizuj|analiz\p{L}*|oceń|ocen\p{L}*|zbadaj|całościow\p{L}*|kompleksow\p{L}*|szans\p{L}*)(?![\p{L}])/iu;
// New substance (theses, provisions, case law) is not a Test A edit.
const NEXT_STEP = /co\s+(?:mam\s+|powinien\p{L}*\s+)?(?:zrobić|robić)|co\s+dalej|od\s+czego\s+zacząć/iu;
const NEW_SUBSTANCE = /(?<![\p{L}])(?:dodaj|dopisz|nowy\s+zarzut|nowe\s+zarzuty|nowe\s+przepisy|orzeczni\p{L}*|argument\p{L}*)(?![\p{L}])/iu;
// "mój sprzeciw", "moje pismo", "naszą odpowiedź na pozew" — not "moje dane osobowe".
const OWN_DOCUMENT =
  /(?<![\p{L}])(?:(?:m[oó]j|moj\p{L}*|nasz\p{L}*|własn\p{L}*)(?:\s+\p{L}+){0,2}?\s+(?:pism\p{L}*|sprzeciw\p{L}*|skarg\p{L}*|wnios\p{L}*|pozew|pozw\p{L}*|wezwani\p{L}*|odwołani\p{L}*|zażaleni\p{L}*|apelacj\p{L}*|projekt\p{L}*|odpowied\p{L}*|zarzut\p{L}*|dokument\p{L}*|tekst\p{L}*|wersj\p{L}*|draft\p{L}*|oświadczeni\p{L}*|umow\p{L}*)|to\s+pismo|ten\s+(?:pozew|projekt))(?![\p{L}])/iu;

/**
 * Entry point for the task: the activation matrix first (phrases of the question
 * and the materials delivered), then the router table on the question and the
 * kinds of the delivered documents.
 */
// What the matrix means by its rows, said differently: a whole-case analysis is
// "akta" (analiza-sadowa-v6), preparing for a hearing is the hearing skill, a
// report with no addressee is "raport ogólny".
const IMPLIED_ROWS: Array<{ pattern: RegExp; primary: string; row: string }> = [
  {
    pattern: /(?<![\p{L}])(?:(?:całościow|kompleksow)\p{L}*\s+(?:\p{L}+\s+)?analiz|analiz\p{L}*\s+(?:całościow|kompleksow|(?:całej\s+)?sprawy))/iu,
    primary: "analiza-sadowa-v6",
    row: "dostarcza akta / wyrok / pismo przeciwnika (analiza całościowa sprawy)"
  },
  {
    pattern: /(?<![\p{L}])(?:przygot\p{L}*|pytani\p{L}*)(?:\s+\p{L}+){0,4}\s+(?:do|na|przed)\s+(?:\p{L}+\s+)?przesłuchani\p{L}*/iu,
    primary: "przesluchanie-swiadkow-v2-min90",
    row: "świadek / pytania do przesłuchania / cross-examination (przygotowanie do przesłuchania)"
  },
  { pattern: /(?<![\p{L}])raport\p{L}*(?![\p{L}])/iu, primary: "raport-sytuacyjny-v2", row: "\"stan sprawy\" / \"aktualny status\" / raport ogólny" }
];

// Case law asked for ("orzecznictwo do art. 233 KK", "jak sądy interpretują",
// "linia orzecznicza", "podaj wyroki SN", "sprawdź sygnaturę").
const CASE_LAW =
  /(?<![\p{L}])(?:orzecznictw\p{L}*|orzecznicz\p{L}*|precedens\p{L}*|sygnatur\p{L}*|(?:wyrok\p{L}*|uchwał\p{L}*|postanowieni\p{L}*)\s+(?:SN|NSA|WSA|TK|TSUE|ETPC\p{L}*|SA|sąd\p{L}*)|(?:podaj|znajdź|wskaż|przytocz|wyszukaj)\s+(?:\p{L}+\s+)?(?:wyrok\p{L}*|orzecze\p{L}*|uchwał\p{L}*)|jak\s+(?:to\s+)?(?:sądy|SN|NSA)\s+(?:interpretuj\p{L}*|rozumi\p{L}*|stosuj\p{L}*|orzekaj\p{L}*|wykładaj\p{L}*|ocenia\p{L}*))(?![\p{L}])/iu;
// An analysis of the provision itself, besides the case law.
const PROVISION_ANALYSIS =
  /(?<![\p{L}])(?:różnic\p{L}*|porówna\p{L}*|porównaj|wykaż|przesłank\p{L}*|znamion\p{L}*|wykładni\p{L}*|omów|wyjaśnij|przeanalizuj|analiz\p{L}*|co\s+mówi)(?![\p{L}])/iu;

/**
 * ACTIVATION-MATRIX: "CEL: znaleźć / zweryfikować orzeczenie (sygnatura,
 * precedens, linia) → orzeczenia-sadowe-v2 jako PRIMARY"; with an analysis of
 * the provision as well, analizator-przepisow-v2 is the entry point and the case
 * law its next step ("kombinacja PRIMARY+SECONDARY zawsze dopuszczalna").
 */
export function decideTask(
  routes: TaskRoute[],
  matrix: MatrixRule[],
  rawQuestion: string,
  materials: DeliveredMaterial[] = [],
  redaction: RedactionTest | null = null,
  simpleLetters: { skill: string; entries: SchemaEntry[] } | null = null
): TaskDecision | null {
  const decision = decideTaskByMatrix(routes, matrix, rawQuestion, materials, redaction, simpleLetters);
  const caseLaw = "orzeczenia-sadowe-v2";
  const known = routes.some((route) => route.primary === caseLaw) || matrix.some((rule) => rule.primary === caseLaw);
  const question = provisionsForDetection(rawQuestion);
  if (!known || !CASE_LAW.test(question) || explicitHandoff(rawQuestion, () => true)) return decision;
  if (!decision) {
    return { source: "MATRIX", primary: caseLaw, then: null, reason: "macierz aktywacji: cel — znaleźć / zweryfikować orzeczenie (sygnatura, precedens, linia)" };
  }
  if (decision.primary !== "analizator-przepisow-v2" || decision.then) return decision;
  return PROVISION_ANALYSIS.test(question)
    ? { ...decision, then: caseLaw, reason: `${decision.reason}; orzecznictwo do przepisu → ${caseLaw}` }
    : { ...decision, primary: caseLaw, reason: `macierz aktywacji: cel — orzecznictwo do przepisu (${decision.reason})` };
}

function decideTaskByMatrix(
  routes: TaskRoute[],
  matrix: MatrixRule[],
  rawQuestion: string,
  materials: DeliveredMaterial[] = [],
  redaction: RedactionTest | null = null,
  simpleLetters: { skill: string; entries: SchemaEntry[] } | null = null
): TaskDecision | null {
  // The user pressed "continue" on a pipeline step: that skill, explicitly.
  const known = new Set([...routes.map((route) => route.primary), ...matrix.flatMap((rule) => [rule.primary, rule.then ?? ""])]);
  const handoff = explicitHandoff(rawQuestion, (skill) => known.has(skill));
  if (handoff) return { source: "MATRIX", primary: handoff, then: null, reason: "następny etap pipeline'u wskazany przez użytkownika" };
  const question = provisionsForDetection(rawQuestion);
  // One's own simple letter to check or improve ("sprawdź mój sprzeciw od nakazu"):
  // pisma-proste-v2 with that letter's schema, not the pleading redaction of Test A.
  const ownSimple = simpleLetters && OWN_DOCUMENT.test(question) ? matchSchema(simpleLetters.entries, question) : null;
  if (ownSimple && simpleLetters && !materials.some((material) => material.category === "PISMO_PROCESOWE")) {
    return {
      source: "SKILL",
      primary: simpleLetters.skill,
      then: null,
      reason: `sprawdzenie własnego pisma prostego (${ownSimple.why}; M8 lista kontrolna)`,
      modules: ownSimple.resources
    };
  }
  // A reply to a payment demand: the demand is assessed first, then the reply drafted.
  if (simpleLetters && repliesToDemand(question)) {
    const demand = materials.some((material) => material.kind === "WEZWANIE");
    return {
      source: "SKILL",
      primary: demand ? "analizator-dowodow-v3" : simpleLetters.skill,
      then: demand ? simpleLetters.skill : null,
      reason: demand
        ? "odpowiedź na otrzymane wezwanie do zapłaty: najpierw ocena wezwania, potem pismo (bez schematu wezwania wierzyciela SPE)"
        : "odpowiedź na wezwanie do zapłaty (pismo proste, bez schematu wezwania wierzyciela SPE)"
    };
  }
  // Test A: a finished pleading delivered (or "my letter") and a request about its form.
  if (redaction && !NEW_SUBSTANCE.test(question)) {
    const ownPleading =
      materials.some((material) => material.category === "PISMO_PROCESOWE") || OWN_DOCUMENT.test(question);
    // The skill's signals, and their verbs ("popraw", "zredaguj", "skróć"...) for the user's own letter.
    const verbs = [...new Set(redaction.signals.map((phrase) => phrase.split(/\s+/u)[0]!))];
    const signal =
      redaction.signals.find((phrase) => stemPhrase(phrase)?.test(question)) ??
      (OWN_DOCUMENT.test(question) ? verbs.find((verb) => stemPhrase(verb)?.test(question)) : undefined);
    if (signal && ownPleading) {
      return {
        source: "SKILL",
        primary: redaction.skill,
        then: null,
        reason: `redakcja istniejącego pisma (${redaction.skill}, KROK 0 Test A: „${signal}”)`,
        modules: [redaction.module]
      };
    }
  }
  // A simple letter of the catalogue (pisma-proste-v2 SCHEMATY PISM: sprzeciw, zarzuty,
  // klauzula, egzekucja, wezwanie, uzasadnienie, zabezpieczenie, SPH...): that skill with
  // that one schema, unless the request is a full pleading ("napisz pozew / apelację").
  if (simpleLetters) {
    const schema = draftingSchema(simpleLetters.entries, question, { demand: materials.some((material) => material.kind === "WEZWANIE") });
    const fullPleading = matrix.some(
      (rule) => rule.primary === "pisma-procesowe-v3" && rule.phrases.some((phrase) => stemPhrase(phrase)?.test(question))
    );
    if (schema && !fullPleading) {
      const decisionDelivered = materials.some((material) => material.category === "ORZECZENIE");
      if (decisionDelivered && ANALYSIS_INTENT.test(question)) {
        return { source: "SKILL", primary: "analiza-sadowa-v6", then: simpleLetters.skill, reason: `analiza dostarczonego orzeczenia, potem pismo proste (${schema.why})` };
      }
      return {
        source: "SKILL",
        primary: simpleLetters.skill,
        then: null,
        reason: `pismo proste z katalogu ${simpleLetters.skill} (${schema.why})`,
        modules: schema.resources
      };
    }
  }
  const delivered = new Set(materials.flatMap(deliveryWords));
  const pleadingDelivered = materials.some((material) => material.category === "ORZECZENIE" || material.category === "PISMO_PROCESOWE");
  const routerPick = classifyTask(routes, rawQuestion);
  const pleadingTask = routerPick?.route.primary === "pisma-procesowe-v3";
  let best: { rule: MatrixRule; score: number; why: string[] } | null = null;
  for (const rule of matrix) {
    const phrases = rule.phrases.filter((phrase) => stemPhrase(phrase)?.test(question));
    const deliveredHits = rule.delivers.filter((word) => delivered.has(word));
    if (rule.withoutPleading && pleadingDelivered) continue;
    // "Oceń szanse skargi do WSA": an assessment, not drafting ("napisz", "przygotuj").
    if (/^pisma-/.test(rule.primary) && asksAbout(question)) continue;
    // ACTIVATION-MATRIX, nakładania: "pismo + dowody + »co zrobić dalej«" -> analiza-sadowa-v6, not the guide.
    if (pleadingDelivered && rule.primary === "przewodnik-prawny-v2" && NEXT_STEP.test(question)) continue;
    // "pismo procesowe + dostarczone akta": a pleading task with case files.
    if (/pismo\s+procesowe\s*\+/iu.test(rule.signal) && !(pleadingTask && deliveredHits.length)) continue;
    if (!phrases.length && !deliveredHits.length) continue;
    // What the user asks for (a phrase of the question) outranks what was delivered;
    // a single generic word ("świadek") weighs less than a phrase, and a request to
    // analyse puts the delivered material first ("przeanalizuj protokół").
    const analysis = ANALYSIS_INTENT.test(question);
    const score =
      phrases.reduce((sum, phrase) => sum + (phrase.includes(" ") ? 100 : 40) + phrase.length, 0) +
      deliveredHits.length * (analysis ? 50 : 25) +
      (rule.then ? 30 : 0);
    if (!best || score > best.score) {
      best = { rule, score, why: [...phrases.map((phrase) => `fraza „${phrase}”`), ...deliveredHits.map((word) => `dostarczono: ${word}`)] };
    }
  }
  if (best) {
    // Asked to draft from a delivered decision / opponent's pleading ("napisz apelację" + wyrok):
    // the delivery row comes first and hands over to the drafting skill.
    const first = matrix.find(
      (rule) => rule !== best!.rule && rule.then === best!.rule.primary && rule.delivers.some((word) => delivered.has(word))
    );
    if (first && !best.rule.delivers.some((word) => delivered.has(word))) {
      return {
        source: "MATRIX",
        primary: first.primary,
        then: best.rule.primary,
        reason: `macierz aktywacji: ${first.signal} → ${best.rule.signal} (${best.why.join(", ")})`
      };
    }
    return { source: "MATRIX", primary: best.rule.primary, then: best.rule.then, reason: `macierz aktywacji: ${best.rule.signal} (${best.why.join(", ")})` };
  }
  // Matrix rows the question names in other words.
  const implied = IMPLIED_ROWS.find((row) => row.pattern.test(question) && known.has(row.primary));
  if (implied) return { source: "MATRIX", primary: implied.primary, then: null, reason: `macierz aktywacji: ${implied.row}` };
  // No matrix row: the router table on the question and the kinds of the documents.
  const byDocuments = routerPick ?? classifyTask(routes, `${rawQuestion}\n${materials.map((material) => material.label).join(" / ")}`);
  // The router row names a letter ("wezwanie do zapłaty"), but the user asks about one
  // ("dostałem wezwanie, czy muszę płacić?"): an explanation, not drafting.
  if (byDocuments && /^pisma-/.test(byDocuments.route.primary) && asksAbout(question) && known.has("przewodnik-prawny-v2")) {
    return {
      source: "ROUTER",
      primary: "przewodnik-prawny-v2",
      then: null,
      reason: `pytanie o pismo, nie prośba o jego napisanie (routing [${byDocuments.route.id}] wskazywał ${byDocuments.route.primary})`
    };
  }
  return byDocuments
    ? { source: "ROUTER", primary: byDocuments.route.primary, then: null, reason: `routing [${byDocuments.route.id}] ${byDocuments.route.title} (${byDocuments.matched.join(", ")})`, route: byDocuments.route }
    : null;
}

// ACTIVATION-MATRIX "KOMBINACJE SKILLI (entry point → pipeline)".
export type SkillCombination = { matter: string; entry: string; next: string[] };

export function parseCombinations(markdown: string): SkillCombination[] {
  const section = /## KOMBINACJE SKILLI[\s\S]*?(?=\n## |$)/u.exec(markdown)?.[0] ?? "";
  const rows: SkillCombination[] = [];
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4 || !cells[2] || !/[a-z]-v\d|min90/.test(cells[2])) continue;
    const entry = /([a-z0-9-]+-v\d+(?:-min90)?)/u.exec(cells[2])?.[1];
    // "→ a → b": the following skills; "← x (źródło)" is a data source, not a next step.
    const next = cells[3]!.trim().startsWith("→")
      ? [...cells[3]!.matchAll(/([a-z0-9-]+-v\d+(?:-min90)?)/gu)].map((match) => match[1]!)
      : [];
    if (entry) rows.push({ matter: cells[1]!, entry, next });
  }
  return rows;
}

export const PIPELINE_HANDOFF = "Następny etap pipeline'u:";

// The parts of a combination ("Przepis + pismo") that name another skill's subject
// must be in the case; the others describe the entry skill's own material.
const COMBINATION_PARTS: Array<{ part: RegExp; present: (question: string, materials: DeliveredMaterial[]) => boolean }> = [
  {
    part: /^pism/iu,
    present: (question, materials) =>
      asksToDraft(question) || /(?<![\p{L}])pism\p{L}*/iu.test(question) || materials.some((material) => material.category === "PISMO_PROCESOWE")
  },
  { part: /^orzecznictw/iu, present: (question) => CASE_LAW.test(question) },
  { part: /^wezwani/iu, present: (question, materials) => /(?<![\p{L}])wezwani\p{L}*/iu.test(question) || materials.some((material) => material.kind === "WEZWANIE") },
  { part: /^ripost/iu, present: (question) => /(?<![\p{L}])(?:ripost\p{L}*|odpowied\p{L}*\s+na)(?![\p{L}])/iu.test(question) }
];

export function combinationApplies(matter: string, question: string, materials: DeliveredMaterial[]): boolean {
  return matter
    .split("+")
    .map((part) => part.trim())
    .every((part) => COMBINATION_PARTS.find((item) => item.part.test(part))?.present(question, materials) ?? true);
}

/**
 * The next skill after this one: the matrix's own "→", else the first combination
 * it enters whose parts are in the case (no "Przepis + pismo" without a letter).
 */
export function pipelineNext(
  skill: string,
  then: string | null,
  combinations: SkillCombination[],
  context?: { question: string; materials: DeliveredMaterial[] }
): { skill: string; reason: string } | null {
  if (then) return { skill: then, reason: "macierz aktywacji (wejście → następny etap)" };
  const combination = combinations.find(
    (row) =>
      row.entry === skill &&
      row.next.length &&
      (!context || combinationApplies(row.matter, provisionsForDetection(context.question), context.materials))
  );
  return combination ? { skill: combination.next[0]!, reason: `kombinacja skilli: ${combination.matter}` } : null;
}

/** "Następny etap pipeline'u: <skill>" sent by the app's own continue button. */
export function explicitHandoff(question: string, known: (skill: string) => boolean): string | null {
  const skill = new RegExp(`${PIPELINE_HANDOFF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([a-z0-9-]+)`, "u").exec(question)?.[1];
  return skill && known(skill) ? skill : null;
}
