const MAX_ANSWER_CHARS = 200_000;
/** The answer's session as the file's source: its trail and verification register. */
export function answerValidationContext(request, result, internal) {
    return {
        schemaVersion: 1,
        sourceSessionId: result.sessionId,
        primarySkill: request.primarySkill,
        provider: request.provider,
        model: request.model,
        usedDocumentContext: Boolean(request.documentAttachments?.length),
        ...(internal.caseFileNumbers?.length ? { caseFileNumbers: [...internal.caseFileNumbers] } : {}),
        ...(internal.caseReferences?.length ? { caseReferences: [...internal.caseReferences] } : {}),
        ...(internal.factAmounts?.length ? { factAmounts: [...internal.factAmounts] } : {}),
        verificationRecords: internal.verificationRecords.map((record) => ({ ...record })),
        auditEvents: internal.auditEvents.map((event) => ({ ...event, ...(event.detail ? { detail: { ...event.detail } } : {}) }))
    };
}
export function validAnswerDocument(value) {
    if (!value || typeof value !== "object")
        return null;
    const raw = value;
    const context = raw.validationContext;
    if (typeof raw.sessionId !== "string" ||
        typeof raw.at !== "string" ||
        typeof raw.text !== "string" ||
        raw.text.length > MAX_ANSWER_CHARS ||
        !context ||
        context.schemaVersion !== 1 ||
        typeof context.sourceSessionId !== "string" ||
        !Array.isArray(context.verificationRecords) ||
        !Array.isArray(context.auditEvents)) {
        return null;
    }
    return {
        sessionId: raw.sessionId,
        at: raw.at,
        text: raw.text,
        validationContext: context
    };
}
// What follows the letter in an answer: the skill's report on it, never part of the file.
const META_HEADING = /^(?:status\s+dokumentu|zakres\s+sprawdzenia|uwagi(?:\s+praktyczne|\s+dla\s+\p{L}+)?|co\s+dalej|dane\s+do\s+uzupełnienia|hybrid[-\s]?valid\p{L}*|ślad\s+\p{L}+|weryfikacja(?:\s+\p{L}+)*|raport\s+\p{L}+|informacj\p{L}+\s+dla\s+\p{L}+|notatk\p{L}*(?:\s+\p{L}+)*|przed\s+wysłaniem(?:\s+\p{L}+)*|źródła(?:\s+i\s+weryfikacja)?)\s*:?$/iu;
// The answer's own sentence before the letter ("Poniżej pełna poprawiona wersja ...").
const INTRO = /^(?:poniżej|przygotowa\p{L}*|oto|poprawi\p{L}*|zgodnie\s+z|na\s+podstawie\s+(?:poprzedni|wcześniejsz)\p{L}*|zachowa\p{L}*|wersja)\b/iu;
const PLACE_DATE = /^(?:\[[^\]\n]{1,40}\]|\p{Lu}[\p{L}-]+(?:[ -]\p{Lu}?[\p{L}-]+){0,2})\s*,\s*(?:dnia\s+)?(?:\[[^\]\n]{1,30}\]|\d{1,2}[.\s])/u;
const ADDRESSEE = /^(?:do|adresat|odbiorca)\s*:\s*/iu;
const LIST_ITEM = /^(?:\d{1,3}[.)]|[-•–]|\*(?!\*))\s+\S/u;
function plainLine(line) {
    const heading = /^\s{0,3}#{1,6}\s+/u.test(line);
    let text = line
        .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/u, "")
        // Links of the chat (the provision's anchor in the act): the label stays.
        .replace(/\[([^[\]\n]+)\]\((?:https?:)?[^)\s]+\)/gu, "$1")
        .replace(/[ \t]+$/u, "")
        .trim();
    // A line bold as a whole ("**ODPOWIEDŹ ...**") is a title or a heading, not a bold label.
    const whole = /^(\*\*|__)([^*_\n]+)\1$/u.exec(text);
    if (whole)
        text = whole[2].trim();
    return { text, heading };
}
// The answer's section labels of the skill's contract ("## TREŚĆ PISMA") stand above the
// letter; they are no title of it ("WEZWANIE DO ZAPŁATY" is).
const CONTRACT_LABEL = /^(?:TREŚĆ|PROJEKT|TEKST)\s+(?:PISMA|DOKUMENTU|UMOWY|WEZWANIA|WNIOSKU)\s*:?$/u;
function titleLike(text) {
    if (LIST_ITEM.test(text) || text.length > 200 || CONTRACT_LABEL.test(text.replace(/[*_]/gu, "").trim()))
        return false;
    const letters = [...text.replace(/\[[^\]]*\]/gu, "")].filter((char) => /\p{L}/u.test(char));
    if (letters.length < 8)
        return false;
    const upper = letters.filter((char) => char === char.toLocaleUpperCase("pl") && char !== char.toLocaleLowerCase("pl")).length;
    return upper / letters.length >= 0.85 && /\p{L}{3,}\s+\p{L}{2,}/u.test(text);
}
// A block of a party or an address: a few short lines, none of them a sentence.
function partyLike(block) {
    return (block.length >= 2 &&
        block.length <= 7 &&
        block.every((line) => line.length <= 90 && !LIST_ITEM.test(line) && !/[.;!?]$/u.test(line.replace(/\b(?:r|ul|al|pl|lok|m|nr|os)\.$/u, ""))));
}
const CLOSING = /^(?:z\s+poważaniem|z\s+wyrazami\s+szacunku|łączę\s+wyrazy\s+szacunku|z\s+up(?:oważnienia)?\.?)$/iu;
// A heading the answer wrote as a plain line ("Uzasadnienie", "Odpowiedź"): short, no sentence.
function headingLike(line) {
    return (line.length <= 60 &&
        line.split(/\s+/u).length <= 8 &&
        /^\p{Lu}/u.test(line) &&
        !/[.,;:!?\]]$/u.test(line) &&
        !/[[§]/u.test(line) &&
        !LIST_ITEM.test(line) &&
        !CLOSING.test(line));
}
function signatureLike(block) {
    return (block.length >= 1 &&
        block.length <= 3 &&
        block.every((line) => line.length <= 70 && !LIST_ITEM.test(line) && !/[.:;!?,]$/u.test(line) && !META_HEADING.test(line)));
}
/** Blocks of lines separated by blank lines, with the heading flag of their first line. */
function blocksOf(lines) {
    const blocks = [];
    let current = null;
    for (const line of lines) {
        if (!line.text) {
            current = null;
            continue;
        }
        // A Markdown heading is its own block even without a blank line around it.
        if (line.heading || !current || current.heading) {
            current = { lines: [line.text], heading: line.heading };
            blocks.push(current);
        }
        else {
            current.lines.push(line.text);
        }
    }
    return blocks;
}
/**
 * The letter of a chat answer in the letter markup (letter-markup.ts), its wording as the
 * answer has it; null when the answer holds no letter (no title in capitals, no body).
 * The verification markers stay: the export gate reads them and the file is without them.
 */
