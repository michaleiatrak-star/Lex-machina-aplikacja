/**
 * Model-free cleanup of OCR lines: Unicode composition, ligatures, invisible characters, odd
 * spaces, Cyrillic/Greek look-alike letters inside Latin words. Run in "OCR z korektą AI"
 * before the vision model reads the doubtful lines (ocr-vision.ts).
 *
 * The text model (Bielik) no longer corrects OCR: on three real scans it gained 0.2 pp of
 * words, changed the author's own spelling ("opini" -> "opinii") and kept about 7 GB in
 * memory while the vision model needs it.
 */
const LIGATURES = { "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st" };
// Cyrillic and Greek letters that look like Latin ones.
const LOOKALIKES = {
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s",
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O", "Р": "P", "С": "C", "Т": "T", "Х": "X", "І": "I",
    "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "ρ": "p", "τ": "t", "υ": "u", "χ": "x",
    "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H", "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T", "Υ": "Y", "Χ": "X"
};
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\uFEFF\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;
const ODD_SPACE = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/gu;
// Non-global copy for .test(): a /g regex keeps lastIndex between calls.
const HAS_INVISIBLE = new RegExp(INVISIBLE.source, "u");
/**
 * Model-free cleanup of one line: Unicode composition, ligatures, invisible
 * characters, odd spaces, and look-alike letters inside Latin words. Returns
 * the visible changes.
 */
export function normalizeOcrLine(text) {
    const fixes = [];
    let result = text.normalize("NFC");
    if (HAS_INVISIBLE.test(result)) {
        result = result.replace(INVISIBLE, "");
        fixes.push({ from: "znaki niewidoczne", to: "usunięte" });
    }
    result = result.replace(ODD_SPACE, " ");
    result = result.replace(/[ﬀﬁﬂﬃﬄﬅﬆ]/gu, (ligature) => {
        fixes.push({ from: ligature, to: LIGATURES[ligature] });
        return LIGATURES[ligature];
    });
    // Only in words that are otherwise Latin: a Russian word stays Russian.
    result = result.replace(/[\p{L}]+/gu, (word) => {
        const foreign = [...word].filter((char) => LOOKALIKES[char]);
        const latin = [...word].filter((char) => /\p{Script=Latin}/u.test(char));
        if (!foreign.length || !latin.length)
            return word;
        const fixed = [...word].map((char) => LOOKALIKES[char] ?? char).join("");
        if (/[^\p{Script=Latin}]/u.test(fixed))
            return word;
        fixes.push({ from: word, to: fixed });
        return fixed;
    });
    return { text: result, fixes };
}
/** The OCR page with its lines cleaned (changes kept in page.corrections). */
export function normalizeOcrPage(page) {
    if (page.source !== "OCR" || !page.lines?.length)
        return page;
    const corrections = [];
    const lines = page.lines.map((line, index) => {
        const normalized = normalizeOcrLine(line.text);
        corrections.push(...normalized.fixes.map((fix) => ({ line: index, ...fix })));
        return normalized.text === line.text ? line : { ...line, text: normalized.text };
    });
    if (lines.every((line, index) => line === page.lines[index]))
        return page;
    return {
        ...page,
        lines,
        text: lines.map((line) => line.text).join("\n"),
        corrections: [...(page.corrections ?? []), ...corrections]
    };
}
