import type { PiiSpan } from "./pseudonymizer.js";

// Names of private firms (REGULY-ANONIMIZACJI: [FIRMA]). A name is a firm when a legal
// form follows it ("Transkom sp. z o.o.", "Budex S.A.", "Kowalski i Wspólnicy sp.k.") or
// a business prefix precedes it ("P.H.U. Marex", "firma Budex"); every later mention of
// the same name ("ze spółką Transkom") is the same firm. Public bodies stay visible.

const LEGAL_FORM_AFTER =
  /^\s*,?\s*(?:sp\.\s?z\s?o\.\s?o\.|Sp\.\s?z\s?o\.\s?o\.|spółk[aiąęę]\s+z\s+ograniczoną\s+odpowiedzialnością|spółk[aiąę]\s+(?:akcyjn|komandytow|jawn|partnersk)\p{L}*|S\.\s?A\.|sp\.\s?k\.(?:\s?a\.)?|Sp\.\s?k\.|sp\.\s?j\.|Sp\.\s?j\.|sp\.\s?p\.|s\.\s?c\.|S\.K\.A\.|P\.S\.A\.)/u;
const PREFIX_BEFORE =
  /(?:\b(?:P\.?\s?P\.?\s?H\.?\s?U\.?|P\.?\s?H\.?\s?U\.?|F\.?\s?H\.?\s?U\.?|F\.?\s?P\.?\s?H\.?\s?U\.?)|(?<![\p{L}])(?:[Ff]irm(?:a|y|ie|ę|ą)|[Ss]półk(?:a|i|ę|ą|ce)|Przedsiębiorstw(?:o|a|u|em)))\s+[„"»]?$/u;

// Words that open a sentence or name a role or a public body, never a firm's own name.
const NOT_A_NAME = new Set([
  "pozwana", "pozwany", "pozwanej", "pozwanego", "powód", "powódka", "powoda", "spółka", "spółki", "spółce", "spółkę", "spółką",
  "firma", "firmy", "firmie", "firmę", "firmą", "wierzyciel", "dłużnik", "zamawiający", "wykonawca", "najemca", "wynajmujący",
  "sprzedawca", "kupujący", "zleceniodawca", "zleceniobiorca", "pracodawca", "ubezpieczyciel", "przedsiębiorca", "uczestnik",
  "wnioskodawca", "w", "z", "ze", "i", "oraz", "a", "przez", "od", "do", "na", "dla", "przeciwko", "umowa", "umowę", "umowy",
  "zgodnie", "według", "strona", "strony", "skarb", "sąd", "sądu", "urząd", "urzędu", "gmina", "gminy", "miasto", "powiat",
  "województwo", "zakład", "prokuratura", "ministerstwo", "minister", "prezes", "rzecznik", "agencja", "instytut", "narodowy",
  "państwowy", "państwowe", "polski", "polska", "rzeczypospolitej", "pozwanym", "pozwaną", "spółkom", "krs", "nip", "regon"
]);

const NAME_WORD = /^(?:[„"»]?\p{Lu}[\p{L}\d&'’.-]*[”"«]?|\d[\p{L}\d-]*|i|&)$/u;

/** The firm name right before a legal form: up to four name words, back to a role word. */
function nameBefore(text: string, end: number): { start: number; value: string } | null {
  const line = text.slice(Math.max(0, end - 80), end);
  const words = [...line.matchAll(/\S+/gu)];
  const picked: RegExpMatchArray[] = [];
  for (let index = words.length - 1; index >= 0 && picked.length < 4; index -= 1) {
    const word = words[index]![0];
    const clean = word.replace(/^[„"»(]+|[”"«),:;]+$/gu, "");
    const joiner = clean === "i" || clean === "&";
    if (!clean || !NAME_WORD.test(clean) || (!joiner && NOT_A_NAME.has(clean.toLocaleLowerCase("pl")))) break;
    // A word ending a sentence is not part of the name ("…zapłaty. Budex S.A.").
    if (index < words.length - 1 && /[.;:!?]$/u.test(word) && !/^\p{Lu}\.$/u.test(word)) break;
    picked.unshift(words[index]!);
  }
  while (picked.length && /^(?:i|&)$/u.test(picked[0]![0])) picked.shift();
  if (!picked.length) return null;
  const startInLine = picked[0]!.index!;
  const lastWord = picked.at(-1)!;
  const raw = line.slice(startInLine, lastWord.index! + lastWord[0].length).replace(/[,:;]+$/u, "").replace(/^[„"»(]+/u, "");
  const offset = line.slice(startInLine).indexOf(raw);
  const value = raw.replace(/[”"«]+$/u, "");
  if (!/\p{L}{2}/u.test(value)) return null;
  return { start: end - line.length + startInLine + offset, value };
}

/** One name word right after a business prefix ("P.H.U. Marex"). */
function nameAfter(text: string, start: number): { start: number; value: string } | null {
  const match = /^\s*[„"»]?(\p{Lu}[\p{L}\d&'’-]*(?:-\p{Lu}[\p{L}\d-]*)?)/u.exec(text.slice(start, start + 60));
  if (!match || NOT_A_NAME.has(match[1]!.toLocaleLowerCase("pl"))) return null;
  // An abbreviation of the prefix itself ("firma P.H.U. Marex"): the name follows it.
  const next = text[start + match[0].length];
  if (next === "." && match[1]!.length <= 4) return null;
  return { start: start + match[0].length - match[1]!.length, value: match[1]! };
}

export type FirmSpan = PiiSpan & { legalForm?: string };

export function detectFirmNames(text: string): FirmSpan[] {
  const names = new Map<string, string | undefined>();
  const spans: FirmSpan[] = [];
  for (const match of text.matchAll(/\s*,?\s*(?:sp\.|Sp\.|spółk|S\.\s?A\.|s\.\s?c\.|S\.K\.A\.|P\.S\.A\.)/gu)) {
    const legal = LEGAL_FORM_AFTER.exec(text.slice(match.index!, match.index! + 60));
    if (!legal) continue;
    const name = nameBefore(text, match.index!);
    if (!name) continue;
    const form = legal[0].replace(/^[\s,]+/u, "").replace(/\s+/g, " ");
    names.set(name.value, form);
    spans.push({ start: name.start, end: name.start + name.value.length, kind: "PERSON", value: name.value, confidence: 0.95, source: "AUTO", legalForm: form });
  }
  for (const match of text.matchAll(/(?:P\.?\s?P\.?\s?H\.?\s?U\.?|P\.?\s?H\.?\s?U\.?|F\.?\s?H\.?\s?U\.?|[Ff]irm(?:a|y|ie|ę|ą)|[Ss]półk(?:a|i|ę|ą|ce)|Przedsiębiorstw(?:o|a|u|em))\s+/gu)) {
    const end = match.index! + match[0].length;
    if (!PREFIX_BEFORE.test(text.slice(match.index!, end))) continue;
    const name = nameAfter(text, end);
    if (!name || names.has(name.value)) continue;
    names.set(name.value, undefined);
    spans.push({ start: name.start, end: name.start + name.value.length, kind: "PERSON", value: name.value, confidence: 0.9, source: "AUTO" });
  }
  // Every other mention of a found name.
  for (const [value, legalForm] of names) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"))) {
      if (spans.some((span) => span.start === match.index)) continue;
      spans.push({ start: match.index!, end: match.index! + value.length, kind: "PERSON", value, confidence: 0.9, source: "AUTO", ...(legalForm ? { legalForm } : {}) });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
