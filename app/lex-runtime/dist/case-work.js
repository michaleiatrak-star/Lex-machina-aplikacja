// Work done in the case (case memory): what later turns, in any thread, start from instead of
// doing it again, and what is still open. Recorded by the application from the turn itself
// (pages read, a chronology kept, a workflow completed), not from the model's own words.
import { mergeRanges, missingPages } from "./document-coverage.js";
export const MAX_CASE_WORK = 60;
export function validCaseWork(value) {
    if (!Array.isArray(value) || value.length > MAX_CASE_WORK)
        return null;
    const items = [];
    for (const raw of value) {
        const item = raw;
        if (!item ||
            typeof item.key !== "string" || item.key.length > 200 ||
            !["DOCUMENT_ANALYSIS", "CHRONOLOGY", "WORKFLOW", "OPEN_ISSUE", "FILE"].includes(String(item.kind)) ||
            typeof item.label !== "string" || item.label.length > 300 ||
            (item.status !== "DONE" && item.status !== "OPEN") ||
            typeof item.at !== "string" || Number.isNaN(Date.parse(item.at)) ||
            (item.skill !== undefined && (typeof item.skill !== "string" || item.skill.length > 100)) ||
            (item.documentId !== undefined && !/^doc_[a-f0-9]{24}$/.test(String(item.documentId))) ||
            (item.totalPages !== undefined && (!Number.isInteger(item.totalPages) || item.totalPages < 1)) ||
            (item.pages !== undefined &&
                (!Array.isArray(item.pages) || item.pages.length > 500 ||
                    !item.pages.every((range) => Array.isArray(range) && range.length === 2 && range.every((page) => Number.isInteger(page) && page >= 1))))) {
            return null;
        }
        items.push({ ...item, ...(item.pages ? { pages: item.pages.map(([a, b]) => [a, b]) } : {}) });
    }
    return items;
}
const WORKFLOW_LABEL = {
    COURT_ANALYSIS_V1: "analiza sądowa (wszystkie etapy)",
    CONTRACT_ANALYSIS_V1: "analiza / redakcja umowy (wszystkie etapy)",
    CHRONOLOGY_V1: "chronologia sprawy (wszystkie etapy)",
    EVIDENCE_ANALYSIS_V1: "analiza dowodów (wszystkie etapy)",
    WITNESS_QUESTIONING_V1: "przygotowanie przesłuchania (wszystkie etapy)",
    PROCESS_PLEADING_V1: "pismo procesowe ze statusem FINAL"
};
/** The register after a turn: documents analysed (pages summed up), a chronology, a workflow done. */
export function recordCaseWork(previous, turn) {
    const items = new Map(previous.map((item) => [item.key, { ...item }]));
    if (turn.documentAnalysis) {
        for (const entry of turn.coverage ?? []) {
            const key = `DOCUMENT_ANALYSIS:${entry.documentId}`;
            const earlier = items.get(key);
            const totalPages = Math.max(entry.totalPages, earlier?.totalPages ?? 0);
            const pages = mergeRanges([...(earlier?.pages ?? []), ...entry.pages]);
            items.set(key, {
                key,
                kind: "DOCUMENT_ANALYSIS",
                label: entry.title ?? earlier?.label ?? entry.documentId,
                status: missingPages(totalPages, pages).length ? "OPEN" : "DONE",
                at: turn.now,
                ...(turn.skill ? { skill: turn.skill } : earlier?.skill ? { skill: earlier.skill } : {}),
                documentId: entry.documentId,
                totalPages,
                pages
            });
        }
    }
    if (turn.chronologySaved) {
        items.set("CHRONOLOGY", { key: "CHRONOLOGY", kind: "CHRONOLOGY", label: "chronologia sprawy (oś czasu w pamięci sprawy)", status: "DONE", at: turn.now });
    }
    for (const file of turn.files ?? []) {
        const key = `FILE:${file.artifactId}`;
        items.set(key, { key, kind: "FILE", label: `plik „${file.filename}”${file.draft ? " (projekt)" : ""}`.slice(0, 300), status: "DONE", at: turn.now });
    }
    for (const workflow of turn.completedWorkflows ?? []) {
        const key = `WORKFLOW:${workflow}`;
        if (!items.has(key))
            items.set(key, { key, kind: "WORKFLOW", label: WORKFLOW_LABEL[workflow] ?? workflow, status: "DONE", at: turn.now });
    }
    if (turn.gapsListed) {
        const listed = new Set((turn.openIssues ?? []).map((issue) => `ISSUE:${issue.key}`));
        for (const [key, item] of items) {
            if (key.startsWith("ISSUE:brak:") && item.status === "OPEN" && !listed.has(key))
                items.set(key, { ...item, status: "DONE", at: turn.now });
        }
    }
    for (const issue of turn.openIssues ?? []) {
        const key = `ISSUE:${issue.key}`;
        items.set(key, { key, kind: "OPEN_ISSUE", label: issue.label.slice(0, 300), status: "OPEN", at: turn.now, ...(turn.skill ? { skill: turn.skill } : {}) });
    }
    for (const resolved of turn.resolvedIssues ?? []) {
        const key = `ISSUE:${resolved}`;
        const item = items.get(key);
        if (item?.status === "OPEN")
            items.set(key, { ...item, status: "DONE", at: turn.now });
    }
    // Open work first, then the newest; the register stays bounded.
    return [...items.values()]
        .sort((a, b) => (a.status === b.status ? b.at.localeCompare(a.at) : a.status === "OPEN" ? -1 : 1))
        .slice(0, MAX_CASE_WORK);
}
const pages = (ranges) => ranges.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
/** One line per item for the next turns and the case memory view. */
export function caseWorkLine(item) {
    const date = item.at.slice(0, 10);
    if (item.kind === "DOCUMENT_ANALYSIS" && item.totalPages) {
        return item.status === "DONE"
            ? `ZAMKNIĘTE: analiza dokumentu „${item.label}” w całości (${item.totalPages} s.)${item.skill ? `, ${item.skill}` : ""}, ${date}`
            : `OTWARTE: analiza dokumentu „${item.label}” — przeczytane s. ${pages(item.pages ?? [])} z ${item.totalPages}, brakuje s. ${pages(missingPages(item.totalPages, item.pages ?? []))}`;
    }
    return `${item.status === "DONE" ? "ZAMKNIĘTE" : "OTWARTE"}: ${item.label}, ${date}`;
}
/** The register for a later turn: use the results, do not repeat closed work, finish the open. */
export function caseWorkBlock(items) {
    if (!items.length)
        return null;
    return [
        "[Prace wykonane wcześniej w tej sprawie (rejestr aplikacji). Korzystaj z ich wyników z rozmowy i pamięci sprawy, nie wykonuj ich od nowa; prace OTWARTE dokończ, gdy prośba ich dotyczy; kwestie OTWARTE (do weryfikacji, do zbadania) rozstrzygnij w źródle, zanim oprzesz na nich odpowiedź albo pismo:]",
        ...items.slice(0, 30).map((item) => `- ${caseWorkLine(item)}`),
        "[Koniec rejestru prac]"
    ].join("\n");
}
/** The key of an open point: its text, normalized (the same provision in any spelling). */
export function issueKey(text) {
    return text.toLocaleLowerCase("pl").replace(/\s+/gu, " ").replace(/[„”"]/gu, "").trim().slice(0, 160);
}
/**
 * The points a turn left open and those it settled, from the application's own records:
 * references the verification could not confirm (do weryfikacji w źródle), a step the
 * answer announced but did not do (do zbadania); a reference verified later closes its point.
 */
export function turnIssues(result) {
    const open = new Map();
    const gaps = answerGaps(result.answer ?? "");
    for (const gap of gaps ?? [])
        open.set(issueKey(`brak:${gap}`), `brak (do uzupełnienia): ${gap}`);
    for (const reference of result.blockedReferences ?? []) {
        if (/UNVERIFIED|NOT_FOUND|AMBIGUOUS/u.test(reference.status))
            open.set(issueKey(reference.claim), `do weryfikacji w źródle: ${reference.claim}`);
    }
    for (const record of result.evidence ?? []) {
        if (record.status === "UNVERIFIED")
            open.set(issueKey(record.claim), `do weryfikacji w źródle: ${record.claim}`);
    }
    if (result.announcedStep)
        open.set(issueKey(`krok:${result.announcedStep}`), `do zbadania (zapowiedziane, niewykonane): ${result.announcedStep}`);
    const resolved = (result.evidence ?? [])
        .filter((record) => record.status === "VERIFIED" || record.status === "SUPPORTED")
        .map((record) => issueKey(record.claim))
        .filter((key) => !open.has(key));
    return { open: [...open].map(([key, label]) => ({ key, label })), resolved, gapsListed: gaps !== null };
}
const GAP_HEADING = /^\s*(?:#{1,4}\s*)?(?:\*\*)?\s*(?:[IVX]+\.\s*|\d+\.\s*)?(?:DANE DO UZUPEŁNIENIA|BRAKI(?: DANYCH| W DOKUMENTACJI)?|BRAKUJĄCE DANE|INFORMACJE DO UZUPEŁNIENIA)\b[^\n]*$/imu;
const GAP_LINE = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+(\S.*)$/u;
/**
 * The gaps an answer lists (its DANE DO UZUPEŁNIENIA / BRAKI section, one per item), null when
 * it has no such section (the gaps of earlier turns stay as they were).
 */
export function answerGaps(answer) {
    const lines = answer.replace(/\r\n?/gu, "\n").split("\n");
    const start = lines.findIndex((line) => GAP_HEADING.test(line));
    if (start < 0)
        return null;
    const gaps = [];
    for (const line of lines.slice(start + 1)) {
        if (!line.trim()) {
            if (gaps.length)
                break;
            continue;
        }
        const item = GAP_LINE.exec(line);
        if (!item)
            break;
        const text = item[1].replace(/\*\*/gu, "").replace(/\s+/gu, " ").trim();
        if (text && !/^(?:brak|nie ma|—|-)\.?$/iu.test(text))
            gaps.push(text.slice(0, 200));
        if (gaps.length >= 15)
            break;
    }
    return gaps;
}
