import { asksAbout, asksToDraft, draftingSchema, matchSchema, repliesToDemand, type SchemaEntry } from "./skill-schema-catalog.js";
import { provisionsForDetection } from "./legal-act-abbreviations.js";
import { requestIntent, requestOf, withoutRoutingMarkers } from "./request-intent.js";
import { COURT_FORMAL, COURT_POSITION } from "./document-kind.js";

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
      // The dropped form takes only an ending: "pozwu", "pozwem", not "pozwolenie".
      return dropped ? `(?:${base}|${dropped}\\p{L}{0,3}(?![\\p{L}]))` : base;
    });
  if (!words.length) return null;
  return new RegExp(`(?<![\\p{L}])${words.join("\\p{L}*\\s+")}`, "iu");
}

/**
 * The route whose phrases match the question best (longest matched phrases win;
 * [10] is the domain router, already in the context, and does not name an
 * executive skill). Null when no executive route matches.
 */
const EVIDENCE_MEDIA = /^(?:maile|sms|nagrania|faktury)$/u;
// Router [1]: a contract named as the matter's background ("brak zgodności towaru z umową")
// is not a contract to work on; [1] needs the contract as the object of the request.
const CONTRACT_NOUNS = /^(?:umowa|kontrakt|ugoda|testament)$/u;
const CONTRACT_OBJECT =
  /(?<![\p{L}])(?:(?:przeanalizuj|przeanalizować|analiz\p{L}*|sprawdź|sprawdzić|oceń|ocenić|przejrzyj|przejrzeć|zweryfikuj|zweryfikować|napisz|napisać|przygotuj|przygotować|sporządź|sporządzić|zredaguj|stwórz|negocj\p{L}*|podpis\p{L}*|zmień|zmienić|popraw\p{L}*|wypowiedz\p{L}*|rozwiąz\p{L}*)\s+(?:\p{L}+\s+){0,3}(?:umow|kontrakt|ugod|testament|owu)\p{L}*|(?:umow|kontrakt|ugod|testament)\p{L}*\s+(?:\p{L}+\s+){0,4}(?:przed\s+podpisaniem|do\s+podpisu|do\s+analizy|do\s+sprawdzenia)|klauzul\p{L}*|(?:zapis|postanowieni)\p{L}*\s+(?:tej\s+|tego\s+)?umow\p{L}*|paragraf\p{L}*|aneks\p{L}*|czy\s+(?:mogę|można)\s+(?:to\s+|tę\s+|ją\s+)?podpisać)/iu;
// Router [8]: a witness or an expert told in the story is not a questioning to prepare;
// "biegły rewident" is an auditor, not a court expert.
const WITNESS_NOUNS = /^(?:świadek|biegły)$/u;
const WITNESS_WORK = /(?<![\p{L}])(?:pytani\p{L}*|przesłuch\p{L}*|przygotow\p{L}*|zezna\p{L}*|cross|rozbi\p{L}*|krzyżow\p{L}*|podważ\p{L}*)(?![\p{L}])/iu;
const EVIDENCE_INTENT = /(?<![\p{L}])(?:dow[oó]d\p{L}*|ocen\p{L}*|oceń|przeanalizuj|analiz\p{L}*|wykorzyst\p{L}*|użyć|sprawdź|zweryfikuj)(?![\p{L}])/iu;

// "Pracuję na umowie zlecenie / o pracę": the person's employment, not a contract to analyse.
const EMPLOYMENT_BASIS = /(?<![\p{L}])na\s+umowi\p{L}*\s+(?:o\s+prac\p{L}*|o\s+dzieło|zlecen\p{L}*|b2b|śmieciow\p{L}*)/giu;

/**
 * The matched phrases that name the task, not only the matter's background: a bare
 * "maile / faktury" without a question about evidence, a contract that is not the
 * object of the request, a witness or expert told in the story (router [1], [6], [8]).
 */
function taskWords(matched: string[], question: string, delivered = ""): string[] {
  const background = (phrase: string): boolean =>
    // Delivered material ("umowa", "faktura") is the object of the work, never background.
    !(delivered && stemPhrase(phrase)?.test(delivered)) &&
    ((EVIDENCE_MEDIA.test(phrase) && !EVIDENCE_INTENT.test(question)) ||
    (CONTRACT_NOUNS.test(phrase) && !CONTRACT_OBJECT.test(question)) ||
    (WITNESS_NOUNS.test(phrase) && (!WITNESS_WORK.test(question) || /biegł\p{L}*\s+rewident/iu.test(question))));
  return matched.every(background) ? [] : matched;
}

