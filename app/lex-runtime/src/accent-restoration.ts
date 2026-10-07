/**
 * Messages typed without Polish letters ("napisz zazalenie", "pytania do swiadka") miss
 * the routing phrases of the skills, which are written with them. The words of the
 * skill corpus give the spelling back: a plain word becomes the corpus word when one
 * accented spelling clearly dominates it in the corpus (file names and identifiers are
 * written without Polish letters, so the plain spelling occurs too, but far less often).
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/u;
const LETTERS: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };

export function plainLetters(text: string): string {
  return text.replace(/[ąćęłńóśźż]/gu, (letter) => LETTERS[letter]!);
}

export type AccentMap = Map<string, string>;

// The accented spelling wins when it is at least this many times more frequent than
// the plain one and than any other accented spelling of the same plain word.
const DOMINANCE = 3;

export function buildAccentMap(texts: string[]): AccentMap {
  const counts = new Map<string, Map<string, number>>();
  for (const text of texts) {
    for (const raw of text.toLocaleLowerCase("pl").match(/\p{L}{2,}/gu) ?? []) {
      const plain = plainLetters(raw);
      const spellings = counts.get(plain) ?? new Map<string, number>();
      spellings.set(raw, (spellings.get(raw) ?? 0) + 1);
      counts.set(plain, spellings);
    }
  }
  const map: AccentMap = new Map();
  for (const [plain, spellings] of counts) {
    const ranked = [...spellings].filter(([word]) => word !== plain).sort((a, b) => b[1] - a[1]);
    const best = ranked[0];
    if (!best) continue;
    const rival = Math.max(spellings.get(plain) ?? 0, ranked[1]?.[1] ?? 0);
    if (best[1] >= DOMINANCE * Math.max(rival, 1) || (rival === 0 && best[1] >= 1)) map.set(plain, best[0]);
  }
  return map;
}

/** The text with Polish letters restored, when it has none of its own; otherwise unchanged. */
export function restoreAccents(text: string, map: AccentMap): string {
  if (POLISH.test(text) || map.size === 0) return text;
  return text.replace(/\p{L}{2,}/gu, (word) => {
    const accented = map.get(word.toLocaleLowerCase("pl"));
    if (!accented) return word;
    return word[0] === word[0]!.toLocaleUpperCase("pl") ? accented[0]!.toLocaleUpperCase("pl") + accented.slice(1) : accented;
  });
}
