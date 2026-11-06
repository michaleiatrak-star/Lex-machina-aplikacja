import type {
  SessionDocumentAttachment
} from "./session-executor.js";
import { CASE_MATERIAL_MARKER_TEXT } from "./finalization-gate.js";
import { classifyDocument } from "./document-kind.js";

export type PublicDocumentCitation = {
  citationId: string;
  marker: string;
  label: string;
  caseId?: string;
  documentId: string;
  chunkIndex: number;
  pageStart: number;
  pageEnd: number;
  contextText: string;
  quote?: string;
  // EXACT: the quote is in the document (whitespace, typography, case and [...] elisions
  // folded); NOT_FOUND: it is not, shown with QUOTE_MISMATCH_MARKER; DIGEST_UNCHECKED: only
  // an extractive digest of the passage was available, so the wording could not be checked.
  quoteFidelity?: "EXACT" | "NOT_FOUND" | "DIGEST_UNCHECKED";
  highlightStart?: number;
  highlightEnd?: number;
};

export type ProcessedDocumentCitations = {
  text: string;
  citations: PublicDocumentCitation[];
  rejectedMarkers: number;
  quoteFindings: {
    // A quote without a marker found verbatim in a case document: linked by the application.
    autoLinked: number;
    // A linked quote whose wording is not in the document.
    mismatched: number;
    // A quote attributed to a pleading or case document, without a marker, found nowhere.
    unsourced: number;
  };
};

export const QUOTE_MISMATCH_MARKER = "⚠️ [CYTAT NIEZGODNY Z DOKUMENTEM]";
export const QUOTE_UNSOURCED_MARKER = "⚠️ [CYTAT NIEODNALEZIONY W AKTACH]";

// ":u<N>" is the application's own: a numbered unit ("pkt 5") of the document, highlighted.
// ":a<N>" likewise: an anchor of the answer (a §, an exhibit, an amount, a date) found in it.
const MARKER = /\[\[LEXDOC:([^:\]\r\n]{1,180}):(\d{1,7})(?::(u|a)(\d{1,4}))?\]\]/g;
const MAX_QUOTE_SCAN = 4_500;

function quoteBefore(text: string, markerStart: number): string | undefined {
  // "*„…”* [[LEXDOC…]]": emphasis around the quote and a space before the marker.
  const window = text.slice(
    Math.max(0, markerStart - MAX_QUOTE_SCAN),
    markerStart
  ).trimEnd().replace(/[*_]+$/u, "");

  const candidates = [
    /„([^„”]{2,4000})”\s*$/s,
    /“([^“”]{2,4000})”\s*$/s,
    /"([^"\r\n]{2,4000})"\s*$/s,
    /'([^'\r\n]{2,4000})'\s*$/s
  ];
  for (const pattern of candidates) {
    const match = window.match(pattern);
    const quote = match?.[1]?.trim();
    if (quote) return quote;
  }
  return undefined;
}

