/** Own columns of the matrix; the rest share one column (presentation only, each fact keeps its document). */
export const OWN_COLUMNS = 6;
export const OTHER_COLUMN = "Pozostałe dokumenty";
const pad = (index) => `D${String(index + 1).padStart(2, "0")}`;
/** D01..DN in the order of delivery, with the heading the matrix uses for the document. */
export function registerIds(documents) {
    return new Map(documents.map((document, index) => [document.documentId, { id: pad(index), record: `${pad(index)} — ${document.label}` }]));
}
/**
 * Own columns, in this order: the challenged decision, the document in dispute (a pleading or the
 * party's earlier letter), judgments and decisions, protocols, then the largest documents, up to
 * OWN_COLUMNS; every other document goes to "Pozostałe dokumenty (n)".
 */
export function matrixColumns(documents, challengedId = null, own = OWN_COLUMNS) {
    const ids = registerIds(documents);
    const rank = (document) => document.documentId === challengedId
        ? 0
        : document.category === "PISMO_PROCESOWE"
            ? 1
            : document.category === "ORZECZENIE"
                ? 2
                : document.kind.startsWith("PROTOKOL")
                    ? 3
                    : 4;
    const ordered = [...documents].sort((a, b) => rank(a) - rank(b) || b.chars - a.chars);
    const chosen = new Set(ordered.slice(0, own).map((document) => document.documentId));
    const rest = documents.filter((document) => !chosen.has(document.documentId)).length;
    return new Map(documents.map((document) => {
        const id = ids.get(document.documentId).id;
        if (!chosen.has(document.documentId))
            return [document.documentId, `${OTHER_COLUMN} (${rest})`];
        return [document.documentId, document.documentId === challengedId ? `${id} zaskarżone rozstrzygnięcie` : `${id} ${document.label}`];
    }));
}
export function buildRegister(documents, coverage, challengedId = null) {
    const ids = registerIds(documents);
    const columns = matrixColumns(documents, challengedId);
    return documents.map((document) => {
        const read = coverage.find((item) => item.documentId === document.documentId);
        const { id, record } = ids.get(document.documentId);
        return {
            ...document,
            id,
            record,
            column: columns.get(document.documentId),
            parts: read?.parts ?? 0,
            facts: read?.facts ?? 0,
            state: read?.state ?? "UNREAD",
            reasons: read?.reasons ?? ["dokument nie został przekazany do odczytu"]
        };
    });
}
export function registerGaps(entries) {
    return entries.filter((entry) => entry.state === "GAP" || entry.state === "UNREAD");
}
const STATE_TEXT = {
    READ: "przeczytany",
    NO_FACTS: "przeczytany, brak faktów do tematów (potwierdzone)",
    GAP: "⚠️ nie potwierdzono odczytu",
    UNREAD: "⚠️ nieprzeczytany"
};
const size = (chars) => (chars >= 1_000 ? `${Math.round(chars / 1_000)} tys. zn.` : `${chars} zn.`);
/** The register as a table (under the pleading and before it). */
export function registerTable(entries, links = true) {
    const read = entries.filter((entry) => entry.state === "READ" || entry.state === "NO_FACTS").length;
    return [
        `REJESTR DOKUMENTÓW (prowadzony przez aplikację): przeczytano ${read}/${entries.length}`,
        "",
        "| Nr | Dokument | Rodzaj | Rozmiar | Kolumna macierzy | Odczyt | Fakty |",
        "|---|---|---|---|---|---|---|",
        ...entries.map((entry) => `| ${entry.id} | ${links ? `[[LEXDOC:${entry.documentId}:${entry.firstChunk}]]` : entry.record} | ${entry.label} | ${size(entry.chars)}${entry.parts > 1 ? `, ${entry.parts} części` : ""} | ${entry.column} | ${STATE_TEXT[entry.state]}${entry.state === "GAP" || entry.state === "UNREAD" ? `: ${entry.reasons.join("; ").slice(0, 200)}` : ""} | ${entry.facts} |`)
    ].join("\n");
}
/** What the model gets before writing: the register, the columns and the rule against omission. */
export function registerPrompt(entries) {
    const gaps = registerGaps(entries);
    return [
        "# REJESTR DOKUMENTÓW SPRAWY (aplikacja; zakaz pomijania materiału)",
        "Każdy dokument ma numer D01..DN. Każdy został przeczytany przez aplikację w całości (duże w częściach), a fakty z niego są w macierzy pod jego numerem. Powołując fakt, wskaż dokument (numer i [[LEXDOC]]). Kolumna „Pozostałe dokumenty” to tylko układ macierzy: każdy fakt należy do swojego dokumentu i ma taką samą wagę.",
        registerTable(entries),
        ...(gaps.length
            ? [`Dokumenty bez potwierdzonego odczytu (${gaps.map((entry) => entry.id).join(", ")}): nie opieraj się na nich i nie zakładaj ich treści; pismo zostanie oznaczone jako szkic z listą braków.`]
            : [])
    ].join("\n\n");
}
