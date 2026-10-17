// A long letter (a pleading, a regulation, a contract) written across several answers: one answer
// cannot hold ~20 pages under the providers' output limit (16k tokens: a 20-page claim in one
// answer ended in an error, the same claim in 5 parts had no numbering, section or attachment
// error). The model announces the split with a plan, writes part k of N per answer; the
// application keeps the plan and the parts in the case memory, checks every part (markers, the
// plan's sections and numbering, references, signature), asks for the next part with what it
// needs to continue (the plan, the last numbers, the end of the previous part) and makes one
// file of the whole.
//
// In the answer:
//   ```plan-pisma
//   {"tytul": "…", "czesci": [{"czesc": 1, "sekcje": ["I. Żądania"], "paragrafy": [1, 15], "punkty": [1, 22]}],
//    "zalaczniki": [{"nr": 1, "opis": "…"}], "pojecia": {"Umowa": "…"}}
//   ```                                   (the first part only)
//   [CZĘŚĆ 1/5]
//   … the text of the part …
//   [KONIEC CZĘŚCI 1/5]

export type LongDocumentPlanPart = {
  czesc: number;
  sekcje?: string[];
  // § numbers of the part (a regulation, a contract), inclusive.
  paragrafy?: [number, number] | null;
  // Numbered points running through the whole letter (a pleading's statement of facts).
  punkty?: [number, number] | null;
};

export type LongDocumentPlan = {
  tytul: string;
  czesci: LongDocumentPlanPart[];
  zalaczniki?: Array<{ nr: number; opis: string }>;
  pojecia?: Record<string, string>;
};

export type LongDocumentState = {
  id: string;
  plan: LongDocumentPlan;
  parts: Array<{ k: number; text: string; at: string }>;
  // The last part that failed the check: asked again with these problems.
  failed?: { k: number; problems: string[] };
  updatedAt: string;
};

export const LONG_DOCUMENT_MAX_PARTS = 12;
const MAX_PART_CHARS = 120_000;
const PLAN_BLOCK = /```plan-pisma\s*\n([\s\S]*?)\n```/u;
const PART_START = /^\s*\[CZĘŚĆ\s+(\d{1,2})\s*\/\s*(\d{1,2})\]\s*$/mu;
const PART_END = /^\s*\[KONIEC CZĘŚCI\s+(\d{1,2})\s*\/\s*(\d{1,2})\]\s*$/mu;

const range = (value: unknown): [number, number] | null =>
  Array.isArray(value) && value.length === 2 && value.every((item) => Number.isInteger(item) && item > 0) && value[0] <= value[1]
    ? [value[0] as number, value[1] as number]
    : null;

