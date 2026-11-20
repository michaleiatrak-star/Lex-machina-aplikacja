const FIELD = /\[(?!(?:LM)?PII:|LEXDOC(?:REF)?:)[^\[\]\r\n]{1,48}\]/gu;
// Longer fields the drafting rules use: "[UZUPEŁNIJ: …]", the court the application could not decide.
const LONG_FIELD = /\[(?:UZUPEŁNIJ|Sąd do ustalenia|SĄD DO SPRAWDZENIA)\b[^\[\]\r\n]{0,240}\]/giu;
const COURT_FIELD = /\[(?:Sąd do ustalenia|SĄD DO SPRAWDZENIA)\b/iu;
// Documents filed or sent under someone's name end with a signature.
const SIGNED_TYPES = new Set(["pleading", "letter", "contract"]);
// A letter in the course of a case (an evidence motion, a preparatory letter, a position on one
// hearing): it serves one circumstance and should fit about 3 pages (user, 2026-11-20).
const IN_COURSE_TITLE = /(?<![\p{L}])(?:wniosek\s+dowodowy|wnioski\s+dowodowe|pismo\s+przygotowawcze|stanowisko\s+(?:powoda|pozwanego|pozwanej|strony|uczestnika|wnioskodawcy)|zastrzeżenie\s+do\s+protokołu|wniosek\s+o\s+zobowiązanie)(?![\p{L}])/iu;
// Times New Roman 12, margins 2.5/2 cm: about 3000 characters fill a page (a 3-page letter: ~8.2 thousand).
const CHARS_PER_PAGE = 3000;
const IN_COURSE_PAGES = 3;
/** The pages the text fills, roughly (characters with spaces). */
export function estimatedPages(text) {
    return Math.max(1, Math.ceil(text.replace(/\s+/gu, " ").trim().length / CHARS_PER_PAGE));
}
/**
 * What the user should check before using the file - never a reason to
 * refuse it: fields left in square brackets ([Kwota], [Miejscowość, data]),
 * a missing title, a missing signature block.
 */
export function documentCompletenessWarnings(ast, text) {
    const warnings = [];
    if (COURT_FIELD.test(text)) {
        warnings.push("sąd nie jest ustalony: podaj pełny adres strony, według którego ustala się właściwość (z numerem budynku), albo wpisz sąd");
    }
    const fields = [...new Set([...(text.match(LONG_FIELD) ?? []), ...(text.match(FIELD) ?? [])])].filter((field) => !COURT_FIELD.test(field));
    const blanks = (text.match(/⬛+/gu) ?? []).length;
    if (blanks)
        warnings.push(`puste pola ⬛ do wypełnienia: ${blanks}`);
    if (fields.length) {
        warnings.push(`pola do uzupełnienia: ${fields.slice(0, 10).join(", ")}${fields.length > 10 ? ` i ${fields.length - 10} innych` : ""}`);
    }
    const titled = Boolean(ast.title?.length) || ast.blocks.some((block) => block.type === "heading" && block.level === 1);
    if (!titled)
        warnings.push("brak tytułu pisma");
    if (SIGNED_TYPES.has(ast.documentType) && !ast.blocks.some((block) => block.type === "signature")) {
        warnings.push("brak bloku podpisu");
    }
    const pages = estimatedPages(text);
    if (ast.documentType === "pleading" && pages > IN_COURSE_PAGES && IN_COURSE_TITLE.test(text.slice(0, 1500))) {
        warnings.push(`objętość ok. ${pages} stron A4: pismo w toku sprawy zwykle mieści się w ${IN_COURSE_PAGES} stronach; skróć powtórzenia i cytaty albo przenieś wątki niezwiązane z tezą dowodową do osobnego pisma`);
    }
    return warnings;
}
