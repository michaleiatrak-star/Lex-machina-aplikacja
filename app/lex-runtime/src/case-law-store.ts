import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Local copies of official decisions (SN, NSA/WSA, common courts, KIO, …),
 * downloaded once when verified or previewed. The source shown to the user is
 * always the decision's card (sn.pl: ?orzeczenie=ID), never the temporary text
 * address; quotes and highlights are made on this stored copy.
 */
export type StoredCaseLaw = {
  cardUrl: string;
  court: string;
  signature?: string;
  date?: string;
  form?: string;
  text: string;
  sha256: string;
  fetchedAt: string;
};

const MAX_TEXT = 2_000_000;

export function courtOfCard(cardUrl: string): string {
  let host = "";
  try {
    host = new URL(cardUrl).hostname.toLowerCase();
  } catch {
    return "?";
  }
  if (/(^|\.)sn\.pl$/.test(host)) return "SN";
  if (host === "orzeczenia.nsa.gov.pl") return "NSA/WSA";
  if (host === "orzeczenia.ms.gov.pl" || /^orzeczenia\.[a-z0-9-]+\.(sr|so|sa)\.gov\.pl$/.test(host)) return "SP";
  if (/(^|\.)trybunal\.gov\.pl$/.test(host)) return "TK";
  if (/(^|\.)saos\.org\.pl$/.test(host)) return "SAOS";
  if (host === "orzeczenia.uzp.gov.pl") return "KIO";
  if (host === "eureka.mf.gov.pl") return "EUREKA";
  if (/(^|\.)uodo\.gov\.pl$/.test(host)) return "UODO";
  if (/(^|\.)curia\.europa\.eu$/.test(host)) return "TSUE";
  return host;
}

// One key per decision: sn.pl and www.sn.pl cards of the same ID are one card.
function cardKey(cardUrl: string): string {
  try {
    const url = new URL(cardUrl);
    const id = url.searchParams.get("orzeczenie");
    if (/(^|\.)sn\.pl$/i.test(url.hostname) && id) return `sn:${id}`;
  } catch {
    // not a URL: the text itself is the key
  }
  return cardUrl;
}

export class CaseLawStore {
  constructor(readonly dir: string) {}

  private file(cardUrl: string): string {
    return path.join(this.dir, `${createHash("sha256").update(cardKey(cardUrl)).digest("hex").slice(0, 40)}.json`);
  }

  get(cardUrl: string): StoredCaseLaw | null {
    try {
      const entry = JSON.parse(fs.readFileSync(this.file(cardUrl), "utf8")) as StoredCaseLaw;
      return cardKey(entry.cardUrl) === cardKey(cardUrl) && typeof entry.text === "string" ? entry : null;
    } catch {
      return null;
    }
  }

  delete(cardUrl: string): boolean {
    try {
      fs.rmSync(this.file(cardUrl));
      return true;
    } catch {
      return false;
    }
  }

  /** Saves a copy once; a later save keeps the first copy and fills in missing metadata. */
  put(input: Omit<StoredCaseLaw, "sha256" | "fetchedAt" | "court"> & { court?: string; fetchedAt?: string }): StoredCaseLaw | null {
    const text = input.text.trim();
    if (text.length < 40 || text.length > MAX_TEXT) return null;
    const existing = this.get(input.cardUrl);
    const entry: StoredCaseLaw = existing
      ? {
          ...existing,
          ...(existing.signature || !input.signature ? {} : { signature: input.signature }),
          ...(existing.date || !input.date ? {} : { date: input.date }),
          ...(existing.form || !input.form ? {} : { form: input.form })
        }
      : {
          cardUrl: input.cardUrl,
          court: input.court ?? courtOfCard(input.cardUrl),
          ...(input.signature ? { signature: input.signature } : {}),
          ...(input.date ? { date: input.date } : {}),
          ...(input.form ? { form: input.form } : {}),
          text,
          sha256: createHash("sha256").update(text).digest("hex"),
          fetchedAt: input.fetchedAt ?? new Date().toISOString()
        };
    if (existing && JSON.stringify(existing) === JSON.stringify(entry)) return existing;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const target = this.file(input.cardUrl);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(entry), "utf8");
      fs.renameSync(temporary, target);
      return entry;
    } catch {
      return null;
    }
  }
}

