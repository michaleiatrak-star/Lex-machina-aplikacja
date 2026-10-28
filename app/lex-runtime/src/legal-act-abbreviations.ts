/**
 * Act abbreviations written with dots ("k.k.", "k. p. c.") in their compact
 * form ("KK", "KPC"), so "art. 233 k.k." and "art. 233 KK" are one provision
 * for detection, planning and the verification registry.
 */
const DOTTED: Array<[RegExp, string]> = ([
  ["k.p.c.", "KPC"],
  ["k.p.k.", "KPK"],
  ["k.p.a.", "KPA"],
  ["k.r.o.", "KRO"],
  ["k.s.h.", "KSH"],
  ["k.p.w.", "KPW"],
  ["k.k.w.", "KKW"],
  ["k.k.s.", "KKS"],
  ["k.c.", "KC"],
  ["k.k.", "KK"],
  ["k.p.", "KP"],
  ["k.w.", "KW"]
] as Array<[string, string]>).map(([dotted, compact]) => [
  new RegExp(`(?<![\\p{L}.])${dotted.replace(/\./g, "\\.\\s?").replace(/\\s\?$/, "")}(?![\\p{L}])`, "giu"),
  compact
]);

// Codes named in words, in any case ("Kodeksu cywilnego", "kodeksem pracy"): the same
// provision as "KC"/"KP" for the verification registry, so a provision verified in the
// session is not marked unverified because the answer names its code in full. Longest first.
const CODE = "kodeks(?:u|owi|em|ie)?\\s+";
const SPELLED_SOURCES: Array<[string, string]> = [
  ["postępowania\\s+cywilnego", "KPC"],
  ["postępowania\\s+karnego", "KPK"],
  ["postępowania\\s+administracyjnego", "KPA"],
  ["postępowania\\s+w\\s+sprawach\\s+o\\s+wykroczenia", "KPW"],
  ["karn\\p{L}*\\s+wykonawcz\\p{L}*", "KKW"],
  ["karn\\p{L}*\\s+skarbow\\p{L}*", "KKS"],
  ["rodzinn\\p{L}*\\s+i\\s+opiekuńcz\\p{L}*", "KRO"],
  ["spółek\\s+handlowych", "KSH"],
  ["cywiln\\p{L}*", "KC"],
  ["karn\\p{L}*", "KK"],
  ["pracy", "KP"],
  ["wykroczeń", "KW"]
];
const SPELLED: Array<[RegExp, string]> = SPELLED_SOURCES.map(([name, compact]) => [
  new RegExp(`(?<![\\p{L}])${CODE}${name}(?![\\p{L}])`, "giu"),
  compact
]);

// For a provision pattern: the codes named in words, longest first.
export const SPELLED_ACT_ALTERNATIVES = SPELLED_SOURCES.map(([name]) => `${CODE}${name}`).join("|");

const SUPERSCRIPT_DIGITS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

/** "art. 101² KP" -> "art. 101^2 KP": one unit, never art. 101 or (after NFKC) art. 1012. */
export function caretSuperscripts(text: string): string {
  return text.replace(/(\d)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/gu, (_match, digit: string, sup: string) => `${digit}^${[...sup].map((char) => SUPERSCRIPT_DIGITS[char]).join("")}`);
}

export function compactActAbbreviations(text: string): string {
  const dotted = DOTTED.reduce((value, [pattern, compact]) => value.replace(pattern, compact), caretSuperscripts(text));
  return SPELLED.reduce((value, [pattern, compact]) => value.replace(pattern, compact), dotted);
}

// Początek powołania artykułu we wszystkich modułach: "art. 415", "art.415", "art 415",
// "artykuł 415", "artykułem 415" (wymaga flag "iu").
export const ARTICLE_LEAD = "\\b(?:art\\.?|artykuł\\p{L}*)\\s*(?=\\d)";

/** Jedna postać w rejestrze weryfikacji: "artykułem 415", "art.415" -> "art. 415". */
export function canonicalArticleLead(text: string): string {
  return text.replace(/\b(a)rt(?:\.|ykuł\p{L}*)?\s*(?=\d)/giu, "$1rt. ");
}

