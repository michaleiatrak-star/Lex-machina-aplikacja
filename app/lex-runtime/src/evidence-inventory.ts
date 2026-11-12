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
import type { CaseFileAccess } from "./case-file-tool-runtime.js";
import type { ProcessPleadingCheckpoint } from "./process-pleading-state.js";

export type EvidenceStrength = "A" | "B" | "C" | "D";

export type EvidenceItem = {
  id: string;
  documentId: string;
  chunk: number;
  pages: string;
  kind: string;
  fact: string;
  quote: string;
  // The quotation occurs in the chunk (checked by the application, not by the model).
  quoteVerified: boolean;
  strength: EvidenceStrength;
  date?: string;
};

export type EvidenceInventory = {
  schemaVersion: 1;
  builtAt: string;
  // "documentId#chunk" -> the chunk's hash and what it proves (ids are assigned over all chunks).
  chunks: Record<string, { sha: string; items: Array<Omit<EvidenceItem, "id">> }>;
  items: EvidenceItem[];
  // Chunks the extraction failed for (read again on the next build).
  failed: string[];
};

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
  "Cytat przepisz dosłownie z fragmentu (aplikacja go sprawdzi); symbole w nawiasach kwadratowych przepisz bez zmian. Bez wstępu, bez komentarza, bez tabel Markdown. Fragment bez faktów: pomiń."
].join("\n");

const flat = (value: string): string => value.normalize("NFKC").replace(/[„”"«»]/gu, '"').replace(/\s+/gu, " ").trim().toLocaleLowerCase("pl");
const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 32);
const chunkKey = (documentId: string, chunk: number): string => `${documentId}#${chunk}`;

type ParsedLine = { fragment: string; fact: string; quote: string; kind: string; strength: EvidenceStrength; date?: string };

/** The extraction lines of one call: "FRAGMENT-ID | fakt | cytat | rodzaj | siła | data". */
export function parseEvidenceLines(text: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const line of text.split("\n")) {
    const cells = line.replace(/^\s*[-*]\s*/u, "").split("|").map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const [fragment, fact, quote, kind, strength, date] = cells as [string, string, string, string, string, string | undefined];
    if (!/^F\d{1,5}$/u.test(fragment) || !fact) continue;
    const grade = /^[ABCD]/u.exec(strength.toUpperCase())?.[0] as EvidenceStrength | undefined;
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
export function quoteInChunk(chunk: string, quote: string): boolean {
  const probe = flat(quote);
  return probe.length >= 12 && flat(chunk).includes(probe);
}

type PortionItem = { fragment: string; documentId: string; chunk: number; pages: string; text: string };

/** Chunks grouped into portions of at most `chars` (a chunk longer than that goes alone, cut). */
export function evidencePortions(chunks: ReadonlyArray<{ documentId: string; chunk: number; pages: string; text: string }>, chars: number): PortionItem[][] {
  const portions: PortionItem[][] = [];
  let current: PortionItem[] = [];
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
  if (current.length) portions.push(current);
  return portions;
}

export function portionPrompt(portion: readonly PortionItem[]): string {
  return portion.map((item) => `[FRAGMENT ${item.fragment} — dokument ${item.documentId}, s. ${item.pages}]\n${item.text}`).join("\n\n");
}

async function pool<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++]!);
    })
  );
}

/**
 * Reads every chunk of the case files whose hash is not in `previous` and extracts what it
 * proves; returns the whole inventory (kept items of unchanged chunks, new items, ids anew).
 */