/** The plan as the model wrote it, checked: parts 1..N in order, ranges continuous. */
export function validPlan(value: unknown): LongDocumentPlan | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.czesci) || raw.czesci.length < 2 || raw.czesci.length > LONG_DOCUMENT_MAX_PARTS) return null;
  const czesci: LongDocumentPlanPart[] = [];
  for (const [index, item] of raw.czesci.entries()) {
    if (!item || typeof item !== "object") return null;
    const part = item as Record<string, unknown>;
    if (part.czesc !== index + 1) return null;
    const paragrafy = range(part.paragrafy);
    const punkty = range(part.punkty);
    czesci.push({
      czesc: index + 1,
      ...(Array.isArray(part.sekcje) ? { sekcje: part.sekcje.filter((name): name is string => typeof name === "string").slice(0, 40).map((name) => name.slice(0, 160)) } : {}),
      ...(paragrafy ? { paragrafy } : {}),
      ...(punkty ? { punkty } : {})
    });
  }
  // A range continues the previous part's (§ 16 after § 15), across parts that have none.
  for (const kind of ["paragrafy", "punkty"] as const) {
    let last = 0;
    for (const part of czesci) {
      const own = part[kind];
      if (!own) continue;
      if (last && own[0] !== last + 1) return null;
      last = own[1];
    }
  }
  const zalaczniki = Array.isArray(raw.zalaczniki)
    ? raw.zalaczniki
        .filter((item): item is { nr: number; opis: string } => Boolean(item) && Number.isInteger((item as { nr?: unknown }).nr) && typeof (item as { opis?: unknown }).opis === "string")
        .slice(0, 200)
        .map((item) => ({ nr: item.nr, opis: item.opis.slice(0, 300) }))
    : undefined;
  const pojecia =
    raw.pojecia && typeof raw.pojecia === "object" && !Array.isArray(raw.pojecia)
      ? Object.fromEntries(Object.entries(raw.pojecia as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string").slice(0, 60).map(([key, text]) => [key.slice(0, 80), text.slice(0, 300)]))
      : undefined;
  return {
    tytul: typeof raw.tytul === "string" ? raw.tytul.slice(0, 300) : "Pismo",
    czesci,
    ...(zalaczniki?.length ? { zalaczniki } : {}),
    ...(pojecia && Object.keys(pojecia).length ? { pojecia } : {})
  };
}

export type ParsedPart = { k: number; n: number; text: string; plan: LongDocumentPlan | null; planInvalid: boolean };

/** The part an answer carries: its marker, its text (without plan and markers), its plan. */
export function parsePart(answer: string): ParsedPart | null {
  const start = PART_START.exec(answer);
  if (!start) return null;
  const k = Number(start[1]);
  const n = Number(start[2]);
  if (k < 1 || n < 2 || k > n || n > LONG_DOCUMENT_MAX_PARTS) return null;
  const planMatch = PLAN_BLOCK.exec(answer);
  let plan: LongDocumentPlan | null = null;
  let planInvalid = false;
  if (planMatch) {
    try {
      plan = validPlan(JSON.parse(planMatch[1]!));
    } catch {
      plan = null;
    }
    planInvalid = !plan;
  }
  const body = answer.slice(start.index + start[0].length);
  const end = PART_END.exec(body);
  const text = (end ? body.slice(0, end.index) : body).trim().slice(0, MAX_PART_CHARS);
  return { k, n, text: end ? text : `${text}\n${UNFINISHED}`, plan, planInvalid };
}

// A part without its end marker: cut at the output limit (or the model forgot it).
const UNFINISHED = "[[CZĘŚĆ BEZ ZNACZNIKA KOŃCA]]";

const paragraphsIn = (text: string) =>
  [...text.matchAll(/^\s*(?:#{1,4}\s*|\*\*|@(?:POD)?SEKCJA:\s*)?§\s*(\d{1,4})\b/gmu)].map((match) => Number(match[1]));
// Numbered points at the start of a line ("23. Powód…"), not § and not a list inside a §'s ustępy
// when the plan numbers paragraphs (then points restart per § and are not checked).
const pointsIn = (text: string) => [...text.matchAll(/^\s*(\d{1,3})\.\s+\S/gmu)].map((match) => Number(match[1]));
const attachmentsIn = (text: string) => [...text.matchAll(/załącznik(?:u|iem|a|i)?\s+nr\s+(\d{1,3})/giu)].map((match) => Number(match[1]));
const SIGNATURE = /^\s*(?:@PODPIS\b|\*{0,2}(?:Z poważaniem|podpis|r\.\s?pr\.|adw\.|radca prawny|adwokat|pełnomocnik)\b)/imu;

export type PartCheck = { ok: boolean; problems: string[] };

/** Part k against the plan and the parts before it. */
export function checkPart(part: { k: number; n: number; text: string }, plan: LongDocumentPlan, previous: ReadonlyArray<{ k: number; text: string }>): PartCheck {
  const problems: string[] = [];
  const own = plan.czesci[part.k - 1];
  if (part.n !== plan.czesci.length) problems.push(`znacznik części mówi o ${part.n} częściach, plan ma ${plan.czesci.length}`);
  if (!own) return { ok: false, problems: [...problems, `w planie nie ma części ${part.k}`] };
  if (part.k > 1 && !previous.some((item) => item.k === part.k - 1)) problems.push(`brak części ${part.k - 1} przed częścią ${part.k}`);
  if (part.text.includes(UNFINISHED)) problems.push("część nie ma znacznika końca (ucięta albo niedokończona)");
  if (/\[ODPOWIEDŹ UCIĘTA\b/u.test(part.text)) problems.push("część ucięta na limicie długości odpowiedzi");
  const earlier = previous.filter((item) => item.k < part.k);
  if (own.paragrafy) {
    const found = paragraphsIn(part.text);
    const expected = Array.from({ length: own.paragrafy[1] - own.paragrafy[0] + 1 }, (_, index) => own.paragrafy![0] + index);
    const missing = expected.filter((number) => !found.includes(number));
    const extra = [...new Set(found.filter((number) => !expected.includes(number)))];
    const seen = new Set(earlier.flatMap((item) => paragraphsIn(item.text)));
    const repeated = [...new Set(found.filter((number) => seen.has(number)))];
    if (missing.length) problems.push(`brakuje § ${missing.slice(0, 8).join(", ")} z planu tej części`);
    if (repeated.length) problems.push(`§ ${repeated.slice(0, 8).join(", ")} powtórzony z wcześniejszej części`);
    else if (extra.length) problems.push(`§ ${extra.slice(0, 8).join(", ")} spoza planu tej części`);
    for (const [a, b] of found.slice(0, -1).map((number, index) => [number, found[index + 1]!] as const)) {
      if (b <= a) problems.push(`kolejność paragrafów: § ${a} przed § ${b}`);
    }
  }
  if (own.punkty) {
    const found = pointsIn(part.text).filter((number) => number >= own.punkty![0] - 5);
    const expected = Array.from({ length: own.punkty[1] - own.punkty[0] + 1 }, (_, index) => own.punkty![0] + index);
    const missing = expected.filter((number) => !found.includes(number));
    if (missing.length) problems.push(`brakuje punktów ${missing.slice(0, 8).join(", ")} z planu tej części`);
    const first = found.find((number) => expected.includes(number));
    if (first !== undefined && first !== own.punkty[0]) problems.push(`numeracja punktów zaczyna się od ${first}, a nie od ${own.punkty[0]}`);
    const doubled = [...new Set(found.filter((number, index) => found.indexOf(number) !== index && expected.includes(number)))];
    if (doubled.length) problems.push(`punkty ${doubled.slice(0, 8).join(", ")} powtórzone`);
  }
  const openRoman = earlier.map((item) => lastRoman(item.text)).filter(Boolean).at(-1) ?? "";
  const keys = sectionKeys(part.text, openRoman);
  for (const name of own.sekcje ?? []) {
    const key = sectionKey(name);
    if (key && !keys.has(key)) problems.push(`brak sekcji „${name}” z planu tej części`);
  }
  const otherSections = plan.czesci.filter((item) => item.czesc !== part.k).flatMap((item) => item.sekcje ?? []).map(sectionKey).filter(Boolean);
  const mine = new Set((own.sekcje ?? []).map(sectionKey));
  const foreign = [...keys].filter((key) => otherSections.includes(key) && !mine.has(key));
  if (foreign.length) problems.push(`sekcja z innej części planu: ${foreign.slice(0, 4).join(", ")}`);
  if (plan.zalaczniki?.length) {
    const known = new Set(plan.zalaczniki.map((item) => item.nr));
    const unknown = [...new Set(attachmentsIn(part.text).filter((number) => !known.has(number)))];
    if (unknown.length) problems.push(`odesłanie do załącznika nr ${unknown.slice(0, 6).join(", ")}, którego nie ma w planie`);
  }
  const last = part.k === plan.czesci.length;
  const signed = SIGNATURE.test(part.text.split("\n").slice(-12).join("\n"));
  if (!last && /^\s*@PODPIS\b/mu.test(part.text)) problems.push("podpis przed ostatnią częścią");
  if (last && !signed) problems.push("ostatnia część bez podpisu");
  return { ok: problems.length === 0, problems };
}

// "III.4 Bezzasadność kar umownych", "## III. 4. …", "**IV. Załączniki**" -> "iii.4" / "iv".
function sectionKey(name: string): string {
  const match = /^\s*(?:#{1,4}\s*|\*\*|@(?:POD)?SEKCJA:\s*)?([IVXL]+)\s*\.?\s*(?:(\d{1,2})\s*[.)]?)?/u.exec(name);
  return match ? `${match[1]!.toLowerCase()}${match[2] ? `.${match[2]}` : ""}` : "";
}

// The last Roman section a text opened ("III" when part 3 goes on with "3. Faktury…").
function lastRoman(text: string): string {
  return [...text.matchAll(/^\s*(?:#{1,4}\s*|\*\*|@(?:POD)?SEKCJA:\s*)([IVXL]+)\s*\./gmu)].at(-1)?.[1]?.toLowerCase() ?? "";
}

function sectionKeys(text: string, openRoman = ""): Set<string> {
  const keys = new Set<string>();
  let roman = openRoman;
  for (const line of text.split("\n")) {
    const heading = /^\s*(?:#{1,4}\s*|\*\*|@(?:POD)?SEKCJA:\s*)([IVXL]+)\s*\.\s*(?:(\d{1,2})\s*[.)]\s*)?/u.exec(line);
    if (heading) {
      roman = heading[1]!.toLowerCase();
      keys.add(roman);
      if (heading[2]) keys.add(`${roman}.${heading[2]}`);
      continue;
    }
    // A subsection under the current Roman section: "### 4. Bezzasadność…", "@SEKCJA: 4. …".
    const sub = /^\s*(?:#{2,4}\s*|@(?:POD)?SEKCJA:\s*|\*\*)(\d{1,2})\s*[.)]\s+\S/u.exec(line);
    if (sub && roman) keys.add(`${roman}.${sub[1]}`);
  }
  return keys;
}

/** The whole letter from its parts, in order, without plan and markers. */
export function joinParts(state: Pick<LongDocumentState, "parts">): string {
  return [...state.parts]
    .sort((a, b) => a.k - b.k)
    .map((part) => part.text.replace(UNFINISHED, "").trim())
    .join("\n\n");
}

export function isComplete(state: LongDocumentState): boolean {
  return state.plan.czesci.every((part) => state.parts.some((item) => item.k === part.czesc));
}

/** The state after part k: the part replaces an earlier version of itself and any later part. */
export function withPart(state: LongDocumentState, part: { k: number; text: string }, now: string): LongDocumentState {
  return {
    ...state,
    parts: [...state.parts.filter((item) => item.k < part.k), { k: part.k, text: part.text, at: now }],
    updatedAt: now
  };
}

export function validLongDocument(value: unknown): LongDocumentState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const plan = validPlan(raw.plan);
  if (!plan || typeof raw.id !== "string" || typeof raw.updatedAt !== "string" || !Array.isArray(raw.parts)) return null;
  const parts = raw.parts
    .filter((item): item is { k: number; text: string; at: string } => Boolean(item) && Number.isInteger((item as { k?: unknown }).k) && typeof (item as { text?: unknown }).text === "string")
    .map((item) => ({ k: item.k, text: item.text.slice(0, MAX_PART_CHARS), at: typeof item.at === "string" ? item.at : raw.updatedAt as string }))
    .filter((item) => item.k >= 1 && item.k <= plan.czesci.length);
  const failed = raw.failed as { k?: unknown; problems?: unknown } | undefined;
  return {
    id: raw.id.slice(0, 64),
    plan,
    parts,
    ...(failed && Number.isInteger(failed.k) && Array.isArray(failed.problems)
      ? { failed: { k: failed.k as number, problems: failed.problems.filter((item): item is string => typeof item === "string").slice(0, 20).map((item) => item.slice(0, 300)) } }
      : {}),
    updatedAt: raw.updatedAt
  };
}

/** The part to write next: the failed one again, else the first not written. */
export function nextPart(state: LongDocumentState): number | null {
  if (state.failed) return state.failed.k;
  const missing = state.plan.czesci.find((part) => !state.parts.some((item) => item.k === part.czesc));
  return missing ? missing.czesc : null;
}

// "Kontynuuj", "napisz część 3 z 5", "dalej": the user (or the application) asks for the next part.
const CONTINUE_REQUEST = /^\s*(?:kontynuuj|dalej|ci[aą]g dalszy|napisz\s+(?:kolejn[aą]|nast[eę]pn[aą])\s+cz[eę][śs][ćc])\b|\bcz[eę][śs][ćc]\s+(\d{1,2})\s+z\s+(\d{1,2})\b/iu;

/** The user's latest message of a conversation sent as one query ("…\n\nUżytkownik: …"). */
export function latestUserMessage(query: string): string {
  const marker = query.lastIndexOf("Użytkownik: ");
  return (marker >= 0 ? query.slice(marker + "Użytkownik: ".length) : query).trim();
}

/** The part a message asks for, or null when it is about something else. */
export function requestedPart(query: string, state: LongDocumentState): number | null {
  const match = CONTINUE_REQUEST.exec(query.slice(0, 400));
  if (!match) return null;
  const named = match[1] ? Number(match[1]) : null;
  if (named && match[2] && Number(match[2]) === state.plan.czesci.length && named >= 1 && named <= state.plan.czesci.length) return named;
  return nextPart(state);
}

/** The answer as the chat shows it: no plan block and markers, a heading "Część k z N". */
export function presentPart(answer: string, part: { k: number; n: number }, title: string): string {
  return answer
    .replace(PLAN_BLOCK, "")
    // Its own paragraph: a heading glued to the sentence before it renders inside that paragraph.
    .replace(PART_START, `\n\n**Część ${part.k} z ${part.n} — ${title}**\n\n`)
    .replace(PART_END, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** What the model gets to write part k (the application's record, not the model's memory). */
export function continuationBlock(state: LongDocumentState, k: number, problems: readonly string[] = []): string {
  const n = state.plan.czesci.length;
  const previous = [...state.parts].sort((a, b) => a.k - b.k).filter((item) => item.k < k);
  const lastText = previous.at(-1)?.text.replace(UNFINISHED, "") ?? "";
  const lastParagraph = previous.flatMap((item) => paragraphsIn(item.text)).at(-1);
  const lastPoint = state.plan.czesci.slice(0, k - 1).map((item) => item.punkty?.[1]).filter((value): value is number => Boolean(value)).at(-1);
  return [
    `# DŁUGIE PISMO — CZĘŚĆ ${k} Z ${n} (rejestr aplikacji)`,
    `Piszesz WYŁĄCZNIE część ${k} z ${n} pisma „${state.plan.tytul}”, według planu poniżej (plan jest ustalony: nie zmieniaj go i nie powtarzaj go w odpowiedzi).`,
    "PLAN:",
    "```json",
    JSON.stringify(state.plan),
    "```",
    `Pierwsza linia odpowiedzi: [CZĘŚĆ ${k}/${n}]. Ostatnia linia: [KONIEC CZĘŚCI ${k}/${n}].`,
    "Tylko sekcje i numery z planu tej części, w tej kolejności; nie powtarzaj niczego z wcześniejszych części; poprawne pojęcia i numery załączników z planu.",
    k < n ? "Bez podpisu i bez listy załączników: pismo będzie kontynuowane." : "To ostatnia część: zakończ pismo (lista załączników wg planu, jeśli jest) i podpisem.",
    ...(lastParagraph ? [`Ostatni paragraf poprzednich części: § ${lastParagraph}.`] : []),
    ...(lastPoint ? [`Ostatni punkt poprzednich części: ${lastPoint}.`] : []),
    ...(lastText ? ["Koniec poprzedniej części (dla ciągłości, nie powtarzaj):", lastText.slice(-1500)] : []),
    ...(problems.length ? [`POPRAW poprzednią wersję tej części: ${problems.join("; ")}.`] : []),
    `# KONIEC BLOKU CZĘŚCI ${k} Z ${n}`
  ].join("\n");
}

/** A message naming a part ("Kontynuuj: napisz część 2 z 3.", "Popraw część 3 z 3."): legal work. */
export function namesDocumentPart(message: string): boolean {
  return /\bcz[eę][śs][ćc]\s+\d{1,2}\s+z\s+\d{1,2}\b/iu.test(message);
}

/** The rule the model follows for a long letter (the system prompt of drafting turns). */
export const LONG_DOCUMENT_RULE = [
  "DŁUGIE PISMO (aplikacja): jeśli pismo, regulamin albo umowa przekroczą ok. 10 stron (ok. 20 000 znaków), nie pisz ich w jednej odpowiedzi — limit długości odpowiedzi je utnie.",
  "Zamiast tego w pierwszej odpowiedzi: jedno zdanie, że pismo jest długie i powstanie w N częściach; blok ```plan-pisma z JSON {\"tytul\", \"czesci\": [{\"czesc\": 1, \"sekcje\": [...], \"paragrafy\": [od, do] albo \"punkty\": [od, do]}], \"zalaczniki\": [{\"nr\", \"opis\"}], \"pojecia\": {...}} (2–12 części po ok. 6–8 stron, numeracja ciągła przez części, lista załączników kompletna); potem [CZĘŚĆ 1/N], tekst części 1 i [KONIEC CZĘŚCI 1/N].",
  "Kolejne części piszesz, gdy aplikacja poda blok „DŁUGIE PISMO — CZĘŚĆ k Z N”: tylko ta część, z markerami. Krótsze pisma piszesz jak dotąd, w jednej odpowiedzi."
].join("\n");

// A line where a long text may be cut for its conversion into a file: a heading or a section.
const CUT_LINE = /^\s*(?:@(?:POD)?SEKCJA:|@TYTUL:|@PODPIS:|@ZALACZNIKI:|#{1,4}\s|§\s*\d|\*\*[^*]+\*\*\s*$|[IVXL]+\.\s+\S|Art\.\s*\d|Rozdział\s+\w)/u;

/**
 * A long text cut into pieces of at most `maxChars` for its conversion into a file, at section
 * boundaries (else at a paragraph), never inside one: each piece is a whole run of units.
 */
export function splitSourceText(text: string, maxChars = 14_000): string[] {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const pieces: string[] = [];
  let current: string[] = [];
  let size = 0;
  let lastCut = -1;
  let lastBlank = -1;
  const flush = (upTo: number) => {
    pieces.push(current.slice(0, upTo).join("\n").trim());
    current = current.slice(upTo);
    size = current.reduce((sum, line) => sum + line.length + 1, 0);
    lastCut = -1;
    lastBlank = -1;
  };
  for (const line of lines) {
    if (current.length && CUT_LINE.test(line)) lastCut = current.length;
    if (current.length && !line.trim()) lastBlank = current.length;
    current.push(line);
    size += line.length + 1;
    if (size > maxChars) {
      const at = lastCut > 0 ? lastCut : lastBlank > 0 ? lastBlank : current.length - 1;
      flush(Math.max(1, at));
    }
  }
  if (current.join("").trim()) pieces.push(current.join("\n").trim());
  return pieces.filter(Boolean);
}

const words = (value: string) =>
  value
    .toLocaleLowerCase("pl")
    .replace(/\[[^\]]*\]/gu, " ")
    .match(/[\p{L}\d]{3,}/gu) ?? [];

/** The share of a source piece's words its converted text keeps (a dropped paragraph shows). */
export function wordCoverage(source: string, converted: string): number {
  const have = new Map<string, number>();
  for (const word of words(converted)) have.set(word, (have.get(word) ?? 0) + 1);
  const wanted = words(source);
  if (!wanted.length) return 1;
  let kept = 0;
  for (const word of wanted) {
    const count = have.get(word) ?? 0;
    if (count > 0) {
      kept += 1;
      have.set(word, count - 1);
    }
  }
  return kept / wanted.length;
}
