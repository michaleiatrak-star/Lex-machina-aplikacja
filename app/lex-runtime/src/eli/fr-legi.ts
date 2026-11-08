// France without a key: DILA's open-data dump LEGI (echanges.dila.gouv.fr/OPENDATA/LEGI,
// Freemium_legi_global_*.tar.gz, about 1.2 GB, refreshed daily) holds every version of every
// article of the codes as one XML file (NUM, ETAT, DATE_DEBUT, DATE_FIN, the code in CONTEXTE,
// the text in BLOC_TEXTUEL, the acts that created/changed/repealed it in LIENS). The archive is
// streamed once into a local index (one JSON file per code); a lookup gives the version in force
// on a date. Légifrance's consolidated text has no legal force: the Journal officiel has.
import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { plainText } from "./readers.js";

export const LEGI_DUMP_INDEX = "https://echanges.dila.gouv.fr/OPENDATA/LEGI/";

export type LegiVersion = {
  id: string;
  num: string;
  state: string;
  from: string;
  to: string;
  text: string;
  // "MODIFICATION: LOI n°2016-1547 du 18 novembre 2016 - art. 1".
  links: string[];
};

export type LegiCode = { cid: string; title: string; short: string; versions: LegiVersion[] };

const tag = (xml: string, name: string): string => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "u").exec(xml)?.[1]?.trim() ?? "";

const CHANGE_LINKS = /^(?:CREATION|MODIFICATION|ABROGATION|ABROGE|TRANSFERT|CODIFICATION|DEPLACEMENT|ANNULATION|DISJONCTION|PERIME|RATIFICATION)$/u;

/** One LEGIARTI file: the version of the article and the code it belongs to. */
export function parseLegiArticle(xml: string): (LegiVersion & { cid: string; title: string; short: string }) | null {
  const id = tag(xml, "ID");
  if (!/^LEGIARTI\d{12}$/u.test(id)) return null;
  const text = /<TEXTE\b[^>]*\bcid="([^"]+)"[^>]*>\s*<TITRE_TXT\b([^>]*)>([^<]*)<\/TITRE_TXT>/u.exec(xml);
  const links = [...xml.matchAll(/<LIEN\b([^>]*)>([\s\S]*?)<\/LIEN>/gu)]
    .map((match) => ({ type: /typelien="([^"]+)"/u.exec(match[1]!)?.[1] ?? "", label: plainText(match[2]!).replace(/\s+/gu, " ") }))
    .filter((link) => CHANGE_LINKS.test(link.type))
    .map((link) => `${link.type}: ${link.label}`);
  return {
    id,
    num: tag(xml, "NUM"),
    state: tag(xml, "ETAT"),
    from: tag(xml, "DATE_DEBUT"),
    to: tag(xml, "DATE_FIN"),
    text: plainText(/<BLOC_TEXTUEL>\s*<CONTENU>([\s\S]*?)<\/CONTENU>/u.exec(xml)?.[1] ?? ""),
    links,
    cid: text?.[1] ?? "",
    title: plainText(text?.[3] ?? ""),
    short: /c_titre_court="([^"]*)"/u.exec(text?.[2] ?? "")?.[1] ?? ""
  };
}

/** Minimal streaming tar reader (ustar, GNU long names, pax headers): calls `onFile` for the entries `want` accepts. */
export async function readTar(stream: AsyncIterable<Buffer>, want: (name: string) => boolean, onFile: (name: string, body: Buffer) => void | Promise<void>): Promise<void> {
  let buffer: Buffer = Buffer.alloc(0);
  let longName: string | undefined;
  const take = async function* (): AsyncGenerator<void> {
    for await (const chunk of stream) {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
      yield;
    }
  };
  const source = take();
  const need = async (bytes: number): Promise<boolean> => {
    while (buffer.length < bytes) if ((await source.next()).done) return false;
    return true;
  };
  for (;;) {
    if (!(await need(512))) return;
    const header = buffer.subarray(0, 512);
    if (header.every((byte) => byte === 0)) return;
    const field = (from: number, length: number) => header.subarray(from, from + length).toString("utf8").replace(/\0[\s\S]*$/u, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156]!);
    const prefix = field(345, 155);
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const padded = Math.ceil(size / 512) * 512;
    if (!(await need(512 + padded))) return;
    const body = buffer.subarray(512, 512 + size);
    longName = undefined;
    if (type === "L") longName = body.toString("utf8").replace(/\0+$/u, "");
    else if (type === "x") longName = /\d+ path=([^\n]+)\n/u.exec(body.toString("utf8"))?.[1];
    else if ((type === "0" || type === "\0") && want(name)) await onFile(name, Buffer.from(body));
    buffer = buffer.subarray(512 + padded);
  }
}

export function defaultLegiIndexDir(): string {
  return path.resolve(process.env.LEX_LEGI_INDEX_DIR ?? path.join(process.env.LEX_DATA_DIR ?? path.join(os.homedir(), ".lex-machina", "data"), "legi"));
}

/**
 * Streams the LEGI dump (a local .tar.gz or its URL) into `dir`: one JSON file per code in force
 * (all versions of its articles), `codes.json` (cid → title) and `articles.json` (LEGIARTI → cid).
 */
