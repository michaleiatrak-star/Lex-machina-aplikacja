import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

/**
 * Skille z repozytorium Lex Machina (nie z wydań aplikacji): dwa kanały rozwijane
 * dwutorowo — rozwojowy ("Wersja rozwojowa rozpakowana") i stabilny ("Wersja stabilna
 * rozpakowana <data>", najnowsza data). Kanał jest przypinany do commita gałęzi, archiwum
 * pobierane z codeload.github.com, a każdy plik katalogu kanału sprawdzany sumą git (blob
 * SHA-1) z drzewa tego commita; brak albo nadmiar pliku = odmowa.
 */

export const SKILLS_REPOSITORY = "michaleiatrak-star/Lex-Machina";
export const SKILLS_BRANCH = "main";

export type SkillChannel = "stable" | "development";

export function isSkillChannel(value: unknown): value is SkillChannel {
  return value === "stable" || value === "development";
}

export type SkillChannelFile = {
  // Ścieżka względem katalogu kanału, z "/".
  path: string;
  sha: string;
  size: number;
};

export type SkillChannelSnapshot = {
  channel: SkillChannel;
  repository: string;
  commit: string;
  committedAt: string | null;
  directory: string;
  // SHA drzewa katalogu kanału: zmienia się tylko przy zmianie skilli tego kanału.
  treeSha: string;
  files: SkillChannelFile[];
};

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

async function githubJson(fetcher: Fetcher, url: string): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "LexMachina-skill-channel/1.0"
    },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`SKILL_CHANNEL_GITHUB_HTTP_${response.status}`);
  return response.json();
}

// "Wersja stabilna rozpakowana 26.09.2026" -> 20260926; bez daty = 0.
function stableDate(name: string): number {
  const match = /(\d{2})\.(\d{2})\.(\d{4})\s*$/.exec(name);
  return match ? Number(`${match[3]}${match[2]}${match[1]}`) : 0;
}

export function channelDirectory(
  channel: SkillChannel,
  topLevel: string[]
): string | null {
  if (channel === "development") {
    return topLevel.find((name) => /^wersja rozwojowa rozpakowana$/i.test(name.trim())) ?? null;
  }
  return (
    topLevel
      .filter((name) => /^wersja stabilna rozpakowana\b/i.test(name.trim()))
      .sort((a, b) => stableDate(b) - stableDate(a) || b.localeCompare(a))[0] ?? null
  );
}

export async function resolveSkillChannel(
  channel: SkillChannel,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis),
  repository: string = SKILLS_REPOSITORY,
  branch: string = SKILLS_BRANCH
): Promise<SkillChannelSnapshot> {
  const commit = (await githubJson(
    fetcher,
    `${API}/repos/${repository}/commits/${encodeURIComponent(branch)}`
  )) as { sha?: unknown; commit?: { committer?: { date?: unknown } } };
  if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/.test(commit.sha)) {
    throw new Error("SKILL_CHANNEL_COMMIT_INVALID");
  }
  const tree = (await githubJson(
    fetcher,
    `${API}/repos/${repository}/git/trees/${commit.sha}?recursive=1`
  )) as { truncated?: unknown; tree?: Array<Record<string, unknown>> };
  if (tree.truncated === true) throw new Error("SKILL_CHANNEL_TREE_TRUNCATED");
  const entries = tree.tree ?? [];
  const topLevel = entries
    .filter((entry) => entry.type === "tree" && typeof entry.path === "string" && !String(entry.path).includes("/"))
    .map((entry) => String(entry.path));
  const directory = channelDirectory(channel, topLevel);
  if (!directory) throw new Error("SKILL_CHANNEL_DIRECTORY_MISSING");
  const directoryEntry = entries.find((entry) => entry.path === directory && entry.type === "tree");
  const prefix = directory + "/";
  const files = entries
    .filter((entry) => entry.type === "blob" && typeof entry.path === "string" && String(entry.path).startsWith(prefix))
    .map((entry) => ({
      path: String(entry.path).slice(prefix.length),
      sha: String(entry.sha),
      size: Number(entry.size ?? 0)
    }));
  if (files.length === 0) throw new Error("SKILL_CHANNEL_EMPTY");
  const committedAt = commit.commit?.committer?.date;
  return {
    channel,
    repository,
    commit: commit.sha,
    committedAt: typeof committedAt === "string" ? committedAt : null,
    directory,
    treeSha: String(directoryEntry?.sha ?? ""),
    files
  };
}

