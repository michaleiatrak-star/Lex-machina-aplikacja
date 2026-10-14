import type { IngestedPage, OcrCorrection } from "./document-ingestion.js";

/**
 * Spaces PaddleOCR drops (measured on two real 152 dpi scans: "ul.Pukowca15", "art.270",
 * "i8", "ipodlega", "siedzibąw", "wKatowicach"). Model-free and run on every OCR page:
 * a split is made only when its parts are words the dictionary knows (SGJP, PESEL names,
 * TERYT) and the glued token is not. Identifiers (KRS0001, ABC123456, PL61...) stay.
 */

export type KnownWords = (words: string[]) => Promise<boolean[]>;

// Short words a split may produce on its own ("i podlega", "siedzibą w", "do lat").
const FUNCTION_WORDS = new Set([
  "i", "w", "z", "o", "a", "u", "do", "od", "na", "po", "ze", "we", "że", "za", "ich", "jej", "jego",
  "lub", "oraz", "nie", "się", "dla", "przy", "pod", "nad", "bez", "albo", "czy", "jak", "to", "tym", "ten"
]);
const ABBREVIATION = /^(art|ust|pkt|poz|nr|par|lit|ul|al|pl|os|tel|kom|tj|zł)([.:])(\d)/iu;
const LETTERS_THEN_NUMBER = /^(\p{L}+)(\d{1,4}[A-Za-z]?(?:\/\d{1,4}[A-Za-z]?)?)$/u;
const NUMBER_THEN_WORD = /^(\d{1,4})(\p{Ll}{3,})$/u;
const EDGE = /^([("„»]*)(.*?)([)"”«.,;:!?]*)$/su;

type Proposal = { token: string; replacement: string; needs: string[]; functionWord?: boolean };

function isIdentifierLike(letters: string): boolean {
  // KRS0001025052, ABC123456, PL61...: capitals only (or one capital) before digits.
  return letters === letters.toLocaleUpperCase("pl");
}

/** Candidate replacements of one token and the words each one needs to be known. */
function candidates(token: string): Proposal[] {
  const edge = EDGE.exec(token);
  if (!edge) return [];
  const [, lead, core, trail] = edge as unknown as [string, string, string, string];
  if (!core || /\s/u.test(core)) return [];
  const wrap = (inner: string) => lead + inner + trail;
  const found: Proposal[] = [];

  const abbreviation = ABBREVIATION.exec(core);
  if (abbreviation) {
    const [, word, mark] = abbreviation;
    found.push({ token, replacement: wrap(`${word}${mark} ${core.slice(word!.length + 1)}`), needs: [] });
    return found;
  }
  const lettersNumber = LETTERS_THEN_NUMBER.exec(core);
  if (lettersNumber) {
    const [, letters, number] = lettersNumber;
    if (!isIdentifierLike(letters!) && (letters!.length >= 2 || FUNCTION_WORDS.has(letters!))) {
      found.push({ token, replacement: wrap(`${letters} ${number}`), needs: FUNCTION_WORDS.has(letters!) ? [] : [letters!] });
    }
    return found;
  }
  const numberWord = NUMBER_THEN_WORD.exec(core);
  if (numberWord) {
    const [, number, word] = numberWord;
    found.push({ token, replacement: wrap(`${number} ${word}`), needs: [word!] });
    return found;
  }
  // Two words glued: only a token that is all letters, starting lowercase.
  if (!/^\p{Ll}[\p{L}]+$/u.test(core) || core.length < 4) return [];
  for (let cut = 1; cut < core.length; cut += 1) {
    const left = core.slice(0, cut);
    const right = core.slice(cut);
    // "wKatowicach": a capital may start the right part only after a one-letter preposition.
    if (/\p{Lu}/u.test(right.slice(1)) || /\p{Lu}/u.test(left)) continue;
    if (/^\p{Lu}/u.test(right) && !(left.length === 1 && FUNCTION_WORDS.has(left))) continue;
    const short = (part: string) => part.length < 3 && !FUNCTION_WORDS.has(part.toLocaleLowerCase("pl"));
    if (short(left) || short(right)) continue;
    // A one-letter word at the end only after a long word ("siedzibą w"); the author's own
    // "opini" is not "opin i".
    if (right.length === 1 && left.length < 5) continue;
    // Negation is never moved: "nierozpowszechniać" stays as the author wrote it.
    if (left.toLocaleLowerCase("pl") === "nie") continue;
    found.push({
      token,
      replacement: wrap(`${left} ${right}`),
      // A function word needs no dictionary; it marks the preferred reading below.
      needs: [left, right].filter((part) => !FUNCTION_WORDS.has(part.toLocaleLowerCase("pl"))),
      functionWord: [left, right].some((part) => FUNCTION_WORDS.has(part.toLocaleLowerCase("pl")))
    });
  }
  return found;
}

/** The fixes for a set of lines: [line index, from, to]. */
export async function spacingFixes(lines: string[], knownWords: KnownWords): Promise<OcrCorrection[]> {
  const tokens = [...new Set(lines.flatMap((line) => line.split(/\s+/u)).filter(Boolean))];
  const proposals = new Map<string, Proposal[]>();
  for (const token of tokens) {
    const found = candidates(token);
    if (found.length) proposals.set(token, found);
  }
  if (!proposals.size) return [];
  // A glued token the dictionary already knows is a word, not a glue ("odpowiedzialność").
  const cores = [...proposals.keys()].map((token) => EDGE.exec(token)?.[2] ?? token);
  const words = [...new Set([...cores, ...[...proposals.values()].flat().flatMap((item) => item.needs)])];
  const flags = await knownWords(words);
  const known = new Set(words.filter((_, index) => flags[index]));
  const chosen = new Map<string, string>();
  for (const [token, items] of proposals) {
    const core = EDGE.exec(token)?.[2] ?? token;
    const glued = !/\d/u.test(core);
    if (glued && known.has(core)) continue;
    const valid = items.filter((item) => item.needs.every((word) => known.has(word)));
    if (!valid.length) continue;
    // Several two-word readings: the one with a short function word, and only if it is the only one.
    const preferred = valid.length === 1 ? valid : valid.filter((item) => item.functionWord);
    if (preferred.length === 1) chosen.set(token, preferred[0]!.replacement);
  }
  const fixes: OcrCorrection[] = [];
  lines.forEach((line, index) => {
    for (const token of line.split(/\s+/u)) {
      const to = chosen.get(token);
      if (to) fixes.push({ line: index, from: token, to });
    }
  });
  return fixes;
}

/** An OCR page with restored spaces; the original tokens are kept in `corrections`. */
export async function restoreOcrSpacing(page: IngestedPage, knownWords: KnownWords): Promise<IngestedPage> {
  if (page.source !== "OCR" || !page.lines?.length) return page;
  const texts = page.lines.map((line) => line.text);
  const fixes = await spacingFixes(texts, knownWords);
  if (!fixes.length) return page;
  const lines = page.lines.map((line, index) => {
    let text = line.text;
    for (const fix of fixes.filter((item) => item.line === index)) {
      text = text.replace(new RegExp(`(?<=^|\\s)${fix.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "u"), fix.to);
    }
    return { ...line, text };
  });
  return {
    ...page,
    lines,
    text: lines.map((line) => line.text).join("\n"),
    corrections: [...(page.corrections ?? []), ...fixes]
  };
}