// For a provision pattern: the dotted forms, longest first.
export const DOTTED_ACT_ALTERNATIVES =
  "k\\.\\s?p\\.\\s?c\\.|k\\.\\s?p\\.\\s?k\\.|k\\.\\s?p\\.\\s?a\\.|k\\.\\s?r\\.\\s?o\\.|k\\.\\s?s\\.\\s?h\\.|k\\.\\s?p\\.\\s?w\\.|k\\.\\s?k\\.\\s?w\\.|k\\.\\s?k\\.\\s?s\\.|k\\.\\s?c\\.|k\\.\\s?k\\.|k\\.\\s?p\\.|k\\.\\s?w\\.";

const BARE_PROVISION =
  // Not a number of a unit or a superscript of an article ("art. 55^1 KP", "pkt 2 KP").
  /(?<!(?:\bart\.?|§|\d|\^|\bpkt|\bust\.?|\blit\.?|\bpoz\.?|\bnr\.?)\s*)\b(\d+[a-z]?)((?:\s*§\s*\d+[a-z]?)?)\s*(kpc|kpk|kpa|kro|ksh|kpw|kkw|kks|kc|kk|kp|kw)(?![\p{L}])/giu;

/**
 * A question's provisions in the form the detector reads: "233 kk" and
 * "art. 233 k.k." become "art. 233 KK", so the runtime verifies them before
 * the answer as it does "art. 233 KK".
 */
export function provisionsForDetection(text: string): string {
  return compactActAbbreviations(text)
    .replace(BARE_PROVISION, (_match, number: string, paragraph: string, act: string) => `art. ${number}${paragraph} ${act.toUpperCase()}`)
    .replace(/(\bart\.?\s+\d+[a-z]?(?:\s*§\s*\d+[a-z]?)?\s+)(kpc|kpk|kpa|kro|ksh|kpw|kc|kk|kp|kw)(?![\p{L}])/giu, (_match, head: string, act: string) => `${head}${act.toUpperCase()}`);
}

// Statutes written as dotted abbreviations ("art. 36a u.k.k."): their titles, so an
// article is matched to the statute it names, never to the only code of the answer
// (E2E W3: "art. 36a ust. 1 u.k.k." became "art. 36a ust. 1 KC" next to "art. 720² KC").
const STATUTE_TITLES: Array<[string, string]> = [
  ["u.p.r.s.k.", "ustawy o pozasądowym rozwiązywaniu sporów konsumenckich"],
  ["u.o.k.k.", "ustawy o ochronie konkurencji i konsumentów"],
  ["u.o.d.o.", "ustawy o ochronie danych osobowych"],
  ["u.d.i.p.", "ustawy o dostępie do informacji publicznej"],
  ["u.p.z.p.", "ustawy o planowaniu i zagospodarowaniu przestrzennym"],
  ["u.k.h.", "ustawy o kredycie hipotecznym"],
  ["u.k.k.", "ustawy o kredycie konsumenckim"],
  ["u.p.k.", "ustawy o prawach konsumenta"],
  ["u.g.n.", "ustawy o gospodarce nieruchomościami"],
  ["u.s.g.", "ustawy o samorządzie gminnym"],
  ["u.o.l.", "ustawy o ochronie praw lokatorów"]
];
const STATUTE_TITLE_PATTERNS: Array<[RegExp, string]> = STATUTE_TITLES.map(([dotted, title]) => [
  new RegExp(`(?<![\\p{L}.])${dotted.replace(/\./g, "\\.\\s?").replace(/\\s\?$/, "")}(?![\\p{L}])`, "giu"),
  `${title} (${dotted})`
]);
// Any other "u.x.y." abbreviation: a statute, not one of the codes (KC, KK…).
export const DOTTED_STATUTE = /(?<![\p{L}.])u\.\s?(?:\p{L}{1,5}\.\s?){1,6}/iu;

/** "art. 36a u.k.k." -> "art. 36a ustawy o kredycie konsumenckim (u.k.k.)". */
export function withStatuteTitles(text: string): string {
  return STATUTE_TITLE_PATTERNS.reduce((value, [pattern, title]) => value.replace(pattern, title), text);
}
