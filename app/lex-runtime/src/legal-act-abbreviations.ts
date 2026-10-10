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

export function compactActAbbreviations(text: string): string {
  return DOTTED.reduce((value, [pattern, compact]) => value.replace(pattern, compact), text);
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
  /(?<!(?:\bart\.?|§|\d)\s*)\b(\d+[a-z]?)((?:\s*§\s*\d+[a-z]?)?)\s*(kpc|kpk|kpa|kro|ksh|kpw|kkw|kks|kc|kk|kp|kw)(?![\p{L}])/giu;

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