export async function buildLegiIndex(archive: string, dir = defaultLegiIndexDir(), options: { onProgress?: (files: number) => void } = {}): Promise<{ codes: number; versions: number }> {
  const input: AsyncIterable<Buffer> = /^https:\/\//u.test(archive)
    ? Readable.fromWeb((await fetchOk(archive)).body as never).pipe(createGunzip())
    : createReadStream(archive).pipe(createGunzip());
  await fs.mkdir(dir, { recursive: true });
  const parts = path.join(dir, "parts");
  await fs.rm(parts, { recursive: true, force: true });
  await fs.mkdir(parts);
  // Versions go to one NDJSON file per code as they come (a code is not held whole in memory).
  const pending = new Map<string, string[]>();
  const meta = new Map<string, { title: string; short: string }>();
  const articles: Record<string, string> = {};
  let held = 0;
  const flush = async () => {
    for (const [cid, lines] of pending) await fs.appendFile(path.join(parts, `${cid}.ndjson`), lines.join(""));
    pending.clear();
    held = 0;
  };
  let files = 0;
  await readTar(
    input,
    (name) => /\/code_en_vigueur\/.*\/article\/.*LEGIARTI\d{12}\.xml$/u.test(name),
    async (_name, body) => {
      const version = parseLegiArticle(body.toString("utf8"));
      files += 1;
      if (files % 50_000 === 0) options.onProgress?.(files);
      if (!version?.cid) return;
      const { cid, title, short, ...own } = version;
      if (!meta.has(cid)) meta.set(cid, { title, short });
      const line = `${JSON.stringify(own)}\n`;
      pending.set(cid, [...(pending.get(cid) ?? []), line]);
      held += line.length;
      articles[own.id] = cid;
      if (held > 32 * 1024 * 1024) await flush();
    }
  );
  await flush();
  let versions = 0;
  for (const [cid, info] of meta) {
    const lines = (await fs.readFile(path.join(parts, `${cid}.ndjson`), "utf8")).split("\n").filter(Boolean);
    const list = lines.map((line) => JSON.parse(line) as LegiVersion);
    list.sort((a, b) => a.num.localeCompare(b.num, "fr", { numeric: true }) || a.from.localeCompare(b.from));
    versions += list.length;
    await fs.writeFile(path.join(dir, `${cid}.json`), JSON.stringify({ cid, ...info, versions: list } satisfies LegiCode));
  }
  await fs.rm(parts, { recursive: true, force: true });
  await fs.writeFile(path.join(dir, "codes.json"), JSON.stringify(Object.fromEntries(meta)));
  await fs.writeFile(path.join(dir, "articles.json"), JSON.stringify(articles));
  await fs.writeFile(path.join(dir, "built.json"), JSON.stringify({ archive: path.basename(archive), built: new Date().toISOString(), codes: meta.size, versions }));
  return { codes: meta.size, versions };
}

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`LEGI_DOWNLOAD_${response.status}`);
  return response;
}

/** The newest dump's URL from DILA's directory listing. */
export async function latestLegiDump(fetchImpl: typeof fetch = fetch): Promise<string> {
  const listing = await (await fetchImpl(LEGI_DUMP_INDEX)).text();
  const names = [...listing.matchAll(/href="(Freemium_legi_global_\d{8}-\d{6}\.tar\.gz)"/gu)].map((match) => match[1]!).sort();
  if (!names.length) throw new Error("LEGI_DUMP_NOT_FOUND");
  return LEGI_DUMP_INDEX + names.at(-1)!;
}

export type LegiAnswer = { code: LegiCode | null; version: LegiVersion | null; others: LegiVersion[]; built?: string };

/** The article of a code (cid, or LEGIARTI id) in force on `date` (default: today) from the local index. */
export async function legiLookup(request: { cid?: string; articleId?: string; num?: string; date?: string }, dir = defaultLegiIndexDir()): Promise<LegiAnswer | null> {
  const built = await fs.readFile(path.join(dir, "built.json"), "utf8").catch(() => null);
  if (!built) return null;
  let cid = request.cid;
  if (!cid && request.articleId) cid = (JSON.parse(await fs.readFile(path.join(dir, "articles.json"), "utf8")) as Record<string, string>)[request.articleId];
  if (!cid || !/^LEGITEXT\d{12}$/u.test(cid)) return { code: null, version: null, others: [], built: JSON.parse(built).built };
  const code = JSON.parse(await fs.readFile(path.join(dir, `${cid}.json`), "utf8").catch(() => "null")) as LegiCode | null;
  if (!code) return { code: null, version: null, others: [], built: JSON.parse(built).built };
  const byId = request.articleId ? code.versions.find((version) => version.id === request.articleId) : undefined;
  const num = (request.num ?? byId?.num ?? "").replace(/^(?:art(?:icle)?\.?)\s*/iu, "").replace(/\s+/gu, "").toLowerCase();
  const same = code.versions.filter((version) => version.num.replace(/\s+/gu, "").toLowerCase() === num);
  const date = request.date ?? new Date().toISOString().slice(0, 10);
  const version = (request.date || !byId ? same.find((item) => item.from <= date && date < item.to) : byId) ?? null;
  return { code: { ...code, versions: [] }, version, others: same.filter((item) => item !== version), built: JSON.parse(built).built };
}
