import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { validateHeaderValue } from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import {
  SecureCaseArtifactStore,
  artifactRenameFilename
} from "../src/case-artifact-store.js";
import { contentDisposition } from "../src/http/workspace-routes.js";

const roots: string[] = [];

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("artifactRenameFilename", () => {
  it("keeps the original extension", () => {
    expect(artifactRenameFilename("pismo.docx", "Wezwanie do zapłaty")).toBe("Wezwanie do zapłaty.docx");
    expect(artifactRenameFilename("pismo.docx", "  Pozew.DOCX ")).toBe("Pozew.docx");
    expect(artifactRenameFilename("pismo.odt", "Pozew.docx")).toBe("Pozew.docx.odt");
  });

  it("rejects names Windows cannot store", () => {
    for (const name of ["", "   ", ".docx", "a/b", "a\\b", "a:b", "a*b", "a?b", "a\"b", "a<b", "a>b", "a|b", "a\tb"]) {
      expect(() => artifactRenameFilename("pismo.docx", name), name).toThrow(/INVALID/);
    }
    for (const name of ["CON", "nul", "com1", "LPT9", "aux.wersja", "pismo.", "pismo. "]) {
      expect(() => artifactRenameFilename("pismo.docx", name), name).toThrow("ARTIFACT_FILENAME_RESERVED_INVALID");
    }
    expect(() => artifactRenameFilename("pismo.docx", "a".repeat(180))).toThrow("ARTIFACT_FILENAME_TOO_LONG_INVALID");
  });
});

describe("SecureCaseArtifactStore.renameArtifact", () => {
  it("renames the manifest and keeps the payload readable", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-artifact-rename-"));
    roots.push(root);
    const userId = "user_0123456789abcdef0123456789abcdef";
    const legalCase = await new LocalCaseFileStore({ rootDir: root }).createCase({
      createdByUserId: userId,
      keyVersion: 1
    });
    const store = new SecureCaseArtifactStore({ rootDir: root });
    const key = randomBytes(32);
    const data = Buffer.from("DOCX fixture");
    const saved = await store.saveArtifact({
      caseId: legalCase.caseId,
      filename: "artifact_generated.docx",
      mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data,
      caseDataKey: key,
      keyVersion: 1,
      sensitivity: "PROTECTED",
      createdByUserId: userId
    });
    const context = { caseId: legalCase.caseId, caseDataKey: key, keyVersion: 1 };

    const renamed = await store.renameArtifact({
      ...context,
      artifactId: saved.artifactId,
      filename: "Pozew o zapłatę"
    });
    expect(renamed.filename).toBe("Pozew o zapłatę.docx");
    expect(await store.listArtifacts(context)).toEqual([
      { ...saved, filename: "Pozew o zapłatę.docx" }
    ]);
    const payload = await store.readArtifact({ ...context, artifactId: saved.artifactId, maxBytes: 1024 });
    expect(payload.equals(data)).toBe(true);

    await expect(
      store.renameArtifact({ ...context, artifactId: saved.artifactId, filename: "a:b" })
    ).rejects.toThrow("ARTIFACT_FILENAME_CHARACTERS_INVALID");
    await expect(
      store.renameArtifact({ ...context, artifactId: "artifact_" + "0".repeat(32), filename: "x" })
    ).rejects.toThrow("ARTIFACT_NOT_FOUND");
  });
});

describe("contentDisposition", () => {
  it("serves a renamed Polish filename as a valid header", () => {
    const header = contentDisposition("Wezwanie do zapłaty – Kowalski.docx");
    expect(() => validateHeaderValue("Content-Disposition", header)).not.toThrow();
    expect(header).toContain("filename*=UTF-8''Wezwanie%20do%20zap%C5%82aty");
  });
});
