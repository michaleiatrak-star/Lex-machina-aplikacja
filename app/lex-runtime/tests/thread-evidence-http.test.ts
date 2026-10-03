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
import { EncryptedCaseWorkspaceStore } from "../src/case-workspace-store.js";
import {
  SESSION_EXECUTION_INTERNAL,
  type SessionExecutionRequest,
  type SessionExecutionResponse
} from "../src/session-executor.js";
import type { VerificationRecord } from "../src/verification-ledger.js";

const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const RECORD: VerificationRecord = {
  claim: "art. 415 KC",
  kind: "statute",
  status: "VERIFIED",
  sourceUrl: "https://eli.gov.pl/a415",
  sourceTier: "R1",
  fetchedAt: "2026-10-03T10:00:00Z",
  temporalMode: "CURRENT",
  temporalFreshnessStatus: "CURRENT",
  currentEli: "DU/2026/795",
  actDescriptor: {
    id: "KC",
    title: "Kodeks cywilny",
    eli: "DU/2026/795",
    baseEli: "DU/1964/93",
    sourceUrl: "https://api.sejm.gov.pl/eli/acts/DU/2026/795/text.html",
    sourceKind: "consolidated_text",
    registryAsOf: "2026-09-15"
  }
};

function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-memory-http-"));
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