export async function buildEvidenceInventory(args: {
  files: Pick<CaseFileAccess, "listDocuments" | "readChunks">;
  previous?: EvidenceInventory | null;
  // One extraction call: the portion's text -> the model's lines.
  extract: (portionText: string) => Promise<string>;
  // The text of a chunk as the model sees it (pseudonym namespace of the document), and back:
  // the inventory keeps the stored tokens; a turn's namespace is not stable across turns.
  aliasText?: (documentId: string, text: string) => string;
  unaliasText?: (documentId: string, text: string) => string;
  portionChars: number;
  concurrency: number;
  onProgress?: (done: number, total: number) => void;
  now?: () => string;
}): Promise<{ inventory: EvidenceInventory; read: number; reused: number; failed: number }> {
  const documents = await args.files.listDocuments();
  const all: Array<{ documentId: string; chunk: number; pages: string; text: string; sha: string }> = [];
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
  const kept: EvidenceInventory["chunks"] = {};
  const toRead = all.filter((item) => {
    const key = chunkKey(item.documentId, item.chunk);
    const before = args.previous?.chunks[key];
    if (before && before.sha === item.sha && !args.previous?.failed.includes(key)) {
      kept[key] = before;
      return false;
    }
    return true;
  });
  const unalias = (documentId: string, text: string): string => (args.unaliasText ? args.unaliasText(documentId, text) : text);
  const portions = evidencePortions(toRead, args.portionChars);
  const failed: string[] = [];
  let done = 0;
  await pool(portions, Math.max(1, args.concurrency), async (portion) => {
    let lines: ParsedLine[] = [];
    let ok = true;
    try {
      lines = parseEvidenceLines(await args.extract(portionPrompt(portion)));
    } catch {
      ok = false;
    }
    for (const item of portion) {
      const key = chunkKey(item.documentId, item.chunk);
      if (!ok) {
        failed.push(key);
        continue;
      }
      const source = toRead.find((chunk) => chunk.documentId === item.documentId && chunk.chunk === item.chunk)!;
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
  const items = Object.values(chunks)
    .flatMap((entry) => entry.items)
    .slice(0, INVENTORY_ITEMS_MAX)
    .map((item, index) => ({ ...item, id: `D${index + 1}` }));
  return {
    inventory: { schemaVersion: 1, builtAt: (args.now ?? (() => new Date().toISOString()))(), chunks, items, failed },
    read: toRead.length - failed.length,
    reused: all.length - toRead.length,
    failed: failed.length
  };
}

export function validateEvidenceInventory(input: unknown): EvidenceInventory | null {
  const value = input as EvidenceInventory | null;
  if (!value || value.schemaVersion !== 1 || typeof value.chunks !== "object" || !Array.isArray(value.items) || !Array.isArray(value.failed)) return null;
  if (
    value.items.length > INVENTORY_ITEMS_MAX ||
    value.items.some((item) => typeof item?.id !== "string" || typeof item.fact !== "string" || item.fact.length > FACT_MAX || typeof item.quote !== "string" || item.quote.length > QUOTE_MAX)
  ) {
    return null;
  }
  return value;
}

// Which view of the inventory a checkpoint needs.
export type InventoryView = "FULL" | "COMPACT" | "CITED";
const VIEWS: Partial<Record<ProcessPleadingCheckpoint, InventoryView>> = {
  "CP-1c-macierz": "FULL",
  "CP-1c-lancuch": "FULL",
  "CP-1d-anomalie": "FULL",
  "CP-ATAK": "CITED",
  "CP-PODMIOT": "CITED",
  "CP-QUALITY": "CITED",
  "CP-AUDYT": "CITED",
  "CP-PEER": "CITED"
};
export function inventoryView(checkpoint: ProcessPleadingCheckpoint): InventoryView {
  return VIEWS[checkpoint] ?? "COMPACT";
}

// Built (or refreshed) from the matrix step on; the steps before it read the files themselves.
export function needsEvidenceInventory(checkpoint: ProcessPleadingCheckpoint, order: readonly ProcessPleadingCheckpoint[]): boolean {
  return order.indexOf(checkpoint) >= order.indexOf("CP-1c-macierz");
}

export function inventoryBudget(view: InventoryView, local: boolean): number {
  return { FULL: local ? 6_000 : 60_000, CITED: local ? 4_000 : 30_000, COMPACT: local ? 3_000 : 20_000 }[view];
}

const where = (item: EvidenceItem): string => `dok. ${item.documentId}, s. ${item.pages}`;
const full = (item: EvidenceItem): string =>
  `${item.id} [${item.strength}; ${item.kind}${item.date ? `; ${item.date}` : ""}; ${where(item)}] ${item.fact}${
    item.quote ? ` — cytat${item.quoteVerified ? "" : " (NIE ODNALEZIONY w dokumencie — nie cytuj)"}: „${item.quote}”` : ""
  }`;
const compact = (item: EvidenceItem): string => `${item.id} [${item.strength}; ${where(item)}] ${item.fact}`;

/**
 * The inventory for one step, within the budget. FULL: every item with its quotation; COMPACT:
 * id, strength, source and fact; CITED: the items the draft and findings name (D12), quoted, then
 * the rest compact. What does not fit is named, with read_case_file as the way to the rest.
 */
export function evidenceInventoryPrompt(
  inventory: EvidenceInventory | null | undefined,
  view: InventoryView,
  budget: number,
  citedIn = "",
  aliasText: (documentId: string, text: string) => string = (_documentId, text) => text
): string | null {
  if (!inventory?.items.length) return null;
  const alias = (item: EvidenceItem): EvidenceItem => ({ ...item, fact: aliasText(item.documentId, item.fact), quote: aliasText(item.documentId, item.quote) });
  const cited = new Set([...citedIn.matchAll(/\bD(\d{1,4})\b/gu)].map((match) => `D${match[1]}`));
  const lines =
    view === "FULL"
      ? inventory.items.map((item) => full(alias(item)))
      : view === "CITED"
        ? [
            ...inventory.items.filter((item) => cited.has(item.id)).map((item) => full(alias(item))),
            ...inventory.items.filter((item) => !cited.has(item.id)).map((item) => compact(alias(item)))
          ]
        : inventory.items.map((item) => compact(alias(item)));
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  const unverified = inventory.items.filter((item) => item.quote && !item.quoteVerified).length;
  return [
    `# INWENTARZ DOWODÓW Z CAŁYCH AKT SPRAWY (zbudowany przez aplikację ${inventory.builtAt.slice(0, 10)}: ${inventory.items.length} pozycji z ${Object.keys(inventory.chunks).length} fragmentów${
      inventory.failed.length ? `; ${inventory.failed.length} fragmentów nieprzeczytanych — wskaż to` : ""
    })`,
    "Pozycja: id dowodu, siła (A–D), źródło (dokument, strona), fakt, cytat sprawdzony przez aplikację w dokumencie. Powołuj dowody przez id (D12) i źródło; macierz D×T i dalsze kroki budują się na tych pozycjach, nie na pamięci rozmowy.",
    ...(unverified ? [`Cytaty oznaczone „NIE ODNALEZIONY” (${unverified}) nie występują dosłownie w dokumencie: nie przytaczaj ich jako cytatu.`] : []),
    ...kept,
    ...(kept.length < lines.length ? [`[… pominięto ${lines.length - kept.length} pozycji (limit okna modelu); pełne brzmienie w aktach sprawy (read_case_file, gdy dostępne)]`] : [])
  ].join("\n");
}