export async function downloadSkillChannelArchive(
  snapshot: SkillChannelSnapshot,
  fetcher: Fetcher = globalThis.fetch.bind(globalThis)
): Promise<Uint8Array> {
  const response = await fetcher(`${CODELOAD}/${snapshot.repository}/zip/${snapshot.commit}`, {
    headers: { "User-Agent": "LexMachina-skill-channel/1.0" },
    signal: AbortSignal.timeout(10 * 60_000)
  });
  if (!response.ok) throw new Error(`SKILL_CHANNEL_ARCHIVE_HTTP_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error("SKILL_CHANNEL_ARCHIVE_SIZE_INVALID");
  }
  return bytes;
}

export function gitBlobSha(content: Buffer): string {
  return createHash("sha1")
    .update(`blob ${content.byteLength}\0`)
    .update(content)
    .digest("hex");
}

function listFiles(root: string, base = root): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("SKILL_CHANNEL_SYMLINK_FORBIDDEN");
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/**
 * Rozpakowuje z archiwum GitHub ("<repo>-<commit>/<katalog>/...") tylko pliki katalogu
 * kanału, wprost do `destination` (bez prefiksu archiwum). Rozpakowanie w Node, nie przez
 * Expand-Archive: Windows PowerShell 5.1 nie zapisze ścieżki dłuższej niż 260 znaków
 * (MAX_PATH), a prefiks archiwum z nazwą katalogu kanału i najdłuższym skillem ją
 * przekraczał. Wpisy z "..", ścieżką bezwzględną albo dowiązaniem są odrzucane.
 */
export function extractSkillChannelDirectory(
  zip: Uint8Array,
  directory: string,
  destination: string
): number {
  const data = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  // Koniec katalogu centralnego (EOCD): sygnatura 0x06054b50, komentarz do 64 KiB.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("SKILL_CHANNEL_ARCHIVE_INVALID");
  const entryCount = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || offset === 0xffffffff) {
    throw new Error("SKILL_CHANNEL_ARCHIVE_ZIP64_UNSUPPORTED");
  }
  const wanted = directory.normalize("NFC").split("/").filter(Boolean);
  const root = path.resolve(destination);
  fs.mkdirSync(root, { recursive: true });
  let written = 0;
  for (let n = 0; n < entryCount; n++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("SKILL_CHANNEL_ARCHIVE_INVALID");
    }
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const size = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const externalAttributes = data.readUInt32LE(offset + 38);
    const localOffset = data.readUInt32LE(offset + 42);
    const rawName = data.subarray(offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    // Nazwy w archiwach GitHub są w UTF-8.
    const name = rawName.toString("utf8").normalize("NFC");
    if (name.endsWith("/")) continue;
    const segments = name.split("/");
    if (
      name.includes("\\") ||
      name.includes("\0") ||
      name.startsWith("/") ||
      segments.some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("SKILL_CHANNEL_ARCHIVE_PATH_INVALID");
    }
    // Pierwszy segment to "<repo>-<commit>"; dalej katalog kanału.
    if (segments.length <= wanted.length + 1) continue;
    if (!wanted.every((segment, index) => segments[index + 1] === segment)) continue;
    if (((externalAttributes >>> 16) & 0o170000) === 0o120000) {
      throw new Error("SKILL_CHANNEL_SYMLINK_FORBIDDEN");
    }
    const relative = segments.slice(wanted.length + 1);
    const target = path.resolve(root, ...relative);
    if (!target.startsWith(root + path.sep)) {
      throw new Error("SKILL_CHANNEL_ARCHIVE_PATH_INVALID");
    }

    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("SKILL_CHANNEL_ARCHIVE_INVALID");
    }
    const dataStart =
      localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > data.length) {
      throw new Error("SKILL_CHANNEL_ARCHIVE_INVALID");
    }
    const compressed = data.subarray(dataStart, dataStart + compressedSize);
    let content: Buffer;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = inflateRawSync(compressed, { maxOutputLength: Math.max(size, 1) });
    else throw new Error("SKILL_CHANNEL_ARCHIVE_METHOD_UNSUPPORTED");
    if (content.byteLength !== size) throw new Error("SKILL_CHANNEL_ARCHIVE_INVALID");

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { flag: "wx" });
    written++;
  }
  return written;
}

/**
 * Sprawdza katalog kanału (już bez prefiksu archiwum): każdy plik sumą git z drzewa
 * commita, brak albo nadmiar pliku = odmowa.
 */
export function verifyChannelFiles(
  root: string,
  snapshot: SkillChannelSnapshot
): void {
  const expected = new Map(snapshot.files.map((file) => [file.path.normalize("NFC"), file]));
  const actual = listFiles(root);
  if (actual.length !== expected.size) throw new Error("SKILL_CHANNEL_FILE_SET_MISMATCH");
  for (const relative of actual) {
    const file = expected.get(relative.normalize("NFC"));
    if (!file) throw new Error("SKILL_CHANNEL_FILE_SET_MISMATCH");
    if (gitBlobSha(fs.readFileSync(path.join(root, relative))) !== file.sha) {
      throw new Error("SKILL_CHANNEL_FILE_HASH_MISMATCH");
    }
  }
}