export type CaseLawCatalogEntry = Omit<StoredCaseLaw, "text"> & { chars: number; snippet?: string };

const CASE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), "utf8");
  fs.renameSync(temporary, file);
}

/**
 * Where downloaded decisions live. Each case keeps its own copies (used to
 * mark quotes in that case). The case-law library (Settings, off by
 * default) additionally catalogues every downloaded decision by court,
 * signature and date, searchable by the user and the model.
 */
export class CaseLawRepository {
  readonly library: CaseLawStore;

  constructor(readonly root: string) {
    this.library = new CaseLawStore(path.join(root, "library"));
  }

  libraryEnabled(): boolean {
    return readJson<{ library?: boolean }>(path.join(this.root, "settings.json"))?.library === true;
  }

  setLibraryEnabled(enabled: boolean): void {
    writeJson(path.join(this.root, "settings.json"), { library: enabled });
  }

  forCase(caseId: string): CaseLawStore | null {
    return CASE_ID.test(caseId) ? new CaseLawStore(path.join(this.root, "cases", caseId)) : null;
  }

  /** The case's copy first, then the library (when enabled). */
  get(cardUrl: string, caseId?: string): StoredCaseLaw | null {
    return (caseId ? this.forCase(caseId)?.get(cardUrl) : null) ?? (this.libraryEnabled() ? this.library.get(cardUrl) : null) ?? null;
  }

  /** Saves into the case (when given) and into the library (when enabled). */
  put(input: Parameters<CaseLawStore["put"]>[0], caseId?: string): StoredCaseLaw | null {
    const inCase = caseId ? this.forCase(caseId)?.put(input) ?? null : null;
    const inLibrary = this.libraryEnabled() ? this.library.put(input) : null;
    if (inLibrary) this.indexEntry(inLibrary);
    return inCase ?? inLibrary;
  }

  private indexFile(): string {
    return path.join(this.root, "library", "index.json");
  }

  private index(): CaseLawCatalogEntry[] {
    return readJson<CaseLawCatalogEntry[]>(this.indexFile()) ?? [];
  }

  private indexEntry(entry: StoredCaseLaw): void {
    const { text, ...meta } = entry;
    const rest = this.index().filter((item) => item.cardUrl !== entry.cardUrl);
    writeJson(this.indexFile(), [...rest, { ...meta, chars: text.length }]);
  }

  /** The library catalogue: newest first; a query matches the signature, court or text. */
  catalog(query = "", limit = 50): CaseLawCatalogEntry[] {
    const all = this.index().sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
    const wanted = query.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl");
    if (!wanted) return all.slice(0, limit);
    const found: CaseLawCatalogEntry[] = [];
    for (const item of all) {
      if (found.length >= limit) break;
      const meta = [item.court, item.signature, item.form, item.date].filter(Boolean).join(" ").toLocaleLowerCase("pl");
      if (meta.includes(wanted)) {
        found.push(item);
        continue;
      }
      const text = this.library.get(item.cardUrl)?.text;
      const at = text ? text.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("pl").indexOf(wanted) : -1;
      if (text && at >= 0) {
        const flat = text.normalize("NFKC").replace(/\s+/g, " ");
        found.push({ ...item, snippet: flat.slice(Math.max(0, at - 200), at + wanted.length + 300) });
      }
    }
    return found;
  }

  remove(cardUrl: string): boolean {
    const rest = this.index().filter((item) => item.cardUrl !== cardUrl);
    const removed = this.library.delete(cardUrl);
    writeJson(this.indexFile(), rest);
    return removed;
  }

  removeCase(caseId: string): void {
    if (CASE_ID.test(caseId)) fs.rmSync(path.join(this.root, "cases", caseId), { recursive: true, force: true });
  }
}

let configured: CaseLawRepository | null = null;

/** The application's repository (set by the HTTP server); null in tests and tools without a data directory. */
export function configureCaseLawStore(dir: string | null): void {
  configured = dir ? new CaseLawRepository(dir) : null;
}

export function caseLawRepository(): CaseLawRepository | null {
  return configured;
}
