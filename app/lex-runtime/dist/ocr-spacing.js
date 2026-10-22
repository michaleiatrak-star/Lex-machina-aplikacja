import { ocrPageText } from "./document-ingestion.js";
// Short words a split may produce on its own ("i podlega", "siedzibą w", "do lat").
const FUNCTION_WORDS = new Set([
    "i", "w", "z", "o", "a", "u", "do", "od", "na", "po", "ze", "we", "że", "za", "ich", "jej", "jego",
    "lub", "oraz", "nie", "się", "dla", "przy", "pod", "nad", "bez", "albo", "czy", "jak", "to", "tym", "ten"
]);
const ABBREVIATION = /^(art|ust|pkt|poz|nr|par|lit|ul|al|pl|os|tel|kom|tj|zł)([.:])(\d)/iu;
const LETTERS_THEN_NUMBER = /^(\p{L}+)(\d{1,4}[A-Za-z]?(?:\/\d{1,4}[A-Za-z]?)?)$/u;
const NUMBER_THEN_WORD = /^(\d{1,4})(\p{Ll}{3,})$/u;
// An amount with a letter o read for a zero: "20.ooo,00", "60.0o0,00".
const AMOUNT_WITH_O = /^\d{1,3}(?:\.[\doO]{3})*,[\doO]{2}$/u;
const EDGE = /^([("„»]*)(.*?)([)"”«.,;:!?]*)$/su;
// Letters OCR reads for one another: a lost diacritic ("prosze") or a close shape ("pracowniezych").
const CONFUSABLE = {
    a: "ą", ą: "a", c: "će", ć: "c", e: "ęc", ę: "e", l: "łi", ł: "l", n: "ń", ń: "n", o: "ó", ó: "o",
    s: "ś", ś: "s", z: "żź", ż: "z", ź: "z", i: "l"
};
/** The token with one letter read differently: "prosze" -> "proszę", "pracowniezych" -> "pracowniczych". */
function misreadings(core) {
    const found = [];
    [...core].forEach((letter, index) => {
        for (const other of CONFUSABLE[letter] ?? "")
            found.push(core.slice(0, index) + other + core.slice(index + 1));
    });
    return found;
}
function isIdentifierLike(letters) {
    // KRS0001025052, ABC123456, PL61...: capitals only (or one capital) before digits.
    return letters === letters.toLocaleUpperCase("pl");
}
/** Candidate replacements of one token and the words each one needs to be known. */
function candidates(token) {
    const edge = EDGE.exec(token);
    if (!edge)
        return [];
    const [, lead, core, trail] = edge;
    if (!core || /\s/u.test(core))
        return [];
    const wrap = (inner) => lead + inner + trail;
    const found = [];
    if (AMOUNT_WITH_O.test(core) && /[oO]/u.test(core)) {
        found.push({ token, replacement: wrap(core.replace(/[oO]/gu, "0")), needs: [] });
        return found;
    }
    const abbreviation = ABBREVIATION.exec(core);
    if (abbreviation) {
        const [, word, mark] = abbreviation;
        found.push({ token, replacement: wrap(`${word}${mark} ${core.slice(word.length + 1)}`), needs: [] });
        return found;
    }
    const lettersNumber = LETTERS_THEN_NUMBER.exec(core);
    if (lettersNumber) {
        const [, letters, number] = lettersNumber;
        if (!isIdentifierLike(letters) && (letters.length >= 2 || FUNCTION_WORDS.has(letters))) {
            found.push({ token, replacement: wrap(`${letters} ${number}`), needs: FUNCTION_WORDS.has(letters) ? [] : [letters] });
        }
        return found;
    }
    const numberWord = NUMBER_THEN_WORD.exec(core);
    if (numberWord) {
        const [, number, word] = numberWord;
        found.push({ token, replacement: wrap(`${number} ${word}`), needs: [word] });
        return found;
    }
    // Two words glued: only a token that is all letters, starting lowercase.
    if (!/^\p{Ll}[\p{L}]+$/u.test(core) || core.length < 4)
        return [];
    for (let cut = 1; cut < core.length; cut += 1) {
        const left = core.slice(0, cut);
        const right = core.slice(cut);
        // "wKatowicach": a capital may start the right part only after a one-letter preposition.
        if (/\p{Lu}/u.test(right.slice(1)) || /\p{Lu}/u.test(left))
            continue;
        if (/^\p{Lu}/u.test(right) && !(left.length === 1 && FUNCTION_WORDS.has(left)))
            continue;
        const short = (part) => part.length < 3 && !FUNCTION_WORDS.has(part.toLocaleLowerCase("pl"));
        if (short(left) || short(right))
            continue;
        // A one-letter word at the end only after a long word ("siedzibą w"); the author's own
        // "opini" is not "opin i".
        if (right.length === 1 && left.length < 5)
            continue;
        // Negation is never moved: "nierozpowszechniać" stays as the author wrote it.
        if (left.toLocaleLowerCase("pl") === "nie")
            continue;
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
const DIACRITIC = {
    a: "ą", c: "ć", e: "ę", l: "ł", n: "ń", o: "ó", s: "ś", z: "żź",
    A: "Ą", C: "Ć", E: "Ę", L: "Ł", N: "Ń", O: "Ó", S: "Ś", Z: "ŻŹ"
};
const PLAIN_WORD = /^\p{L}{5,}$/u;
function withDiacritic(core) {
    const found = [];
    [...core].forEach((letter, index) => {
        for (const other of DIACRITIC[letter] ?? "")
            found.push(core.slice(0, index) + other + core.slice(index + 1));
    });
    return found;
}
/**
 * A word with one diacritic lost ("Spólka", "Zarzadu", "PELNOMOCNICTWO"): the token is unknown and
 * exactly one reading with the diacritic is a common word. Asked in lowercase, so a name written
 * without diacritics ("Czaplowski", "Grazyne") stays as written.
 */
async function diacriticFixes(tokens, knownWords) {
    const lower = (word) => word.toLocaleLowerCase("pl");
    const plain = tokens.filter((token) => PLAIN_WORD.test(EDGE.exec(token)?.[2] ?? ""));
    const cores = [...new Set(plain.map((token) => EDGE.exec(token)[2]))];
    const words = [...new Set(cores.flatMap((core) => [core, lower(core), ...withDiacritic(core).map(lower)]))];
    if (!words.length)
        return new Map();
    const flags = await knownWords(words);
    const known = new Set(words.filter((_, index) => flags[index]));
    const chosen = new Map();
    for (const token of plain) {
        const [, lead, core, trail] = EDGE.exec(token);
        if (known.has(core) || known.has(lower(core)))
            continue;
        const readings = withDiacritic(core).filter((word) => known.has(lower(word)));
        if (readings.length === 1)
            chosen.set(token, lead + readings[0] + trail);
    }
    return chosen;
}
/** The fixes for a set of lines: [line index, from, to]. */
export async function spacingFixes(lines, knownWords) {
    const tokens = [...new Set(lines.flatMap((line) => line.split(/\s+/u)).filter(Boolean))];
    const proposals = new Map();
    for (const token of tokens) {
        const found = candidates(token);
        if (found.length)
            proposals.set(token, found);
    }
    const cores = [...proposals.keys()].map((token) => EDGE.exec(token)?.[2] ?? token);
    const glued = cores.filter((core) => !/\d/u.test(core));
    const words = [
        ...new Set([...cores, ...glued.flatMap(misreadings), ...[...proposals.values()].flat().flatMap((item) => item.needs)])
    ];
    const flags = words.length ? await knownWords(words) : [];
    const known = new Set(words.filter((_, index) => flags[index]));
    const chosen = new Map();
    for (const [token, items] of proposals) {
        const core = EDGE.exec(token)?.[2] ?? token;
        // A glued token the dictionary knows, or knows with one letter read differently, is a
        // (misread) word: "prosze" is "proszę", not "pros ze".
        if (!/\d/u.test(core) && (known.has(core) || misreadings(core).some((word) => known.has(word))))
            continue;
        const valid = items.filter((item) => item.needs.every((word) => known.has(word)));
        if (!valid.length)
            continue;
        // Several two-word readings: the one with a short function word, and only if it is the only one.
        const preferred = valid.length === 1 ? valid : valid.filter((item) => item.functionWord);
        if (preferred.length === 1)
            chosen.set(token, preferred[0].replacement);
    }
    const misread = await diacriticFixes(tokens.filter((token) => !chosen.has(token)), knownWords);
    for (const [token, to] of misread)
        chosen.set(token, to);
    const fixes = [];
    lines.forEach((line, index) => {
        for (const token of line.split(/\s+/u)) {
            const to = chosen.get(token);
            if (to)
                fixes.push({ line: index, from: token, to });
        }
    });
    return fixes;
}
/** An OCR page with restored spaces; the original tokens are kept in `corrections`. */
export async function restoreOcrSpacing(page, knownWords) {
    if (page.source !== "OCR" || !page.lines?.length)
        return page;
    const texts = page.lines.map((line) => line.text);
    const fixes = await spacingFixes(texts, knownWords);
    if (!fixes.length)
        return page;
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
        text: ocrPageText(lines),
        corrections: [...(page.corrections ?? []), ...fixes]
    };
}
