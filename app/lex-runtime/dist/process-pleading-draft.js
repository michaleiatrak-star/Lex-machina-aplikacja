export const DRAFT_VERSIONS_MAX = 20;
export const DRAFT_TEXT_MAX = 400_000;
export const REMARKS_MAX = 4_000;
// The pipeline writes the full current pleading between these lines (W2, W3).
export const PLEADING_START = "=== PISMO ===";
export const PLEADING_END = "=== KONIEC PISMA ===";
// A pleading over the output limit: the block ends on a whole section with this line and the
// application asks for the rest in the same step (pleadingContinuationPrompt).
export const PLEADING_CONTINUES = "=== CIĄG DALSZY ===";
// A long draft revised by a later step: only the changed sections, applied to the stored text.
export const SECTION_CHANGE = "=== ZMIANA SEKCJI:";
export const SECTION_CHANGE_END = "=== KONIEC ZMIANY ===";
export const NO_TEXT_CHANGE = "=== BEZ ZMIAN W TEKŚCIE ===";
// Above this a revising step returns its changes, not the whole text (about 10 pages).
export const LONG_DRAFT_CHARS = 18_000;
export const PLEADING_CONTINUATIONS_MAX = 6;
const CASE_ID = /^case_[a-f0-9]{32}$/;
function cleanText(text, max) {
    const clean = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").trim();
    if (!clean || clean.length > max)
        throw new Error("PROCESS_PLEADING_DRAFT_TEXT_INVALID");
    return clean;
}
export function emptyProcessPleadingDraft(caseId) {
    if (!CASE_ID.test(caseId))
        throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
    return { schemaVersion: 1, caseId, revision: 0, versions: [] };
}
export function validateProcessPleadingDraft(input) {
    if (!input ||
        input.schemaVersion !== 1 ||
        !CASE_ID.test(input.caseId) ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 0 ||
        !Array.isArray(input.versions) ||
        input.versions.length > DRAFT_VERSIONS_MAX) {
        throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
    }
    let previous = 0;
    for (const item of input.versions) {
        if (!Number.isSafeInteger(item.version) ||
            item.version <= previous ||
            typeof item.text !== "string" ||
            !item.text.trim() ||
            item.text.length > DRAFT_TEXT_MAX ||
            !["PIPELINE", "USER"].includes(item.source) ||
            (item.change !== undefined && !["MINOR", "SUBSTANTIVE"].includes(item.change)) ||
            typeof item.createdAt !== "string") {
            throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
        }
        previous = item.version;
    }
    if (input.remarks && (typeof input.remarks.text !== "string" || input.remarks.text.length > REMARKS_MAX)) {
        throw new Error("PROCESS_PLEADING_DRAFT_INVALID");
    }
    return structuredClone(input);
}
export function latestDraftVersion(draft) {
    return draft?.versions.at(-1) ?? null;
}
export function appendDraftVersion(input, version, at = new Date().toISOString()) {
    const draft = validateProcessPleadingDraft(input);
    const text = cleanText(version.text, DRAFT_TEXT_MAX);
    const latest = draft.versions.at(-1);
    // The same text again (a repeated W3 step) is not a new version.
    if (latest && latest.text === text)
        return draft;
    draft.versions.push({
        ...version,
        text,
        version: (latest?.version ?? 0) + 1,
        createdAt: at
    });
    draft.versions = draft.versions.slice(-DRAFT_VERSIONS_MAX);
    draft.revision += 1;
    return draft;
}
export function withDraftRemarks(input, checkpoint, text, at = new Date().toISOString()) {
    const draft = validateProcessPleadingDraft(input);
    draft.remarks = { checkpoint, text: cleanText(text, REMARKS_MAX), at };
    draft.revision += 1;
    return draft;
}
export function withoutDraftRemarks(input) {
    const draft = validateProcessPleadingDraft(input);
    if (!draft.remarks)
        return draft;
    delete draft.remarks;
    draft.revision += 1;
    return draft;
}
/** The pleading between the markers of an answer; the last block when there are several. */
export function extractPleadingText(answer) {
    const start = answer.lastIndexOf(PLEADING_START);
    if (start < 0)
        return null;
    const end = answer.indexOf(PLEADING_END, start + PLEADING_START.length);
    if (end < 0)
        return null;
    const text = answer.slice(start + PLEADING_START.length, end).trim();
    return text.length >= 40 ? text : null;
}
// A heading line of a pleading: "I. ŻĄDANIA", "## II. Uzasadnienie", "**III. Dowody**", "§ 4.".
const HEADING = /^\s*(?:(#{1,4})\s+|@(?:POD)?SEKCJA:\s*|\*\*)?((?:[IVXL]+\.|§\s*\d+|\d{1,2}\.)(?:\s|$)[^\n]*?)\**\s*$/u;
function headingKey(line) {
    const match = HEADING.exec(line);
    if (!match)
        return null;
    return match[2].replace(/\*+/gu, "").replace(/\s+/gu, " ").trim().toLocaleLowerCase("pl");
}
// The class of a heading (its numbering): a section runs to the next heading of the same class.
function headingClass(line) {
    const match = HEADING.exec(line);
    if (!match)
        return null;
    const label = match[2];
    return `${match[1] ?? ""}|${/^[IVXL]+\./u.test(label) ? "roman" : /^§/u.test(label) ? "par" : "arabic"}`;
}
/** The text with each changed section (by its heading) replaced; problems for an unknown heading. */
export function applySectionChanges(text, changes) {
    let lines = text.split("\n");
    const problems = [];
    for (const change of changes) {
        const key = headingKey(change.heading) ?? change.heading.replace(/\s+/gu, " ").trim().toLocaleLowerCase("pl");
        const start = lines.findIndex((line) => headingKey(line) === key);
        if (start < 0) {
            problems.push(`brak sekcji „${change.heading.trim()}” w projekcie`);
            continue;
        }
        const kind = headingClass(lines[start]);
        let end = start + 1;
        while (end < lines.length && headingClass(lines[end]) !== kind)
            end += 1;
        const body = change.body.replace(/\r\n?/gu, "\n").trim();
        // The new body repeats its heading or not: the stored heading stays either way.
        const replacement = body && headingKey(body.split("\n")[0]) === key ? body.split("\n") : [lines[start], ...(body ? body.split("\n") : [])];
        lines = [...lines.slice(0, start), ...(body ? replacement : []), ...(body && end < lines.length ? [""] : []), ...lines.slice(end)];
    }
    return { text: lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim(), problems };
}
/**
 * The pleading text a writing step produced: the whole text, a part that continues (the
 * pleading over the output limit), the changes to a long draft applied to it, or a problem
 * (a block cut at the limit, a change to a section the draft has not) - never silently the
 * previous version.
 */
export function pleadingStepText(answer, previous) {
    const start = answer.lastIndexOf(PLEADING_START);
    if (start >= 0) {
        const body = answer.slice(start + PLEADING_START.length);
        const end = body.indexOf(PLEADING_END);
        const continues = body.indexOf(PLEADING_CONTINUES);
        if (end >= 0 && (continues < 0 || end < continues)) {
            const text = body.slice(0, end).trim();
            return text.length >= 40 ? { kind: "FULL", text } : { kind: "PROBLEM", problem: "blok pisma pusty" };
        }
        if (continues >= 0)
            return { kind: "PARTIAL", text: body.slice(0, continues).trim() };
        return { kind: "PROBLEM", problem: "tekst pisma ucięty (brak linii końca bloku): nowa wersja nie została zapisana" };
    }
    const changes = [...answer.matchAll(/^=== ZMIANA SEKCJI:\s*(.+?)\s*===\s*\n([\s\S]*?)(?:^=== KONIEC ZMIANY ===|(?![\s\S]))/gmu)];
    if (changes.length) {
        if (!previous)
            return { kind: "PROBLEM", problem: "zmiany sekcji bez zapisanego projektu" };
        const cut = changes.some((match) => !match[0].includes(SECTION_CHANGE_END));
        if (cut)
            return { kind: "PROBLEM", problem: "zmiana sekcji ucięta (brak linii końca zmiany): nowa wersja nie została zapisana" };
        const applied = applySectionChanges(previous, changes.map((match) => ({ heading: match[1], body: match[2] })));
        if (applied.problems.length)
            return { kind: "PROBLEM", problem: `${applied.problems.join("; ")}: nowa wersja nie została zapisana` };
        return { kind: "FULL", text: applied.text };
    }
    if (answer.includes(NO_TEXT_CHANGE))
        return { kind: "UNCHANGED" };
    return { kind: "NONE" };
}
/** The request for the rest of a pleading whose block ended with PLEADING_CONTINUES. */
export function pleadingContinuationPrompt(written, round) {
    // Section headings only (a numbered point "1." of a section is no heading here).
    const headings = written.split("\n").filter((line) => headingClass(line) && !/^\|arabic$/u.test(headingClass(line))).map((line) => line.trim());
    return [
        `# DALSZY CIĄG PISMA — runda ${round} (aplikacja)`,
        "Pismo z poprzedniej odpowiedzi jest dłuższe niż jedna odpowiedź. Napisz WYŁĄCZNIE jego dalszy ciąg, od następnej sekcji po ostatniej napisanej, w bloku:",
        PLEADING_START,
        "…dalszy ciąg…",
        `${PLEADING_END}   (koniec pisma)  albo  ${PLEADING_CONTINUES}   (pismo trwa dalej; zakończ na całej sekcji)`,
        "Nie powtarzaj sekcji już napisanych; zachowaj numerację (sekcje, punkty, załączniki) i pojęcia. Raporty kroku poza blokiem tylko w ostatniej rundzie.",
        ...(headings.length ? ["Sekcje już napisane:", ...headings.slice(-40)] : []),
        "Koniec napisanego tekstu (nie powtarzaj):",
        written.slice(-1_500)
    ].join("\n");
}
/** Checkpoints whose run writes or revises the pleading text itself. */
export function writesPleading(checkpoint) {
    return ["CP-ATAK", "CP-PODMIOT", "CP-QUALITY", "CP-AUDYT", "CP-PEER"].includes(checkpoint);
}
// Instructions for the model on a checkpoint: where the pleading goes, which version
// it works on, and the user's remarks when the step was sent back.
export function draftPrompt(args) {
    const parts = [];
    if (writesPleading(args.checkpoint)) {
        const long = (args.draft?.text.length ?? 0) > LONG_DRAFT_CHARS;
        parts.push("# TEKST PISMA — FORMAT (aplikacja)", long
            ? [
                `Projekt jest długi (${Math.round(args.draft.text.length / 2_000)} stron): NIE przepisuj całego pisma — limit długości odpowiedzi by je uciął.`,
                `Każdą zmienioną sekcję podaj w całości między linią \`${SECTION_CHANGE} <nagłówek sekcji dokładnie jak w projekcie> ===\` a linią \`${SECTION_CHANGE_END}\`; sekcja bez treści między tymi liniami zostaje usunięta. Aplikacja wstawia zmiany do zapisanego projektu i zapisuje go jako kolejną wersję; z niego powstaje plik .docx.`,
                `Krok bez zmian w tekście pisma: linia \`${NO_TEXT_CHANGE}\`. Raporty, rejestry i uwagi dla prawnika — poza blokami zmian.`
            ].join("\n")
            : [
                `Pełny, aktualny tekst pisma (po zmianach tego kroku) umieść w odpowiedzi między liniami \`${PLEADING_START}\` i \`${PLEADING_END}\`, każda w osobnej linii. Raporty, rejestry i uwagi dla prawnika — poza tym blokiem. Aplikacja zapisuje ten blok jako kolejną wersję projektu w sprawie; z niego powstaje plik .docx.`,
                `Pismo dłuższe niż ok. 10 stron: zakończ blok na całej sekcji linią \`${PLEADING_CONTINUES}\` zamiast \`${PLEADING_END}\`; aplikacja poprosi o dalszy ciąg w tym samym kroku i złoży całość.`
            ].join("\n"));
    }
    if (args.draft) {
        parts.push(`# AKTUALNY PROJEKT PISMA — wersja ${args.draft.version} (${args.draft.source === "USER" ? "poprawiony przez użytkownika — jego zmiany są wiążące, nie cofaj ich" : `z pipeline'u, etap ${args.draft.stage}`})`, "Pracuj na tym tekście; nie odtwarzaj pisma z wcześniejszej części rozmowy.", args.draft.text);
    }
    if (args.remarks) {
        parts.push(`# UWAGI UŻYTKOWNIKA DO KROKU ${args.checkpoint} (krok odesłany do poprawy)`, "Wykonaj ten krok ponownie z uwzględnieniem uwag; wskaż, co zmieniono.", args.remarks);
    }
    return parts.join("\n\n");
}
