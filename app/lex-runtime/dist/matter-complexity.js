import { isTrivialChatCommand, latestUserTurn } from "./execution-engine.js";
export const SIMPLE_MAX_CHARS = 320;
const SIMPLE_MAX_SENTENCES = 3;
const SIMPLE_MAX_QUESTIONS = 2;
const QUESTION_START = /^(?:czy|jak[a-ząćęłńóśźż]*|ile|kiedy|kto|komu|kogo|co|gdzie|dlaczego|czemu|jaki[a-ząćęłńóśźż]*|kt[oó]r[a-ząćęłńóśźż]*|w jakim|na jakiej|od kiedy|do kiedy|po ilu|czym|z jakiego|a je[sś]li|a gdyby)(?!\p{L})/u;
// A request for a work product needs execution skills and workflows.
const WORK_PRODUCT = /(?<!\p{L})(?:napisz|sporz[aą]d[zź]|przygotuj|zredaguj|popraw|przeanalizuj|oce[nń] (?:umow|pism|dokument|akt)|sprawd[zź] (?:umow|pism|dokument|akt)|raport|chronologi|dokument|za[lł][aą]cznik|akt[ay] sprawy|strategi|przes[lł]uchani|[sś]wiadk|\.docx)/iu;
// Case-law research is a skill of its own (orzeczenia-sadowe-v2).
const CASE_LAW = /(?<!\p{L})(?:orzecze[nń]|orzecznictw|wyrok[ai]? (?:sn|nsa|wsa|tk|s[aą]du)|uchwa[lł][aęy] (?:sn|nsa)|sygnatur|linia orzecznicza|judykatur)/iu;
const AMOUNT = /(?<![\p{L}\d])\d[\d\s.,]*\s?(?:z[lł]|pln|euro|eur|\$|tys\.?|mln)(?!\p{L})/giu;
const DATE = /(?<![\p{L}\d])(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{1,2} (?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrze[sś]nia|pa[zź]dziernika|listopada|grudnia)(?: \d{4})?|\d{4} r\.?)/giu;
const PERSON_TOKEN = /\[(?:LM)?PII:(?:D\d+:)?PERSON:(\d{4})/g;
const ROLE_WORD = /(?<!\p{L})(?:pow[oó]d\w*|pozwan\w*|wierzyciel\w*|d[lł]u[zż]nik\w*|sprawc\w*|pokrzywdzon\w*|[sś]wiad\w*|pracodawc\w*|pracownik\w*|wynajmuj[aą]c\w*|najemc\w*|sprzedawc\w*|kupuj[aą]c\w*|spadkobierc\w*|ma[lł][zż]on\w*|wsp[oó]lnik\w*|zleceniodawc\w*|wykonawc\w*)/giu;
const ACT_ABBREVIATION = /(?<!\p{L})(?:k\.?k\.?|k\.?c\.?|k\.?p\.?c\.?|k\.?p\.?k\.?|k\.?p\.?a\.?|k\.?p\.?|k\.?w\.?|k\.?k\.?s\.?|k\.?r\.?o\.?|k\.?s\.?h\.?|o\.?p\.?|p\.?p\.?s\.?a\.?|rodo|kodeks\p{L}* \p{L}+|ustaw\p{L}* o \p{L}+)(?![\p{L}\d])/giu;
function distinct(text, pattern, group = 0) {
    return new Set([...text.matchAll(pattern)].map((match) => (match[group] ?? match[0]).toLowerCase().replace(/[\s.]/g, ""))).size;
}
export function assessMatterComplexity(input) {
    if ((input.attachmentCount ?? 0) === 0 &&
        isTrivialChatCommand(input.query)) {
        return { level: "TRIVIAL", reasons: ["TRIVIAL_COMMAND"] };
    }
    const reasons = [];
    const raw = latestUserTurn(input.query);
    const text = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
    const lower = text.toLowerCase();
    if ((input.attachmentCount ?? 0) > 0)
        reasons.push("DOCUMENTS_ATTACHED");
    if (input.workflowPinned)
        reasons.push("WORKFLOW_PINNED");
    if (text.length < 12)
        reasons.push("TOO_SHORT");
    if (text.length > SIMPLE_MAX_CHARS || /\n\s*\n/.test(raw.trim())) {
        reasons.push("LONG_DESCRIPTION");
    }
    const sentences = text
        .split(/(?<=[.!?])\s+/)
        .filter((part) => part.trim());
    if (sentences.length > SIMPLE_MAX_SENTENCES)
        reasons.push("MANY_SENTENCES");
    const questions = (text.match(/\?/g) ?? []).length;
    if (questions > SIMPLE_MAX_QUESTIONS)
        reasons.push("MANY_QUESTIONS");
    if (WORK_PRODUCT.test(text))
        reasons.push("WORK_PRODUCT_REQUEST");
    if (CASE_LAW.test(text))
        reasons.push("CASE_LAW_REQUEST");
    if (distinct(text, AMOUNT) + distinct(text, DATE) > 3) {
        reasons.push("MANY_FACTS");
    }
    if (distinct(text, PERSON_TOKEN, 1) > 2 ||
        distinct(text, ROLE_WORD) > 2) {
        reasons.push("MANY_PARTIES");
    }
    if (distinct(text, ACT_ABBREVIATION) > 2)
        reasons.push("MANY_ACTS");
    if (questions === 0 && !QUESTION_START.test(lower)) {
        reasons.push("NOT_A_QUESTION");
    }
    return reasons.length === 0
        ? { level: "SIMPLE", reasons: [] }
        : { level: "STANDARD", reasons };
}
const REASON_LABELS = {
    TRIVIAL_COMMAND: "krótkie polecenie",
    DOCUMENTS_ATTACHED: "dołączone dokumenty",
    WORKFLOW_PINNED: "wybrany tryb mechaniczny",
    LONG_DESCRIPTION: "długi opis",
    MANY_SENTENCES: "wiele zdań",
    MANY_QUESTIONS: "wiele pytań",
    WORK_PRODUCT_REQUEST: "zlecenie pisma lub analizy",
    MANY_FACTS: "wiele kwot lub dat",
    MANY_PARTIES: "wiele stron",
    MANY_ACTS: "kilka aktów prawnych",
    CASE_LAW_REQUEST: "orzecznictwo",
    NOT_A_QUESTION: "opis bez pytania",
    TOO_SHORT: "za mało treści"
};
/** One line for the progress window: the level and why. */
export function describeMatterComplexity(value) {
    if (value.level === "TRIVIAL")
        return "krótkie polecenie: bez skilli prawnych i workflow";
    if (value.level === "SIMPLE")
        return "sprawa prosta: router v3 i jedna domena DR";
    return `pełna ścieżka (${value.reasons.map((reason) => REASON_LABELS[reason]).join(", ")})`;
}
// An opinion or a view asked for in a few words ("co sądzisz o…", "jak oceniasz…", "czy Twoim
// zdaniem…", "w skrócie"): answered from the matter's material, not by an executive skill's procedure.
const OPINION = /(?<!\p{L})(?:co (?:o tym |o tej \p{L}+ |o tym \p{L}+ |o \p{L}+ )?(?:s[aą]dzisz|my[sś]lisz|uwa[zż]asz)|co (?:ty )?na to|jak (?:to |t[eę] \p{L}+ |ten \p{L}+ )?(?:oceniasz|widzisz)|jakie (?:jest |masz )?(?:twoje |pana |pani )?zdanie|jaka (?:jest )?(?:twoja|pana|pani) (?:opini|ocen)|twoim zdaniem|(?:wed[lł]ug|zdaniem) ciebie|tw[oó]j pogl[aą]d|w skr[oó]cie|kr[oó]tko[,:]? )/iu;
// The work products and analyses an executive skill exists for ("przeanalizuj", "oceń zeznania",
// "szanse i ryzyka"): never the short form.
const ANALYSIS_ASKED = /(?<!\p{L})(?:przeanalizuj|zanalizuj|analiz\p{L}*|oce[nń](?!ia(?:sz|cie))|zbadaj|szans\p{L}*|ryzyk\p{L}*|kompleksow\p{L}*|ca[lł]o[sś]ciow\p{L}*|szczeg[oó][lł]ow\p{L}*)/iu;
/**
 * A question in the simple form, also in a matter with files: one short legal question (the
 * SIMPLE level without counting the files) or an opinion asked for in a few words. The turn is
 * answered in the light profile without an executive skill leading it; the files, ELI verification,
 * the criminal qualifier and every hard gate stay (user 2026-11-21).
 */
/** An opinion or a view asked for in a few words. */
export function opinionAsked(text) {
    return OPINION.test(latestUserTurn(text));
}
export function simpleFormQuestion(text) {
    const raw = latestUserTurn(text).normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!raw || raw.length > SIMPLE_MAX_CHARS || ANALYSIS_ASKED.test(raw) || WORK_PRODUCT.test(raw) && !OPINION.test(raw))
        return false;
    if (/(?<!\p{L})(?:napisz|sporz[aą]d[zź]|przygotuj|zredaguj|popraw|wygeneruj)/iu.test(raw))
        return false;
    if (OPINION.test(raw))
        return (raw.match(/\?/g) ?? []).length <= SIMPLE_MAX_QUESTIONS;
    return assessMatterComplexity({ query: raw }).level === "SIMPLE";
}
