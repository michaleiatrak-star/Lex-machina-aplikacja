// Local database of court rulings and interpretations (user, 2026-11-13: "serwer bazy wyroków z
// CBOSA, SN, pozostałych wyroków z bazy i interpretacji … w przypadku przerwania kontynuowany od
// najstarszych dokumentów aż do najnowszych z okresowym sprawdzaniem … odczyt i przeszukiwanie ma
// pierwszeństwo przed pobieraniem kopii ze źródła, gdy są tożsame … karty i powiązania").
// One SQLite file: a card per document as the source gives it (court, signatures, date, judges,
// keywords, legal bases, the lower court's ruling), its text, the links to other documents (cited
// rulings, cited acts, the lower court's case) and each source's synchronisation cursor. A source
// adapter reads its own pages oldest first; an interrupted run continues from the cursor; after the
// full pass only changes are read. The source stays the authority: a card says where it came from
// and when, and the status of a ruling is not promoted by being held here.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type CaseLawSource = "SAOS" | "CBOSA" | "SN" | "EUREKA" | "SP" | "TK" | "KIO" | "UODO" | "WSD" | "OSD" | "SEJM" | "NIL" | "URE" | "RPO" | "KNF" | "UKE" | "RIO" | "KRRIT" | "RF";

export type CaseLawCard = {
  id: string;
  source: CaseLawSource;
  sourceId: string;
  court: string;
  courtType: string;
  division: string | null;
  signatures: string[];
  date: string | null;
  kind: string | null;
  judges: string[];
  keywords: string[];
  legalBases: string[];
  summary: string | null;
  url: string | null;
  modified: string | null;
  fetchedAt: string;
  textSha256: string | null;
};

export type CaseLawLink = { kind: "CITES_CASE" | "CITES_ACT" | "LOWER_COURT"; target: string; label: string | null };

export type SyncCursor = { phase: "FULL" | "INCREMENTAL"; year: number; page: number; since: string | null; completedAt: string | null };

export function defaultCaseLawDbDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.LEX_CASE_LAW_DB_DIR ?? path.join(env.LEX_DATA_DIR ?? path.join(os.homedir(), ".lex-machina", "data"), "case-law-db"));
}

/** "II  K 336/17" -> "II K 336/17"; the form a signature is compared in. */
export const CASE_LAW_PACKAGE_FORMAT = "lex-case-law/1";
export const CASE_LAW_SOURCES: readonly CaseLawSource[] = ["SAOS", "CBOSA", "SN", "EUREKA", "SP", "TK", "KIO", "UODO", "WSD", "OSD", "SEJM", "NIL", "URE", "RPO", "KNF", "UKE", "RIO", "KRRIT", "RF"];
export function caseLawPackageManifest(documents: Record<string, number>, library = 0): string {
  return JSON.stringify({ format: CASE_LAW_PACKAGE_FORMAT, exportedAt: new Date().toISOString(), documents, library });
}
export type CaseLawImportResult = { format: string | null; imported: number; skipped: number; invalid: number; sources: Record<string, number> };

export function normalizeSignature(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").replace(/\s*\/\s*/gu, "/").trim().toLocaleUpperCase("pl");
}

export class CaseLawDatabase {
  private readonly db: DatabaseSync;
  readonly fts: boolean;

