import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractSkillChannelDirectory,
  gitBlobSha,
  verifyChannelFiles,
  type SkillChannelSnapshot
} from "../src/skill-channel.js";

type Entry = { name: string; content?: string; symlink?: boolean };

// Minimalne archiwum ZIP jak z codeload.github.com (deflate, nazwy UTF-8).
function buildZip(entries: Entry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.content ?? "", "utf8");
    const compressed = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.symlink ? 0o120777 : 0o100644) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, centralBytes, eocd]));
}

const TOP = "Lex-Machina-" + "a".repeat(40);
const DIRECTORY = "Wersja stabilna rozpakowana 26.09.2026";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-skill-channel-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("skill channel archive extraction", () => {
  it("extracts only the channel directory, without the archive prefix", () => {
    const skill = "# Przedawnienie\n";
    const zip = buildZip([
      { name: `${TOP}/` },
      { name: `${TOP}/README.md`, content: "repo" },
      { name: `${TOP}/Wersja rozwojowa rozpakowana/x/SKILL.md`, content: "dev" },
      { name: `${TOP}/${DIRECTORY}/` },
      { name: `${TOP}/${DIRECTORY}/dr-02/czesc-01-przedawnienie.md`, content: skill }
    ]);
    const destination = path.join(root, "s");

    expect(extractSkillChannelDirectory(zip, DIRECTORY, destination)).toBe(1);
    expect(
      fs.readFileSync(path.join(destination, "dr-02", "czesc-01-przedawnienie.md"), "utf8")
    ).toBe(skill);
    expect(fs.readdirSync(destination)).toEqual(["dr-02"]);

    const snapshot = {
      files: [
        {
          path: "dr-02/czesc-01-przedawnienie.md",
          sha: gitBlobSha(Buffer.from(skill)),
          size: skill.length
        }
      ]
    } as SkillChannelSnapshot;
    expect(() => verifyChannelFiles(destination, snapshot)).not.toThrow();
  });

  it("rejects path traversal inside the channel directory", () => {
    const zip = buildZip([
      { name: `${TOP}/${DIRECTORY}/../../evil.md`, content: "x" }
    ]);
    expect(() =>
      extractSkillChannelDirectory(zip, DIRECTORY, path.join(root, "s"))
    ).toThrow("SKILL_CHANNEL_ARCHIVE_PATH_INVALID");
    expect(fs.existsSync(path.join(root, "evil.md"))).toBe(false);
  });

  it("rejects symlinks in the channel directory", () => {
    const zip = buildZip([
      { name: `${TOP}/${DIRECTORY}/link.md`, content: "/etc/passwd", symlink: true }
    ]);
    expect(() =>
      extractSkillChannelDirectory(zip, DIRECTORY, path.join(root, "s"))
    ).toThrow("SKILL_CHANNEL_SYMLINK_FORBIDDEN");
  });

  it("rejects a file set that differs from the commit tree", () => {
    const zip = buildZip([
      { name: `${TOP}/${DIRECTORY}/a.md`, content: "a" },
      { name: `${TOP}/${DIRECTORY}/b.md`, content: "b" }
    ]);
    const destination = path.join(root, "s");
    extractSkillChannelDirectory(zip, DIRECTORY, destination);
    const snapshot = {
      files: [{ path: "a.md", sha: gitBlobSha(Buffer.from("a")), size: 1 }]
    } as SkillChannelSnapshot;
    expect(() => verifyChannelFiles(destination, snapshot)).toThrow(
      "SKILL_CHANNEL_FILE_SET_MISMATCH"
    );
  });
});
