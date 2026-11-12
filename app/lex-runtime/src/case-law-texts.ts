// Long rulings for the model, as the chat reads them: the beginning (court, composition,
// operative part) and the passages around what the case file quotes from that ruling, with the
// rest read in portions by read_case_law_text (user, 2026-11-12: fragments instead of higher
// limits; a higher limit lengthens every model round, and the chat reads a long text in parts).

export const CASE_TEXT_BUDGET = 15_000;
// A local model (Bielik, Mistral: a small context window) gets shorter excerpts.
export const LOCAL_CASE_TEXT_BUDGET = 5_000;
export const CASE_TEXT_PORTION = 15_000;
const HEAD = 3_000;
const WINDOW = 1_500;

type Held = { signature: string; source: string; text: string };
const held = new Map<string, Held>();
const key = (signature: string): string => signature.normalize("NFKC").replace(/\./gu, "").replace(/\s+/gu, " ").trim().toLocaleUpperCase("pl");

/** A ruling's full text read in this run (SN, SAOS, WSD portal), for read_case_law_text. */
export function holdCaseLawText(signature: string, source: string, text: string): void {
  if (text) held.set(key(signature), { signature, source, text });
}

export function heldCaseLawText(signature: string): Held | null {
  return held.get(key(signature)) ?? null;
}

const flat = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").toLocaleLowerCase("pl");

/** Quotations the case file attributes to this ruling: „…” within 600 characters after its signature. */
export function quotesForSignature(fileText: string, signature: string): string[] {
  const quotes: string[] = [];
  const at = (from: number) => fileText.indexOf(signature, from);
  for (let index = at(0); index >= 0; index = at(index + signature.length)) {
    const window = fileText.slice(index, index + 600);
    for (const match of window.matchAll(/„([^„”]{20,600})”/gu)) quotes.push(match[1]!);
  }
  return [...new Set(quotes)].slice(0, 8);
}

/**
 * The text whole when it fits the budget; otherwise its beginning and a window around each quote
 * found in it (by its first words), in their order, with the omitted parts named.
 */
export function caseTextExcerpt(text: string, quotes: readonly string[], budget = CASE_TEXT_BUDGET): { text: string; truncated: boolean; chars: number } {
  if (text.length <= budget) return { text, truncated: false, chars: text.length };
  const lower = flat(text);
  // flat() keeps the length only when the text has no runs of whitespace: positions are found
  // in the flattened text and the excerpt is cut from it.
  const ranges: Array<[number, number]> = [[0, HEAD]];
  for (const quote of quotes) {
    const probe = flat(quote).split(" ").slice(0, 8).join(" ");
    const found = probe.length > 15 ? lower.indexOf(probe) : -1;
    if (found >= 0) ranges.push([Math.max(0, found - WINDOW / 2), Math.min(lower.length, found + probe.length + WINDOW)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1] + 200) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const source = text.normalize("NFKC").replace(/\s+/gu, " ");
  let out = "";
  let cursor = 0;
  for (const [from, to] of merged) {
    if (out.length >= budget) break;
    if (from > cursor) out += `\n[… pominięto znaki ${cursor}–${from}; doczytaj read_case_law_text z offset=${from} …]\n`;
    out += source.slice(from, Math.min(to, from + budget - out.length));
    cursor = to;
  }
  if (cursor < source.length) out += `\n[… dalej od znaku ${cursor} z ${source.length}; doczytaj read_case_law_text z offset=${cursor} …]`;
  return { text: out, truncated: true, chars: source.length };
}

/** A portion of a held ruling for read_case_law_text. */
export function caseTextPortion(signature: string, offset: number): string {
  const entry = heldCaseLawText(signature);
  if (!entry) return JSON.stringify({ status: "NOT_HELD", signature, instruction: "Ten tekst nie był pobrany w tej sesji; zweryfikuj sygnaturę narzędziem właściwego sądu." });
  const source = entry.text.normalize("NFKC").replace(/\s+/gu, " ");
  const from = Math.max(0, Math.min(Math.trunc(offset) || 0, source.length));
  const to = Math.min(source.length, from + CASE_TEXT_PORTION);
  return JSON.stringify({ status: "OK", signature: entry.signature, source: entry.source, offset: from, nextOffset: to < source.length ? to : null, total: source.length, text: source.slice(from, to) });
}