export function classifyTask(routes: TaskRoute[], rawQuestion: string, delivered = ""): { route: TaskRoute; matched: string[] } | null {
  // "233 kk" is "art. 233 KK" for the article row.
  const question = provisionsForDetection(rawQuestion).replace(EMPLOYMENT_BASIS, " ");
  let best: { route: TaskRoute; matched: string[]; score: number } | null = null;
  for (const route of routes) {
    if (route.primary === "prawo-polskie-v2") continue;
    const matched = route.phrases.filter((phrase) => stemPhrase(phrase)?.test(question));
    if (!matched.length) continue;
    // "SMS-y i śledzenie" tells the story; "czy te SMS-y są dowodem" asks about evidence.
    if (!taskWords(matched, question, delivered).length) continue;
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
  /(?<![\p{L}])(?:(?:m[oó]j|moj\p{L}*|nasz\p{L}*|własn\p{L}*)(?:\s+\p{L}+){0,2}?\s+(?:pism\p{L}*|sprzeciw\p{L}*|skarg\p{L}*|wnios\p{L}*|pozew|pozw\p{L}*|wezwani\p{L}*|odwołani\p{L}*|zażaleni\p{L}*|apelacj\p{L}*|projekt\p{L}*|odpowied\p{L}*|zarzut\p{L}*|dokument\p{L}*|tekst\p{L}*|wersj\p{L}*|draft\p{L}*|oświadczeni\p{L}*|umow\p{L}*)|to\s+pismo|ten\s+(?:pozew|projekt)|(?:ten|nasz|m[oó]j)\s+wzór)(?![\p{L}])/iu;
const OWN_CONTRACT =
  /(?<![\p{L}])(?:m[oó]j\p{L}*|moj\p{L}*|nasz\p{L}*|t[eę]j|t[aąę]|ten|tego)(?:\s+\p{L}+){0,2}?\s+(?:umow\p{L}*|aneks\p{L}*|regulamin\p{L}*|porozumieni\p{L}*|polis\p{L}*|kontrakt\p{L}*)(?![\p{L}])/iu;

// A reply to another party's or the court's document ("odpowiedź na pozew", "odpowiedz na
// pismo przygotowawcze", "replika", "ustosunkuj się do apelacji"): a new letter, not an edit.
export const REPLY_REQUEST =
  /(?<![\p{L}])(?:(?:odpowied\p{L}*|replik\p{L}*|ripost\p{L}*|duplik\p{L}*)\s+(?:na|do)\s+(?:\p{L}+\s+){0,3}?(?:pozew|pozw\p{L}*|apelacj\p{L}*|zażaleni\p{L}*|skarg\p{L}*|pism\p{L}*|akt\p{L}*\s+oskarżenia|wezwani\p{L}*|sprzeciw\p{L}*|zarzut\p{L}*|odpowied\p{L}*|zarządzeni\p{L}*|odwołani\p{L}*|wnios\p{L}*|kasacj\p{L}*)|ustosunkuj\p{L}*\s+się\s+do|replik\p{L}*|ripost\p{L}*)(?![\p{L}])/iu;
// Documents between the parties (contracts, agreements, demands and the letters about them)
// are analysed by the contract skill (ACTIVATION-MATRIX "Dokument + wezwanie").
const DOCUMENT_ANALYSIS = "analizator-umow-v1";
// "Odpowiedz na ten dokument", "przygotuj odpowiedź", "odpisz im" with a demand delivered.
const DEMAND_REPLY = /(?<![\p{L}])(?:odpowiedz|odpowiedź|odpowiedzi|odpowiedzieć|odpisz|odpisać)(?![\p{L}])/iu;
// "Wygeneruj dokument", "generuj pismo", "przygotuj dokument" (the reply to the delivered demand).
const GENERATE_DOCUMENT =
  /(?<![\p{L}])(?:(?:wy)?generuj\p{L}*|przygotuj|napisz|sporządź|zredaguj)\s+(?:\p{L}+\s+){0,2}?(?:dokument\p{L}*|pism\p{L}*|odpowied\p{L}*)(?![\p{L}])/iu;
// "ten dokument", "to wezwanie", "tego pisma": the delivered file named.
const DOCUMENT_REF = /(?<![\p{L}])(?:ten|to|tego|tym|tej|tę|załączon\p{L}*|dołączon\p{L}*)\s+(?:dokument\p{L}*|wezwani\p{L}*|pism\p{L}*)(?![\p{L}])/iu;
// The reply is the user's own text already ("popraw moją odpowiedź", "odpowiedź, którą napisałem").
const OWN_REPLY =
  /(?<![\p{L}])(?:(?:m[oó]j\p{L}*|moj\p{L}*|nasz\p{L}*|własn\p{L}*)\s+(?:\p{L}+\s+){0,2}?(?:odpowied|replik|ripost|projekt|pism|sprzeciw|wersj|draft|tekst)\p{L}*|któr\p{L}*\s+(?:już\s+)?(?:napisał|przygotował|sporządził|zredagował)\p{L}*|to\s+pismo|ten\s+projekt|tę\s+odpowiedź|tej\s+odpowiedzi)(?![\p{L}])/iu;
// A delivered reply or preparatory letter is the user's own draft of that kind.
const REPLY_KINDS = new Set(["ODPOWIEDZ_NA_POZEW", "ODPOWIEDZ_NA_SRODEK", "PISMO_PRZYGOTOWAWCZE", "SPRZECIW"]);
// A court's summons or order named in the message ("wezwanie sądu", "zarządzenie przewodniczącego").
const COURT_SUMMONS_TEXT =
  /(?<![\p{L}])(?:(?:wezwani\p{L}*|zarządzeni\p{L}*|zobowiązani\p{L}*)\s+(?:\p{L}+\s+){0,2}?(?:sądu|sąd\p{L}*|przewodnicząc\p{L}*|referendarz\p{L}*)|(?:sąd|przewodnicząc\p{L}*|referendarz\p{L}*)\s+(?:mnie\s+|nas\s+)?(?:wezwał|zobowiązał|zarządził)\p{L}*)(?![\p{L}])/iu;
const ANSWER_WANTED =
  /(?<![\p{L}])(?:odpowied\p{L}*|odpis\p{L}*|co\s+(?:mam\s+|powinien\p{L}*\s+)?(?:napisać|złożyć|zrobić))(?![\p{L}])/iu;
// A pleading named as what to produce, and "use these documents in the claim".
const PLEADING_NOUN =
  /(?<![\p{L}])(?:pozew|pozw\p{L}*|odpowied\p{L}*\s+na|apelacj\p{L}*|zażaleni\p{L}*|skarg\p{L}*|replik\p{L}*|pism\p{L}*\s+(?:procesow|przygotowawcz)\p{L}*|wnios\p{L}*\s+dowodow\p{L}*|sprzeciw\p{L}*|zarzut\p{L}*\s+od|odwołani\p{L}*|kasacj\p{L}*|skarg\p{L}*\s+kasacyjn\p{L}*)(?![\p{L}])/iu;
const USE_IN_PLEADING =
  /(?<![\p{L}])(?:wykorzystaj|użyj|powołaj|dołącz|załącz)\p{L}*\s+(?:\p{L}+\s+){0,4}?(?:w|do)\s+(?:\p{L}+\s+)?(?:pozw|odpowiedzi|apelacj|pism|zażaleni|skarg)\p{L}*/iu;

/**
 * pisma-procesowe-v3 MODUŁY-MAPA "opponent-attack-v9 — aktywny gdy: mamy pismo przeciwnika DO
 * OBALENIA": a reply to a delivered pleading names that condition in the words of the skill's
 * module map, so the engine and its checklist are loaded with the stage's modules.
 */
export function opponentPleadingTrigger(question: string, materials: DeliveredMaterial[]): string {
  return REPLY_REQUEST.test(question) && !OWN_REPLY.test(question) && materials.some((material) => material.category === "PISMO_PROCESOWE")
    ? "analiza pisma przeciwnika: pismo przeciwnika do obalenia (odpowiedź na nie)"
    : "";
}

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
  /(?<![\p{L}])(?:orzecznictw\p{L}*|orzecznicz\p{L}*|precedens\p{L}*|sygnatur\p{L}*|(?:wyrok\p{L}*|uchwał\p{L}*|postanowieni\p{L}*|orzecze\p{L}*|orzeczeń)\s+(?:SN|NSA|WSA|TK|TSUE|ETPC\p{L}*|SA|sąd\p{L}*|Trybunał\p{L}*|Sąd\p{L}*)|(?:podaj|znajdź|wskaż|przytocz|wyszukaj|szukaj|poszukaj|szukam)\s+(?:\p{L}+,?\s+){0,4}(?:wyrok\p{L}*|orzecze\p{L}*|orzeczeń|uchwał\p{L}*)|(?:inn\p{L}*|kolejn\p{L}*|podobn\p{L}*)\s+(?:\p{L}+\s+)?(?:wyrok\p{L}*|orzecze\p{L}*|orzeczeń|uchwał\p{L}*)|jak\s+(?:to\s+)?(?:sądy|SN|NSA)\s+(?:interpretuj\p{L}*|rozumi\p{L}*|stosuj\p{L}*|orzekaj\p{L}*|wykładaj\p{L}*|ocenia\p{L}*))(?![\p{L}])/iu;
// Substantive defences of a letter (sprzeciw, zarzuty). pisma-proste-v2, "Kiedy eskalować do
// pisma-procesowe-v3 (obowiązkowo)": more than one legal basis to analyse; router v3 [4]:
// not for more than one thread. One defence (przedawnienie alone) stays a simple letter.
const DEFENCES = [
  /przedawni/u,
  /potrac/u,
  /legitymacj/u,
  /niewaznos|niewazn\w* (?:umow|czynnos|klauzul)/u,
  /niewymagaln/u,
  /abuzywn|niedozwolon\w* (?:postanowi|klauzul)/u,
  /razaco wygorowan|miarkowani/u,
  /(?:zakwestionow|kwestionuj|kwestionow|zaprzecz)\w* (?:\p{L}+ ){0,2}(?:wysokos|istnieni|zasadnos|podstaw)/u,
  /rekojm|wad\w* (?:towar|rzecz|uslug|robot)/u,
  /uchyl\w* sie od skutkow/u
];

// Terminating a contract: "wypowiedz", "napisz wypowiedzenie", "chcę wypowiedzieć".
const TERMINATION = /(?<![\p{L}])(?:wypowiedz|wypowiedzenie|wypowiedzieć|wypowiadam|wypowiedzi\p{L}*)(?![\p{L}])/iu;

const DRAFT_NOUN = /(?<![\p{L}])(?:przygotowani\p{L}*|napisani\p{L}*|sporządzeni\p{L}*|zredagowani\p{L}*)(?![\p{L}])/iu;

export function defenceCount(question: string): number {
  const text = question.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/gu, "l");
  return DEFENCES.filter((defence) => defence.test(text)).length;
}

const PASSING_DOCUMENT_ROWS = new Set(["analizator-umow-v1", "pisma-procesowe-v3", "pisma-proste-v2"]);
const QUESTION_ONLY = /\?\s*$|(?:^|[.!?]\s+)(?:chcę|chciał\p{L}*)\s+(?:zrozumieć|wiedzieć|się\s+dowiedzieć)(?![\p{L}])/iu;
const REVIEW_REQUEST = /(?<![\p{L}])(?:przeanalizuj|przejrzyj|oceń|sprawdź|zweryfikuj|przeczytaj|popraw|zbadaj|zapis\p{L}*|klauzul\p{L}*|co\s+(?:oznacza\p{L}*|znacz\p{L}*)|m(?:ój|oja|oje|ojej|ojego)\s+(?:umow|polis|regulamin|aneks)\p{L}*)(?![\p{L}])/iu;
const CASE_LAW_LOOKUP =
  /(?<![\p{L}])(?:(?:szukam|szukaj|poszukaj|potrzebuj\p{L}*|chc\p{L}*|prosił\p{L}*|znajdź|wyszukaj|podaj|wskaż|przytocz)\s+(?:\p{L}+,?\s+){0,4}(?:wyrok\p{L}*|orzecze\p{L}*|orzeczeń|orzecznictw\p{L}*|uchwał\p{L}*|sygnatur\p{L}*)|(?:inn\p{L}*|kolejn\p{L}*|podobn\p{L}*)\s+(?:\p{L}+\s+)?(?:wyrok\p{L}*|orzecze\p{L}*|orzeczeń|uchwał\p{L}*)|sygnatur\p{L}*[^.?!]{0,60}?(?:istnieje|potwierdź|czego dotyczy)|(?:sprawdź|zweryfikuj|potwierdź)\p{L}*[^.?!]{0,40}?sygnatur\p{L}*)/iu;
// "Wyrok ETPCz w sprawie Xero Flor przeciwko Polsce, co orzekł?": what a named court said in
// someone else's case, with no judgment delivered, is looked up (router [5]), not analysed.
const NAMED_JUDGMENT =
  /(?<![\p{L}])(?:co\s+(?:\p{L}+\s+){0,3}(?:orzekł\p{L}*|orzekła|rozstrzygnął|rozstrzygnęł\p{L}*|stwierdził\p{L}*|uznał\p{L}*)|o\s+czym\s+(?:jest|był)|czego\s+dotyczy(?:ł)?|przeciwko\s+Polsce|C-\d+\/\d{2})(?![\p{L}])/iu;
// A Supreme Court or NSA case number in the question ("co orzekł SN w III CZP 25/22?"); the
// repertories of common courts ("I C 900/26") are the user's own proceedings.
const TOP_COURT_SIGNATURE =
  /(?<![\p{L}])[IVX]{1,4}\s+(?:CZP|CSK|CSKP|CNP|CNPP|CZ|CO|KZP|KK|KO|KS|KZ|PK|UK|UZP|PZP|PSK|PSKP|USK|USKP|NSNc|NSNk|NSNp|OSK|FSK|GSK|OPS|OPK|FPS|GPS)\s+\d+\/\d{2}(?![\p{L}\d])/u;
// An analysis of the provision itself, besides the case law.
const PROVISION_ANALYSIS =
  /(?<![\p{L}])(?:różnic\p{L}*|porówna\p{L}*|porównaj|wykaż|przesłank\p{L}*|znamion\p{L}*|wykładni\p{L}*|omów|wyjaśnij|przeanalizuj|analiz\p{L}*|co\s+mówi)(?![\p{L}])/iu;

/**
 * ACTIVATION-MATRIX: "CEL: znaleźć / zweryfikować orzeczenie (sygnatura,
 * precedens, linia) → orzeczenia-sadowe-v2 jako PRIMARY"; with an analysis of
 * the provision as well, analizator-przepisow-v2 is the entry point and the case
 * law its next step ("kombinacja PRIMARY+SECONDARY zawsze dopuszczalna").
 */
const NAMED_OUTPUTS: ReadonlySet<string> = new Set([
  "raport-sytuacyjny-v2",
  "raport-klienta-v1",
  "chronologia-sprawy-v1",
  "przesluchanie-swiadkow-v2-min90"
]);

export function decideTask(
  routes: TaskRoute[],
  matrix: MatrixRule[],
  rawQuestion: string,
  materials: DeliveredMaterial[] = [],
  redaction: RedactionTest | null = null,
  simpleLetters: { skill: string; entries: SchemaEntry[] } | null = null
): TaskDecision | null {
  // A full case description: the closing request decides, without pasted routing markers.
  let intent: { primary: string; reason: string } | null = null;
  if (!explicitHandoff(rawQuestion, () => true)) {
    rawQuestion = requestOf(withoutRoutingMarkers(rawQuestion));
    const known = (skill: string) => routes.some((route) => route.primary === skill) || matrix.some((rule) => rule.primary === skill);
    const named = requestIntent(rawQuestion, known);
    // With delivered files the matrix row of the material decides, except for an output the
    // user names ("raport sytuacyjny tej sprawy" + akta is the report, not the court analysis).
    if (!materials.length || (named && NAMED_OUTPUTS.has(named.primary))) intent = named;
  }
  const matrixDecision = decideTaskByMatrix(routes, matrix, rawQuestion, materials, redaction, simpleLetters);
  // The table's own decision when it names the same skill (it carries the letter's schema).
  const decision =
    intent && matrixDecision?.primary !== intent.primary
      ? { source: "ROUTER" as const, primary: intent.primary, then: null, reason: `prośba użytkownika: ${intent.reason}` }
      : matrixDecision;
  if (decision?.primary === "pisma-proste-v2" && (asksToDraft(rawQuestion) || DRAFT_NOUN.test(rawQuestion)) && defenceCount(rawQuestion) >= 2) {
    return {
      source: "ROUTER",
      primary: "pisma-procesowe-v3",
      then: null,
      reason: "kilka zarzutów merytorycznych: obowiązkowa eskalacja z pisma-proste-v2 (więcej niż jedna podstawa prawna)"
    };
  }
  const caseLaw = "orzeczenia-sadowe-v2";
  const known = routes.some((route) => route.primary === caseLaw) || matrix.some((rule) => rule.primary === caseLaw);
  const question = provisionsForDetection(rawQuestion);
  if (!known || !(CASE_LAW.test(question) || (!materials.length && TOP_COURT_SIGNATURE.test(question))) || explicitHandoff(rawQuestion, () => true)) return decision;
  // "Szukam wyroków NSA o...", "Sprawdź, czy sygnatura I CSK 123/18 istnieje": a lookup, not the analysis of a judgment the user has.
  if (decision?.primary === "analiza-sadowa-v6" && (CASE_LAW_LOOKUP.test(question) || (!materials.length && (NAMED_JUDGMENT.test(question) || TOP_COURT_SIGNATURE.test(question))))) {
    return { source: "MATRIX", primary: caseLaw, then: null, reason: "macierz aktywacji: cel — znaleźć / zweryfikować orzeczenie (wyszukanie, nie analiza posiadanego)" };
  }
  if (!decision) {
    return { source: "MATRIX", primary: caseLaw, then: null, reason: "macierz aktywacji: cel — znaleźć / zweryfikować orzeczenie (sygnatura, precedens, linia)" };
  }
  if (decision.primary !== "analizator-przepisow-v2" || decision.then) return decision;
  return PROVISION_ANALYSIS.test(question)
    ? { ...decision, then: caseLaw, reason: `${decision.reason}; orzecznictwo do przepisu → ${caseLaw}` }
    : { ...decision, primary: caseLaw, reason: `macierz aktywacji: cel — orzecznictwo do przepisu (${decision.reason})` };
}

// Test A, "Użytkownik dostarczył treść GOTOWEGO pisma": an editing verb of the skill's signals
// aimed at the delivered letter ("popraw styl tego sprzeciwu", "przeredaguj wezwanie na bardziej
// stanowcze"). "zredaguj" also drafts anew, so it needs a pointer to the delivered text;
// "sprawdź" alone is a review, not an edit.
const DELIVERED_REF = /(?<![\p{L}])(?:ten|tego|tej|tę|to|tym|tą|powyższ\p{L}*|załączon\p{L}*|dołączon\p{L}*)(?![\p{L}])/iu;

function editsDelivered(question: string, materials: DeliveredMaterial[], redaction: RedactionTest | null): string | undefined {
  if (!redaction || !materials.length) return undefined;
  const verbs = [...new Set(redaction.signals.map((phrase) => phrase.split(/\s+/u)[0]!))].filter((verb) => !/^sprawd/u.test(verb));
  const verb = verbs.find((candidate) => stemPhrase(candidate)?.test(question));
  return verb && (!/^zredag/u.test(verb) || DELIVERED_REF.test(question)) ? verb : undefined;
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
  const editVerb = editsDelivered(question, materials, redaction);
  const ownSimple = simpleLetters && (OWN_DOCUMENT.test(question) || editVerb) ? matchSchema(simpleLetters.entries, question) : null;
  // The delivered letter may be that simple letter itself ("sprawdź mój sprzeciw" + the sprzeciw).
  if (ownSimple && simpleLetters && !materials.some((material) => material.category === "PISMO_PROCESOWE" && material.kind !== "SPRZECIW")) {
    return {
      source: "SKILL",
      primary: simpleLetters.skill,
      then: null,
      reason: `sprawdzenie własnego pisma prostego (${ownSimple.why}; M8 lista kontrolna)`,
      modules: ownSimple.resources
    };
  }
  // A court summons or order (router R-3.54-b): the letter follows from what it demands.
  const summons =
    materials.find((material) => material.kind?.startsWith("WEZWANIE_SADU"))?.kind ??
    (COURT_SUMMONS_TEXT.test(question)
      ? COURT_POSITION.test(question)
        ? "WEZWANIE_SADU_STANOWISKO"
        : COURT_FORMAL.test(question)
          ? "WEZWANIE_SADU_BRAKI"
          : "WEZWANIE_SADU"
      : null);
  if (summons && simpleLetters && (asksToDraft(question) || REPLY_REQUEST.test(question) || ANSWER_WANTED.test(question))) {
    return summons === "WEZWANIE_SADU_STANOWISKO"
      ? {
          source: "SKILL",
          primary: "pisma-procesowe-v3",
          then: null,
          reason: "odpowiedź na wezwanie / zarządzenie sądu żądające stanowiska, twierdzeń lub wniosków dowodowych (router R-3.54-b)"
        }
      : {
          source: "SKILL",
          primary: simpleLetters.skill,
          then: null,
          reason:
            summons === "WEZWANIE_SADU_BRAKI"
              ? "odpowiedź na wezwanie sądu do uzupełnienia braku formalnego lub złożenia dokumentu (router R-3.54-b)"
              : "odpowiedź na wezwanie sądu: odczytaj jego treść — żądanie stanowiska, twierdzeń lub dowodów to pisma-procesowe-v3 (router R-3.54-b)"
        };
  }
  // A demand between the parties delivered (przedsądowe wezwanie do zapłaty): ACTIVATION-MATRIX
  // "Dokument + wezwanie" -> analizator-umow-v1 assesses the document and what it rests on
  // (umowa, porozumienie, kara umowna); a reply asked for in any words ("odpowiedz na ten
  // dokument", "wygeneruj dokument") is its next stage, the letter of pisma-proste-v2.
  const demand = materials.some((material) => material.kind === "WEZWANIE");
  const documentSkill = known.has(DOCUMENT_ANALYSIS) ? DOCUMENT_ANALYSIS : "analizator-dowodow-v3";
  const replyWanted =
    repliesToDemand(question) ||
    // "Odpowiedź na to pismo" names the delivered demand; "popraw to pismo" is one's own text.
    (demand && (REPLY_REQUEST.test(question) || (!OWN_REPLY.test(question) && (DEMAND_REPLY.test(question) || GENERATE_DOCUMENT.test(question)))));
  if (simpleLetters && replyWanted) {
    return {
      source: "SKILL",
      primary: demand ? documentSkill : simpleLetters.skill,
      then: demand ? simpleLetters.skill : null,
      reason: demand
        ? "odpowiedź na otrzymane wezwanie (dokument między stronami): najpierw analiza wezwania i jego podstawy (macierz: Dokument + wezwanie), potem pismo (bez schematu wezwania wierzyciela SPE)"
        : "odpowiedź na wezwanie do zapłaty (pismo proste, bez schematu wezwania wierzyciela SPE)"
    };
  }
  // The demand itself assessed ("przeanalizuj ten dokument", "czy ta kara umowna jest zasadna"):
  // a document between the parties, not evidence without a letter. "Co mam zrobić" stays the guide.
  if (
    demand &&
    !NEXT_STEP.test(question) &&
    // One's own letter ("popraw to pismo", "sprawdź moje wezwanie") stays with the letter skills.
    !OWN_DOCUMENT.test(question) &&
    materials.every((material) => material.kind === "WEZWANIE" || material.category === "UMOWA") &&
    (ANALYSIS_INTENT.test(question) || REVIEW_REQUEST.test(question) || asksAbout(question) || DOCUMENT_REF.test(question))
  ) {
    return {
      source: "MATRIX",
      primary: documentSkill,
      then: null,
      reason: "macierz aktywacji: Dokument + wezwanie (analiza dokumentu między stronami i jego podstawy)"
    };
  }
  // Test A: a finished pleading delivered (or "my letter") and a request about its form.
  // A new reply to the delivered pleading ("zredaguj odpowiedź na ten pozew") is not one.
  const newReply =
    REPLY_REQUEST.test(question) && !OWN_REPLY.test(question) && !materials.some((material) => REPLY_KINDS.has(material.kind ?? ""));
  if (redaction && !NEW_SUBSTANCE.test(question) && !newReply) {
    // "Popraw zapisy w mojej umowie": the user's own contract is redacted by analizator-umow-v1
    // (REDACTION mode), not by the pleading redaction of Test A.
    const ownContract = OWN_CONTRACT.test(question) && !materials.some((material) => material.category === "PISMO_PROCESOWE");
    const ownPleading =
      !ownContract && (materials.some((material) => material.category === "PISMO_PROCESOWE") || OWN_DOCUMENT.test(question));
    // The skill's signals, and their verbs ("popraw", "zredaguj", "skróć"...) for the user's own letter.
    const verbs = [...new Set(redaction.signals.map((phrase) => phrase.split(/\s+/u)[0]!))];
    const signal =
      redaction.signals.find((phrase) => stemPhrase(phrase)?.test(question)) ??
      (OWN_DOCUMENT.test(question) ? verbs.find((verb) => stemPhrase(verb)?.test(question)) : editVerb);
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
    // "Napisz wypowiedzenie tej umowy" with the contract delivered: the kind of contract is in the
    // file, not the message; the catalogue's notice-of-termination row (pisma-proste-v2 SPN) drafts it.
    const termination =
      !schema && materials.some((material) => material.category === "UMOWA") && TERMINATION.test(question) && !asksAbout(question)
        ? simpleLetters.entries.find((entry) => /^wypowiedz/iu.test(entry.label))
        : undefined;
    if (termination) {
      return {
        source: "SKILL",
        primary: simpleLetters.skill,
        then: null,
        reason: `wypowiedzenie dostarczonej umowy (schemat ${termination.code}: rodzaj umowy z dokumentu)`,
        modules: termination.resources
      };
    }
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
    const phrases = taskWords(rule.phrases.filter((phrase) => stemPhrase(phrase)?.test(question)), question, materials.map((material) => material.label).join(" / "));
    const deliveredHits = rule.delivers.filter((word) => delivered.has(word));
    if (rule.withoutPleading && pleadingDelivered) continue;
    // "Oceń szanse skargi do WSA": an assessment, not drafting ("napisz", "przygotuj").
    if (/^pisma-/.test(rule.primary) && asksAbout(question)) continue;
    // ACTIVATION-MATRIX, nakładania: "pismo + dowody + »co zrobić dalej«" -> analiza-sadowa-v6, not the guide.
    if (pleadingDelivered && rule.primary === "przewodnik-prawny-v2" && NEXT_STEP.test(question)) continue;
    // "pismo procesowe + dostarczone akta": a pleading task with case files.
    // A question about the delivered pleading ("wyjaśnij mi ten pozew") is not drafting one.
    if (/pismo\s+procesowe\s*\+/iu.test(rule.signal) && (!(pleadingTask && deliveredHits.length) || asksAbout(question))) continue;
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
    // The material's row comes first, but the user asked for a pleading too ("przeanalizuj
    // pozew i przygotuj odpowiedź", "przygotuj pozew na podstawie faktur"): the letter is the
    // next stage, as in "pismo procesowe + dostarczone akta".
    const letter =
      !best.rule.then && ["analiza-sadowa-v6", "analizator-dowodow-v3"].includes(best.rule.primary) && PLEADING_NOUN.test(question) && !asksAbout(question) &&
      (asksToDraft(question) || DRAFT_NOUN.test(question) || REPLY_REQUEST.test(question) || USE_IN_PLEADING.test(question))
        ? simpleLetters && draftingSchema(simpleLetters.entries, question) && defenceCount(question) < 2
          ? simpleLetters.skill
          : "pisma-procesowe-v3"
        : null;
    return {
      source: "MATRIX",
      primary: best.rule.primary,
      then: best.rule.then ?? letter,
      reason: `macierz aktywacji: ${best.rule.signal} (${best.why.join(", ")})${letter ? `; pismo jako następny etap (${letter})` : ""}`
    };
  }
  // Matrix rows the question names in other words.
  const implied = IMPLIED_ROWS.find((row) => row.pattern.test(question) && known.has(row.primary));
  if (implied) return { source: "MATRIX", primary: implied.primary, then: null, reason: `macierz aktywacji: ${implied.row}` };
  // No matrix row: the router table on the question and the kinds of the documents.
  const byDocuments = routerPick ?? classifyTask(routes, `${rawQuestion}\n${materials.map((material) => material.label).join(" / ")}`, materials.map((material) => material.label).join(" / "));
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
  // A question that names a document only in passing ("Czy wykonawca, z którym gmina rozwiązała
  // umowę, może startować w przetargu?", "Skargę składa się do wojewody, prawda?"): the router row
  // matched one noun of the story; no request to draft, review or assess, so a plain answer.
  if (byDocuments && !materials.length && PASSING_DOCUMENT_ROWS.has(byDocuments.route.primary) && QUESTION_ONLY.test(question) && !asksToDraft(question) && !REVIEW_REQUEST.test(question)) return null;
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
  { part: /^ripost/iu, present: (question) => /(?<![\p{L}])(?:ripost\p{L}*|odpowied\p{L}*\s+na)(?![\p{L}])/iu.test(question) },
  // "Dowody + terminy + koszty": deadlines and costs are a subject of the case only when named.
  { part: /^termin/iu, present: (question) => /(?<![\p{L}])(?:termin\p{L}*|do\s+kiedy|przedawni\p{L}*)/iu.test(question) },
  { part: /^koszt/iu, present: (question) => /(?<![\p{L}])(?:koszt\p{L}*|opłat\p{L}*|ile\s+(?:to\s+)?kosztuj\p{L}*)/iu.test(question) }
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

/** One option offered after a result: draft the document, or one more stage of analysis. */
export type NextChoice = {
  skill: string;
  kind: "DOCUMENT" | "ANALYSIS";
  reason: string;
  // The file of this very result (a pleading of pisma-procesowe-v3, a contract redacted or
  // drafted by analizator-umow-v1), made by that skill's own pipeline and its HYBRID-VAL.
  own?: true;
  // The pipeline's step register at this point (pleading checkpoints): done, skipped with
  // the reason, still open. A file with an open or unexplained step is a draft.
  steps?: StepSummary;
};

export type StepSummary = {
  done: number;
  total: number;
  skipped: Array<{ checkpoint: string; reason?: string }>;
  open: string[];
};

/** The register of a pipeline's checkpoints, summed up for the user before a file. */
export function stepSummary(register: ReadonlyArray<{ checkpoint: string; status: string; reason?: string }>): StepSummary {
  return {
    done: register.filter((entry) => entry.status === "CLOSED").length,
    total: register.length,
    skipped: register
      .filter((entry) => entry.status === "NA")
      .map((entry) => ({ checkpoint: entry.checkpoint, ...(entry.reason?.trim() ? { reason: entry.reason.trim().slice(0, 300) } : {}) })),
    open: register.filter((entry) => entry.status === "OPEN" || entry.status === "PENDING_CONFIRMATION").map((entry) => entry.checkpoint)
  };
}

const DRAFTING_SKILL = /^pisma-/u;

/**
 * What the user may do after this skill's result, never started on its own: generate the
 * document when the result is satisfactory (one drafting skill), or go on with a further stage
 * of analysis. The matrix's "→" first, then the combinations this skill enters whose parts are
 * in the case. A reply to a demand between the parties is a simple letter (pisma-proste-v2).
 */
export function nextChoices(
  skill: string,
  then: string | null,
  combinations: SkillCombination[],
  context?: { question: string; materials: DeliveredMaterial[] },
  options: { ownDocument?: boolean; steps?: StepSummary } = {}
): NextChoice[] {
  const own: NextChoice[] = options.ownDocument
    ? [{ skill, kind: "DOCUMENT", reason: "plik z tego wyniku", own: true, ...(options.steps ? { steps: options.steps } : {}) }]
    : [];
  const demand = context?.materials.some((material) => material.kind === "WEZWANIE") ?? false;
  const found: NextChoice[] = [];
  const add = (candidate: string, reason: string) => {
    const next = demand && candidate === "pisma-procesowe-v3" ? "pisma-proste-v2" : candidate;
    if (next === skill || found.some((choice) => choice.skill === next)) return;
    found.push({ skill: next, kind: DRAFTING_SKILL.test(next) ? "DOCUMENT" : "ANALYSIS", reason });
  };
  if (then) add(then, "macierz aktywacji (wejście → następny etap)");
  for (const row of combinations) {
    if (row.entry !== skill || !row.next.length) continue;
    if (context && !combinationApplies(row.matter, provisionsForDetection(context.question), context.materials)) continue;
    for (const next of row.next) add(next, `kombinacja skilli: ${row.matter}`);
  }
  // One document to generate (the first drafting skill), and the analyses after it.
  const document = own[0] ?? found.find((choice) => choice.kind === "DOCUMENT");
  return [...(document ? [document] : []), ...found.filter((choice) => choice.kind === "ANALYSIS").slice(0, 2)];
}

/** "Następny etap pipeline'u: <skill>" sent by the app's own continue button. */
export function explicitHandoff(question: string, known: (skill: string) => boolean): string | null {
  const skill = new RegExp(`${PIPELINE_HANDOFF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([a-z0-9-]+)`, "u").exec(question)?.[1];
  return skill && known(skill) ? skill : null;
}