  constructor(directory: string = defaultCaseLawDbDir()) {
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "case-law.sqlite"), { timeout: 5_000 });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, source_id TEXT NOT NULL, card TEXT NOT NULL,
        text TEXT, text_sha256 TEXT, modified TEXT, date TEXT, fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS signatures (signature TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (signature, id));
      CREATE TABLE IF NOT EXISTS links (id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, label TEXT, PRIMARY KEY (id, kind, target));
      CREATE INDEX IF NOT EXISTS links_target ON links (target);
      CREATE TABLE IF NOT EXISTS sync_state (source TEXT PRIMARY KEY, cursor TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
    let fts = true;
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(id UNINDEXED, signatures, keywords, summary, text, tokenize = "unicode61 remove_diacritics 2");`);
    } catch {
      fts = false;
    }
    this.fts = fts;
  }

  close(): void {
    this.db.close();
  }

  /** Inserts or replaces a document; returns false when the same version (modification and text) is already held. */
  upsert(card: Omit<CaseLawCard, "id" | "fetchedAt" | "textSha256">, text: string | null, links: CaseLawLink[], fetchedAt = new Date().toISOString()): boolean {
    const id = `${card.source}:${card.sourceId}`;
    const sha = text ? createHash("sha256").update(text).digest("hex") : null;
    const held = this.db.prepare("SELECT modified, text_sha256 FROM documents WHERE id = ?").get(id) as { modified: string | null; text_sha256: string | null } | undefined;
    if (held && held.modified === card.modified && held.text_sha256 === sha) return false;
    const full: CaseLawCard = { ...card, id, fetchedAt, textSha256: sha };
    this.db.exec("BEGIN");
    try {
      this.db.prepare("INSERT OR REPLACE INTO documents (id, source, source_id, card, text, text_sha256, modified, date, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        id, card.source, card.sourceId, JSON.stringify(full), text, sha, card.modified, card.date, fetchedAt
      );
      this.db.prepare("DELETE FROM signatures WHERE id = ?").run(id);
      for (const signature of card.signatures) this.db.prepare("INSERT OR IGNORE INTO signatures (signature, id) VALUES (?, ?)").run(normalizeSignature(signature), id);
      this.db.prepare("DELETE FROM links WHERE id = ?").run(id);
      for (const link of links) this.db.prepare("INSERT OR IGNORE INTO links (id, kind, target, label) VALUES (?, ?, ?, ?)").run(id, link.kind, link.target, link.label);
      if (this.fts) {
        this.db.prepare("DELETE FROM documents_fts WHERE id = ?").run(id);
        this.db.prepare("INSERT INTO documents_fts (id, signatures, keywords, summary, text) VALUES (?, ?, ?, ?, ?)").run(id, card.signatures.join(" "), card.keywords.join(" "), card.summary ?? "", text ?? "");
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  /** The documents held under a signature (exact, after normalisation). */
  bySignature(signature: string): Array<{ card: CaseLawCard; text: string | null }> {
    const rows = this.db.prepare("SELECT d.card, d.text FROM signatures s JOIN documents d ON d.id = s.id WHERE s.signature = ?").all(normalizeSignature(signature)) as Array<{ card: string; text: string | null }>;
    return rows.map((row) => ({ card: JSON.parse(row.card) as CaseLawCard, text: row.text }));
  }

  /** What a document cites, and which held documents cite it (by any of its signatures). */
  related(id: string): { cites: CaseLawLink[]; citedBy: Array<{ id: string; signatures: string[] }> } {
    const cites = (this.db.prepare("SELECT kind, target, label FROM links WHERE id = ?").all(id) as Array<{ kind: CaseLawLink["kind"]; target: string; label: string | null }>);
    const card = this.db.prepare("SELECT card FROM documents WHERE id = ?").get(id) as { card: string } | undefined;
    const own = card ? (JSON.parse(card.card) as CaseLawCard).signatures.map(normalizeSignature) : [];
    const citedBy = own.length
      ? (this.db.prepare(`SELECT DISTINCT l.id, d.card FROM links l JOIN documents d ON d.id = l.id WHERE l.kind IN ('CITES_CASE', 'LOWER_COURT') AND l.target IN (${own.map(() => "?").join(",")})`).all(...own) as Array<{ id: string; card: string }>)
          .map((row) => ({ id: row.id, signatures: (JSON.parse(row.card) as CaseLawCard).signatures }))
      : [];
    return { cites, citedBy };
  }

  /** Full-text search over cards and texts (FTS5; without it, signatures and keywords only). */
  search(query: string, limit = 20): CaseLawCard[] {
    if (this.fts) {
      const terms = query.normalize("NFKC").split(/\s+/u).map((term) => term.replace(/["*^():]/gu, "")).filter((term) => term.length > 1).map((term) => `"${term}"`).join(" ");
      if (!terms) return [];
      const rows = this.db.prepare("SELECT d.card FROM documents_fts f JOIN documents d ON d.id = f.id WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?").all(terms, limit) as Array<{ card: string }>;
      return rows.map((row) => JSON.parse(row.card) as CaseLawCard);
    }
    const rows = this.db.prepare("SELECT card FROM documents WHERE card LIKE ? LIMIT ?").all(`%${query}%`, limit) as Array<{ card: string }>;
    return rows.map((row) => JSON.parse(row.card) as CaseLawCard);
  }

  count(source?: CaseLawSource): number {
    const row = (source ? this.db.prepare("SELECT COUNT(*) AS n FROM documents WHERE source = ?").get(source) : this.db.prepare("SELECT COUNT(*) AS n FROM documents").get()) as { n: number };
    return row.n;
  }

  /** Documents per issuing body (court, chamber) of a source, most first. */
  courts(source: CaseLawSource): Array<{ court: string; documents: number }> {
    return this.db
      .prepare("SELECT json_extract(card, '$.court') AS court, COUNT(*) AS documents FROM documents WHERE source = ? GROUP BY court ORDER BY documents DESC")
      .all(source)
      .map((row) => ({ court: String((row as { court: unknown }).court ?? ""), documents: Number((row as { documents: number }).documents) }));
  }

  /** A page of a source's documents (optionally one body's), newest first. */
  list(source: CaseLawSource, court: string | null, offset: number, limit: number): { total: number; cards: CaseLawCard[] } {
    const where = court ? "source = ? AND json_extract(card, '$.court') = ?" : "source = ?";
    const args = court ? [source, court] : [source];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS n FROM documents WHERE ${where}`).get(...args) as { n: number }).n);
    const rows = this.db.prepare(`SELECT card FROM documents WHERE ${where} ORDER BY date IS NULL, date DESC, id LIMIT ? OFFSET ?`).all(...args, limit, offset) as Array<{ card: string }>;
    return { total, cards: rows.map((row) => JSON.parse(row.card) as CaseLawCard) };
  }

  /** Whether a document of this source is held. */
  has(source: CaseLawSource, sourceId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM documents WHERE id = ?").get(`${source}:${sourceId}`));
  }

  /**
   * The same ruling already held from another official source (same signature and date): the
   * database keeps one copy, e.g. a WSA ruling from CBOSA is not stored again from another base.
   */
  duplicateOf(source: CaseLawSource, signatures: string[], date: string | null): string | null {
    if (!date) return null;
    for (const signature of signatures) {
      const row = this.db
        .prepare("SELECT d.id FROM signatures s JOIN documents d ON d.id = s.id WHERE s.signature = ? AND d.date = ? AND d.source <> ? AND d.source <> 'SAOS' LIMIT 1")
        .get(normalizeSignature(signature), date, source) as { id: string } | undefined;
      if (row) return row.id;
    }
    return null;
  }

  /** Any JSON state of a source's synchronisation (its cursor), saved after every unit of work. */
  state<T>(source: string): T | null {
    const row = this.db.prepare("SELECT cursor FROM sync_state WHERE source = ?").get(source) as { cursor: string } | undefined;
    return row ? (JSON.parse(row.cursor) as T) : null;
  }

  saveState(source: string, state: unknown): void {
    this.db.prepare("INSERT OR REPLACE INTO sync_state (source, cursor, updated_at) VALUES (?, ?, ?)").run(source, JSON.stringify(state), new Date().toISOString());
  }

  cursor(source: CaseLawSource): SyncCursor | null {
    const row = this.db.prepare("SELECT cursor FROM sync_state WHERE source = ?").get(source) as { cursor: string } | undefined;
    return row ? (JSON.parse(row.cursor) as SyncCursor) : null;
  }

  /**
   * A package of the database (user, 2026-11-20: the user builds the base where a source answers
   * only a browser — sn.pl behind its check — and loads it elsewhere): one JSON line per document
   * with its card (the source it came from), text and links, then each source's synchronisation
   * state, so the next run there continues where this one stopped. Only the given sources.
   */
  documentCounts(sources: readonly CaseLawSource[] | null = null): Record<string, number> {
    return sources?.length
      ? Object.fromEntries(sources.map((source) => [source, this.count(source)]))
      : Object.fromEntries((this.db.prepare("SELECT source, COUNT(*) AS n FROM documents GROUP BY source").all() as Array<{ source: string; n: number }>).map((row) => [row.source, row.n]));
  }

  *exportLines(sources: readonly CaseLawSource[] | null = null, withManifest = true): Generator<string> {
    const wanted = sources?.length ? sources : null;
    if (withManifest) yield caseLawPackageManifest(this.documentCounts(wanted));
    const where = wanted ? `WHERE source IN (${wanted.map(() => "?").join(",")})` : "";
    const rows = this.db.prepare(`SELECT id, card, text FROM documents ${where} ORDER BY id`).iterate(...(wanted ?? []));
    const links = this.db.prepare("SELECT kind, target, label FROM links WHERE id = ?");
    for (const row of rows as Iterable<{ id: string; card: string; text: string | null }>) {
      yield JSON.stringify({ card: JSON.parse(row.card), text: row.text, links: links.all(row.id) });
    }
    const states = this.db.prepare("SELECT source, cursor FROM sync_state").all() as Array<{ source: string; cursor: string }>;
    for (const state of states) {
      const source = state.source.split(":")[0]!;
      if (!wanted || wanted.includes(source as CaseLawSource)) yield JSON.stringify({ state: state.source, cursor: JSON.parse(state.cursor) });
    }
  }

  /**
   * Loads a package line by line. A document already held in the same version is skipped; a
   * ruling held from another official source is not stored twice; the sync state is taken only
   * when this database has none for the source (its own run is never moved back).
   */
  importLine(line: string, result: CaseLawImportResult): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let item: Record<string, unknown>;
    try {
      item = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      result.invalid += 1;
      return;
    }
    if (typeof item.format === "string") {
      if (item.format !== CASE_LAW_PACKAGE_FORMAT) throw new Error("CASE_LAW_PACKAGE_FORMAT_UNKNOWN");
      result.format = item.format;
      return;
    }
    if (typeof item.state === "string") {
      if (!this.state(item.state)) this.saveState(item.state, item.cursor);
      return;
    }
    const card = item.card as CaseLawCard | undefined;
    if (!card || !CASE_LAW_SOURCES.includes(card.source) || typeof card.sourceId !== "string" || !Array.isArray(card.signatures)) {
      result.invalid += 1;
      return;
    }
    const { id: _id, fetchedAt, textSha256: _sha, ...rest } = card;
    if (this.duplicateOf(card.source, card.signatures, card.date)) {
      result.skipped += 1;
      return;
    }
    const links = Array.isArray(item.links) ? (item.links as CaseLawLink[]).filter((link) => link && typeof link.target === "string") : [];
    const stored = this.upsert(rest, typeof item.text === "string" ? item.text : null, links, typeof fetchedAt === "string" ? fetchedAt : undefined);
    if (stored) {
      result.imported += 1;
      result.sources[card.source] = (result.sources[card.source] ?? 0) + 1;
    } else result.skipped += 1;
  }

  saveCursor(source: CaseLawSource, cursor: SyncCursor): void {
    this.db.prepare("INSERT OR REPLACE INTO sync_state (source, cursor, updated_at) VALUES (?, ?, ?)").run(source, JSON.stringify(cursor), new Date().toISOString());
  }
}

