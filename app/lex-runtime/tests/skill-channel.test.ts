import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  channelDirectory,
  gitBlobSha,
  resolveSkillChannel,
  verifiedChannelRoot,
  type SkillChannelSnapshot
} from "../src/skill-channel.js";
import { MaintenanceService, installedSkillOverlayRoot } from "../src/maintenance-service.js";

const COMMIT = "a".repeat(40);
const DEV = "Wersja rozwojowa rozpakowana";
const temporary: string[] = [];
const previousLocalAppData = process.env.LOCALAPPDATA;

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-skill-channel-"));
  temporary.push(dir);
  return dir;
}

afterEach(() => {
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// Minimalny kanał: jeden poprawny skill.
const FILES: Record<string, string> = {
  "prawny-router-v3/SKILL.md": "---\nname: prawny-router-v3\n---\n# Router\n",
  "prawny-router-v3/references/HYBRID-VALIDATION.md": "HYBRID-VAL przed .docx\n"
};

function tree(files: Record<string, string>, directory = DEV) {
  return [
    { path: directory, type: "tree", sha: "t".repeat(40) },
    { path: "Wersja stabilna rozpakowana 26.09.2026", type: "tree", sha: "s".repeat(40) },
    ...Object.entries(files).map(([file, content]) => ({
      path: `${directory}/${file}`,
      type: "blob",
      sha: gitBlobSha(Buffer.from(content)),
      size: Buffer.byteLength(content)
    }))
  ];
}

function github(files: Record<string, string>) {
  const requested: string[] = [];
  const fetcher = async (url: string) => {
    requested.push(url);
    if (url.endsWith("/commits/main")) {
      return Response.json({ sha: COMMIT, commit: { committer: { date: "2026-09-29T10:00:00Z" } } });
    }
    if (url.includes(`/git/trees/${COMMIT}`)) return Response.json({ truncated: false, tree: tree(files) });
    if (url === `https://codeload.github.com/michaleiatrak-star/Lex-Machina/zip/${COMMIT}`) {
      return new Response(new Uint8Array([80, 75, 3, 4]));
    }
    return new Response("", { status: 404 });
  };
  return { fetcher, requested };
}

function writeArchive(destination: string, files: Record<string, string>): void {
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(destination, `Lex-Machina-${COMMIT}`, DEV, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

describe("kanały skilli z repozytorium Lex Machina", () => {
  it("wybiera katalog kanału; stabilny = najnowsza data awansu", () => {
    const top = [
      "WERSJA ROZWOJOWA",
      DEV,
      "Wersja stabilna rozpakowana 26.09.2026",
      "Wersja stabilna rozpakowana 03.10.2026",
      "benchmark"
    ];
    expect(channelDirectory("development", top)).toBe(DEV);
    expect(channelDirectory("stable", top)).toBe("Wersja stabilna rozpakowana 03.10.2026");
    expect(channelDirectory("stable", ["benchmark"])).toBeNull();
  });

  it("przypina commit gałęzi i listę plików kanału z sumami git", async () => {
    const snapshot = await resolveSkillChannel("development", github(FILES).fetcher as never);
    expect(snapshot).toMatchObject({ commit: COMMIT, directory: DEV, treeSha: "t".repeat(40) });
    expect(snapshot.files.map((file) => file.path).sort()).toEqual(Object.keys(FILES).sort());
  });

  it("odrzuca archiwum ze zmienionym albo dodatkowym plikiem", async () => {
    const snapshot: SkillChannelSnapshot = await resolveSkillChannel("development", github(FILES).fetcher as never);
    const good = tempDir();
    writeArchive(good, FILES);
    expect(verifiedChannelRoot(good, snapshot)).toContain(DEV);

    const tampered = tempDir();
    writeArchive(tampered, { ...FILES, "prawny-router-v3/SKILL.md": "---\nname: podmieniony\n---\n" });
    expect(() => verifiedChannelRoot(tampered, snapshot)).toThrow("SKILL_CHANNEL_FILE_HASH_MISMATCH");

    const extra = tempDir();
    writeArchive(extra, { ...FILES, "dodatkowy.md": "x" });
    expect(() => verifiedChannelRoot(extra, snapshot)).toThrow("SKILL_CHANNEL_FILE_SET_MISMATCH");
  });

  it("odświeża skille z kanału jako nakładkę i raportuje stan kanału", async () => {
    process.env.LOCALAPPDATA = tempDir();
    const { fetcher } = github(FILES);
    const maintenance = new MaintenanceService(
      { check: async () => ({ currentVersion: "0.1.10", status: "NO_RELEASE", checkedAt: "" }) },
      fetcher as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (_zip, destination) => writeArchive(destination, FILES)
    );

    expect(await maintenance.skillChannelStatus("development")).toMatchObject({
      status: "AVAILABLE",
      installed: null,
      latest: { commit: COMMIT, directory: DEV, files: 2 }
    });

    const result = await maintenance.refreshSkillsFromChannel("development");
    expect(result).toMatchObject({ channel: "development", commit: COMMIT, files: 2, restartRequired: true });
    const marker = JSON.parse(
      fs.readFileSync(path.join(installedSkillOverlayRoot(), ".lex-skills-version.json"), "utf8")
    );
    expect(marker).toMatchObject({ channel: "development", commit: COMMIT, health: "PENDING_RESTART_VALIDATION" });

    expect(await maintenance.skillChannelStatus("development")).toMatchObject({
      status: "UP_TO_DATE",
      installed: { channel: "development", commit: COMMIT }
    });
    // Inny kanał niż zainstalowany: do odświeżenia.
    expect((await maintenance.skillChannelStatus("stable")).status).not.toBe("UP_TO_DATE");
  });

  it("brak dostępu do GitHub: stan UNAVAILABLE z przyczyną, bez zmian w nakładce", async () => {
    process.env.LOCALAPPDATA = tempDir();
    const maintenance = new MaintenanceService(
      { check: async () => ({ currentVersion: "0.1.10", status: "NO_RELEASE", checkedAt: "" }) },
      (async () => new Response("", { status: 403 })) as never
    );
    expect(await maintenance.skillChannelStatus("stable")).toMatchObject({
      status: "UNAVAILABLE",
      unavailableReason: "SKILL_CHANNEL_GITHUB_HTTP_403"
    });
    await expect(maintenance.refreshSkillsFromChannel("stable")).rejects.toThrow("SKILL_CHANNEL_GITHUB_HTTP_403");
    expect(fs.existsSync(installedSkillOverlayRoot())).toBe(false);
  });
});
