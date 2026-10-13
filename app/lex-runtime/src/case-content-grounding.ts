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
const SIGNATURE =
  /(?<![\p{L}\d])[IVXL]{1,5}\s+[A-ZĄĆĘŁŃÓŚŹŻ]{1,6}(?:\/[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]{0,2})?(?:-[A-Z]{1,3})?\s+\d{1,5}\/\d{2,4}(?!\d)/gu;

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
function sourceTextFor(key: string, sources: string[]): string | null {
  const texts: string[] = [];
  for (const source of sources) {
    const normalized = signatureKey(source);
    const at = normalized.indexOf(key);
    if (at < 0) continue;
    const others = new Set([...source.matchAll(SIGNATURE)].map((match) => signatureKey(match[0])));
    texts.push(others.size >= 3 ? source.slice(Math.max(0, at - 1500), at + 3000) : source);
  }
  return texts.length ? texts.join("\n") : null;
}

// Other legal texts with a signature: TK (K 3/21, SK 12/20), KIO 1234/24, TSUE and General
// Court (C-123/22, T-45/21), UODO decisions (DKN.5130.123.2024), ETPC applications (nr 12345/19).
const OTHER_SIGNATURE =
  /(?<![\p{L}\d-])(?:(?:Kpt|Kp|SK|Pp|Ts|K|P|U|S)\s+\d{1,4}\/\d{2}|KIO\s+\d{1,5}\/\d{2}|[CT]-\d{1,4}\/\d{2}|DKN\.\d{4}\.\d{1,5}\.\d{4}|(?<=(?:skarg[aięi]|application)\s+(?:nr|no\.?)\s*)\d{3,6}\/\d{2})(?![\d\p{L}])/gu;

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

function interpretationTextFor(signature: string, sources: string[]): string | null {
  const texts = sources.filter((source) => canonicalInterpretationSignature(source).includes(signature));
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
