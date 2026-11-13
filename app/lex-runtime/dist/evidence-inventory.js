// Evidence inventory of a case for the process pleading pipeline (user, 2026-11-12: "macierz
// w oparciu o materiały, szczególnie obszerne … do wykorzystania przez wszystkie kroki").
// The matrix D×T at CP-1c-macierz used to rest on what fit one model window (and, for a local
// model, on the attached excerpt alone: no case-file tools). Now every chunk of every document
// is read once, in portions sized to the model (map): the model lists what each portion proves,
// with a literal quotation; the application checks each quotation against the chunk, numbers
// the items (D1, D2 …) and keeps them in the case's pleading store, keyed by the chunk's hash, so
// a new or changed document is read again and the rest is not. Each later step gets the view it
// needs (reduce): the matrix steps every item with its quotation, the drafting and verification
// steps the items the draft and findings cite, quoted, the other steps a compact list.
import { createHash } from "node:crypto";
export const INVENTORY_ITEMS_MAX = 800;
const FACT_MAX = 400;
const QUOTE_MAX = 300;
// A portion of the files for one extraction call.
export const HOSTED_PORTION_CHARS = 60_000;
export const LOCAL_PORTION_CHARS = 8_000;
export const EVIDENCE_MAP_INSTRUCTION = [
    "Jesteś asystentem prawnika. Poniżej fragmenty akt sprawy (każdy z nagłówkiem [FRAGMENT …]).",
    "Wypisz KAŻDY fakt istotny dla sprawy, który dany fragment dowodzi lub któremu przeczy — jeden fakt w jednej linii, w formacie:",
    "FRAGMENT-ID | FAKT (jednym zdaniem) | CYTAT (dosłowny, ciągły fragment tekstu, do 300 znaków) | RODZAJ (dokument urzędowy, dokument prywatny, zeznanie, opinia, korespondencja, nagranie, inny) | SIŁA (A, B, C albo D) | DATA zdarzenia (RRRR-MM-DD albo -)",
    "SIŁA: A — dokument urzędowy lub fakt bezsporny; B — dokument prywatny podpisany, korespondencja stron; C — zeznanie, oświadczenie strony; D — pośredni, poszlaka, niepodpisany.",
    "Cytat przepisz dosłownie z fragmentu (aplikacja go sprawdzi); symbole w nawiasach kwadratowych przepisz bez zmian. Bez wstępu, bez komentarza, bez tabel Markdown. Fragment bez faktów: pomiń. Pomijaj wpisy rutynowe i powtarzalne bez znaczenia dla sporu (seryjne pomiary w normie, logistyka, operacje bankowe innych podmiotów); fakt z wielu podobnych wpisów podaj raz, zbiorczo."
].join("\n");
const flat = (value) => value.normalize("NFKC").replace(/[„”"«»]/gu, '"').replace(/\s+/gu, " ").trim().toLocaleLowerCase("pl");
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 32);
const chunkKey = (documentId, chunk) => `${documentId}#${chunk}`;
/** The extraction lines of one call: "FRAGMENT-ID | fakt | cytat | rodzaj | siła | data". */
export function parseEvidenceLines(text) {
    const out = [];
    for (const line of text.split("\n")) {
        const cells = line.replace(/^\s*[-*]\s*/u, "").split("|").map((cell) => cell.trim());
        if (cells.length < 5)
            continue;
        const [fragment, fact, quote, kind, strength, date] = cells;
        if (!/^F\d{1,5}$/u.test(fragment) || !fact)
            continue;
        const grade = /^[ABCD]/u.exec(strength.toUpperCase())?.[0];
        out.push({
            fragment,
            fact: fact.slice(0, FACT_MAX),
            quote: quote.replace(/^["„]|["”]$/gu, "").slice(0, QUOTE_MAX),
            kind: (kind || "inny").slice(0, 40),
            strength: grade ?? "D",
            ...(date && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? { date } : {})
        });
    }
    return out;
}
/** The quotation occurs in the chunk (whitespace, case and quotation marks aside). */
export function quoteInChunk(chunk, quote) {
    const probe = flat(quote);
    return probe.length >= 12 && flat(chunk).includes(probe);
}
/** Chunks grouped into portions of at most `chars` (a chunk longer than that goes alone, cut). */
export function evidencePortions(chunks, chars) {
    const portions = [];
    let current = [];
    let size = 0;
    chunks.forEach((item, index) => {
        const text = item.text.slice(0, chars);
        if (current.length && size + text.length > chars) {
            portions.push(current);
            current = [];
            size = 0;
        }
        current.push({ documentId: item.documentId, chunk: item.chunk, pages: item.pages, text, fragment: `F${index + 1}` });
        size += text.length;
    });
    if (current.length)
        portions.push(current);
    return portions;
}
export function portionPrompt(portion) {
    return portion.map((item) => `[FRAGMENT ${item.fragment} — dokument ${item.documentId}, s. ${item.pages}]\n${item.text}`).join("\n\n");
}
async function pool(items, limit, run) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length)
            await run(items[next++]);
    }));
}
/**
 * Reads every chunk of the case files whose hash is not in `previous` and extracts what it
 * proves; returns the whole inventory (kept items of unchanged chunks, new items, ids anew).
 */