describe("evidence memory over HTTP", () => {
  it("saves what an answer verified and gives it to the next message of the same matter", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-memory-http-data-"));
    roots.push(root);
    const authStore = new LocalAuthStore({ rootDir: root });
    const auth = new LocalAuthService(authStore, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const files = new LocalCaseFileStore({ rootDir: root });
    const cases = new LocalCaseAccessService(authStore, auth, files);
    const workspace = new EncryptedCaseWorkspaceStore({ rootDir: root });
    const received: SessionExecutionRequest[] = [];
    const execute = vi.fn(async (input: SessionExecutionRequest) => {
      received.push(input);
      const result: SessionExecutionResponse = {
        sessionId: "s",
        status: "DRAFT_PRESENTABLE",
        provider: input.provider,
        model: input.model,
        primarySkill: input.primarySkill,
        answer: "Odpowiedź.",
        loadedSkills: [DR],
        finalization: "PASS",
        blockedReferences: [],
        verification: { records: 1, verified: 1, supported: 0, unverified: 0 },
        evidence: [],
        audit: { result: "PASS", eventCount: 0, closed: true }
      };
      Object.defineProperty(result, SESSION_EXECUTION_INTERNAL, {
        value: { verificationRecords: received.length === 1 ? [RECORD] : [], auditEvents: [] },
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
      caseMemoryStore: workspace,
      sessionExecutor: { execute }
    });
    const owner = await request(app)
      .post("/api/auth/bootstrap")
      .send({ loginName: "memory", displayName: "Owner", password: "Memory strong password 2026" })
      .expect(201);
    const authorization = `Bearer ${String(owner.body.sessionToken)}`;
    const created = await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Pamięć" }).expect(201);
    const caseId = String(created.body.caseId);
    const send = () =>
      request(app)
        .post("/api/sessions/execute")
        .set("Authorization", authorization)
        .send({
          query: "Czy sprawca odpowiada z art. 415 KC?",
          provider: "openai",
          model: "gpt-test",
          primarySkill: DR,
          mode: "PRAWNIK",
          knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 }
        })
        .expect(200);

    await send();
    expect(received[0]?.threadEvidence).toBeUndefined();
    const second = await send();
    expect(received[1]?.threadEvidence?.provisions.map((record) => record.claim)).toEqual(["art. 415 KC"]);
    expect(received[1]?.threadEvidence?.skills).toEqual([DR]);
    expect(JSON.stringify(second.body)).not.toContain("threadEvidence");
  });
});

describe("thread summary over HTTP", () => {
  it("replaces omitted messages with a stored summary, reuses it, and lets the user correct it", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-summary-http-data-"));
    roots.push(root);
    const authStore = new LocalAuthStore({ rootDir: root });
    const auth = new LocalAuthService(authStore, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const files = new LocalCaseFileStore({ rootDir: root });
    const cases = new LocalCaseAccessService(authStore, auth, files);
    const workspace = new EncryptedCaseWorkspaceStore({ rootDir: root });
    const queries: string[] = [];
    const summarized: string[][] = [];
    const executor = {
      execute: vi.fn(async (input: SessionExecutionRequest) => {
        queries.push(input.query);
        const result: SessionExecutionResponse = {
          sessionId: "s",
          status: "DRAFT_PRESENTABLE",
          provider: input.provider,
          model: input.model,
          primarySkill: input.primarySkill,
          answer: "Odpowiedź.",
          finalization: "PASS",
          blockedReferences: [],
          verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
          evidence: [],
          audit: { result: "PASS", eventCount: 0, closed: true }
        };
        Object.defineProperty(result, SESSION_EXECUTION_INTERNAL, { value: { verificationRecords: [], auditEvents: [] }, enumerable: false });
        return result;
      }),
      summarizeThread: vi.fn(async (input: { messages: Array<{ content: string }> }) => {
        summarized.push(input.messages.map((message) => message.content));
        return "## Fakty\n- szkoda z 2026-05-01";
      })
    };
    const app = createLexHttpApp({
      registry: registry(),
      modelCatalog: { list: vi.fn(async () => []) },
      authService: auth,
      caseFileStore: files,
      caseAccessService: cases,
      caseMemoryStore: workspace,
      sessionExecutor: executor
    });
    const owner = await request(app)
      .post("/api/auth/bootstrap")
      .send({ loginName: "summary", displayName: "Owner", password: "Summary strong password 2026" })
      .expect(201);
    const authorization = `Bearer ${String(owner.body.sessionToken)}`;
    const created = await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Streszczenie" }).expect(201);
    const caseId = String(created.body.caseId);
    const actor = auth.authenticateAuthorization(authorization)!;
    const view = cases.openCase(actor, caseId);
    for (let index = 0; index < 4; index += 1) {
      await cases.withCaseDataKey(actor, caseId, "WRITE", (caseDataKey) =>
        workspace.appendThreadMessage({
          caseId,
          caseDataKey,
          keyVersion: view.keyVersion,
          message: {
            messageId: `message_${String(index).padStart(16, "0")}`,
            role: index % 2 === 0 ? "user" : "assistant",
            content: `wiadomość ${index}`,
            createdAt: "2026-10-03T00:00:00Z"
          }
        })
      );
    }
    const send = () =>
      request(app)
        .post("/api/sessions/execute")
        .set("Authorization", authorization)
        .send({
          query: "[Wcześniejsza część rozmowy pominięta (2 wiadomości) — nie mieści się w oknie modelu.]\n\nUżytkownik: wiadomość 2\n\nAsystent: wiadomość 3\n\nUżytkownik: Co dalej ze szkodą?",
          provider: "openai",
          model: "gpt-test",
          primarySkill: DR,
          mode: "PRAWNIK",
          knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 }
        })
        .expect(200);

    await send();
    expect(summarized).toEqual([["wiadomość 0", "wiadomość 1"]]);
    expect(queries[0]).toContain("## Fakty\n- szkoda z 2026-05-01");
    expect(queries[0]).not.toContain("pominięta");

    await send();
    expect(summarized).toHaveLength(1);
    expect(queries[1]).toContain("szkoda z 2026-05-01");

    const memory = await request(app).get(`/api/cases/${caseId}/memory`).set("Authorization", authorization).expect(200);
    expect(memory.body.summary).toMatchObject({ coveredMessages: 2 });
    await request(app)
      .patch(`/api/cases/${caseId}/memory/summary`)
      .set("Authorization", authorization)
      .send({ text: "## Fakty\n- szkoda z 2026-05-02 (poprawione)" })
      .expect(200);
    await send();
    expect(queries[2]).toContain("2026-05-02 (poprawione)");
    expect(queries[2]).toContain("poprawione przez użytkownika");
    await request(app).delete(`/api/cases/${caseId}/memory`).set("Authorization", authorization).expect(200);
    expect((await request(app).get(`/api/cases/${caseId}/memory`).set("Authorization", authorization)).body.summary).toBeNull();
  });
});