export function answerLetterMarkup(answer) {
    const body = answer.replace(/\r\n?/gu, "\n").split(/⚖️|\bWażna informacja:/u)[0] ?? "";
    // A section label of the skill's contract is no line of the letter.
    const lines = body
        .split("\n")
        .map(plainLine)
        .map((line) => (CONTRACT_LABEL.test(line.text.replace(/[*_]/gu, "").trim()) ? { ...line, text: "" } : line));
    const titleAt = lines.findIndex((line) => titleLike(line.text));
    if (titleAt < 0)
        return null;
    const metaAt = lines.findIndex((line, index) => index > titleAt && line.text.length <= 60 && META_HEADING.test(line.text.replace(/[*_]/gu, "")));
    const before = blocksOf(lines.slice(0, titleAt));
    const after = blocksOf(lines.slice(titleAt + 1, metaAt < 0 ? lines.length : metaAt));
    if (!after.length)
        return null;
    const out = [];
    let sender = false;
    const party = (block) => {
        const [first, ...rest] = block;
        if (ADDRESSEE.test(first)) {
            const label = first.replace(ADDRESSEE, "").trim();
            out.push("@ADRESAT:", ...(label ? [label] : []), ...rest, "");
        }
        else {
            out.push(sender ? "@STRONA:" : "@NADAWCA:", ...block, "");
            sender = true;
        }
    };
    for (const block of before) {
        const [first] = block.lines;
        if (block.lines.length === 1 && PLACE_DATE.test(first))
            out.push(`@MIEJSCE_DATA: ${first}`, "");
        else if (block.lines.length === 1 && INTRO.test(first))
            continue;
        else if (ADDRESSEE.test(first) || partyLike(block.lines))
            party(block.lines);
        else if (block.lines.every((line) => INTRO.test(line) || /[.:]$/u.test(line)))
            continue;
        else
            party(block.lines);
    }
    out.push(`@TYTUL: ${lines[titleAt].text}`, "");
    // The signer: the last block, a name (and a role) without a sentence's end.
    const last = after.at(-1);
    const signer = after.length > 1 && !last.heading && signatureLike(last.lines) ? after.pop().lines : null;
    let opening = true;
    for (const block of after) {
        const [first] = block.lines;
        // The parties right under the title (as some answers put them), before the body.
        if (opening && !block.heading && (ADDRESSEE.test(first) || partyLike(block.lines))) {
            party(block.lines);
            continue;
        }
        if (opening && block.lines.length === 1 && PLACE_DATE.test(first)) {
            out.push(`@MIEJSCE_DATA: ${first}`, "");
            continue;
        }
        opening = false;
        if (block.heading || (block.lines.length === 1 && headingLike(first))) {
            out.push(`@SEKCJA: ${block.lines.join(" ")}`, "");
            continue;
        }
        out.push(...block.lines, "");
    }
    if (signer)
        out.push("@PODPIS:", ...signer);
    return out.join("\n").trimEnd();
}
const TABLE_RULE = /^\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?$/u;
/**
 * An analysis or report answer (no letter in it) in the same markup: its first heading is the
 * title, its headings are sections, its paragraphs, quotes and lists stay as written. The file
 * comes from the answer's text without a model turn (a local model writing the document's JSON
 * again took minutes and failed: DOCUMENT_AST_JSON_INVALID). null for an answer without a body.
 */