export async function buildEvidenceInventory(args) {
    const documents = await args.files.listDocuments();
    const all = [];
    for (const document of documents) {
        const indices = Array.from({ length: document.chunks }, (_, index) => index);
        for (let from = 0; from < indices.length; from += 20) {
            const read = await args.files.readChunks(document.documentId, indices.slice(from, from + 20));
            for (const chunk of read.chunks) {
                all.push({
                    documentId: document.documentId,
                    chunk: chunk.index,
                    pages: chunk.pageStart === chunk.pageEnd ? String(chunk.pageStart) : `${chunk.pageStart}-${chunk.pageEnd}`,
                    text: args.aliasText ? args.aliasText(document.documentId, chunk.text) : chunk.text,
                    sha: hash(chunk.text)
                });
            }
        }
    }
    const kept = {};
    const toRead = all.filter((item) => {
        const key = chunkKey(item.documentId, item.chunk);
        const before = args.previous?.chunks[key];
        if (before && before.sha === item.sha && !args.previous?.failed.includes(key)) {
            kept[key] = before;
            return false;
        }
        return true;
    });
    const unalias = (documentId, text) => (args.unaliasText ? args.unaliasText(documentId, text) : text);
    const portions = evidencePortions(toRead, args.portionChars);
    const failed = [];
    let done = 0;
    await pool(portions, Math.max(1, args.concurrency), async (portion) => {
        let lines = [];
        let ok = true;
        try {
            lines = parseEvidenceLines(await args.extract(portionPrompt(portion)));
        }
        catch {
            ok = false;
        }
        for (const item of portion) {
            const key = chunkKey(item.documentId, item.chunk);
            if (!ok) {
                failed.push(key);
                continue;
            }
            const source = toRead.find((chunk) => chunk.documentId === item.documentId && chunk.chunk === item.chunk);
            kept[key] = {
                sha: source.sha,
                items: lines
                    .filter((line) => line.fragment === item.fragment)
                    .map((line) => ({
                    documentId: item.documentId,
                    chunk: item.chunk,
                    pages: item.pages,
                    kind: line.kind,
                    fact: unalias(item.documentId, line.fact),
                    quote: unalias(item.documentId, line.quote),
                    quoteVerified: quoteInChunk(source.text, line.quote),
                    strength: line.strength,
                    ...(line.date ? { date: line.date } : {})
                }))
            };
        }
        done += 1;
        args.onProgress?.(done, portions.length);
    });
    // Ids in the order of the files (document, then chunk): the same files give the same ids.
    const order = new Map(all.map((item, index) => [chunkKey(item.documentId, item.chunk), index]));
    const chunks = Object.fromEntries(Object.entries(kept).sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0)));
    const items = capped(Object.values(chunks).flatMap((entry) => entry.items)).map((item, index) => ({ ...item, id: `D${index + 1}` }));
    return {
        inventory: { schemaVersion: 1, builtAt: (args.now ?? (() => new Date().toISOString()))(), chunks, items, failed },
        read: toRead.length - failed.length,
        reused: all.length - toRead.length,
        failed: failed.length
    };
}
// Over the cap: by turns from every document, the strongest first (the end of a long case file
// is not dropped: 2026-11-13, the witness's note was the last document and lost), file order kept.
function capped(items) {
    if (items.length <= INVENTORY_ITEMS_MAX)
        return items;
    const rank = { A: 0, B: 1, C: 2, D: 3 };
    const byDocument = new Map();
    items.forEach((item, index) => byDocument.set(item.documentId, [...(byDocument.get(item.documentId) ?? []), index]));
    const queues = [...byDocument.values()].map((list) => list.sort((a, b) => rank[items[a].strength] - rank[items[b].strength] || a - b));
    const kept = new Set();
    for (let round = 0; kept.size < INVENTORY_ITEMS_MAX; round += 1)
        for (const queue of queues)
            if (queue[round] !== undefined && kept.size < INVENTORY_ITEMS_MAX)
                kept.add(queue[round]);
    return items.filter((_, index) => kept.has(index));
}
export function validateEvidenceInventory(input) {
    const value = input;
    if (!value || value.schemaVersion !== 1 || typeof value.chunks !== "object" || !Array.isArray(value.items) || !Array.isArray(value.failed))
        return null;
    if (value.items.length > INVENTORY_ITEMS_MAX ||
        value.items.some((item) => typeof item?.id !== "string" || typeof item.fact !== "string" || item.fact.length > FACT_MAX || typeof item.quote !== "string" || item.quote.length > QUOTE_MAX)) {
        return null;
    }
    return value;
}
const VIEWS = {
    "CP-1c-macierz": "FULL",
    "CP-1c-lancuch": "FULL",
    "CP-1d-anomalie": "FULL",
    "CP-ATAK": "CITED",
    "CP-PODMIOT": "CITED",
    "CP-QUALITY": "CITED",
    "CP-AUDYT": "CITED",
    "CP-PEER": "CITED"
};
export function inventoryView(checkpoint) {
    return VIEWS[checkpoint] ?? "COMPACT";
}
// Built (or refreshed) from the matrix step on; the steps before it read the files themselves.
export function needsEvidenceInventory(checkpoint, order) {
    return order.indexOf(checkpoint) >= order.indexOf("CP-1c-macierz");
}
export function inventoryBudget(view, local) {
    return { FULL: local ? 6_000 : 60_000, CITED: local ? 4_000 : 30_000, COMPACT: local ? 3_000 : 20_000 }[view];
}
const where = (item) => `dok. ${item.documentId}, s. ${item.pages}`;
const full = (item) => `${item.id} [${item.strength}; ${item.kind}${item.date ? `; ${item.date}` : ""}; ${where(item)}] ${item.fact}${item.quote ? ` — cytat${item.quoteVerified ? "" : " (NIE ODNALEZIONY w dokumencie — nie cytuj)"}: „${item.quote}”` : ""}`;
const compact = (item) => `${item.id} [${item.strength}; ${where(item)}] ${item.fact}`;
/**
 * The inventory for one step, within the budget. FULL: every item with its quotation; COMPACT:
 * id, strength, source and fact; CITED: the items the draft and findings name (D12), quoted, then
 * the rest compact. What does not fit is named, with read_case_file as the way to the rest.
 */
