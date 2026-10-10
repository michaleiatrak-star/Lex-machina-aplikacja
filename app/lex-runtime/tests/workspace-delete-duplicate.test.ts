import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWorkspaceRoutes } from "../src/http/workspace-routes.js";
import { documentIdFromSha256 } from "../src/case-document-purge.js";

const CASE_ID = "case_0123456789abcdef0123456789abcdef";
const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function fixture(uploads: Array<{ uploadId: string; sha256: string; extracted?: Array<{ sha256: string }> }>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-ws-delete-"));
  roots.push(root);
  const deleteDocumentVault = vi.fn(async () => true);
  const forget = vi.fn(() => true);
  const app = express();
  registerWorkspaceRoutes(app, {
    authService: { authenticateAuthorization: () => ({ user: { appRole: "USER" } }) } as never,
    caseAccessService: {
      assertAccess: () => undefined,
      openCase: () => ({ keyVersion: 1, caseKind: "MATTER" }),
      withCaseDataKey: async (_actor: unknown, _case: string, _cap: string, fn: (key: Buffer) => unknown) =>
        fn(Buffer.alloc(32))
    } as never,
    uploads: {
      listUploads: async () =>
        uploads.map((item) => ({ ...item, extracted: item.extracted ?? [], bytes: 1, filename: "a.pdf" })),
      readUploadPayload: async () => Buffer.from("x")
    } as never,
    templates: { templatesDir: root, listTemplates: async () => [], readTemplate: async () => { throw new Error("NO"); } } as never,
    privacyVaults: { deleteDocumentVault },
    documentService: { forget },
    workspace: {
      listWorkspace: async () => ({ folders: [], itemLocations: {} }),
      forgetItem: async () => undefined
    } as never,
    rootDir: root
  });
  return { app, deleteDocumentVault, forget };
}

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const FIRST = `upload_${"1".repeat(32)}`;
const SECOND = `upload_${"2".repeat(32)}`;

describe("usuwanie uploadu", () => {
  it("nie kasuje dokumentu ani klucza, gdy ten sam plik ma inny upload", async () => {
    const current = fixture([
      { uploadId: FIRST, sha256: SHA, extracted: [{ sha256: OTHER }] },
      { uploadId: SECOND, sha256: SHA }
    ]);
    await request(current.app).delete(`/api/cases/${CASE_ID}/workspace/items/${FIRST}`).expect(204);
    const deleted = current.deleteDocumentVault.mock.calls.map((call) => (call as unknown as [{ documentId: string }])[0].documentId);
    expect(deleted).toEqual([documentIdFromSha256(OTHER)]);
    expect(current.forget).not.toHaveBeenCalledWith(documentIdFromSha256(SHA));
  });

  it("kasuje dokument ostatniego uploadu z tym plikiem", async () => {
    const current = fixture([{ uploadId: FIRST, sha256: SHA }]);
    await request(current.app).delete(`/api/cases/${CASE_ID}/workspace/items/${FIRST}`).expect(204);
    expect(current.forget).toHaveBeenCalledWith(documentIdFromSha256(SHA));
  });
});
