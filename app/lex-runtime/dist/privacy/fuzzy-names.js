// A known name (a firm or a person from a register, a firm found in the text) as OCR damaged
// it: a letter lost, added or misread ("uman Park Global", "Hurnan Park Global", "Michal
// Wiatrak"). The whole name decides: the text is read in windows of as many words as the name
// has, and a window close enough to the whole name (after letter case, Polish letters and the
// usual OCR confusions are folded) is that name. A single word alone is never matched loosely.
const OCR_FOLD = { "0": "o", "1": "l", "|": "l", i: "l", ł: "l" };
/** Lowercase, without Polish letters, the usual OCR confusions folded (i/l/1/|, o/0). */
export function foldName(value) {
    return value
        .toLocaleLowerCase("pl")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[01|ił]/gu, (char) => OCR_FOLD[char] ?? char)
        .replace(/\s+/gu, " ")
        .trim();
}
function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit)
        return limit + 1;
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        let best = i;
        for (let j = 1; j <= b.length; j += 1) {
            const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            current.push(value);
            best = Math.min(best, value);
        }
        if (best > limit)
            return limit + 1;
        previous = current;
    }
    return previous[b.length];
}
/** Edits a name of this many letters may carry: none below 8, one from 8, two from 14. */
export function allowedEdits(name) {
    const letters = name.replace(/[^\p{L}\p{N}]/gu, "").length;
    return letters >= 14 ? 2 : letters >= 8 ? 1 : 0;
}
/**
 * Windows of the text that are the name, exactly or within the allowed edits. Only names of
 * two or more words: one damaged word alone is too weak a sign.
 */
export function findNameApproximately(text, name) {
    const target = foldName(name);
    const size = target.split(" ").length;
    if (size < 2)
        return [];
    const limit = allowedEdits(name);
    const words = [...text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}’'|-]*/gu)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
        value: match[0]
    }));
    const found = [];
    for (let index = 0; index + size <= words.length; index += 1) {
        const window = words.slice(index, index + size);
        // A name does not run across a sentence or a field: only spaces and line breaks between its words.
        if (window.some((word, offset) => offset > 0 && /[^\s]/u.test(text.slice(window[offset - 1].end, word.start))))
            continue;
        const value = text.slice(window[0].start, window.at(-1).end);
        // A common phrase in small letters is not the name.
        if (value === value.toLocaleLowerCase("pl"))
            continue;
        const folded = foldName(window.map((word) => word.value).join(" "));
        if (folded === target) {
            found.push({ start: window[0].start, end: window.at(-1).end, value, exact: value.replace(/\s+/gu, " ").toLocaleLowerCase("pl") === name.replace(/\s+/gu, " ").toLocaleLowerCase("pl") });
            continue;
        }
        // The first letters of every word but one agree: "uman Park Global" yes, "Lorem Ipsum Dolor" no.
        const initialsDiffer = window.filter((word, offset) => foldName(word.value)[0] !== target.split(" ")[offset][0]).length;
        if (limit === 0 || initialsDiffer > 1)
            continue;
        if (distance(folded, target, limit) <= limit) {
            found.push({ start: window[0].start, end: window.at(-1).end, value, exact: false });
        }
    }
    return found;
}
