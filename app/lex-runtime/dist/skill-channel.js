import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
/**
 * Skille z repozytorium Lex Machina (nie z wydań aplikacji): dwa kanały rozwijane
 * dwutorowo — rozwojowy ("Wersja rozwojowa rozpakowana") i stabilny ("Wersja stabilna
 * rozpakowana <data>", najnowsza data). Kanał jest przypinany do commita gałęzi, archiwum
 * pobierane z codeload.github.com, a każdy plik katalogu kanału sprawdzany sumą git (blob
 * SHA-1) z drzewa tego commita; brak albo nadmiar pliku = odmowa.
 */
export const SKILLS_REPOSITORY = "michaleiatrak-star/Lex-Machina";
export const SKILLS_BRANCH = "main";
export function isSkillChannel(value) {
    return value === "stable" || value === "development";
}
const API = "https://api.github.com";
const CODELOAD = "https://codeload.github.com";
const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;
async function githubJson(fetcher, url) {
    const response = await fetcher(url, {
        headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "LexMachina-skill-channel/1.0"
        },
        signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok)
        throw new Error(`SKILL_CHANNEL_GITHUB_HTTP_${response.status}`);
    return response.json();
}
// "Wersja stabilna rozpakowana 26.09.2026" -> 20260926; bez daty = 0.
function stableDate(name) {
    const match = /(\d{2})\.(\d{2})\.(\d{4})\s*$/.exec(name);
    return match ? Number(`${match[3]}${match[2]}${match[1]}`) : 0;
}
export function channelDirectory(channel, topLevel) {
    if (channel === "development") {
        return topLevel.find((name) => /^wersja rozwojowa rozpakowana$/i.test(name.trim())) ?? null;
    }
    return (topLevel
        .filter((name) => /^wersja stabilna rozpakowana\b/i.test(name.trim()))
        .sort((a, b) => stableDate(b) - stableDate(a) || b.localeCompare(a))[0] ?? null);
}
export async function resolveSkillChannel(channel, fetcher = globalThis.fetch.bind(globalThis), repository = SKILLS_REPOSITORY, branch = SKILLS_BRANCH) {
    const commit = (await githubJson(fetcher, `${API}/repos/${repository}/commits/${encodeURIComponent(branch)}`));
    if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/.test(commit.sha)) {
        throw new Error("SKILL_CHANNEL_COMMIT_INVALID");
    }
    const tree = (await githubJson(fetcher, `${API}/repos/${repository}/git/trees/${commit.sha}?recursive=1`));
    if (tree.truncated === true)
        throw new Error("SKILL_CHANNEL_TREE_TRUNCATED");
    const entries = tree.tree ?? [];
    const topLevel = entries
        .filter((entry) => entry.type === "tree" && typeof entry.path === "string" && !String(entry.path).includes("/"))
        .map((entry) => String(entry.path));
    const directory = channelDirectory(channel, topLevel);
    if (!directory)
        throw new Error("SKILL_CHANNEL_DIRECTORY_MISSING");
    const directoryEntry = entries.find((entry) => entry.path === directory && entry.type === "tree");
    const prefix = directory + "/";
    const files = entries
        .filter((entry) => entry.type === "blob" && typeof entry.path === "string" && String(entry.path).startsWith(prefix))
        .map((entry) => ({
        path: String(entry.path).slice(prefix.length),
        sha: String(entry.sha),
        size: Number(entry.size ?? 0)
    }));
    if (files.length === 0)
        throw new Error("SKILL_CHANNEL_EMPTY");
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
export async function downloadSkillChannelArchive(snapshot, fetcher = globalThis.fetch.bind(globalThis)) {
    const response = await fetcher(`${CODELOAD}/${snapshot.repository}/zip/${snapshot.commit}`, {
        headers: { "User-Agent": "LexMachina-skill-channel/1.0" },
        signal: AbortSignal.timeout(10 * 60_000)
    });
    if (!response.ok)
        throw new Error(`SKILL_CHANNEL_ARCHIVE_HTTP_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARCHIVE_BYTES) {
        throw new Error("SKILL_CHANNEL_ARCHIVE_SIZE_INVALID");
    }
    return bytes;
}
export function gitBlobSha(content) {
    return createHash("sha1")
        .update(`blob ${content.byteLength}\0`)
        .update(content)
        .digest("hex");
}
function listFiles(root, base = root) {
    const out = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const full = path.join(root, entry.name);
        if (entry.isSymbolicLink())
            throw new Error("SKILL_CHANNEL_SYMLINK_FORBIDDEN");
        if (entry.isDirectory())
            out.push(...listFiles(full, base));
        else if (entry.isFile())
            out.push(path.relative(base, full).split(path.sep).join("/"));
    }
    return out;
}
/**
 * Katalog kanału z rozpakowanego archiwum ("<repo>-<commit>/<katalog>") po weryfikacji
 * każdego pliku sumą git z drzewa commita. Zwraca ścieżkę katalogu kanału.
 */
export function verifiedChannelRoot(extracted, snapshot) {
    const candidates = fs
        .readdirSync(extracted, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(extracted, entry.name, snapshot.directory))
        .filter((dir) => fs.existsSync(dir));
    if (candidates.length !== 1)
        throw new Error("SKILL_CHANNEL_ARCHIVE_LAYOUT_INVALID");
    const root = candidates[0];
    const expected = new Map(snapshot.files.map((file) => [file.path.normalize("NFC"), file]));
    const actual = listFiles(root);
    if (actual.length !== expected.size)
        throw new Error("SKILL_CHANNEL_FILE_SET_MISMATCH");
    for (const relative of actual) {
        const file = expected.get(relative.normalize("NFC"));
        if (!file)
            throw new Error("SKILL_CHANNEL_FILE_SET_MISMATCH");
        if (gitBlobSha(fs.readFileSync(path.join(root, relative))) !== file.sha) {
            throw new Error("SKILL_CHANNEL_FILE_HASH_MISMATCH");
        }
    }
    return root;
}