export function evidenceInventoryPrompt(inventory, view, budget, citedIn = "", aliasText = (_documentId, text) => text) {
    if (!inventory?.items.length)
        return null;
    const alias = (item) => ({ ...item, fact: aliasText(item.documentId, item.fact), quote: aliasText(item.documentId, item.quote) });
    const cited = new Set([...citedIn.matchAll(/\bD(\d{1,4})\b/gu)].map((match) => `D${match[1]}`));
    const render = (item) => (view === "FULL" || (view === "CITED" && cited.has(item.id)) ? full(alias(item)) : compact(alias(item)));
    // What fits the budget: the cited items first, then by turns from every document (the
    // strongest first in each), so a small window still sees each document; shown in id order.
    const rank = { A: 0, B: 1, C: 2, D: 3 };
    const byDocument = new Map();
    for (const item of inventory.items)
        byDocument.set(item.documentId, [...(byDocument.get(item.documentId) ?? []), item]);
    for (const list of byDocument.values())
        list.sort((a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)) || rank[a.strength] - rank[b.strength] || Number(a.id.slice(1)) - Number(b.id.slice(1)));
    const order = inventory.items.filter((item) => cited.has(item.id));
    const queues = [...byDocument.values()].map((list) => list.filter((item) => !cited.has(item.id)));
    for (let round = 0; queues.some((queue) => queue.length > round); round += 1)
        for (const queue of queues)
            if (queue[round])
                order.push(queue[round]);
    const chosen = new Set();
    let used = 0;
    for (const item of order) {
        const line = render(item);
        if (used + line.length + 1 > budget)
            continue;
        chosen.add(item.id);
        used += line.length + 1;
    }
    const lines = inventory.items.map((item) => item.id);
    const kept = inventory.items.filter((item) => chosen.has(item.id)).sort((a, b) => Number(cited.has(b.id)) - Number(cited.has(a.id)) || Number(a.id.slice(1)) - Number(b.id.slice(1))).map(render);
    const unverified = inventory.items.filter((item) => item.quote && !item.quoteVerified).length;
    return [
        `# INWENTARZ DOWODÓW Z CAŁYCH AKT SPRAWY (zbudowany przez aplikację ${inventory.builtAt.slice(0, 10)}: ${inventory.items.length} pozycji z ${Object.keys(inventory.chunks).length} fragmentów${inventory.failed.length ? `; ${inventory.failed.length} fragmentów nieprzeczytanych — wskaż to` : ""})`,
        "Pozycja: id dowodu, siła (A–D), źródło (dokument, strona), fakt, cytat sprawdzony przez aplikację w dokumencie. Powołuj dowody przez id (D12) i źródło; macierz D×T i dalsze kroki budują się na tych pozycjach, nie na pamięci rozmowy.",
        "Inwentarz obejmuje WSZYSTKIE dokumenty sprawy, także strony oznaczone w ZAKRESIE DOKUMENTÓW jako NIEPRZEKAZANE albo streszczone: aplikacja przeczytała je w całości. Ustalenia z nich opieraj na pozycjach inwentarza (źródło i cytat są sprawdzone); nie nazywaj tych dokumentów nieodczytanymi ani niedostępnymi. Pełne brzmienie poza cytatem: read_case_file, gdy dostępne.",
        ...(unverified ? [`Cytaty oznaczone „NIE ODNALEZIONY” (${unverified}) nie występują dosłownie w dokumencie: nie przytaczaj ich jako cytatu.`] : []),
        ...kept,
        ...(kept.length < lines.length ? [`[… pominięto ${lines.length - kept.length} pozycji (limit okna modelu); pełne brzmienie w aktach sprawy (read_case_file, gdy dostępne)]`] : [])
    ].join("\n");
}
