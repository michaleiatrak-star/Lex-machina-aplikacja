// The case register (user 2026-11-27, "zrób 1-3"): participants, events and facts of the case,
// gathered from its documents turn by turn without a model call (so it costs no time and works with
// every model), kept in the encrypted case memory, and given to every later turn of the case as a
// short block: who is who, what happened when, and the facts the question is about.
//
// Built from the case's own documents under the case's shared key only: their placeholders
// ([PII:PERSON:0001]) are the same in every turn, so the register never names a person and never
// mixes two people up. Each entry keeps its document and chunk, and a chunk read again replaces
// what it gave before (a document read in parts fills the register part by part).

export type RegisterSource = { documentId: string; chunkIndex: number };

export type RegisterParticipant = {
  symbol: string;
  kind: "OSOBA" | "PODMIOT";
  roles: string[];
  sources: RegisterSource[];
};

export type RegisterEvent = RegisterSource & { date: string; text: string };

export type RegisterFact = RegisterSource & {
  kind: "KWOTA" | "TWIERDZENIE" | "USTALENIE" | "ZEZNANIE";
  // Who states it: a party (claim), the court or an expert (finding), a witness (testimony).
  speaker: string;
  text: string;
};

export type CaseRegister = {
  schemaVersion: 1;
  updatedAt: string;
  documents: Record<string, { label: string; chunks: number[] }>;
  participants: RegisterParticipant[];
  events: RegisterEvent[];
  facts: RegisterFact[];
};

export const REGISTER_LIMITS = { documents: 200, participants: 200, events: 400, facts: 600, text: 320 };

export type RegisterDocument = { documentId: string; label: string; chunks: ReadonlyArray<{ index: number; text: string }> };

const fold = (text: string): string =>
  text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/ł/gu, "l");

const TOKEN = /\[PII:(PERSON|FIRM|ORG|ORGANIZATION|COMPANY|INSTITUTION):(\d{4})(?:\|[A-Z]{2,4})?\]/gu;
const symbolOf = (type: string, number: string) => `[PII:${type}:${number}]`;

// Roles a document gives a person or an entity, read just before (or right after) its placeholder.
const ROLES: Array<[RegExp, string]> = [
  [/powod(?:a|owi|em|zie)?\b|powodk\w*|powód/u, "powód"],
  [/pozwan\w*/u, "pozwany"],
  [/oskarzon\w*/u, "oskarżony"],
  [/podejrzan\w*/u, "podejrzany"],
  [/pokrzywdzon\w*/u, "pokrzywdzony"],
  [/oskarzyci\w* posilkow\w*/u, "oskarżyciel posiłkowy"],
  [/wnioskodawc\w*/u, "wnioskodawca"],
  [/uczestni\w* postepowania|uczestnik\w*/u, "uczestnik"],
  [/swiad\w*/u, "świadek"],
  [/bieg\w*/u, "biegły"],
  [/pelnomocni\w*/u, "pełnomocnik"],
  [/obronc\w*/u, "obrońca"],
  [/adwokat\w*|radc\w* prawn\w*|r\.pr\.|adw\./u, "zawodowy pełnomocnik"],
  [/sedzi\w*|przewodnicz\w*|ssr\b|sso\b|ssa\b/u, "sędzia"],
  [/prokurator\w*/u, "prokurator"],
  [/komornik\w*/u, "komornik"],
  [/kierowni\w* budowy/u, "kierownik budowy"],
  [/pracodawc\w*/u, "pracodawca"],
  [/pracowni\w*/u, "pracownik"],
  [/wynajmujac\w*/u, "wynajmujący"],
  [/najemc\w*/u, "najemca"],
  [/zamawiajac\w*/u, "zamawiający"],
  [/wykonawc\w*/u, "wykonawca"],
  [/sprzedawc\w*|sprzedajac\w*/u, "sprzedawca"],
  [/kupujac\w*|nabywc\w*/u, "kupujący"],
  [/dluzni\w*/u, "dłużnik"],
  [/wierzyciel\w*/u, "wierzyciel"],
  [/prezes\w* zarzadu|czlon\w* zarzadu/u, "członek zarządu"],
  [/\b(?:ojc\w*|ojciec|matk\w*|syn|syna|synem|synowi|cork\w*|malzon\w*|zona|zony|zona|maz|meza|mezem|brat|brata|bratem|siostr\w*)\b/u, "osoba bliska"]
];

