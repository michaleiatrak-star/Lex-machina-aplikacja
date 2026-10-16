import type { PiiSpan } from "./pseudonymizer.js";
import { findNameApproximately } from "./fuzzy-names.js";
import { genericWords } from "./generic-words.js";

// Names of private firms (REGULY-ANONIMIZACJI: [FIRMA]). A name is a firm when a legal
// form follows it ("Transkom sp. z o.o.", "Budex S.A.", "TERMEX SP. Z O.O.") or a business
// prefix precedes it ("P.H.U. Marex", "firma Budex", "Zakład Usługowy Mar-Pol"); every later
// mention of the same name, also inflected ("z Transkomem", "Budeksowi"), is the same firm.
// Public bodies stay visible.

// Legal forms in any letter case: headings and KRS extracts are written in capitals.
// OCR spellings count too: "Spólka", "Sp6łka", "sp. z 0.o.", "sp. zo.o.".
const SPOLK = "sp[óo60][łl1]k";
const LEGAL_FORM_AFTER = new RegExp(
  String.raw`^\s*,?\s*(?:sp\.\s?z\s?[o0]\.\s?[o0]\.|${SPOLK}[aiąę]\s+z\s+ograniczoną\s+odpowiedzialnością|${SPOLK}[aiąę]\s+(?:akcyjn|komandytow|jawn|partnersk)\p{L}*|s\.\s?a\.|sp\.\s?k\.(?:\s?a\.)?|sp\.\s?j\.|sp\.\s?p\.|s\.\s?c\.|s\.k\.a\.|p\.s\.a\.)`,
  "iu"
);
const PREFIX_BEFORE =
  /(?:\b(?:P\.?\s?P\.?\s?H\.?\s?U\.?|P\.?\s?H\.?\s?U\.?|F\.?\s?H\.?\s?U\.?|F\.?\s?P\.?\s?H\.?\s?U\.?)|(?<![\p{L}])(?:[Ff]irm(?:a|y|ie|ę|ą)|[Ss]p[óo60][łl1]k(?:a|i|ę|ą)|[Ss]p[óo60][łl1]ce|Przedsiębiorstw(?:o|a|u|em)))\s+[„"»]?$/u;
// Adjectives of a trade between a prefix and the name ("Firma Handlowa Budex",
// "Zakład Usługowy Mar-Pol", "Biuro Rachunkowe Bilans").
const TRADE_ADJECTIVE =
  /^(?:(?:Handlowo|Usługowo|Produkcyjno|Przemysłowo|Budowlano|Transportowo)-)?(?:Usługow|Handlow|Remontow|Budowlan|Ogólnobudowlan|Transportow|Produkcyjn|Rachunkow|Księgow|Instalacyjn|Projektow|Gastronomiczn|Spedycyjn|Techniczn|Kosmetyczn|Medyczn|Wielobranżow|Przemysłow|Elektryczn|Stolarsk|Ślusarsk|Mechaniczn|Informatyczn|Reklamow|Turystyczn|Poligraficzn|Ogrodnicz|Rolnicz|Weterynaryjn|Fryzjersk|Dekarsk|Brukarsk|Malarsk|Hydrauliczn)\p{L}*$/u;
// A trade noun is a business prefix only with a trade adjective after it:
// "Zakład Usługowy X" is a firm, "Zakład Ubezpieczeń Społecznych" is not.
const TRADE_NOUN =
  /(?<![\p{L}])(?:Zakład|Zakładu|Zakładem|Zakładzie|Biuro|Biura|Biurem|Usługi|Usług|Hurtownia|Hurtowni|Sklep|Sklepu|Warsztat|Warsztatu|Pracownia|Pracowni|Studio|Firma|Firmy|Firmie|Firmę|Firmą|Przedsiębiorstwo|Przedsiębiorstwa|Przedsiębiorstwie|Przedsiębiorstwem)\s+/gu;
const MAX_NAME_WORDS = 4;

// Words that open a sentence or name a role or a public body, never a firm's own name.
const NOT_A_NAME = new Set([
  "pozwana", "pozwany", "pozwanej", "pozwanego", "powód", "powódka", "powoda", "spółka", "spółki", "spółce", "spółkę", "spółką",
  "firma", "firmy", "firmie", "firmę", "firmą", "wierzyciel", "dłużnik", "zamawiający", "wykonawca", "najemca", "wynajmujący",
  "sprzedawca", "kupujący", "zleceniodawca", "zleceniobiorca", "pracodawca", "ubezpieczyciel", "przedsiębiorca", "uczestnik",
  "wnioskodawca", "w", "z", "ze", "i", "oraz", "a", "przez", "od", "do", "na", "dla", "przeciwko", "umowa", "umowę", "umowy",
  "zgodnie", "według", "strona", "strony", "skarb", "sąd", "sądu", "urząd", "urzędu", "gmina", "gminy", "miasto", "powiat",
  "województwo", "zakład", "prokuratura", "ministerstwo", "minister", "prezes", "rzecznik", "agencja", "instytut", "narodowy",
  "państwowy", "państwowe", "polski", "polska", "rzeczypospolitej", "pozwanym", "pozwaną", "spółkom", "krs", "nip", "regon",
  // The legal form itself, written with capitals ("Ciecierski Rak Spółka Komandytowa").
  "komandytowa", "komandytowej", "komandytową", "akcyjna", "akcyjnej", "akcyjną", "jawna", "jawnej", "jawną",
  "partnerska", "partnerskiej", "partnerską", "cywilna", "cywilnej", "cywilną",
  "zarząd", "zarządu", "zarządem", "zarządzie",
  // A profession or an office before a partnership's name ("Kancelaria Adwokatów i Radców
  // Prawnych Nowak Lis sp.k."): the name is the partners', not the profession's.
  "kancelaria", "kancelarii", "kancelarią", "adwokatów", "adwokata", "radców", "radcy", "prawnych", "prawnego",
  "notariusza", "notarialna", "notarialnej", "komorniczej", "doradców", "podatkowych"
]);

// A role word as OCR spells it ("Spólka" for "Spółka") is still a role word.
function notAName(lower: string): boolean {
  return NOT_A_NAME.has(lower) || NOT_A_NAME.has(lower.replace(/^sp[óo60][łl1]k/u, "spółk").replace(/^sp[óo60][łl1]c/u, "spółc"));
}

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
    if (!clean || !NAME_WORD.test(clean) || (!joiner && notAName(clean.toLocaleLowerCase("pl")))) break;
    // A word ending a sentence is not part of the name ("…zapłaty. Budex S.A.").
    if (index < words.length - 1 && /[.;:!?]$/u.test(word) && !/^\p{Lu}\.$/u.test(word)) break;
    picked.unshift(words[index]!);
  }
  // "w Katowicach i Human Park sp. z o.o.": a place after "w" is not the first firm's name.
  const before = words[words.length - picked.length - 1]?.[0];
  const joinerAt = picked.findIndex((word) => /^(?:i|&)$/u.test(word[0]));
  if (joinerAt > 0 && before && /^(?:w|we)$/iu.test(before)) picked.splice(0, joinerAt + 1);
  // A name of two words or more on its own line does not take words from the line above
  // ("Kancelaria Adwokatów i Radców Prawnych\nCiecierski Rak Spółka Komandytowa").
  const breakAt = picked.findIndex((word, index) => index > 0 && /\n/u.test(line.slice(picked[index - 1]!.index!, word.index!)));
  if (breakAt > 0 && picked.length - breakAt >= 2) picked.splice(0, breakAt);
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

