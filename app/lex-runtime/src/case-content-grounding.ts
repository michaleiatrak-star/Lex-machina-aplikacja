import { detectLegalReferences } from "./finalization-gate.js";
import { canonicalInterpretationSignature, interpretationSignaturesInLine } from "./interpretation-verifier.js";

// What the answer says a judgment is about must be in that judgment's text read in the
// turn. Version 0.1.27: a real signature (II SAB/Po 175/26, access to public information)
// was presented as a ruling on lawyers' AI hallucinations; the fetched CBOSA text never
// mentioned AI. Only signatures whose text a source tool returned are checked.

export type CaseGroundingFinding = {
  signature: string;
  // The user's topic words the answer gives this judgment, absent from its text.
  missing: string[];
};

// I KZP 3/24, III CZP 25/11, II SAB/Po 175/26, II SA/Wa 123/24, I OSK 12/24, XXV C 123/20.
// Common courts write the repertory in mixed case: II Ca 990/26, I ACa 12/25, IV Ka 3/26, III Ns 5/24.
const SIGNATURE =
  /(?<![\p{L}\d])[IVXL]{1,5}\s+[A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż]{0,5}(?:\/[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{0,2})?(?:-[A-Z]{1,3})?\s+\d{1,5}\/\d{2,4}(?!\d)/gu;

// Tool results arrive as JSON with the document nested as a string (escaped line breaks,
// quotes, sometimes \u escapes of a Python server, sometimes JSON inside JSON): the plain text.
export function readableSource(source: string): string {
  const strings: string[] = [];
  const collect = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      const nested = depth < 3 && /^\s*[[{]/u.test(value) ? tryParse(value) : undefined;
      if (nested !== undefined) collect(nested, depth + 1);
      else strings.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) collect(item, depth);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value)) collect(item, depth);
    } else if (typeof value === "number") {
      strings.push(String(value));
    }
  };
  const parsed = tryParse(source);
  if (parsed === undefined) {
    return source
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\[nrt]/g, "\n")
      .replace(/\\(["\\/])/g, "$1");
  }
  collect(parsed, 0);
  return strings.join("\n");
}

function tryParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function caseSignaturesIn(text: string): string[] {
  return [...text.matchAll(SIGNATURE)].map((match) => match[0].replace(/\s+/g, " "));
}

const fold = (value: string): string =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLocaleLowerCase("pl");

const signatureKey = (value: string): string => value.replace(/\./g, "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pl");

// Words of the request, the court and the search itself, not of the topic.
const NON_TOPIC = [
  "znajd", "wyszu", "szuka", "poszu", "wyrok", "orzec", "uchwa", "posta", "sadu", "sadow", "sadzi", "najwy", "admin", "dotyc",
  "prosz", "prosi", "polsk", "inneg", "innym", "innyc", "takim", "razie", "wydan", "kogos", "ktory", "ktore", "ktora", "teraz",
  "wskaz", "podaj", "sygna", "spraw", "jakis", "jakie", "jakim", "takze", "rowni", "ponie", "wlasn", "trzeb", "chcia", "chcem",
  "mozes", "mozna", "robis", "dalej", "kontyn", "dobrz", "zgodn", "dotyk", "przyk", "bazie", "bazy", "portal", "inter", "stron",
  "ktos", "kiedy", "gdzie", "dlacz", "potwi", "zwery", "weryf", "rejon", "okreg", "apela", "najno", "aktua", "ostat"
];
const COURT_ACRONYMS = new Set(["SN", "NSA", "WSA", "TK", "SA", "SR", "SO", "TSUE", "ETPC", "ETPCZ", "KIO", "UODO", "KC", "KPC", "KK", "KPK", "KPA", "PPSA", "RP", "UE", "OK"]);
const NEGATION = /(?<![\p{L}])(?:nie|brak\p{L}*|żadn\p{L}*|zadn\p{L}*|bez)(?![\p{L}])/iu;

type Term = { stem: string; word: string; acronym: boolean };

function topicTerms(topicText: string): Term[] {
  const terms = new Map<string, Term>();
  for (const match of topicText.matchAll(/[\p{L}]+/gu)) {
    const word = match[0];
    if (/^[A-ZĄĆĘŁŃÓŚŹŻ]{2,5}$/u.test(word) && !COURT_ACRONYMS.has(word)) {
      const stem = fold(word);
      if (!terms.has(stem)) terms.set(stem, { stem, word, acronym: true });
      continue;
    }
    const folded = fold(word);
    if (folded.length < 6) continue;
    const stem = folded.slice(0, 6);
    if (NON_TOPIC.some((prefix) => stem.startsWith(prefix))) continue;
    if (!terms.has(stem)) terms.set(stem, { stem, word: word.toLocaleLowerCase("pl"), acronym: false });
  }
  return [...terms.values()];
}

function contains(foldedText: string, term: Term): boolean {
  return term.acronym
    ? new RegExp(`(?<![a-z0-9])${term.stem}(?![a-z0-9])`, "u").test(foldedText)
    : new RegExp(`(?<![a-z0-9])${term.stem}`, "u").test(foldedText);
}

// The paragraph with the signature and the paragraphs after it, up to the next signature.
function claimWindow(paragraphs: string[], index: number): string {
  const parts = [paragraphs[index]!];
  for (let next = index + 1; next < paragraphs.length && parts.length < 3; next += 1) {
    if (new RegExp(SIGNATURE.source, "u").test(paragraphs[next]!)) break;
    parts.push(paragraphs[next]!);
  }
  return parts.join("\n");
}

const assertedSentences = (window: string): string =>
  window
    .split(/(?<=[.!?])\s+|\n+/u)
    .filter((sentence) => !NEGATION.test(sentence))
    .join(" ");

const squeeze = (value: string): string => value.replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Quotations of at least six words: „...”, "...", «...».
function quotesIn(window: string): string[] {
  return [...window.matchAll(/[„"«]([^„”"«»]{30,})[”"»]/gu)]
    .map((match) => match[1]!.trim())
    .filter((quote) => quote.split(/\s+/u).length >= 6);
}

// The document's text for one signature: a full document whole; a hit list only around it.
// In a hit list (an array of entries), the one entry that carries the signature: the other
// hits' subjects must not be read as this judgment's.
function hitListEntry(key: string, source: string): string | null {
  const parsed = tryParse(source);
  let found: string | null = null;
  const visit = (value: unknown): void => {
    if (found || !value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      if (value.length > 1) {
        for (const item of value) {
          if (item && typeof item === "object" && signatureKey(readableSource(JSON.stringify(item))).includes(key)) {
            found = readableSource(JSON.stringify(item));
            return;
          }
        }
      }
      for (const item of value) visit(item);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  };
  visit(parsed);
  return found;
}

function sourceTextFor(key: string, raw: string[]): string | null {
  // The document itself, fetched in the turn, comes before its line on a hit list: the list
  // has only the title, the judge needs the reasoning.
  const whole = raw.filter((source) => !hitListEntry(key, source) && signatureKey(readableSource(source)).includes(key));
  const texts: string[] = [];
  for (const entry of whole.length ? [] : raw.map((source) => hitListEntry(key, source))) if (entry) texts.push(entry);
  if (texts.length) return texts.join("\n");
  raw = whole.length ? whole : raw;
  for (const source of raw.map(readableSource)) {
    const normalized = signatureKey(source);
    const at = normalized.indexOf(key);
    if (at < 0) continue;
    const others = new Set([...source.matchAll(SIGNATURE)].map((match) => signatureKey(match[0])));
    // A result naming many cases is cut around the signature; the document itself (its
    // signature in the heading) stays whole, though its reasoning cites other judgments.
    const itself = at < 800;
    texts.push(!itself && others.size >= 3 ? source.slice(Math.max(0, at - 1500), at + 3000) : source);
  }
  return texts.length ? texts.join("\n") : null;
}

// Other legal texts with a signature: TK (K 3/21, SK 12/20), KIO 1234/24, TSUE and General
// Court (C-123/22, T-45/21), UODO decisions (DKN.5130.123.2024, DKE.523.18.2021, ZSOŚS.440.58.2018,
// ZSPR.421.2.2019), ETPC applications (nr 12345/19), SN chambers without a Roman division
// (SNO 11/16 disciplinary, WZ 5/16 military, I DSI 3/24 is caught by SIGNATURE).
const OTHER_SIGNATURE =
  /(?<![\p{L}\d-])(?:(?:Kpt|Kp|SK|Pp|Ts|K|P|U|S)\s+\d{1,4}\/\d{2}|KIO\s+\d{1,5}\/\d{2}|[CT]-\d{1,4}\/\d{2}|(?:DKN|DKE|DKUE|DOL|DS|DIS|ZSOŚS|ZSZZS|ZSPR|ZSPU|ZKE|ZSZ|ZWAD)\.\d{3,4}\.\d{1,5}\.\d{4}|(?:SNO|SDI|SDU|WZ|WO|WK)\s+\d{1,4}\/\d{2}|(?<=(?:skarg[aięi]|application)\s+(?:nr|no\.?)\s*)\d{3,6}\/\d{2})(?![\d\p{L}])/gu;

const comparableClaim = (value: string): string =>
  value.normalize("NFKC").toLocaleLowerCase("pl").replace(/[.,;:()[\]{}]/g, " ").replace(/\s+/g, " ").trim();

// Provisions verified in ELI in this turn: claim -> the wording read from the source.
function verifiedWordings(sources: string[]): Map<string, string> {
  const wordings = new Map<string, string>();
  for (const source of sources) {
    let value: unknown;
    try {
      value = JSON.parse(source);
    } catch {
      continue;
    }
    const record = value as { claim?: unknown; evidence?: unknown; status?: unknown };
    if (typeof record.claim === "string" && typeof record.evidence === "string" && record.evidence.trim()) {
      wordings.set(comparableClaim(record.claim), record.evidence);
    }
  }
  return wordings;
}

export type CitedDocument = {
  signature: string;
  kind: "case" | "interpretation" | "other" | "statute";
  // What the answer says about it: its paragraph and the ones after it.
  claim: string;
  // The text the source tools returned for it in this turn.
  text: string;
};

/** Judgments and tax interpretations the answer cites whose text a source returned in the turn. */
export function citedDocuments(answer: string, sources: string[]): CitedDocument[] {
  const paragraphs = answer.split(/\n\s*\n/u);
  const cited = new Map<string, CitedDocument>();
  paragraphs.forEach((paragraph, index) => {
    const found: Array<{ signature: string; key: string; kind: CitedDocument["kind"] }> = [
      ...[...paragraph.matchAll(SIGNATURE)].map((match) => ({ signature: match[0].replace(/\s+/g, " "), key: signatureKey(match[0]), kind: "case" as const })),
      ...interpretationSignaturesInLine(paragraph).map((signature) => ({ signature, key: signature, kind: "interpretation" as const })),
      ...[...paragraph.matchAll(OTHER_SIGNATURE)].map((match) => ({ signature: match[0].replace(/\s+/g, " "), key: signatureKey(match[0]), kind: "other" as const }))
    ];
    for (const item of found) {
      if (cited.has(item.key)) continue;
      const text = item.kind === "interpretation" ? interpretationTextFor(item.key, sources) : sourceTextFor(item.key, sources);
      if (text) cited.set(item.key, { signature: item.signature, kind: item.kind, claim: claimWindow(paragraphs, index), text });
    }
  });
  // Provisions: what the answer says about a verified article against its wording.
  const wordings = verifiedWordings(sources);
  if (wordings.size) {
    for (const reference of detectLegalReferences(answer)) {
      if (reference.kind !== "statute") continue;
      const claim = comparableClaim(reference.claim);
      const wording = wordings.get(claim) ?? [...wordings.entries()].find(([key]) => key.startsWith(`${claim} `))?.[1];
      const key = `statute:${claim}`;
      if (!wording || cited.has(key)) continue;
      const index = paragraphs.findIndex((paragraph) => paragraph.includes(reference.lineText.trim().slice(0, 40)));
      cited.set(key, { signature: reference.claim, kind: "statute", claim: index >= 0 ? claimWindow(paragraphs, index) : reference.lineText, text: wording });
    }
  }
  return [...cited.values()];
}

function interpretationTextFor(signature: string, raw: string[]): string | null {
  // As for judgments: the interpretation itself before its line on a hit list, and from a
  // list only its own entry (another hit's subject is not this interpretation's).
  const key = signatureKey(signature);
  const whole = raw.filter((source) => !hitListEntry(key, source) && canonicalInterpretationSignature(readableSource(source)).includes(signature));
  if (whole.length) return whole.map(readableSource).join("\n");
  const entries = raw.map((source) => hitListEntry(key, source)).filter((entry): entry is string => Boolean(entry));
  if (entries.length) return entries.join("\n");
  const texts = raw.map(readableSource).filter((source) => canonicalInterpretationSignature(source).includes(signature));
  return texts.length ? texts.join("\n") : null;
}

export function caseContentFindings(answer: string, sources: string[], topicText: string): CaseGroundingFinding[] {
  const terms = topicTerms(topicText);
  if (!terms.length || !sources.length) return [];
  const paragraphs = answer.split(/\n\s*\n/u);
  const findings = new Map<string, CaseGroundingFinding>();
  paragraphs.forEach((paragraph, index) => {
    for (const match of paragraph.matchAll(SIGNATURE)) {
      const signature = match[0].replace(/\s+/g, " ");
      const key = signatureKey(signature);
      const text = sourceTextFor(key, sources);
      if (!text) continue;
      const window = fold(assertedSentences(claimWindow(paragraphs, index)));
      const foldedText = fold(text);
      const missing = [
        ...terms.filter((term) => contains(window, term) && !contains(foldedText, term)).map((term) => term.word),
        // A thesis quoted as the judgment's own words must be in its text, word for word.
        ...quotesIn(claimWindow(paragraphs, index))
          .filter((quote) => !squeeze(foldedText).includes(squeeze(fold(quote))))
          .map((quote) => `cytat „${quote.length > 80 ? `${quote.slice(0, 77)}...` : quote}”`)
      ];
      if (!missing.length) continue;
      const current = findings.get(key);
      findings.set(key, { signature, missing: [...new Set([...(current?.missing ?? []), ...missing])] });
    }
  });
  return [...findings.values()];
}

export function caseContentCorrectionPrompt(findings: CaseGroundingFinding[]): string {
  return [
    "KONTROLA TREŚCI ORZECZEŃ (aplikacja): odpowiedź przypisuje orzeczeniom treść, której nie ma w tekście pobranym w tej turze ze źródła:",
    ...findings.map((finding) => `- sygn. ${finding.signature}: w pobranym tekście nie ma: ${finding.missing.join(", ")}`),
    "Popraw odpowiedź: każde orzeczenie opisuj wyłącznie tym, co jest w jego pobranym tekście (sąd, sygnatura, data, przedmiot sprawy). Orzeczenia, które nie dotyczą pytania, nie przedstawiaj jako trafienia.",
    "Gdy żadne pobrane orzeczenie nie spełnia kryteriów, napisz wprost, że nie znaleziono orzeczenia spełniającego te kryteria (brak trafień = OUT_OF_SCOPE, nie dowód braku orzeczenia), i wskaż, co sprawdzono.",
    "Podaj pełną poprawioną odpowiedź."
  ].join("\n");
}

export function caseContentWarning(findings: CaseGroundingFinding[]): string {
  return findings
    .map(
      (finding) =>
        `⚠️ Kontrola aplikacji: w tekście orzeczenia sygn. ${finding.signature} pobranym w tej turze nie ma pojęć, które odpowiedź mu przypisuje (${finding.missing.join(", ")}). Nie powołuj go jako orzeczenia w tej sprawie bez sprawdzenia treści w źródle.`
    )
    .join("\n");
}
