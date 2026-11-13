// Local copies of official consolidated texts that are not acts of the Journal of Laws (no ELI):
// codes of professional ethics, resolutions and rules of the professions' councils, internal
// rules of public bodies. The rule is the one of the ELI copy (core-law-index.ts): a text the
// application downloads is kept locally with its source, date and SHA-256, split into units,
// and read from the local copy afterwards; a newer text at the source replaces it and the
// change is logged (user, 2026-11-12: "pobranie nowego tekstu jednolitego powinno wpiąć go do
// RAG … aplikacja czyta z lokalnie pobranego pliku … uniwersalna zasada").
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readLegislationPdf } from "./eli/readers.js";

export type OfficialTextSource = {
  // Stable key of the act ("KEA"), not of its version.
  key: string;
  name: string;
  issuer: string;
  url: string;
  // The version the URL serves ("tekst jednolity — załącznik do uchwały nr 174/2026 …").
  version: string;
  // How the units are headed: "§ 16" alone on its line, or "Art. 16." at the start of a line.
  unit: "§" | "Art.";
};

export type OfficialTextCopy = {
  key: string;
  name: string;
  issuer: string;
  url: string;
  version: string;
  unit: "§" | "Art.";
  fetchedAt: string;
  checkedAt: string;
  sha256: string;
  units: Record<string, string>;
  text: string;
};

export type OfficialTextFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

// A copy is checked at the source again after this time (the text itself is kept).
export const OFFICIAL_TEXT_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

export function defaultOfficialTextDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve(env.LEX_OFFICIAL_TEXTS_DIR ?? path.join(env.LEX_DATA_DIR ?? path.join(os.homedir(), ".lex-machina", "data"), "official-texts"));
}

/** Units of a text by their headings: "§ 16" on its own line, or "Art. 16." at the start of a line. */
export function officialTextUnits(text: string, unit: "§" | "Art."): Record<string, string> {
  const heading = unit === "§" ? /(?:^|\n)[ \t]*§[ \t]*(\d{1,3}[a-z]?)[ \t]*\n/gu : /(?:^|\n)[ \t]*Art\.[ \t]*(\d{1,4}[a-z]?)\.[ \t]*/gu;
  // A page number alone on its line ("25") is not text of the unit it splits.
  text = text.replace(/\n[ \t]*\d{1,3}[ \t]*(?=\n)/gu, "");
  const marks = [...text.matchAll(heading)];
  const units: Record<string, string> = {};
  marks.forEach((match, index) => {
    const from = match.index! + match[0].length;
    const to = index + 1 < marks.length ? marks[index + 1]!.index! : text.length;
    // A chapter heading before the next unit belongs to the next part, not to this unit.
    const body = text.slice(from, to).replace(/\n\s*(?:Rozdział|ROZDZIAŁ|Dział|DZIAŁ)\s[\s\S]*$/u, "").replace(/\s*\n\s*/gu, " ").trim();
    if (body && units[match[1]!] === undefined) units[match[1]!] = `${unit} ${match[1]}${unit === "Art." ? "." : "."} ${body}`;
  });
  return units;
}

export class OfficialTextStore {
  constructor(
    private readonly directory: string = defaultOfficialTextDir(),
    private readonly fetcher: OfficialTextFetch = fetch as unknown as OfficialTextFetch,
    private readonly now: () => number = () => Date.now()
  ) {}

  private file(key: string): string {
    return path.join(this.directory, `${key.replace(/[^A-Za-z0-9_-]/gu, "_")}.json`);
  }

  /** The local copy, if any. */
  get(key: string): OfficialTextCopy | null {
    try {
      return JSON.parse(fs.readFileSync(this.file(key), "utf8")) as OfficialTextCopy;
    } catch {
      return null;
    }
  }