function cleanWord(word: string): string {
  return word.replace(/^[„"»(]+|[”"«),:;]+$/gu, "");
}

/**
 * The name after a business prefix ("P.H.U. Marex", "spółce Nordic Trade Group"): up to four
 * capitalized words, after any trade adjectives; it stops at a lowercase word, a role or
 * public-body word and at the end of a sentence. Null for an institution ("spółka Skarbu
 * Państwa") or a prefix abbreviation ("firma P.H.U. Marex": the name follows it).
 */
function nameAfter(text: string, start: number, requireTrade = false, abbreviation = false): { start: number; value: string } | null {
  const institutions = genericWords().institutions;
  const words = [...text.slice(start, start + 120).matchAll(/\S+/gu)];
  let index = 0;
  let trade = false;
  while (index < words.length && TRADE_ADJECTIVE.test(cleanWord(words[index]![0]))) {
    trade = true;
    index += 1;
  }
  if (requireTrade && !trade) return null;
  const picked: RegExpMatchArray[] = [];
  for (; index < words.length && picked.length < MAX_NAME_WORDS; index += 1) {
    const raw = words[index]![0];
    const word = cleanWord(raw.replace(/[.!?]+$/u, ""));
    const joiner = picked.length > 0 && (word === "i" || word === "&");
    if (!joiner && !/^(?:\p{Lu}[\p{L}\d&'’-]*|\d[\p{L}\d-]*)$/u.test(word)) break;
    const lower = word.toLocaleLowerCase("pl");
    // After "P.H.U." every word is the firm's ("P.H.U. Mazowieckie Centrum Logistyki"); after
    // "spółka"/"firma" an institution word opens no name ("spółka Skarbu Państwa").
    const institution = !abbreviation && picked.length === 0 && institutions.has(lower);
    if (!joiner && (notAName(lower) || institution)) {
      if (picked.length === 0) return null;
      break;
    }
    // An abbreviation of the prefix itself ("firma P.H.U. Marex").
    if (picked.length === 0 && /^\p{Lu}{1,4}\.$/u.test(raw)) return null;
    picked.push(words[index]!);
    // A word that ends a sentence ends the name; an opening quote closes at its pair.
    if (/[.!?;:,)”"«]$/u.test(raw)) break;
  }
  while (picked.length && /^(?:i|&)$/u.test(picked.at(-1)![0])) picked.pop();
  if (!picked.length) return null;
  const first = picked[0]!;
  const last = picked.at(-1)!;
  const raw = text.slice(start + first.index!, start + last.index! + last[0].length);
  const lead = /^[„"»(]*/u.exec(raw)![0].length;
  const value = raw.slice(lead).replace(/[.,:;!?)”"«]+$/u, "");
  if (!/\p{L}{2}/u.test(value)) return null;
  return { start: start + first.index! + lead, value };
}

// A law or professional office: its brand before it is the firm's own name ("LORICA IURIS
// Kancelaria Adwokatów i Radców Prawnych", a letterhead "Lex Nova⏎Kancelaria Radcy Prawnego").
const OFFICE =
  /(?<![\p{L}])(?:Kancelari[aiąę]|KANCELARI[AIĄĘ])\s+(?:i\s+)?(?:Adwokac|Adwokat|Radc|Radcy|Prawn|Notarial|Notariusz|Komornicz|Komornik|Doradc|Podatkow|Patentow|ADWOKA|RADC|PRAWN|NOTARI|KOMORNI|DORADC|PODATKOW|PATENTOW)/gu;
const BRAND_WORD = /^\p{Lu}[\p{L}&'’.-]*$/u;

/** The brand right before an office: up to three capitalized words on its line, or a line of them above. */
function brandBefore(text: string, officeStart: number): { start: number; value: string } | null {
  const lineStart = text.lastIndexOf("\n", officeStart - 1) + 1;
  let segment = text.slice(lineStart, officeStart);
  let segmentStart = lineStart;
  if (!segment.trim() && lineStart > 0) {
    // The office opens its line: the brand is the whole line above ("LORICA IURIS⏎Kancelaria ...").
    const above = text.lastIndexOf("\n", lineStart - 2) + 1;
    segment = text.slice(above, lineStart - 1);
    segmentStart = above;
    const words = segment.trim().split(/\s+/u);
    if (!segment.trim() || words.length > 3 || !words.every((word) => BRAND_WORD.test(word) && !notAName(word.toLocaleLowerCase("pl")))) return null;
  }
  const words = [...segment.matchAll(/\S+/gu)];
  const picked: RegExpMatchArray[] = [];
  for (let index = words.length - 1; index >= 0 && picked.length < 3; index -= 1) {
    const word = words[index]![0];
    if (!BRAND_WORD.test(word) || notAName(word.toLocaleLowerCase("pl")) || genericWords().institutions.has(word.toLocaleLowerCase("pl"))) break;
    // A word ending a sentence or a clause is not part of the brand ("Sąd Rejonowy. Kancelaria ...").
    if (/[.;:!?,]$/u.test(word)) break;
    picked.unshift(words[index]!);
  }
  if (!picked.length) return null;
  const start = segmentStart + picked[0]!.index!;
  const last = picked.at(-1)!;
  const value = text.slice(start, segmentStart + last.index! + last[0].length).replace(/[.,]+$/u, "");
  return /\p{L}{3}/u.test(value) ? { start, value } : null;
}

// OCR reads a capital I as l or 1 ("Lorica luris"): a brand's later mentions allow it.
function ocrTolerant(value: string): string {
  return [...value]
    .map((char) => (/[iIl1]/u.test(char) ? "[iIlł1|]" : /\s/u.test(char) ? "\\s+" : char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
    .join("");
}

// Case endings of a firm's own name in a sentence ("z Transkomem", "Budeksowi").
const FIRM_ENDINGS = "a|u|owi|em|iem|ie|ze|y|ę|ą|om|ach|ami";

function inflectedStems(name: string): string[] {
  if (/\s/u.test(name) || name.length < 4 || !/\p{Ll}/u.test(name)) return [];
  const stems = [name];
  if (/x$/u.test(name)) stems.push(name.slice(0, -1) + "ks");
  return stems;
}

export type FirmSpan = PiiSpan & { legalForm?: string; canonical?: string };

// A part of a firm's name neither starts nor ends with a connector ("i Wspólnicy") and is
// not made of generic words alone ("Global Group").
const FRAGMENT_CONNECTOR = /^(?:i|oraz|&|and|und|et|w|z|na|do|-)$/iu;
const FRAGMENT_GENERIC = /^(?:global|group|grupa|polska|poland|international|invest|service|serwis|holding|consulting|trade|centrum|sp\.|spółka)$/iu;

/**
 * Parts of a firm's name of two or more words, as OCR or a later mention cuts it: "Park
 * Global" and "Human Park" of "Human Park Global". A name is one element: a surname or a
 * word inside it ("Park", "Rak" of "Ciecierski Rak") belongs to the firm there, not to a
 * person; outside the name it is judged on its own.
 */
export function firmFragments(name: string): string[] {
  const words = name.trim().split(/\s+/u);
  if (words.length < 3) return [];
  const parts: string[] = [];
  for (let size = words.length - 1; size >= 2; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const part = words.slice(start, start + size);
      if (FRAGMENT_CONNECTOR.test(part[0]!) || FRAGMENT_CONNECTOR.test(part[part.length - 1]!)) continue;
      if (part.every((word) => FRAGMENT_GENERIC.test(word) || FRAGMENT_CONNECTOR.test(word))) continue;
      if (!part.every((word) => /^[\p{Lu}\p{N}]/u.test(word) || FRAGMENT_CONNECTOR.test(word))) continue;
      parts.push(part.join(" "));
    }
  }
  return parts;
}

export function detectFirmNames(text: string): FirmSpan[] {
  const names = new Map<string, string | undefined>();
  const spans: FirmSpan[] = [];
  for (const match of text.matchAll(/\s*,?\s*(?:sp\.|sp[óo60][łl1]k|s\.\s?a\.|s\.\s?c\.|s\.k\.a\.|p\.s\.a\.)/giu)) {
    const legal = LEGAL_FORM_AFTER.exec(text.slice(match.index!, match.index! + 60));
    if (!legal) continue;
    // A sentence ends before the form: "magazyn w Gdyni. Spółka akcyjna zawarła..." names no firm.
    if (/[.!?;:]\s*$/u.test(text.slice(Math.max(0, match.index! - 2), match.index!))) continue;
    const name = nameBefore(text, match.index!);
    if (!name) continue;
    const form = legal[0].replace(/^[\s,]+/u, "").replace(/\s+/g, " ");
    names.set(name.value, form);
    spans.push({ start: name.start, end: name.start + name.value.length, kind: "PERSON", value: name.value, confidence: 0.95, source: "AUTO", legalForm: form });
  }
  const after = (end: number, requireTrade: boolean, abbreviation = false) => {
    const name = nameAfter(text, end, requireTrade, abbreviation);
    // A name already known (with its legal form) is added below as a later mention.
    if (!name || names.has(name.value) || spans.some((span) => span.start <= name.start && name.start < span.end)) return;
    names.set(name.value, undefined);
    spans.push({ start: name.start, end: name.start + name.value.length, kind: "PERSON", value: name.value, confidence: 0.9, source: "AUTO" });
  };
  for (const match of text.matchAll(/(?:P\.?\s?P\.?\s?H\.?\s?U\.?|P\.?\s?H\.?\s?U\.?|F\.?\s?H\.?\s?U\.?|[Ff]irm(?:a|y|ie|ę|ą)|[Ss]p[óo60][łl1]k(?:a|i|ę|ą)|[Ss]p[óo60][łl1]ce|Przedsiębiorstw(?:o|a|u|em))\s+/gu)) {
    const end = match.index! + match[0].length;
    if (!PREFIX_BEFORE.test(text.slice(match.index!, end))) continue;
    after(end, false, /^[PF]\.?\s?/u.test(match[0]) && !/^[Ff]irm|^Przeds/u.test(match[0]));
  }
  for (const match of text.matchAll(TRADE_NOUN)) after(match.index! + match[0].length, true);
  // Brands of law offices, and their mentions in any letter case and OCR spelling.
  const brands = new Set<string>();
  for (const match of text.matchAll(OFFICE)) {
    const brand = brandBefore(text, match.index!);
    if (!brand || spans.some((span) => span.start < brand.start + brand.value.length && brand.start < span.end)) continue;
    brands.add(brand.value);
    spans.push({ start: brand.start, end: brand.start + brand.value.length, kind: "PERSON", value: brand.value, confidence: 0.9, source: "AUTO" });
  }
  for (const brand of brands) {
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${ocrTolerant(brand)}(?![\\p{L}\\p{N}])`, "giu"))) {
      if (spans.some((span) => span.start < match.index! + match[0].length && match.index! < span.end)) continue;
      // Not a common phrase in small letters.
      if (match[0] === match[0].toLocaleLowerCase("pl")) continue;
      spans.push({
        start: match.index!, end: match.index! + match[0].length, kind: "PERSON", value: match[0], confidence: 0.9, source: "AUTO",
        ...(match[0] !== brand ? { canonical: brand } : {})
      });
    }
  }
  // Every other mention of a found name, also in another case.
  for (const [value, legalForm] of names) {
    // A name written in capitals in a heading is the same firm in normal spelling below
    // ("DOMBUD SP. Z O.O. ... Przedstawiciel Dombud").
    const spelled = value === value.toLocaleUpperCase("pl") && /\p{L}{2}/u.test(value)
      ? value.toLocaleLowerCase("pl").replace(/(^|[\s-])(\p{L})/gu, (_m, lead: string, letter: string) => lead + letter.toLocaleUpperCase("pl"))
      : null;
    const forms = [value, ...(spelled ? [spelled] : [])]
      .flatMap((form) => [form, ...firmFragments(form)])
      .map((form) => form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const stems = [value, ...(spelled ? [spelled] : [])]
      .flatMap((form) => inflectedStems(form))
      .map((stem) => stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = stems.length
      ? `(?:${forms.join("|")}|(?:${stems.join("|")})(?:${FIRM_ENDINGS}))`
      : `(?:${forms.join("|")})`;
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "gu"))) {
      if (spans.some((span) => span.start <= match.index! && match.index! < span.end)) continue;
      spans.push({
        start: match.index!, end: match.index! + match[0].length, kind: "PERSON", value: match[0], confidence: 0.9, source: "AUTO",
        ...(legalForm ? { legalForm } : {}),
        ...(match[0] !== value ? { canonical: value } : {})
      });
    }
  }
  // A name of two or more words as OCR damaged it ("uman Park Global"): the whole name within a
  // letter or two (fuzzy-names.ts), the same firm.
  for (const [value, legalForm] of names) {
    for (const match of findNameApproximately(text, value)) {
      if (spans.some((span) => span.start < match.end && match.start < span.end)) continue;
      spans.push({
        start: match.start, end: match.end, kind: "PERSON", value: match.value, confidence: 0.85, source: "AUTO",
        ...(legalForm ? { legalForm } : {}),
        canonical: value
      });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}
