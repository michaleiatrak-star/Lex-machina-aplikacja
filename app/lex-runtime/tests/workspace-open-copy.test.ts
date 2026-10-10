import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageWorkspaceOpenCopy } from "../src/http/workspace-routes.js";

const roots: string[] = [];

function tempRoot(): string {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "lex-open-"));
  roots.push(parent);
  return path.join(parent, "LexMachinaOpen");
}

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("workspace open copy", () => {
  it("stages a document under a private directory with its extension", async () => {
    const root = tempRoot();
    const token = await stageWorkspaceOpenCopy(root, "Pozew.DOCX", Buffer.from("treść"));
    expect(token).toMatch(/^open_[a-f0-9]{32}\.docx$/);
    expect(fs.readFileSync(path.join(root, token), "utf8")).toBe("treść");
    if (process.platform !== "win32") {
      expect(fs.statSync(root).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(root, token)).mode & 0o777).toBe(0o600);
    }
  });

  it("refuses executables, macro documents and files without an extension", async () => {
    const root = tempRoot();
    for (const name of ["faktura.exe", "skrypt.bat", "app.hta", "run.command", "makro.docm", "bez-rozszerzenia"]) {
      await expect(stageWorkspaceOpenCopy(root, name, Buffer.from("x"))).rejects.toThrow("WORKSPACE_OPEN_FILE_TYPE_INVALID");
    }
    expect(fs.existsSync(root) ? fs.readdirSync(root) : []).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("does not write into a directory open to other users or a symlink", async () => {
    const root = tempRoot();
    fs.mkdirSync(root, { mode: 0o777 });
    fs.chmodSync(root, 0o777);
    await expect(stageWorkspaceOpenCopy(root, "a.pdf", Buffer.from("x"))).rejects.toThrow("WORKSPACE_OPEN_ROOT_UNSAFE");
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "lex-open-target-"));
    roots.push(elsewhere);
    const link = tempRoot();
    fs.symlinkSync(elsewhere, link);
    await expect(stageWorkspaceOpenCopy(link, "a.pdf", Buffer.from("x"))).rejects.toThrow("WORKSPACE_OPEN_ROOT_UNSAFE");
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });
});