// ── SAOS: the public dump, year by year from the oldest, then changes since the last run ──
export const SAOS_DUMP = "https://www.saos.org.pl/api/dump/judgments";
export const SAOS_FIRST_YEAR = 1990;
const SAOS_PAGE_SIZE = 100;
// SAOS asks API users to keep a pause between requests.
const SAOS_GAP_MS = 1_000;

type SaosItem = {
  id: number;
  courtType?: string;
  courtCases?: Array<{ caseNumber?: string }>;
  judgmentType?: string;
  judgmentDate?: string;
  judges?: Array<{ name?: string }>;
  keywords?: string[];
  legalBases?: string[];
  summary?: string | null;
  textContent?: string;
  division?: { name?: string; court?: { name?: string } } | null;
  source?: { judgmentUrl?: string; publicationDate?: string } | null;
  referencedCourtCases?: Array<{ caseNumber?: string }>;
  referencedRegulations?: Array<{ journalYear?: number; journalEntry?: number; journalNo?: number; journalTitle?: string }>;
  lowerCourtJudgments?: Array<{ caseNumber?: string } | string>;
  modificationDate?: string;
};

const plain = (html: string): string => html.replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&quot;/gu, '"').replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/\s+/gu, " ").trim();

/** One dump item -> card, text and links (cited rulings, cited Dz.U. acts as ELI, the lower court's case). */
export function saosRecord(item: SaosItem): { card: Omit<CaseLawCard, "id" | "fetchedAt" | "textSha256">; text: string | null; links: CaseLawLink[] } {
  const signatures = (item.courtCases ?? []).map((entry) => entry.caseNumber ?? "").filter(Boolean);
  const links: CaseLawLink[] = [
    ...(item.referencedCourtCases ?? []).map((entry) => entry.caseNumber).filter((value): value is string => Boolean(value)).map((value) => ({ kind: "CITES_CASE" as const, target: normalizeSignature(value), label: null })),
    ...(item.referencedRegulations ?? [])
      .filter((entry) => entry.journalYear && entry.journalEntry)
      .map((entry) => ({ kind: "CITES_ACT" as const, target: `DU/${entry.journalYear}/${entry.journalEntry}`, label: entry.journalTitle ?? null })),
    ...(item.lowerCourtJudgments ?? [])
      .map((entry) => (typeof entry === "string" ? entry : entry.caseNumber))
      .filter((value): value is string => Boolean(value))
      .map((value) => ({ kind: "LOWER_COURT" as const, target: normalizeSignature(value), label: null }))
  ];
  return {
    card: {
      source: "SAOS",
      sourceId: String(item.id),
      court: item.division?.court?.name ?? (item.courtType === "SUPREME" ? "Sąd Najwyższy" : item.courtType ?? ""),
      courtType: item.courtType ?? "",
      division: item.division?.name ?? null,
      signatures,
      date: item.judgmentDate ?? null,
      kind: item.judgmentType ?? null,
      judges: (item.judges ?? []).map((judge) => judge.name ?? "").filter(Boolean),
      keywords: item.keywords ?? [],
      legalBases: item.legalBases ?? [],
      summary: item.summary ? plain(item.summary) : null,
      url: `https://www.saos.org.pl/judgments/${item.id}`,
      modified: item.modificationDate ?? item.source?.publicationDate ?? null
    },
    text: item.textContent ? plain(item.textContent) : null,
    links
  };
}

type DumpFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * One run of the SAOS synchronisation: from the cursor, year by year (the oldest first), page by
 * page; the cursor is saved after every page, so a broken run continues where it stopped. After the
 * last year the full pass is complete and later runs read only what changed since the previous run.
 */
export async function syncSaos(store: CaseLawDatabase, args: { fetcher?: DumpFetch; maxPages?: number; gapMs?: number; now?: () => Date; firstYear?: number } = {}): Promise<{ pages: number; stored: number; cursor: SyncCursor }> {
  const fetcher = args.fetcher ?? (globalThis.fetch.bind(globalThis) as unknown as DumpFetch);
  const now = args.now ?? (() => new Date());
  const gap = args.gapMs ?? SAOS_GAP_MS;
  const thisYear = now().getUTCFullYear();
  let cursor: SyncCursor = store.cursor("SAOS") ?? { phase: "FULL", year: args.firstYear ?? SAOS_FIRST_YEAR, page: 0, since: null, completedAt: null };
  const startedAt = now().toISOString();
  let pages = 0;
  let stored = 0;
  while (pages < (args.maxPages ?? Infinity)) {
    const range =
      cursor.phase === "FULL"
        ? `judgmentStartDate=${cursor.year}-01-01&judgmentEndDate=${cursor.year}-12-31`
        : `sinceModificationDate=${encodeURIComponent((cursor.since ?? startedAt).replace("Z", ""))}`;
    if (gap && pages) await new Promise((resolve) => setTimeout(resolve, gap));
    const reply = await fetcher(`${SAOS_DUMP}?pageSize=${SAOS_PAGE_SIZE}&pageNumber=${cursor.page}&${range}`, { signal: AbortSignal.timeout(120_000), headers: { accept: "application/json" } });
    if (!reply.ok) throw new Error(`SAOS_DUMP_HTTP_${reply.status}`);
    const body = (await reply.json()) as { items?: SaosItem[]; links?: Array<{ rel?: string }> };
    pages += 1;
    for (const item of body.items ?? []) {
      const record = saosRecord(item);
      if (store.upsert(record.card, record.text, record.links)) stored += 1;
    }
    const more = (body.links ?? []).some((link) => link.rel === "next") && (body.items?.length ?? 0) > 0;
    if (more) cursor = { ...cursor, page: cursor.page + 1 };
    else if (cursor.phase === "FULL" && cursor.year < thisYear) cursor = { ...cursor, year: cursor.year + 1, page: 0 };
    else {
      // A pass is done: the next runs read the changes since this one began.
      cursor = { phase: "INCREMENTAL", year: thisYear, page: 0, since: startedAt, completedAt: now().toISOString() };
      store.saveCursor("SAOS", cursor);
      break;
    }
    store.saveCursor("SAOS", cursor);
  }
  return { pages, stored, cursor };
}

// The database of this installation, when the synchronisation has created it (server mode or
// LEX_CASE_LAW_SYNC=1); null otherwise, so a desktop without it asks the sources as before.
let shared: CaseLawDatabase | null | undefined;
export function sharedCaseLawDatabase(): CaseLawDatabase | null {
  if (shared !== undefined) return shared;
  const directory = defaultCaseLawDbDir();
  shared = process.env.VITEST || !fs.existsSync(path.join(directory, "case-law.sqlite")) ? null : new CaseLawDatabase(directory);
  return shared;
}

/** The synchronisation's database becomes the installation's shared one. */
export function setSharedCaseLawDatabase(database: CaseLawDatabase | null): void {
  shared = database;
}
