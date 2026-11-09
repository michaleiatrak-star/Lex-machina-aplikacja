import { inflateRawSync } from "node:zlib";
import { plainText, type NationalArticle } from "./readers.js";
import type { NationalFetch } from "./national-law.js";

/**
 * California: leginfo.legislature.ca.gov answers only through a Cloudflare challenge, which is not
 * bypassed. The Legislative Counsel publishes the same database as daily-updated files
 * (downloads.leginfo.legislature.ca.gov/pubinfo_{session year}.zip, about 1.2 GB). The server serves byte
 * ranges, so only three parts are read: the zip directory, LAW_SECTION_TBL.dat (every section: code,
 * number, history, the file holding its text) and the one .lob file with the section asked for.
 * The directory and the table (about 26 MB) are kept in memory for the session.
 */
export const CA_PUBINFO_HOST = /^downloads\.leginfo\.legislature\.ca\.gov$/u;

type Entry = { offset: number; compressed: number };
type Row = { code: string; section: string; history: string; lob: string; active: boolean };
type Archive = { url: string; stamp: string; entries: Map<string, Entry>; rows?: Map<string, Row> };

const UA = "LexMachina/0.1 (legal research)";
const archives = new Map<string, Archive>();

async function range(fetchImpl: NationalFetch, url: string, spec: string): Promise<{ bytes: Uint8Array; total: number; stamp: string }> {
  const reply = await fetchImpl(url, { headers: { range: `bytes=${spec}`, "user-agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (reply.status !== 206) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
  const total = Number(/\/(\d+)$/u.exec(reply.headers.get("content-range") ?? "")?.[1] ?? 0);
  return { bytes: new Uint8Array(await reply.arrayBuffer()), total, stamp: reply.headers.get("last-modified") ?? "" };
}

const u16 = (view: DataView, at: number) => view.getUint16(at, true);
const u32 = (view: DataView, at: number) => view.getUint32(at, true);
const u64 = (view: DataView, at: number) => Number(view.getBigUint64(at, true));

/** The zip's central directory (zip64: the archive is over 4 GB of entries). */
async function directory(fetchImpl: NationalFetch, url: string): Promise<Archive> {
  const tail = await range(fetchImpl, url, "-70000");
  const known = archives.get(url);
  if (known && known.stamp === tail.stamp) return known;
  const view = new DataView(tail.bytes.buffer, tail.bytes.byteOffset, tail.bytes.byteLength);
  let locator = -1;
  for (let at = tail.bytes.length - 20; at >= 0; at -= 1) if (u32(view, at) === 0x07064b50) { locator = at; break; }
  let cdOffset: number;
  let cdSize: number;
  if (locator >= 0) {
    const eocd64 = await range(fetchImpl, url, `${u64(view, locator + 8)}-${u64(view, locator + 8) + 55}`);
    const record = new DataView(eocd64.bytes.buffer, eocd64.bytes.byteOffset, eocd64.bytes.byteLength);
    cdSize = u64(record, 40);
    cdOffset = u64(record, 48);
  } else {
    let end = -1;
    for (let at = tail.bytes.length - 22; at >= 0; at -= 1) if (u32(view, at) === 0x06054b50) { end = at; break; }
    if (end < 0) throw new Error("CA_PUBINFO_NOT_A_ZIP");
    cdSize = u32(view, end + 12);
    cdOffset = u32(view, end + 16);
  }
  const cd = (await range(fetchImpl, url, `${cdOffset}-${cdOffset + cdSize - 1}`)).bytes;
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map<string, Entry>();
  const decoder = new TextDecoder();
  for (let at = 0; at + 46 <= cd.length && u32(dv, at) === 0x02014b50; ) {
    let compressed = u32(dv, at + 20);
    const plain = u32(dv, at + 24);
    const nameLength = u16(dv, at + 28);
    const extraLength = u16(dv, at + 30);
    const commentLength = u16(dv, at + 32);
    let offset = u32(dv, at + 42);
    const name = decoder.decode(cd.subarray(at + 46, at + 46 + nameLength));
    // Zip64 extra field: the 32-bit values set to 0xFFFFFFFF are given there, in this order.
    for (let x = at + 46 + nameLength; x + 4 <= at + 46 + nameLength + extraLength; ) {
      const id = u16(dv, x);
      const size = u16(dv, x + 2);
      if (id === 1) {
        let k = x + 4;
        if (plain === 0xffffffff) k += 8;
        if (compressed === 0xffffffff) { compressed = u64(dv, k); k += 8; }
        if (offset === 0xffffffff) offset = u64(dv, k);
      }
      x += 4 + size;
    }
    entries.set(name, { offset, compressed });
    at += 46 + nameLength + extraLength + commentLength;
  }
  const archive: Archive = { url, stamp: tail.stamp, entries };
  archives.set(url, archive);
  return archive;
}

async function entry(fetchImpl: NationalFetch, archive: Archive, name: string): Promise<Uint8Array> {
  const item = archive.entries.get(name);
  if (!item) throw new Error(`CA_PUBINFO_ENTRY_MISSING:${name}`);
  const header = (await range(fetchImpl, archive.url, `${item.offset}-${item.offset + 29}`)).bytes;
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const start = item.offset + 30 + u16(hv, 26) + u16(hv, 28);
  const data = (await range(fetchImpl, archive.url, `${start}-${start + item.compressed - 1}`)).bytes;
  return u16(hv, 8) === 8 ? new Uint8Array(inflateRawSync(data)) : data;
}

const field = (value: string | undefined): string => (value ?? "").replace(/^`|`$/gu, "");

/** Rows of LAW_SECTION_TBL.dat: tab-separated, values in backticks, NULL when empty. */
export function parseLawSections(text: string): Map<string, Row> {
  const rows = new Map<string, Row>();
  for (const line of text.split("\n")) {
    const cells = line.split("\t");
    if (cells.length < 16) continue;
    const row: Row = { code: field(cells[1]), section: field(cells[2]).replace(/\.$/u, ""), history: field(cells[13]), lob: field(cells[14]), active: field(cells[15]) === "Y" };
    const key = `${row.code} ${row.section}`;
    if (row.active || !rows.has(key)) rows.set(key, row);
  }
  return rows;
}

// "PEN 187", "Penal Code § 187", "CIV 1714", "Civ. Code 1714": the code abbreviation and the section.
const CODES: Record<string, string> = { penal: "PEN", civil: "CIV", "civil procedure": "CCP", family: "FAM", evidence: "EVID", probate: "PROB", labor: "LAB", vehicle: "VEH", commercial: "COM", corporations: "CORP", "business and professions": "BPC", government: "GOV", "health and safety": "HSC", "welfare and institutions": "WIC", education: "EDC", "revenue and taxation": "RTC", insurance: "INS", "public resources": "PRC", water: "WAT", elections: "ELEC", "fish and game": "FGC", "food and agricultural": "FAC", financial: "FIN", "military and veterans": "MVC", "public contract": "PCC", "public utilities": "PUC", "streets and highways": "SHC", "unemployment insurance": "UIC", harbors: "HNC" };

export function californiaUnit(unit: string): { code: string; section: string } | null {
  const match = /^\s*([A-Za-z.&\s]+?)\s*(?:Code)?\s*(?:§+|sec(?:tion)?\.?)?\s*(\d[\w.-]*?)\.?\s*$/iu.exec(unit);
  if (!match) return null;
  const name = match[1]!.trim().replace(/\.$/u, "").toLowerCase();
  const short = /^[a-z]{2,5}$/u.test(name) ? name.toUpperCase() : undefined;
  const code = CODES[name.replace(/\s+code$/u, "")] ?? (short && Object.values(CODES).includes(short) ? short : undefined);
  return code ? { code, section: match[2]! } : null;
}

export async function readCaliforniaSection(fetchImpl: NationalFetch, url: string, unit: string): Promise<{ articles: NationalArticle[]; version: string }> {
  const wanted = californiaUnit(unit);
  if (!wanted) throw new Error("CA_PUBINFO_UNIT_INVALID: unit = code abbreviation and section, e.g. \"PEN 187\", \"CIV 1714\"");
  const archive = await directory(fetchImpl, url);
  archive.rows ??= parseLawSections(new TextDecoder().decode(await entry(fetchImpl, archive, "LAW_SECTION_TBL.dat")));
  const row = archive.rows.get(`${wanted.code} ${wanted.section}`);
  const version = `baza Legislative Counsel (pubinfo), plik z ${archive.stamp}`;
  if (!row) return { articles: [], version };
  const text = plainText(new TextDecoder().decode(await entry(fetchImpl, archive, row.lob)).replace(/<span class="EnSpace"\/>/gu, " "));
  return {
    version,
    articles: [{ unit: `${row.code} ${row.section}`, heading: `${row.code} § ${row.section}`, text: `${row.code} § ${row.section}\n${text}`, amendments: row.history ? [{ act: row.history }] : [] }]
  };
}

/**
 * New Jersey: the Legislature's download of the statutes (pub.njleg.state.nj.us/statutes/STATUTES-TEXT.zip,
 * one STATUTES.TXT, "updated through P.L. …"). The Folio viewer at lis.njleg.state.nj.us builds its pages
 * with scripts; the file is read once per session (byte ranges, the text entry only) and kept in memory.
 */
export const NJ_STATUTES_HOST = /^pub\.njleg\.state\.nj\.us$/u;
const njText = new Map<string, { stamp: string; lines: string[]; through: string }>();

export async function newJerseyLines(fetchImpl: NationalFetch, url: string): Promise<{ lines: string[]; through: string }> {
  const archive = await directory(fetchImpl, url);
  const known = njText.get(url);
  if (known && known.stamp === archive.stamp) return known;
  const text = new TextDecoder("latin1").decode(await entry(fetchImpl, archive, "STATUTES.TXT"));
  const through = /UPDATED THROUGH\s+([^\r\n)]+)/u.exec(text.slice(0, 400))?.[1]?.trim() ?? "";
  const value = { stamp: archive.stamp, lines: text.split(/\r?\n/u), through };
  njText.set(url, value);
  return value;
}
