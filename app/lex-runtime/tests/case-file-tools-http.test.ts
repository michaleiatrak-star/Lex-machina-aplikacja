import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLexHttpApp } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import type { DocumentService } from "../src/document-service.js";
import {
  SESSION_EXECUTION_INTERNAL,
  type SessionExecutionRequest,
  type SessionExecutionResponse
} from "../src/session-executor.js";

const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const OUTSIDE = "doc_bbbbbbbbbbbbbbbbbbbbbbbb";
const TEXT = "[STRONA 2 · DIGITAL]\nTermin zapłaty upłynął, [PII:PERSON:0001] nie zapłacił.";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-case-files-http-"));
  roots.push(root);
  for (const name of ["prawny-router-v3", "prawo-polskie-v2", DR]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\nversion: "1.0"\ndescription: "test"\n---\n# ${name}\n`);
  }
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  fs.writeFileSync(path.join(root, "shared", "PRAWO-HARDGATE.md"), "# hard gate\n");
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), DR + "\n");
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-case-files-http-data-"));
  roots.push(root);
  const authStore = new LocalAuthStore({ rootDir: root });
  const auth = new LocalAuthService(authStore, {
    sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
    kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
  });
  const files = new LocalCaseFileStore({ rootDir: root });
  const cases = new LocalCaseAccessService(authStore, auth, files);

  const hit = { caseId: "", documentId: OUTSIDE, chunkIndex: 2, pageStart: 2, pageEnd: 2, score: 5, text: TEXT };
  const caseKnowledgeSearch = {
    search: vi.fn(async (args: { caseId: string }) => [{ ...hit, caseId: args.caseId }]),
    listDocuments: vi.fn(async () => [{ documentId: OUTSIDE, totalPages: 2, chunks: 2 }])
  };
  const restored = new Set<string>();
  const documentService = {
    restoreDocument: vi.fn(async (args: { documentId: string }) => {
      restored.add(args.documentId);
      return { documentId: args.documentId };
    }),
    resolveProtectedChunks: vi.fn(async (selection: { documentId: string; chunkIndices: number[] }) => {
      if (!restored.has(selection.documentId)) throw new Error("UNKNOWN_LOCAL_DOCUMENT");
      return { documentId: selection.documentId, totalPages: 2, totalChars: TEXT.length, chunks: [{ index: 2, pageStart: 2, pageEnd: 2, text: TEXT }] };
    }),
    deanonymize: vi.fn((documentId: string, token: string) => {
      if (!restored.has(documentId)) throw new Error("Unknown local document.");
      return token.startsWith("[PII:PERSON:0001") ? "Jan Kowalski" : token;
    })
  } as unknown as DocumentService;

  const received: SessionExecutionRequest[] = [];
  const execute = vi.fn(async (input: SessionExecutionRequest) => {
    received.push(input);
    let answer = "Brak dostępu do akt.";
    if (input.caseFiles) {
      await input.caseFiles.search("termin zapłaty", 4);
      const read = await input.caseFiles.readChunks(OUTSIDE, [2]);
      answer = read.chunks[0]!.text.includes("[PII:PERSON:0001]") ? "[LMPII:D01:PERSON:0001|NOM] nie zapłacił." : "?";
    }
    const result: SessionExecutionResponse = {
      sessionId: "session-case-files",
      status: "DRAFT_PRESENTABLE",
      provider: input.provider,
      model: input.model,
      primarySkill: input.primarySkill,
      answer,
      finalization: "PASS",
      blockedReferences: [],
      verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
      evidence: [],
      audit: { result: "PASS", eventCount: 0, closed: true }
    };
    Object.defineProperty(result, SESSION_EXECUTION_INTERNAL, {
      value: { verificationRecords: [], auditEvents: [], documentAliasDocumentIds: input.caseFiles ? [OUTSIDE] : [] },
      enumerable: false
    });
    return result;
  });

  const app = createLexHttpApp({
    registry: registry(),
    modelCatalog: { list: vi.fn(async () => []) },
    authService: auth,
    caseFileStore: files,
    caseAccessService: cases,
    caseKnowledgeSearch,
    documentService,
    sessionExecutor: { execute }
  });
  return { app, received, documentService, caseKnowledgeSearch };
}

async function bootstrap(app: ReturnType<typeof fixture>["app"]) {
  const owner = await request(app)
    .post("/api/auth/bootstrap")
    .send({ loginName: "case-files", displayName: "Owner", password: "Case files strong password 2026" })
    .expect(201);
  const authorization = `Bearer ${String(owner.body.sessionToken)}`;
  const created = await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Akta" }).expect(201);
  return { authorization, caseId: String(created.body.caseId) };
}

describe("case file tools over HTTP", () => {
  it("gives the model the matter's files only with case search on and restores names from the read document", async () => {
    const current = fixture();
    const { authorization, caseId } = await bootstrap(current.app);
    const send = (includeCase: boolean) =>
      request(current.app)
        .post("/api/sessions/execute")
        .set("Authorization", authorization)
        .send({
          query: "Czy dłużnik zapłacił w terminie według dokumentów sprawy?",
          provider: "openai",
          model: "gpt-test",
          primarySkill: DR,
          mode: "PRAWNIK",
          knowledge: { caseId, includeCase, includeFirm: false, limit: 8 }
        })
        .expect(200);

    const off = await send(false);
    expect(current.received[0]?.caseFiles).toBeUndefined();
    expect(off.body.answer).toBe("Brak dostępu do akt.");

    const on = await send(true);
    expect(current.received[1]?.caseFiles?.caseId).toBe(caseId);
    expect(current.documentService.restoreDocument).toHaveBeenCalledWith(
      expect.objectContaining({ caseId, documentId: OUTSIDE })
    );
    expect(on.body.answer).toBe("Jan Kowalski nie zapłacił.");
    expect(JSON.stringify(on.body)).not.toContain("caseFiles");
  });
});
