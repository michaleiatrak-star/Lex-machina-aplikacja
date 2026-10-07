/**
 * Messages typed without Polish letters ("napisz zazalenie", "pytania do swiadka") miss
 * the routing phrases of the skills, which are written with them. The words of the
 * skill corpus give the spelling back: a plain word becomes the corpus word when one
 * accented spelling clearly dominates it in the corpus (file names and identifiers are
 * written without Polish letters, so the plain spelling occurs too, but far less often).
 */
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/u;
const LETTERS = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z" };
export function plainLetters(text) {
    return text.replace(/[ąćęłńóśźż]/gu, (letter) => LETTERS[letter]);
}
// The accented spelling wins when it is at least this many times more frequent than
// the plain one and than any other accented spelling of the same plain word.
const DOMINANCE = 3;
export function buildAccentMap(texts) {
    // Single words, and pairs of words: "ocen" is a word of its own ("ocen" of "ocena"),
    // "ocen szanse" is only "oceń szanse".
    const counts = new Map();
    const count = (spelled) => {
        const plain = plainLetters(spelled);
        const spellings = counts.get(plain) ?? new Map();
        spellings.set(spelled, (spellings.get(spelled) ?? 0) + 1);
        counts.set(plain, spellings);
    };
    for (const text of texts) {
        const words = text.toLocaleLowerCase("pl").match(/\p{L}{2,}/gu) ?? [];
        words.forEach((word, index) => {
            count(word);
            if (index > 0)
                count(`${words[index - 1]} ${word}`);
        });
    }
    const map = new Map();
    for (const [plain, spellings] of counts) {
        const ranked = [...spellings].filter(([word]) => word !== plain).sort((a, b) => b[1] - a[1]);
        const best = ranked[0];
        if (!best)
            continue;
        const rival = Math.max(spellings.get(plain) ?? 0, ranked[1]?.[1] ?? 0);
        if (best[1] >= DOMINANCE * Math.max(rival, 1) || (rival === 0 && best[1] >= 1))
            map.set(plain, best[0]);
    }
    return map;
}
/** The text with Polish letters restored, when it has none of its own; otherwise unchanged. */
export function restoreAccents(text, map) {
    if (POLISH.test(text) || map.size === 0)
        return text;
    const words = [...text.matchAll(/\p{L}{2,}/gu)];
    const spelled = words.map((match) => map.get(match[0].toLocaleLowerCase("pl")) ?? null);
    // A pair decides a word its single spelling leaves open.
    for (let index = 1; index < words.length; index += 1) {
        const pair = map.get(`${words[index - 1][0]} ${words[index][0]}`.toLocaleLowerCase("pl"));
        if (!pair)
            continue;
        const [first, second] = pair.split(" ");
        spelled[index - 1] ??= first;
        spelled[index] ??= second;
    }
    let result = "";
    let at = 0;
    words.forEach((match, index) => {
        const word = match[0];
        const accented = spelled[index];
        result += text.slice(at, match.index) + (accented ? keepCase(word, accented) : word);
        at = match.index + word.length;
    });
    return result + text.slice(at);
}
function keepCase(word, accented) {
    return word[0] === word[0].toLocaleUpperCase("pl") ? accented[0].toLocaleUpperCase("pl") + accented.slice(1) : accented;
}
