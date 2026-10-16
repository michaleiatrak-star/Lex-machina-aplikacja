// A letter in the model's markup, made into the document AST by the application: the model
// writes the text and names its parts, the layout is the application's (the office's
// templates), and nothing of the text changes on the way. Easier for a model than JSON and
// without its failures (a cut object, a block shape, the wrong field).
//
// @MIEJSCE_DATA: Jaworzno, 23 września 2026 r.
// @NADAWCA:            (or @ADRESAT:, @STRONA: Wnioskodawca (klient):) the lines of the block below
// @DOTYCZY: Umowy pożyczki nr 1 z dnia 16 sierpnia 2024 r.
// @TYTUL: OŚWIADCZENIE O SPEŁNIANIU ŚWIADCZEŃ Z ZASTRZEŻENIEM ZWROTU
// @PODSTAWA: (art. 35 ustawy o rozpatrywaniu reklamacji)
// @SEKCJA: I. Żądanie
// a paragraph per line; "1." / "-" lines are a list; **Etykieta:** is bold
// @PODPIS:             the signer's lines below (none: a field to fill in)
// @ZALACZNIKI:         a list below
export const LETTER_MARKUP_MARKERS = [
    "MIEJSCE_DATA",
    "NADAWCA",
    "ADRESAT",
    "STRONA",
    "DOTYCZY",
    "TYTUL",
    "PODSTAWA",
    "SEKCJA",
    "PODPIS",
    "ZALACZNIKI"
];
const MARKER = /^\s*@([A-ZŁ_]+)\s*:?\s*(.*)$/u;
const LIST_ITEM = /^\s*(?:(\d{1,3}[.)])|([-•–]|\*(?!\*)))\s+(\S.*)$/u;
const ALIAS = /\[(LMPII:D\d{2}:[A-Z_]+:\d{4})(?:\|(NOM|GEN|DAT|ACC|INS|LOC|VOC))?\]/gu;
const SIGNATURE_LINE = "……………………………………";
/** True when the answer is a letter in the markup (its title is marked). */
export function isLetterMarkup(answer) {
    return /^\s*@TYTUL\s*:/mu.test(answer);
}
/** Text with **bold** spans and generation aliases ([LMPII:D01:PERSON:0001|GEN]) as AST nodes. */
export function markupInlines(text, bold = false) {
    const nodes = [];
    const pushText = (value, strong) => {
        if (!value)
            return;
        const last = nodes[nodes.length - 1];
        if (last?.type === "text" && Boolean(last.bold) === strong) {
            last.text += value;
            return;
        }
        nodes.push({ type: "text", text: value, ...(strong ? { bold: true } : {}) });
    };
    const parts = text.split(/(\*\*[^*\n]+\*\*)/u);
    for (const part of parts) {
        const strong = bold || /^\*\*[^*\n]+\*\*$/u.test(part);
        const body = /^\*\*[^*\n]+\*\*$/u.test(part) ? part.slice(2, -2) : part;
        let at = 0;
        for (const match of body.matchAll(ALIAS)) {
            pushText(body.slice(at, match.index), strong);
            nodes.push({
                type: "pii_ref",
                alias: `[${match[1]}]`,
                ...(match[2] ? { case: match[2] } : {})
            });
            at = match.index + match[0].length;
        }
        pushText(body.slice(at), strong);
    }
    return nodes;
}
export class LetterMarkupError extends Error {
    constructor(code) {
        super(code);
        this.name = "LetterMarkupError";
    }
}
/** The letter in the markup as a document AST; LETTER_MARKUP_* errors for the repair round. */
export function letterMarkupAst(answer, options) {
    const lines = answer.replace(/\r\n?/gu, "\n").split("\n");
    const first = lines.findIndex((line) => MARKER.test(line));
    if (first < 0)
        throw new LetterMarkupError("LETTER_MARKUP_MISSING");
    const blocks = [];
    let title = false;
    let body = 0;
    let list = null;
    const flushList = () => {
        if (list?.items.length)
            blocks.push({ type: "list", ordered: list.ordered, items: list.items });
        list = null;
    };
    // The lines of a block (a party, a signature) up to the next marker or a blank line.
    const blockLines = (from) => {
        const out = [];
        let index = from;
        while (index < lines.length && !MARKER.test(lines[index]) && lines[index].trim()) {
            out.push(lines[index].trim());
            index += 1;
        }
        return { lines: out, next: index };
    };
    const party = (label, rows, role = "party") => {
        if (!label && !rows.length)
            return;
        // A label ("Wnioskodawca (klient):") is bold; without one the name (first line) is.
        const content = label
            ? [...markupInlines(label, true), ...(rows.length ? markupInlines(`\n${rows.join("\n")}`) : [])]
            : [...markupInlines(rows[0], true), ...(rows.length > 1 ? markupInlines(`\n${rows.slice(1).join("\n")}`) : [])];
        blocks.push({ type: "paragraph", role, content });
    };
    for (let index = first; index < lines.length; index += 1) {
        const line = lines[index];
        const marker = MARKER.exec(line);
        if (marker) {
            flushList();
            const name = marker[1];
            const rest = marker[2].trim();
            switch (name) {
                case "MIEJSCE_DATA":
                    if (rest)
                        blocks.push({ type: "paragraph", role: "place_date", content: markupInlines(rest) });
                    break;
                case "NADAWCA":
                case "ADRESAT":
                case "STRONA": {
                    const rows = blockLines(index + 1);
                    party(name === "STRONA" ? rest : "", name === "STRONA" ? rows.lines : [...(rest ? [rest] : []), ...rows.lines], name === "ADRESAT" ? "addressee" : "party");
                    index = rows.next - 1;
                    break;
                }
                case "DOTYCZY":
                    if (rest)
                        blocks.push({ type: "paragraph", role: "subject", content: [{ type: "text", text: "Dotyczy: ", bold: true }, ...markupInlines(rest)] });
                    break;
                case "TYTUL":
                    if (!rest)
                        throw new LetterMarkupError("LETTER_MARKUP_TITLE_EMPTY");
                    blocks.push({ type: "heading", level: 1, content: markupInlines(rest) });
                    title = true;
                    break;
                case "PODSTAWA":
                    if (rest)
                        blocks.push({ type: "paragraph", role: "basis", content: markupInlines(rest) });
                    break;
                case "SEKCJA":
                    if (rest)
                        blocks.push({ type: "heading", level: 2, content: markupInlines(rest) });
                    break;
                case "PODPIS": {
                    const rows = blockLines(index + 1);
                    const signer = [...(rest ? [rest] : []), ...rows.lines];
                    blocks.push({ type: "signature", content: markupInlines([SIGNATURE_LINE, ...(signer.length ? signer : ["[imię i nazwisko]"])].join("\n")) });
                    index = rows.next - 1;
                    break;
                }
                case "ZALACZNIKI":
                    blocks.push({ type: "heading", level: 2, content: [{ type: "text", text: "Załączniki:" }] });
                    break;
                default:
                    throw new LetterMarkupError(`LETTER_MARKUP_UNKNOWN_MARKER:${name}`);
            }
            continue;
        }
        const text = line.trim();
        if (!text) {
            flushList();
            continue;
        }
        const item = LIST_ITEM.exec(line);
        if (item) {
            const ordered = Boolean(item[1]);
            if (list && list.ordered !== ordered)
                flushList();
            list ??= { ordered, items: [] };
            list.items.push(markupInlines(item[3].trim()));
            body += 1;
            continue;
        }
        flushList();
        blocks.push({ type: "paragraph", content: markupInlines(text) });
        body += 1;
    }
    flushList();
    if (!title)
        throw new LetterMarkupError("LETTER_MARKUP_TITLE_MISSING");
    if (!body)
        throw new LetterMarkupError("LETTER_MARKUP_BODY_MISSING");
    return {
        schemaVersion: "1",
        documentType: options.documentType,
        locale: "pl-PL",
        styleProfile: options.styleProfile,
        blocks
    };
}
/** The contract the model follows in the generation turn (replaces the JSON contract). */
export const LETTER_MARKUP_CONTRACT = [
    "Return ONLY the finished letter in the LETTER MARKUP below: plain text, no JSON, no Markdown headings, no code fence, no commentary before or after it. Never output routing keys (legal, primarySkill, domainSkills, executionSkills, workflowExecutionSkill).",
    "Each part starts with its marker at the beginning of a line:",
    "@MIEJSCE_DATA: <place, date> — first line (e.g. \"Kraków, dnia 13 października 2026 r.\"; unknown: \"[Miejscowość], dnia [data]\").",
    "@NADAWCA: then the sender's lines below it (name first, then address, PESEL/NIP, e-mail), one per line.",
    "@ADRESAT: then the addressee's lines below it. For a labelled party use @STRONA: <label> (e.g. \"@STRONA: Wnioskodawca (klient):\", \"@STRONA: Pozwany:\") with its lines below.",
    "@DOTYCZY: <what the letter concerns> — optional, one line.",
    "@TYTUL: <TITLE IN CAPITALS> — required, one line.",
    "@PODSTAWA: <legal basis under the title, in parentheses> — optional.",
    "@SEKCJA: <I. Section title> — for a letter with sections (numbered with Roman numerals).",
    "Body: one paragraph per line; list items start with \"1.\" (numbered) or \"- \" (bullets); **label:** marks a bold label at the start of a paragraph or item (e.g. \"**Żądanie główne:** …\").",
    "@PODPIS: then the signer's name below it (unknown: leave the line empty).",
    "@ZALACZNIKI: then the attachments as a numbered list below it (only when there are attachments).",
    "Copy the letter's text from the conversation without changing its substance: no shortening, no new claims, no meta-sections (DANE DO UZUPEŁNIENIA, UWAGI, CO DALEJ, HYBRID-VALIDATION, disclaimers, verification markers).",
    "Missing user data go into neutral square-bracket fields such as [Kwota] or [Termin zapłaty]; never [UZUPEŁNIJ].",
    "A person, firm or address of the case is written ONLY as its generation alias from the map below, with the grammatical case of this occurrence after a bar: [LMPII:D01:PERSON:0001|GEN] after \"wobec\", [LMPII:D01:ADDRESS:0001|LOC] after \"przy\" (NOM, GEN, DAT, ACC, INS, LOC, VOC). The value is inflected locally; never write the name or the address yourself."
].join("\n");