// The role word must stand right before the placeholder ("Powód: [PII]", "świadek [PII]", "pan [PII]"
// after "świadek") or in an apposition right after it ("[PII], kierownik budowy,"); "z powództwa [PII]"
// is the claimant, "przeciwko [PII]" the defendant. A role word further away belongs to someone else
// ("Na pytanie pełnomocnika powoda: Pan [PII]…" names no role of that person).
function rolesNear(text: string, at: number, end: number): string[] {
  const before = fold(text.slice(Math.max(0, at - 60), at)).replace(/\s+/gu, " ");
  const after = fold(text.slice(end, end + 50)).replace(/\s+/gu, " ");
  const found = new Set<string>();
  if (/z powodztwa\s*$/u.test(before)) found.add("powód");
  if (/przeciwko\s*$/u.test(before)) found.add("pozwany");
  // "Na pytanie pełnomocnika powoda: Pan [PII]" — the asker's role, not this person's.
  const asked = /na pytani\w*[^:]{0,60}:\s*(?:pan|pani)?\s*$/u.test(before);
  const tail = asked ? "" : /([\p{L}.]+(?: [\p{L}.]+)?)\s*[:,]?\s*(?:pan|pani|panu|pana)?\s*$/u.exec(before)?.[1] ?? "";
  const apposition = /^\s*,\s*(?:lat \d+\s*,\s*)?([^,.;:\n]{3,30})/u.exec(after)?.[1] ?? "";
  for (const [pattern, role] of ROLES) {
    if ((tail && pattern.test(tail)) || (apposition && pattern.test(apposition))) found.add(role);
  }
  return [...found];
}

// Dates in the forms the documents use: 15 marca 2025 r., 15.03.2025, 2025-03-15; a month and a year.
const MONTHS: Record<string, number> = {
  styczni: 1, stycz: 1, lut: 2, marc: 3, kwietni: 4, maj: 5, czerw: 6, lip: 7, sierpni: 8, wrzesni: 9, pazdziernik: 10, listopad: 11, grudni: 12
};
const WORD_DATE = /(?<!\d)(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrzesnia|września|pazdziernika|października|listopada|grudnia)\s+(\d{4})/giu;
const NUMERIC_DATE = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?![\d])/gu;
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/gu;

function monthOf(word: string): number | null {
  const folded = fold(word);
  for (const [stem, value] of Object.entries(MONTHS)) if (folded.startsWith(stem)) return value;
  return null;
}

const iso = (year: number, month: number, day: number): string | null =>
  month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900 && year <= 2100
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;

export function datesIn(sentence: string): string[] {
  const dates = new Set<string>();
  for (const match of sentence.matchAll(WORD_DATE)) {
    const value = iso(Number(match[3]), monthOf(match[2]!) ?? 0, Number(match[1]));
    if (value) dates.add(value);
  }
  for (const match of sentence.matchAll(NUMERIC_DATE)) {
    const value = iso(Number(match[3]), Number(match[2]), Number(match[1]));
    if (value) dates.add(value);
  }
  for (const match of sentence.matchAll(ISO_DATE)) {
    const value = iso(Number(match[1]), Number(match[2]), Number(match[3]));
    if (value) dates.add(value);
  }
  return [...dates];
}