// Folds only what does not change the wording: whitespace, line-break hyphenation, dashes,
// quotation-mark style and letter case. Never fuzzy matching: a changed word is a mismatch.
function fold(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === "\u00AD") continue;
    if (/[-‐‑‒–—−]/u.test(ch)) {
      // "praco-\nwnik" is "pracownik"; other dashes are dropped on both sides.
      if (/^.[ \t]*\r?\n/u.test(text.slice(i, i + 6))) {
        while (i + 1 < text.length && /\s/u.test(text[i + 1]!)) i += 1;
      }
      continue;
    }
    let folded: string;
    if (/\s/u.test(ch)) {
      if (out === "" || out.endsWith(" ")) continue;
      folded = " ";
    } else if (/[„“”"«»]/u.test(ch)) folded = "\"";
    else if (/[‚‘’'`]/u.test(ch)) folded = "'";
    else if (ch === "…") folded = "...";
    else {
      const lower = ch.toLowerCase();
      folded = lower.length === 1 ? lower : ch;
    }
    for (const part of folded) {
      out += part;
      map.push(i);
    }
  }
  return { text: out, map };
}

const ELISION = /\s*(?:\[\s*(?:\.{3}|…)\s*\]|\(\s*(?:\.{3}|…)\s*\)|\.{3}|…)\s*/u;

function quoteSegments(quote: string): string[] {
  return quote
    .split(ELISION)
    .map((segment) => fold(segment).text.trim().replace(/^[\s.,;:!?]+|[\s.,;:!?]+$/gu, ""))
    .filter((segment) => segment.length >= 3);
}

// An editorial ending in brackets ("Członk[ów] Zarządu", "poczt[y] tradycyjn[ej]", RD 121/26):
// that word may differ in its ending from the source; its stem and every other word may not.
const ADAPTED_WORD = /(\p{L}*)\[(\p{L}{1,6})\](\p{L}*)/gu;

function locateAdaptedQuote(contextText: string, quote: string): { start: number; end: number } | undefined {
  const words = fold(quote.replace(new RegExp(ELISION.source, "gu"), " ")).text.trim().split(" ").filter(Boolean);
  let adapted = 0;
  const pattern = words.map((word) => {
    ADAPTED_WORD.lastIndex = 0;
    const match = ADAPTED_WORD.exec(word);
    if (!match) return word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    adapted += 1;
    const stem = match[1]!.slice(0, Math.max(3, match[1]!.length - 2));
    const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return `${escape(word.slice(0, match.index))}${escape(stem)}\\p{L}*${escape(word.slice(match.index + match[0].length))}`;
  });
  // Only an adapted quote, and never one made mostly of adapted words.
  if (adapted === 0 || words.length - adapted < 2) return undefined;
  const source = fold(contextText);
  const found = new RegExp(pattern.join(" "), "u").exec(source.text);
  return found ? { start: source.map[found.index]!, end: source.map[found.index + found[0].length - 1]! + 1 } : undefined;
}

// Every segment of the quote ("a [...] b" is two) in the document, in order.
function locateQuote(
  contextText: string,
  quote: string | undefined
): { start: number; end: number } | undefined {
  if (!quote) return undefined;
  if (/\[\p{L}{1,6}\]/u.test(quote)) {
    const adapted = locateAdaptedQuote(contextText, quote);
    if (adapted) return adapted;
  }
  const segments = quoteSegments(quote);
  if (segments.length === 0) return undefined;
  const source = fold(contextText);
  let from = 0;
  let start = -1;
  let end = -1;
  for (const segment of segments) {
    const at = source.text.indexOf(segment, from);
    if (at < 0) return undefined;
    if (start < 0) start = at;
    end = at + segment.length;
    from = end;
  }
  return { start: source.map[start]!, end: source.map[end - 1]! + 1 };
}

function textContainsQuote(text: string, quote: string): boolean {
  return locateQuote(text, quote) !== undefined;
}

// Where a quote comes from, not whether it is verbatim: a passage put into the sentence's case
// ("o pozwie „spełniającym przesłanki…”" from "od pozwu spełniającego przesłanki…", live C13-039)
// is still that source's text. Each word keeps its stem; only the ending may differ.
function words(text: string): string[] {
  return text.toLocaleLowerCase("pl").match(/[\p{L}\p{N}]+/gu) ?? [];
}

function sameStem(left: string, right: string): boolean {
  if (left === right) return true;
  const shorter = Math.min(left.length, right.length);
  if (shorter < 4 || Math.abs(left.length - right.length) > 3) return false;
  let common = 0;
  while (common < shorter && left[common] === right[common]) common += 1;
  return common >= Math.max(3, Math.max(left.length, right.length) - 3);
}

function textContainsInflectedQuote(text: string, quote: string): boolean {
  if (textContainsQuote(text, quote)) return true;
  return quoteSegments(quote).every((segment) => {
    const wanted = words(segment);
    if (wanted.length < 4) return false;
    const source = words(text);
    for (let at = 0; at + wanted.length <= source.length; at += 1) {
      if (wanted.every((word, index) => sameStem(word, source[at + index]!))) return true;
    }
    return false;
  });
}

type ChunkEntry = {
  attachment: SessionDocumentAttachment;
  chunk: SessionDocumentAttachment["chunks"][number];
};

function findQuoteChunk(
  entries: ChunkEntry[],
  quote: string,
  preferDocumentId?: string
): { entry: ChunkEntry; location: { start: number; end: number } } | undefined {
  const ordered = preferDocumentId
    ? [
        ...entries.filter((entry) => entry.attachment.documentId === preferDocumentId),
        ...entries.filter((entry) => entry.attachment.documentId !== preferDocumentId)
      ]
    : entries;
  for (const entry of ordered) {
    const location = locateQuote(entry.chunk.text, quote);
    if (location) return { entry, location };
  }
  return undefined;
}

// A quote the answer attributes to a pleading, a letter or another case document.
const DOCUMENT_ATTRIBUTION =
  /(?:pozw\p{L}*|pism\p{L}*|apelacj\p{L}*|zażaleni\p{L}*|sprzeciw\p{L}*|skarg\p{L}*|wnios\p{L}*|umow\p{L}*|aneks\p{L}*|zaskarżon\p{L}*|protok\p{L}*|wezwani\p{L}*|notatk\p{L}*|e-?mail\p{L}*|korespondencj\p{L}*|regulamin\p{L}*|dokument\p{L}*|załącznik\p{L}*|przeciwn\p{L}*|powod\p{L}*|powód|pełnomocnik\p{L}*|oskarżon\p{L}*|uczestnik\p{L}*|wierzyciel\p{L}*|dłużni\p{L}*|kontrahent\p{L}*|klient\p{L}*)/giu;
// The wording of a statute or a judgment's thesis: checked by the provision and case-law gates.
const NON_DOCUMENT_SOURCE =
  /(?:\bart\.|§|\bstanowi\p{L}*|\bbrzmi\p{L}*|\bprzepis\p{L}*|\bustaw\p{L}*|\bkodeks\p{L}*|\bDz\.\s?U|\bteza\p{L}*|\bSN\b|\bNSA\b|\bTK\b|\bTSUE\b|\bSąd Najwyższy)/giu;
// Typographic quotes only: straight "…" are JSON strings and code as often as quotations.
const UNMARKED_QUOTE = /„([^„”\r\n]{20,1500})”|“([^“”\r\n]{20,1500})”/gu;

function lastMatchEnd(pattern: RegExp, text: string): number {
  let last = -1;
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) last = match.index + match[0].length;
  return last;
}

function attributedToDocument(text: string, quoteStart: number): boolean {
  const paragraphStart = Math.max(text.lastIndexOf("\n\n", quoteStart), quoteStart - 300, 0);
  const before = text.slice(paragraphStart, quoteStart);
  const attribution = lastMatchEnd(DOCUMENT_ATTRIBUTION, before);
  if (attribution < 0) return false;
  // "pozwany powołuje art. 6 k.c., który stanowi: „…”": the nearer cue decides.
  return lastMatchEnd(NON_DOCUMENT_SOURCE, before) < attribution;
}

// "VIII W 633/25 ⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]": the signature is in the case's
// documents, so the marker gets the passage that names it, shown and highlighted like a quote
// (RD 121/26: the user saw "z materiałów sprawy" without which document or where).
const SIGNATURE_BEFORE = /((?:sygn\.?\s*(?:akt\s*)?:?\s*)?(?:[A-ZĄĆĘŁŃÓŚŹŻ]{1,8}\s+){1,4}\d+\/\d{2,4})\s*$/u;

function linkCaseMaterialSignatures(text: string, entries: ChunkEntry[]): string {
  if (!entries.length || !text.includes(CASE_MATERIAL_MARKER_TEXT)) return text;
  let output = "";
  let cursor = 0;
  for (let at = text.indexOf(CASE_MATERIAL_MARKER_TEXT); at >= 0; at = text.indexOf(CASE_MATERIAL_MARKER_TEXT, at + 1)) {
    const end = at + CASE_MATERIAL_MARKER_TEXT.length;
    if (/^\s*\[\[LEXDOC:/u.test(text.slice(end, end + 12))) continue;
    const signature = SIGNATURE_BEFORE.exec(text.slice(Math.max(0, at - 60), at))?.[1]?.replace(/^sygn\.?\s*(?:akt\s*)?:?\s*/iu, "");
    if (!signature) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\d])${signature.trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s*")}(?![\\d])`, "iu");
    const found = entries.find((entry) => pattern.test(entry.chunk.text));
    if (!found) continue;
    output += text.slice(cursor, end) + ` [[LEXDOC:${found.attachment.documentId}:${found.chunk.index}]]`;
    cursor = end;
  }
  return output + text.slice(cursor);
}

// A numbered unit of a case document: "5. Za każde nieuprawnione naruszenie…" up to the next
// unit or a blank line. Only units at the start of a line count ("12.W sytuacji" included).
function unitLocation(text: string, unit: number): { start: number; end: number } | undefined {
  const number = String(unit);
  // "5.000,00 zł" at the start of a line is an amount, not unit 5.
  const head = new RegExp(`(?:^|\\n)[ \\t]*${number}[ \\t]*[.)](?!\\d)[ \\t]*(?=\\S)`, "u").exec(text);
  if (!head) return undefined;
  const begin = head.index + head[0].indexOf(number);
  const rest = text.slice(begin + number.length);
  const next = /\n[ \t]*\d{1,3}[ \t]*[.)](?!\d)[ \t]*\S|\n\s*\n/u.exec(rest);
  return { start: begin, end: Math.min(begin + number.length + (next ? next.index : rest.length), begin + 900) };
}

// "pkt 5", "punkt 10", "pkt 2, 5 i 10", "pkt. 6": a numbered unit of a case document, not of a
// statute ("art. 187 § 1 pkt 3 KPC", "ust. 2 pkt 4" stay with the provision gates).
const UNIT_REFERENCE = /(?<![\p{L}])(pkt\.?|punkt(?:u|em|cie|y|ów|ach|ami)?|Punkt(?:u|em|cie|y)?)\s*(\d{1,3})((?:\s*(?:,|i|oraz|lub|albo|–|-)\s*\d{1,3}(?![\d.,]\d))*)/gu;
const STATUTE_CONTEXT = /(?:\bart\.|§|\bust\.|\bDz\.\s?U|\bpoz\.)[^.;\n]{0,40}$/u;

// The user report of 2026-11-06: Bielik wrote "Punkt 5 nakłada karę" with no quote and no
// marker, so nothing showed where pkt 5 is or what it says. Each such reference gets a link
// to its document and page, the unit highlighted, when exactly one case document has it.
function linkDocumentUnits(text: string, entries: ChunkEntry[]): { text: string; linked: number } {
  if (!entries.length || /^\s*[{[]/u.test(text)) return { text, linked: 0 };
  const cache = new Map<number, ChunkEntry | null>();
  const owner = (unit: number): ChunkEntry | null => {
    if (cache.has(unit)) return cache.get(unit)!;
    const found = entries.filter((entry) => unitLocation(entry.chunk.text, unit));
    const documents = new Set(found.map((entry) => entry.attachment.documentId));
    const result = documents.size === 1 ? found[0]! : null;
    cache.set(unit, result);
    return result;
  };
  let output = "";
  let cursor = 0;
  let linked = 0;
  // One link per unit and paragraph: a list of five mentions of pkt 10 is not five links.
  let paragraphStart = 0;
  const seen = new Set<number>();
  UNIT_REFERENCE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = UNIT_REFERENCE.exec(text)) !== null) {
    const paragraph = text.lastIndexOf("\n\n", match.index);
    if (paragraph !== paragraphStart) {
      paragraphStart = paragraph;
      seen.clear();
    }
    if (STATUTE_CONTEXT.test(text.slice(Math.max(0, match.index - 60), match.index))) continue;
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 30);
    // "pkt 3 KPC", "pkt 2 ustawy": a statute's unit after all.
    if (/^\s*(?:K[A-Z]{1,3}\b|k\.[a-z]|ustaw|rozporządz|Kodeks|u\.[a-z])/u.test(after)) continue;
    if (/^\s*\[\[LEXDOC/u.test(after)) continue;
    const head = match[1]!.length + match[0].slice(match[1]!.length).search(/\d/u);
    const numbers = [...match[0].slice(head).matchAll(/\d{1,3}/gu)].map((item) => ({ value: Number(item[0]), end: head + item.index! + item[0].length }));
    let local = "";
    let localCursor = 0;
    for (const number of numbers) {
      if (seen.has(number.value)) continue;
      const entry = owner(number.value);
      if (!entry) continue;
      seen.add(number.value);
      local += match[0].slice(localCursor, number.end) + ` [[LEXDOC:${entry.attachment.documentId}:${entry.chunk.index}:u${number.value}]]`;
      localCursor = number.end;
      linked += 1;
    }
    if (!local) continue;
    output += text.slice(cursor, match.index) + local + match[0].slice(localCursor);
    cursor = match.index + match[0].length;
  }
  return { text: output + text.slice(cursor), linked };
}

type Anchor = { label: string; key: string; locate: (text: string) => { start: number; end: number } | undefined };

const MONTHS = ["stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca", "lipca", "sierpnia", "września", "października", "listopada", "grudnia"];
const MONEY = /(?<![\p{L}\d,.])\d{1,3}(?:[ .  ]\d{3})*(?:,\d{1,2})?\s*(?:zł|złotych|PLN)(?![\p{L}])/gu;
const DATE = new RegExp(`(?<![\\d.])(\\d{1,2})(?:\\.(\\d{1,2})\\.|\\s+(${MONTHS.join("|")})\\s+)(\\d{4})(?!\\d)`, "giu");

function moneyKey(text: string): string {
  return text.replace(/\s*(?:zł|złotych|PLN)$/u, "").replace(/[ .  ]/gu, "").replace(/,0+$/u, "");
}
function dateKey(match: RegExpExecArray): string {
  const month = match[2] ? Number(match[2]) : MONTHS.indexOf(match[3]!.toLocaleLowerCase("pl")) + 1;
  return `${match[4]}-${String(month).padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
}
function firstMatching(pattern: RegExp, key: (match: RegExpExecArray) => string, wanted: string) {
  return (text: string) => {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) if (key(match) === wanted) return { start: match.index, end: match.index + match[0].length };
    return undefined;
  };
}
function phrase(pattern: RegExp) {
  return (text: string) => {
    const match = pattern.exec(text);
    if (!match) return undefined;
    // The line that holds it: "Załącznik nr 3 – umowa najmu z 1.02.2024 r."
    const start = text.lastIndexOf("\n", match.index) + 1;
    const lineEnd = text.indexOf("\n", match.index + match[0].length);
    return { start, end: Math.min(lineEnd < 0 ? text.length : lineEnd, start + 400) };
  };
}

// What the answer takes from the case documents besides quotes and points (user report
// 2026-11-06: "powołanie się na dowód, pismo przeciwnika czy inne dokumenty" showed no place):
// "§ 4" of a contract or rules, "załącznik nr 3", "dowód nr 2", an amount ("60 000 zł") and a
// date ("3 grudnia 2024 r."). Linked when exactly one case document has it; a statute's "§"
// and values no document holds stay as they are.
function linkDocumentAnchors(text: string, entries: ChunkEntry[]): { text: string; list: Anchor[] } {
  const list: Anchor[] = [];
  if (!entries.length || /^\s*[{[]/u.test(text)) return { text, list };
  const candidates: Array<{ end: number; anchor: Anchor }> = [];
  const add = (end: number, anchor: Anchor) => candidates.push({ end, anchor });
  for (const match of text.matchAll(/(?<![\p{L}])§\s*(\d{1,3})(?!\s*(?:ust|pkt)\.?\s*\d)(?![\d])/gu)) {
    const before = text.slice(Math.max(0, match.index! - 40), match.index!);
    if (/\bart\.\s*\d+[\p{L}\d^¹²³⁴⁵⁶⁷⁸⁹⁰]*\s*$/u.test(before)) continue;
    const after = text.slice(match.index! + match[0].length, match.index! + match[0].length + 25);
    if (/^\s*(?:ust\.|pkt|K[A-Z]{1,3}\b|k\.[a-z]|ustaw|rozporządz|regulaminu\s+(?:urzędowania|sądów))/u.test(after)) continue;
    const unit = match[1]!;
    add(match.index! + match[0].length, { label: `§ ${unit}`, key: `§${unit}`, locate: phrase(new RegExp(`(?:^|\\n)[ \\t]*§[ \\t]*${unit}(?!\\d)`, "u")) });
  }
  for (const match of text.matchAll(/(?<![\p{L}])(załącznik\p{L}*|dowod\p{L}*|dowód)\s+(?:nr|numer)\s*(\d{1,3})(?!\d)/giu)) {
    const kind = /^za/iu.test(match[1]!) ? "Załącznik" : "Dowód";
    add(match.index! + match[0].length, { label: `${kind.toLowerCase()} nr ${match[2]}`, key: `${kind}${match[2]}`, locate: phrase(new RegExp(`(?<![\\p{L}])${kind === "Załącznik" ? "załącznik\\p{L}*" : "dow[óo]d\\p{L}*"}\\s+(?:nr|numer)\\s*${match[2]}(?!\\d)`, "iu")) });
  }
  for (const match of text.matchAll(MONEY)) {
    const key = moneyKey(match[0]);
    add(match.index! + match[0].length, { label: match[0].replace(/\s+/gu, " "), key: `zł${key}`, locate: firstMatching(MONEY, (found) => moneyKey(found[0]), key) });
  }
  const dates = new RegExp(DATE.source, DATE.flags);
  let date: RegExpExecArray | null;
  while ((date = dates.exec(text)) !== null) {
    const key = dateKey(date);
    add(date.index + date[0].length, { label: date[0], key: `d${key}`, locate: firstMatching(DATE, dateKey, key) });
  }
  // A quote is linked as a quote (linkUnmarkedQuotes, the model's marker): nothing inside it twice.
  const quotes = [...text.matchAll(/„[^„”]*”|“[^“”]*”/gu)].map((quote) => ({ start: quote.index!, end: quote.index! + quote[0].length }));
  const inQuote = (end: number) => quotes.some((quote) => end > quote.start && end <= quote.end);
  candidates.sort((left, right) => left.end - right.end);
  const owners = new Map<string, ChunkEntry | null>();
  const owner = (anchor: Anchor): ChunkEntry | null => {
    if (!owners.has(anchor.key)) {
      const found = entries.filter((entry) => anchor.locate(entry.chunk.text));
      owners.set(anchor.key, new Set(found.map((entry) => entry.attachment.documentId)).size === 1 ? found[0]! : null);
    }
    return owners.get(anchor.key)!;
  };
  let output = "";
  let cursor = 0;
  let paragraphStart = -2;
  const seen = new Set<string>();
  for (const { end, anchor } of candidates) {
    if (end < cursor || inQuote(end)) continue;
    const paragraph = text.lastIndexOf("\n\n", end);
    if (paragraph !== paragraphStart) {
      paragraphStart = paragraph;
      seen.clear();
    }
    if (seen.has(anchor.key) || /^\s*\[\[LEXDOC/u.test(text.slice(end, end + 12))) continue;
    // Inside a verification marker or a link ("[VER: …, 2026-10-25]") a date is no anchor.
    const lineStart = text.lastIndexOf("\n", end) + 1;
    const line = text.slice(lineStart, end);
    if (/\[(?:VER|NIEWERYFIKOWANE)[^\]]*$|\]\([^)]*$/u.test(line)) continue;
    const entry = owner(anchor);
    if (!entry) continue;
    seen.add(anchor.key);
    output += text.slice(cursor, end) + ` [[LEXDOC:${entry.attachment.documentId}:${entry.chunk.index}:a${list.length}]]`;
    list.push(anchor);
    cursor = end;
  }
  return { text: output + text.slice(cursor), list };
}

// Quotes without a marker: linked when found in a case document; flagged when attributed to
// a document yet found neither there nor in the thread or the case law read in this turn.
function linkUnmarkedQuotes(
  text: string,
  entries: ChunkEntry[],
  otherTexts: string[]
): { text: string; autoLinked: number; unsourced: number } {
  // A structured result (the document AST) is not prose: quotes in it are not touched.
  if (/^\s*[{[]/u.test(text)) return { text, autoLinked: 0, unsourced: 0 };
  let output = "";
  let cursor = 0;
  let autoLinked = 0;
  let unsourced = 0;
  UNMARKED_QUOTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  const fences = [...text.matchAll(/^```[^\n]*\n[\s\S]*?^```/gmu)]
    .map((fence) => ({ start: fence.index, end: fence.index + fence[0].length }));
  while ((match = UNMARKED_QUOTE.exec(text)) !== null) {
    const quote = (match[1] ?? match[2] ?? "").trim();
    const end = match.index + match[0].length;
    if (fences.some((fence) => match!.index >= fence.start && match!.index < fence.end)) continue;
    if (/^[*_]*\s*\[\[LEXDOC:/u.test(text.slice(end, end + 16))) continue;
    if (quote.split(/\s+/u).length < 4) continue;
    const found = entries.length ? findQuoteChunk(entries, quote) : undefined;
    if (found) {
      output += text.slice(cursor, end) + `[[LEXDOC:${found.entry.attachment.documentId}:${found.entry.chunk.index}]]`;
      cursor = end;
      autoLinked += 1;
      continue;
    }
    if (!attributedToDocument(text, match.index)) continue;
    // "Czy dostała Pani też decyzję, że „nie podlega Pani ubezpieczeniom”?": a question to the
    // user about a document's wording, not a quote from it (live C12-027). A quote given after
    // a colon ("pozwany napisał: „…”, prawda?") is still presented as the document's text.
    if (/^[^.!\n]*\?/u.test(text.slice(end, end + 200)) && !/:\s*[*_]*$/u.test(text.slice(Math.max(0, match.index - 4), match.index))) continue;
    if (otherTexts.some((other) => textContainsInflectedQuote(other, quote))) continue;
    // A digest shows the passage shortened: the quote may be in the full text.
    if (entries.some((entry) => entry.chunk.representation === "EXTRACTIVE_DIGEST")) continue;
    output += text.slice(cursor, end) + ` ${QUOTE_UNSOURCED_MARKER}`;
    cursor = end;
    unsourced += 1;
  }
  return { text: output + text.slice(cursor), autoLinked, unsourced };
}

export function documentCitationSystemPrompt(
  attachments: SessionDocumentAttachment[]
): string {
  if (attachments.length === 0) return "";
  return [
    "# LOCAL DOCUMENT CITATION PROTOCOL",
    "When you quote or closely rely on an attached local document, cite the exact chunk immediately after the relevant sentence or quotation using this internal marker:",
    "[[LEXDOC:<documentId>:<chunkIndex>]]",
    "Use only documentId and chunkIndex values present in LOCAL_DOCUMENT_CONTEXT.",
    "Never invent a document id, page, chunk, quote, or marker.",
    "For a verbatim quotation, place the marker immediately after the closing quotation mark so the application can validate and highlight the exact passage.",
    "Quote a pleading, a letter or any case document word for word; mark omissions with [...]. A quotation not found in the document is shown to the user as not matching it.",
    "Markers are machine-readable metadata and will be replaced by clickable in-chat citations before presentation."
  ].join("\n");
}

// Which document a point or an amount is in, by its recognised kind ("porozumienie",
// "wezwanie"): a file name may carry personal data and is not sent.
const documentNames = new WeakMap<SessionDocumentAttachment, string>();
function documentName(attachment: SessionDocumentAttachment): string {
  let name = documentNames.get(attachment);
  if (!name) {
    const kind = classifyDocument({ text: attachment.chunks.map((chunk) => chunk.text).join("\n").slice(0, 6_000) });
    name = kind.category === "INNE" ? "dokument" : kind.label.split(/\s*[/(]/u)[0]!.trim();
    documentNames.set(attachment, name);
  }
  return name;
}

export function processDocumentCitationMarkers(
  modelText: string,
  attachments: SessionDocumentAttachment[],
  options: {
    // Texts a quote may legitimately come from without a case document link: the thread
    // (the user's own words, earlier answers), case law and statute wording read in this turn.
    otherTexts?: string[];
  } = {}
): ProcessedDocumentCitations {
  const chunks = new Map<string, ChunkEntry>();
  for (const attachment of attachments) {
    for (const chunk of attachment.chunks) {
      chunks.set(`${attachment.documentId}:${chunk.index}`, {
        attachment,
        chunk
      });
    }
  }
  const entries = [...chunks.values()];
  const linked = linkUnmarkedQuotes(linkCaseMaterialSignatures(modelText, entries), entries, options.otherTexts ?? []);
  const units = linkDocumentUnits(linked.text, entries);
  const anchors = linkDocumentAnchors(units.text, entries);
  const text = anchors.text;
  let mismatched = 0;

  const citations: PublicDocumentCitation[] = [];
  let rejectedMarkers = 0;
  let output = "";
  let cursor = 0;
  let match: RegExpExecArray | null;
  MARKER.lastIndex = 0;

  while ((match = MARKER.exec(text)) !== null) {
    output += text.slice(cursor, match.index);
    const documentId = match[1] ?? "";
    const chunkIndex = Number(match[2]);
    const cited = chunks.get(`${documentId}:${chunkIndex}`);
    if (!cited || !Number.isInteger(chunkIndex)) {
      rejectedMarkers += 1;
      cursor = match.index + match[0].length;
      continue;
    }

    const citationId = `docref_${citations.length + 1}`;
    const marker = `[[LEXDOCREF:${citationId}]]`;
    const unit = match[3] === "u" ? Number(match[4]) : undefined;
    const anchor = match[3] === "a" ? anchors.list[Number(match[4])] : undefined;
    const quote = unit === undefined && !anchor ? quoteBefore(text, match.index) : undefined;
    let resolved = cited;
    let location = unit !== undefined
      ? unitLocation(cited.chunk.text, unit)
      : anchor
        ? anchor.locate(cited.chunk.text)
        : locateQuote(cited.chunk.text, quote);
    if (quote && !location) {
      // Cited the wrong chunk: the link goes where the words actually are.
      const elsewhere = findQuoteChunk(entries, quote, documentId);
      if (elsewhere) {
        resolved = elsewhere.entry;
        location = elsewhere.location;
      }
    }
    // A case-material signature's link highlights the signature itself in the passage.
    const before = text.slice(Math.max(0, match.index - 80), match.index).trimEnd();
    const signature = !quote && before.endsWith(CASE_MATERIAL_MARKER_TEXT)
      ? SIGNATURE_BEFORE.exec(before.slice(0, -CASE_MATERIAL_MARKER_TEXT.length).trimEnd())?.[1]?.replace(/^sygn\.?\s*(?:akt\s*)?:?\s*/iu, "")
      : undefined;
    if (signature && !location) location = locateQuote(resolved.chunk.text, signature);
    const quoteFidelity = !quote
      ? undefined
      : location
        ? "EXACT" as const
        : cited.chunk.representation === "EXTRACTIVE_DIGEST"
          ? "DIGEST_UNCHECKED" as const
          : "NOT_FOUND" as const;
    if (quoteFidelity === "NOT_FOUND") mismatched += 1;
    const pageLabel = resolved.chunk.pageStart === resolved.chunk.pageEnd
      ? `s. ${resolved.chunk.pageStart}`
      : `s. ${resolved.chunk.pageStart}–${resolved.chunk.pageEnd}`;
    const citation: PublicDocumentCitation = {
      citationId,
      marker,
      label: unit !== undefined
        ? `${documentName(resolved.attachment)}, pkt ${unit}, ${pageLabel}`
        : anchor
          ? `${documentName(resolved.attachment)}, ${anchor.label}, ${pageLabel}`
          : `Dokument ${citations.length + 1}, ${pageLabel}`,
      ...(resolved.attachment.caseId
        ? { caseId: resolved.attachment.caseId }
        : {}),
      documentId: resolved.attachment.documentId,
      chunkIndex: resolved.chunk.index,
      pageStart: resolved.chunk.pageStart,
      pageEnd: resolved.chunk.pageEnd,
      contextText: resolved.chunk.text,
      ...(quote ? { quote } : {}),
      ...(quoteFidelity ? { quoteFidelity } : {}),
      ...(location
        ? {
            highlightStart: location.start,
            highlightEnd: location.end
          }
        : {})
    };
    citations.push(citation);
    output += quoteFidelity === "NOT_FOUND" ? `${marker} ${QUOTE_MISMATCH_MARKER}` : marker;
    cursor = match.index + match[0].length;
  }

  output += text.slice(cursor);
  return {
    text: output,
    citations,
    rejectedMarkers,
    quoteFindings: {
      autoLinked: linked.autoLinked + units.linked + anchors.list.length,
      mismatched,
      unsourced: linked.unsourced
    }
  };
}