  /** Every local copy (the catalogue the user and the model can browse). */
  list(): Array<Omit<OfficialTextCopy, "text" | "units"> & { units: number }> {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.directory).filter((name) => name.endsWith(".json") && name !== "changes.json");
    } catch {
      return [];
    }
    return names
      .map((name) => this.get(name.replace(/\.json$/u, "")))
      .filter((copy): copy is OfficialTextCopy => Boolean(copy))
      .map(({ text: _text, units, ...meta }) => ({ ...meta, units: Object.keys(units).length }));
  }

  /** Changes of the local copies: added, replaced by a newer text at the source. */
  changes(): Array<{ key: string; kind: "ADDED" | "UPDATED"; at: string; version: string; sha256: string }> {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.directory, "changes.json"), "utf8"));
    } catch {
      return [];
    }
  }

  private write(copy: OfficialTextCopy, kind?: "ADDED" | "UPDATED"): void {
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = `${this.file(copy.key)}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(copy), "utf8");
    fs.renameSync(temporary, this.file(copy.key));
    if (kind) {
      const log = [...this.changes(), { key: copy.key, kind, at: copy.fetchedAt, version: copy.version, sha256: copy.sha256 }].slice(-500);
      fs.writeFileSync(path.join(this.directory, "changes.json"), JSON.stringify(log), "utf8");
    }
  }

  /**
   * The text to read: the local copy while it is fresh; otherwise the source is checked, a new
   * text replaces the copy (logged), the same text only renews the check date. The source down:
   * the local copy, said as such (`stale`). Neither: null.
   */
  async ensure(source: OfficialTextSource): Promise<{ copy: OfficialTextCopy; from: "LOCAL" | "DOWNLOADED" | "UPDATED" | "LOCAL_STALE" } | null> {
    const local = this.get(source.key);
    const now = this.now();
    if (local && local.url === source.url && now - Date.parse(local.checkedAt) < OFFICIAL_TEXT_CHECK_MS) return { copy: local, from: "LOCAL" };
    try {
      const reply = await this.fetcher(source.url, { headers: { accept: "application/pdf, text/html;q=0.8" }, signal: AbortSignal.timeout(60_000) });
      if (!reply.ok) throw new Error(`OFFICIAL_TEXT_HTTP_${reply.status}`);
      const bytes = new Uint8Array(await reply.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const stamp = new Date(now).toISOString();
      if (local && local.sha256 === sha256 && local.url === source.url) {
        const renewed = { ...local, checkedAt: stamp };
        this.write(renewed);
        return { copy: renewed, from: "LOCAL" };
      }
      const reading = await readLegislationPdf(bytes);
      if (reading.kind === "SKAN") throw new Error("OFFICIAL_TEXT_SCAN");
      const copy: OfficialTextCopy = { ...source, fetchedAt: stamp, checkedAt: stamp, sha256, units: officialTextUnits(reading.text, source.unit), text: reading.text };
      this.write(copy, local ? "UPDATED" : "ADDED");
      return { copy, from: local ? "UPDATED" : "DOWNLOADED" };
    } catch {
      return local ? { copy: local, from: "LOCAL_STALE" } : null;
    }
  }

  /** Units whose text holds every word of the query (a plain local search over the copies). */
  search(query: string, limit = 10): Array<{ key: string; name: string; unit: string; text: string }> {
    const words = query.toLocaleLowerCase("pl").split(/\s+/u).filter((word) => word.length > 2);
    if (!words.length) return [];
    const hits: Array<{ key: string; name: string; unit: string; text: string }> = [];
    for (const meta of this.list()) {
      const copy = this.get(meta.key);
      for (const [unit, text] of Object.entries(copy?.units ?? {})) {
        const lower = text.toLocaleLowerCase("pl");
        if (words.every((word) => lower.includes(word))) hits.push({ key: meta.key, name: meta.name, unit, text });
        if (hits.length >= limit) return hits;
      }
    }
    return hits;
  }
}

let shared: OfficialTextStore | null = null;
export function officialTextStore(): OfficialTextStore {
  shared ??= new OfficialTextStore();
  return shared;
}