// A sentence that only carries the document's date or a signature line is no event of the case.
const NO_EVENT = /^(?:sygn\.|dnia\s+\d|warszawa|krakow|lodz|poznan|wroclaw|gdansk|\[strona|dziennik ustaw)|wyrok w imieniu|protokol rozprawy z dnia\s+\d+\s+\w+\s+\d{4}\s*r?\.?$/u;

const MONEY = /\d[\d\s\u00a0]*(?:,\d{2})?\s*(?:zł|złotych|pln|eur|euro)(?![\p{L}])/iu;

// Who a sentence is said by: the court or an expert (finding), a party (claim), a witness (testimony).
const FINDING = /^(?:sad\w*\s+(?:ustalil|zwazyl|uznal|przyjal|stwierdzil|nie rozwazyl|oddalil|zasadzil|postanowil|dopuscil)|biegl\w*\s+(?:stwierdzil|ustalil|wskazal|ocenil|wyliczyl)|w ocenie sadu|zdaniem sadu)/u;
const CLAIM = /^(?:(powod\w*|pozwan\w*|wnioskodawc\w*|uczestni\w*|oskarzon\w*|obronc\w*|oskarzyci\w*|prokurator\w*|skarzac\w*|strona\s+\w+)\s+(?:twierdzi|twierdzil\w*|wnosi|wniosl\w*|wnies\w*|podnosi|podniosl\w*|zarzuca|zarzucil\w*|przyznaje|przyznal\w*|zaprzecza|zaprzeczyl\w*|domaga|zadal\w*|zada|wskazuje|wskazal\w*|oswiadcza|oswiadczyl\w*|kwestionuje|zakwestionowal\w*|zlozyl\w*|sklada|zglosil\w*|zglasza|odmowil\w*|odmawia)|wnosze\b|wnosimy\b|wnosi sie\b)/u;
const TESTIMONY = /\b(?:zeznal\w*|zeznaje|zeznania? swiad\w*|swiad\w*\s+(?:zeznal|podal|wskazal|potwierdzil))\b/u;
// A first-person sentence of a hearing record ("Byłem kierownikiem…", "Pęknięcia zobaczyłem…").
const FIRST_PERSON = /\b\w+(?:lem|lam|ilem|ilam|alem|alam)\b/u;

const COURT_SAYS = /\bsad\w*\s+(?:ustalil|zwazyl|uznal|przyjal|stwierdzil|nie rozwazyl|nie dal wiary|dal wiare|ocenil)/u;
function speakerOf(folded: string, record: string): { kind: RegisterFact["kind"]; speaker: string } | null {
  if (FINDING.test(folded)) return { kind: "USTALENIE", speaker: /^biegl/u.test(folded) ? "biegły" : "sąd" };
  // In a judgment's reasons the court assesses a witness or a claim: its finding, not the testimony.
  if (/wyrok|postanowien|uzasadnien/u.test(record) && COURT_SAYS.test(folded)) return { kind: "USTALENIE", speaker: "sąd" };
  const claim = CLAIM.exec(folded);
  if (claim) {
    const subject = claim[1] ?? "";
    const speaker = /^powod/u.test(subject) || /^wnosze|^wnosimy/u.test(folded) && /pozew/u.test(record) ? "powód"
      : /^pozwan/u.test(subject) ? "pozwany"
      : /^oskarzon|^obronc/u.test(subject) ? "oskarżony (obrona)"
      : /^oskarzyci|^prokurator/u.test(subject) ? "oskarżyciel"
      : subject || "strona";
    return { kind: "TWIERDZENIE", speaker };
  }
  if (TESTIMONY.test(folded) || (/protokol|zeznan/u.test(record) && FIRST_PERSON.test(folded))) return { kind: "ZEZNANIE", speaker: "świadek" };
  return null;
}

function sentences(text: string): string[] {
  return text
    .replace(/\[STRONA \d+[^\]]*\]/gu, " ")
    .split(/(?<=[.!?])(?<!(?:^|[\s(])(?:ul|nr|art|pkt|ust|tj|tzw|godz|al|pl|ok|lit|poz|sygn|zob|por|ws|k\.k|k\.c|k\.p|k\.p\.c|k\.p\.k|k\.r\.o|m\.in|sp|o\.o|s\.a|dr|prof|mgr|inż|adw|r\.pr|ss[rao])\.)\s+(?=[\p{Lu}\d„"])|\n{2,}|\n(?=\s*(?:\d+\.|[-•]|§)\s)|(?<=[^\p{Ll},\-–\s])\s*\n(?=\s*\p{Lu})/u)
    .map((item) => item.replace(/\s+/gu, " ").trim())
    .filter((item) => item.length >= 12);
}

const clip = (text: string) => (text.length > REGISTER_LIMITS.text ? `${text.slice(0, REGISTER_LIMITS.text - 1)}…` : text);

/** What one chunk of a document gives the register. */
export function chunkEntries(
  document: RegisterDocument,
  chunk: { index: number; text: string }
): { participants: RegisterParticipant[]; events: RegisterEvent[]; facts: RegisterFact[] } {
  const source = { documentId: document.documentId, chunkIndex: chunk.index };
  const participants = new Map<string, RegisterParticipant>();
  for (const match of chunk.text.matchAll(TOKEN)) {
    const symbol = symbolOf(match[1]!, match[2]!);
    const item = participants.get(symbol) ?? { symbol, kind: match[1] === "PERSON" ? "OSOBA" as const : "PODMIOT" as const, roles: [], sources: [source] };
    for (const role of rolesNear(chunk.text, match.index!, match.index! + match[0].length)) if (!item.roles.includes(role)) item.roles.push(role);
    participants.set(symbol, item);
  }
  const events: RegisterEvent[] = [];
  const facts: RegisterFact[] = [];
  const record = fold(document.label);
  for (const sentence of sentences(chunk.text)) {
    const folded = fold(sentence);
    const plain = sentence.replace(/\|[A-Z]{2,4}\]/gu, "]");
    // A list of dates (the evidence of a statement of claim) is no event; one sentence, its first date.
    const dates = datesIn(sentence);
    if (!NO_EVENT.test(folded) && dates.length >= 1 && dates.length <= 2) events.push({ ...source, date: dates[0]!, text: clip(plain) });
    const said = speakerOf(folded, record);
    if (said) facts.push({ ...source, kind: said.kind, speaker: said.speaker, text: clip(plain) });
    else if (MONEY.test(sentence)) facts.push({ ...source, kind: "KWOTA", speaker: /pozew|powod/u.test(record) ? "powód (pozew)" : /odpowiedz/u.test(record) ? "pozwany (odpowiedź)" : /wyrok|postanowien|uzasadnien/u.test(record) ? "sąd" : "dokument", text: clip(plain) });
  }
  return { participants: [...participants.values()], events, facts };
}

export function emptyRegister(now = new Date().toISOString()): CaseRegister {
  return { schemaVersion: 1, updatedAt: now, documents: {}, participants: [], events: [], facts: [] };
}

const sameSource = (a: RegisterSource, documentId: string, chunks: ReadonlySet<number>) => a.documentId === documentId && chunks.has(a.chunkIndex);

/** The register with these documents' chunks read again: what they gave before is replaced. */
export function updateRegister(previous: CaseRegister | null, documents: readonly RegisterDocument[], now = new Date().toISOString()): CaseRegister {
  const register: CaseRegister = previous
    ? { ...previous, documents: { ...previous.documents }, participants: previous.participants.map((item) => ({ ...item, roles: [...item.roles], sources: [...item.sources] })), events: [...previous.events], facts: [...previous.facts] }
    : emptyRegister(now);
  for (const document of documents) {
    if (!document.chunks.length) continue;
    const read = new Set(document.chunks.map((chunk) => chunk.index));
    register.events = register.events.filter((item) => !sameSource(item, document.documentId, read));
    register.facts = register.facts.filter((item) => !sameSource(item, document.documentId, read));
    for (const participant of register.participants) participant.sources = participant.sources.filter((item) => !sameSource(item, document.documentId, read));
    const known = register.documents[document.documentId];
    register.documents[document.documentId] = { label: document.label, chunks: [...new Set([...(known?.chunks ?? []), ...read])].sort((a, b) => a - b) };
    for (const chunk of document.chunks) {
      const entries = chunkEntries(document, chunk);
      register.events.push(...entries.events);
      register.facts.push(...entries.facts);
      for (const found of entries.participants) {
        const item = register.participants.find((other) => other.symbol === found.symbol);
        if (!item) register.participants.push(found);
        else {
          for (const role of found.roles) if (!item.roles.includes(role)) item.roles.push(role);
          item.sources.push(...found.sources);
        }
      }
    }
  }
  register.participants = register.participants.filter((item) => item.sources.length > 0).slice(0, REGISTER_LIMITS.participants);
  const seen = new Set<string>();
  register.events = register.events
    .filter((item) => {
      const key = `${item.date}|${fold(item.text)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, REGISTER_LIMITS.events);
  const facts = new Set<string>();
  register.facts = register.facts.filter((item) => {
    const key = fold(item.text);
    if (facts.has(key)) return false;
    facts.add(key);
    return true;
  }).slice(0, REGISTER_LIMITS.facts);
  const ids = Object.keys(register.documents);
  if (ids.length > REGISTER_LIMITS.documents) for (const id of ids.slice(0, ids.length - REGISTER_LIMITS.documents)) delete register.documents[id];
  register.updatedAt = now;
  return register;
}

/** A document removed from the case: its entries go too. */
export function withoutDocument(register: CaseRegister, documentId: string, now = new Date().toISOString()): CaseRegister {
  const documents = { ...register.documents };
  delete documents[documentId];
  return {
    ...register,
    updatedAt: now,
    documents,
    events: register.events.filter((item) => item.documentId !== documentId),
    facts: register.facts.filter((item) => item.documentId !== documentId),
    participants: register.participants
      .map((item) => ({ ...item, sources: item.sources.filter((source) => source.documentId !== documentId) }))
      .filter((item) => item.sources.length > 0)
  };
}

export function validCaseRegister(value: unknown): CaseRegister | null {
  const item = value as Partial<CaseRegister> | null;
  if (!item || typeof item !== "object" || item.schemaVersion !== 1 || typeof item.updatedAt !== "string") return null;
  if (!item.documents || typeof item.documents !== "object" || !Array.isArray(item.participants) || !Array.isArray(item.events) || !Array.isArray(item.facts)) return null;
  const source = (entry: Partial<RegisterSource>) => typeof entry.documentId === "string" && Number.isInteger(entry.chunkIndex);
  const text = (entry: { text?: unknown }) => typeof entry.text === "string" && entry.text.length <= REGISTER_LIMITS.text + 1;
  if (item.participants.length > REGISTER_LIMITS.participants || item.events.length > REGISTER_LIMITS.events || item.facts.length > REGISTER_LIMITS.facts) return null;
  if (!item.participants.every((entry) => typeof entry.symbol === "string" && /^\[PII:[A-Z]+:\d{4}\]$/u.test(entry.symbol) && Array.isArray(entry.roles) && Array.isArray(entry.sources) && entry.sources.every(source))) return null;
  if (!item.events.every((entry) => source(entry) && text(entry) && /^\d{4}-\d{2}-\d{2}$/u.test(String(entry.date)))) return null;
  if (!item.facts.every((entry) => source(entry) && text(entry) && typeof entry.speaker === "string" && ["KWOTA", "TWIERDZENIE", "USTALENIE", "ZEZNANIE"].includes(String(entry.kind)))) return null;
  return item as CaseRegister;
}

// Words of the question that pick the facts and events it is about (no stop words, no short words).
const STOP = new Set(["ktory", "ktora", "ktore", "jaki", "jaka", "jakie", "czy", "jest", "sprawie", "sprawy", "tej", "tego", "oraz", "przez", "jako", "kiedy", "gdzie", "dlaczego", "moze", "mozna", "powinien", "prosze", "napisz", "przygotuj", "przeanalizuj", "analiza", "pytania", "pytanie"]);
function questionStems(question: string): string[] {
  return [...new Set(fold(question).split(/[^\p{L}\d]+/u).filter((word) => word.length >= 4 && !STOP.has(word)).map((word) => word.slice(0, Math.max(4, word.length - 3))))];
}

const score = (text: string, stems: readonly string[]) => {
  const folded = fold(text);
  return stems.reduce((sum, stem) => sum + (folded.includes(stem) ? 1 : 0), 0);
};

/**
 * The block a turn of the case gets: every participant with roles, the events (all when they fit,
 * else those the question names, then the latest), the facts the question is about. Each line
 * names its document, so the model can tell a party's claim from the court's finding.
 */
export function registerBlock(register: CaseRegister, question: string, budget = 6_000): string | null {
  if (!register.participants.length && !register.events.length && !register.facts.length) return null;
  const label = (documentId: string) => register.documents[documentId]?.label ?? "dokument sprawy";
  const stems = questionStems(question);
  const lines: string[] = [
    "# REJESTR SPRAWY (aplikacja: z dokumentów sprawy, bez modelu; symbole osób jak w dokumentach)",
    "Uczestnicy, zdarzenia i fakty zebrane z dokumentów w kolejnych turach. To pomoc w nawigacji, nie dowód: każdą tezę opieraj na dokumencie, a twierdzenie strony odróżniaj od ustalenia sądu."
  ];
  if (register.participants.length) {
    lines.push("", "## Uczestnicy");
    for (const item of register.participants.slice(0, 40)) {
      const docs = [...new Set(item.sources.map((source) => label(source.documentId)))].slice(0, 3).join("; ");
      lines.push(`- ${item.symbol} (${item.kind === "OSOBA" ? "osoba" : "podmiot"}): ${item.roles.length ? item.roles.join(", ") : "rola nieustalona"} — ${docs}`);
    }
  }
  const relevantEvents = register.events.length <= 30 ? register.events : [...register.events].sort((a, b) => score(b.text, stems) - score(a.text, stems)).slice(0, 30).sort((a, b) => a.date.localeCompare(b.date));
  if (relevantEvents.length) {
    lines.push("", "## Zdarzenia (oś czasu)");
    for (const item of relevantEvents) lines.push(`- ${item.date} — ${item.text} [${label(item.documentId)}]`);
  }
  const relevantFacts = [...register.facts]
    .map((item, order) => ({ item, order, value: score(item.text, stems) + (item.kind === "USTALENIE" ? 0.5 : 0) }))
    .filter((entry) => entry.value > 0 || register.facts.length <= 20)
    .sort((a, b) => b.value - a.value || a.order - b.order)
    .slice(0, 25)
    .map((entry) => entry.item);
  if (relevantFacts.length) {
    lines.push("", "## Fakty do pytania (kto mówi)");
    const kind = { KWOTA: "kwota", TWIERDZENIE: "twierdzenie", USTALENIE: "ustalenie", ZEZNANIE: "zeznanie" } as const;
    for (const item of relevantFacts) lines.push(`- [${kind[item.kind]} — ${item.speaker}] ${item.text} [${label(item.documentId)}]`);
  }
  let text = lines.join("\n");
  const more = "\n[…dalsza część rejestru w pamięci sprawy]";
  if (text.length > budget) text = `${text.slice(0, Math.max(0, budget - more.length))}${more}`;
  return text;
}