export function answerReportMarkup(answer) {
    const body = answer.replace(/\r\n?/gu, "\n").split(/⚖️|\bWażna informacja:/u)[0] ?? "";
    const lines = body.split("\n").map(plainLine);
    const metaAt = lines.findIndex((line, index) => index > 0 && line.text.length <= 60 && META_HEADING.test(line.text.replace(/[*_]/gu, "")));
    const blocks = blocksOf(lines.slice(0, metaAt < 0 ? lines.length : metaAt));
    const first = blocks[0];
    if (!first)
        return null;
    const titled = first.heading || (first.lines.length === 1 && first.lines[0].length <= 120 && !LIST_ITEM.test(first.lines[0]));
    const title = titled ? blocks.shift().lines.join(" ").replace(/[*_]{2}/gu, "").trim() : "ANALIZA PRAWNA";
    // A short reply (a question for missing data, a one-line note) is no document.
    if (blocks.reduce((sum, block) => sum + block.lines.join(" ").length, 0) < 200)
        return null;
    const out = [`@TYTUL: ${title.toLocaleUpperCase("pl")}`, ""];
    for (const block of blocks) {
        const [head] = block.lines;
        if (block.heading || (block.lines.length === 1 && headingLike(head))) {
            out.push(`@SEKCJA: ${block.lines.join(" ").replace(/[*_]{2}/gu, "").replace(/:$/u, "")}`, "");
            continue;
        }
        for (const line of block.lines) {
            if (TABLE_RULE.test(line))
                continue;
            const row = /^\|(.*)\|$/u.exec(line);
            const text = row ? row[1].split("|").map((cell) => cell.trim()).filter(Boolean).join(" — ") : line.replace(/^[*•–]\s+/u, "- ");
            // A heading inside a block ("**Kwalifikacja:**" alone on its line) opens a section.
            const label = /^(\*\*|__)([^*_\n]{2,60}?):?\1:?$/u.exec(text);
            out.push(label ? `\n@SEKCJA: ${label[2].trim()}\n` : text);
        }
        out.push("");
    }
    return out.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd();
}
/** The answer's file markup: its letter when it holds one, else the analysis as a report. */
export function answerDocumentMarkup(answer) {
    const letter = answerLetterMarkup(answer);
    if (letter)
        return { markup: letter, letter: true };
    const report = answerReportMarkup(answer);
    return report ? { markup: report, letter: false } : null;
}
