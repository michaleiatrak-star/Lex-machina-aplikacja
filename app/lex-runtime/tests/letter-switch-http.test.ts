import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLexHttpApp } from "../src/http/app.js";
import { registerWorkspaceRoutes } from "../src/http/workspace-routes.js";
import { LexSkillRegistry } from "../src/registry.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { SecureCaseUploadStore } from "../src/case-secure-store.js";
import { EncryptedCaseWorkspaceStore } from "../src/case-workspace-store.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { SecureCaseArtifactStore } from "../src/case-artifact-store.js";

// A thread that starts as a simple letter, escalates to the process pleading (M7), reaches
// KROK 0 Test B there (reduction offered) and goes back to the simple letter, over HTTP with
// the real executor and the case's encrypted workflow state.

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const ESCALATION = "⚠ ESKALACJA DO pisma-procesowe-v3\n\nPrzyczyna: kilka zarzutów (przedawnienie, potrącenie, abuzywność).\nCzy przełączyć na pisma-procesowe-v3?";
const REDUCTION = "KROK 0 — Test B: jedno żądanie, jedna podstawa, katalog.\nREDUKCJA DO pisma-proste-v2\nPrzyczyna: wniosek o nadanie klauzuli wykonalności z katalogu Testu B.\nCzy przełączyć na pisma-proste-v2?";

describe("letter skill switch over HTTP", () => {
  it("escalation, pipeline start, reduction at CP-1a, reset, simple letter again", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-letter-switch-"));
    roots.push(root);
    const authStore = new LocalAuthStore({ rootDir: root });
    const auth = new LocalAuthService(authStore, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const files = new LocalCaseFileStore({ rootDir: root });
    const cases = new LocalCaseAccessService(authStore, auth, files);
    const workspace = new EncryptedCaseWorkspaceStore({ rootDir: root });
    const uploads = new SecureCaseUploadStore({ rootDir: root });
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const replies: string[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream() {
        return { fullText: replies.shift() ?? "ok" };
      }
    } as never);
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    registerWorkspaceRoutes(app, {
      authService: auth,
      caseAccessService: cases,
      uploads,
      templates: { templatesDir: path.join(root, "templates"), listTemplates: vi.fn(async () => []), readTemplate: vi.fn(async () => { throw new Error("UNUSED"); }) },
      privacyVaults: { deleteDocumentVault: vi.fn(async () => false) },
      documentService: { forget: vi.fn(() => false) },
      workspace,
      rootDir: root
    } as never);
    app.use(
      createLexHttpApp({
        registry,
        modelCatalog: { list: vi.fn(async () => []) },
        authService: auth,
        caseFileStore: files,
        secureCaseUploadStore: uploads,
        caseAccessService: cases,
        contractWorkflowStore: workspace,
        processWorkflowStore: workspace,
        chronologyWorkflowStore: workspace,
        courtAnalysisWorkflowStore: workspace,
        orderedCaseWorkflowStore: workspace,
        secureCaseArtifactStore: new SecureCaseArtifactStore({ rootDir: root }),
        sessionExecutor: new SafeSessionExecutor(registry, new ProviderGateway(providers))
      } as never)
    );
    const boot = await request(app).post("/api/auth/bootstrap").send({ loginName: "letter-switch", displayName: "Owner", password: "Letter switch strong password 2026" });
    const authorization = `Bearer ${boot.body.sessionToken}`;
    const caseId = (await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Sprzeciw" })).body.caseId as string;
    const send = (skill: string, text: string) =>
      request(app)
        .post("/api/sessions/execute")
        .set("Authorization", authorization)
        .send({
          query: `__LEX_SKILLS_V1__ ${JSON.stringify({ auto: false, manual: [skill], caseType: [skill] })}\n${text}`,
          provider: "openai",
          model: "account/openai/default",
          primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
          mode: "PRAWNIK",
          knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 }
        });
    const ask = "Przygotuj sprzeciw od nakazu zapłaty: roszczenie przedawnione, potrącenie i abuzywna klauzula.";

    replies.push(ESCALATION);
    const escalated = await send("pisma-proste-v2", ask);
    expect(escalated.status).toBe(200);
    expect(escalated.body.status).toBe("DRAFT_PRESENTABLE");
    expect(escalated.body.skillSwitch).toMatchObject({ to: "pisma-procesowe-v3", direction: "ESCALATION" });

    // The switched thread needs the pipeline started first (the chat offers the start).
    const history = `Użytkownik: ${ask}\n\nAsystent: ${ESCALATION}\n\nUżytkownik: Przełączam na pismo procesowe.`;
    const needsStart = await send("pisma-procesowe-v3", history);
    expect(needsStart.status).toBe(409);
    expect(needsStart.body.error).toBe("PROCESS_PLEADING_STATE_REQUIRED");
    await request(app).post(`/api/cases/${caseId}/workflow/process-pleading/initialize`).set("Authorization", authorization).send({ mode: "CHECKPOINT" }).expect(201);
    await request(app).post(`/api/cases/${caseId}/workflow/process-pleading/accept-start`).set("Authorization", authorization).send({}).expect(200);

    replies.push(REDUCTION);
    const reduced = await send("pisma-procesowe-v3", history);
    expect(reduced.status).toBe(200);
    expect(reduced.body.status).toBe("DRAFT_PRESENTABLE");
    expect(reduced.body.skillSwitch).toMatchObject({ to: "pisma-proste-v2", direction: "REDUCTION" });
    expect(reduced.body.processWorkflow.checkpoints["CP-1a"]).not.toBe("CLOSED");
    expect(reduced.body.processWorkflow.checkpoints["CP-1a"]).not.toBe("READY");

    // Reduction accepted: the chat resets the case's pipeline and pins the simple letter.
    const state = await request(app).get(`/api/cases/${caseId}/workflow/process-pleading`).set("Authorization", authorization).expect(200);
    await request(app)
      .post(`/api/cases/${caseId}/workflow/process-pleading/reset`)
      .set("Authorization", authorization)
      .send({ expectedRevision: state.body.state.revision, confirmation: "RESET_PROCESS_PLEADING" })
      .expect(200);
    replies.push("DANE DO UZUPEŁNIENIA\n- sygnatura nakazu");
    const simple = await send("pisma-proste-v2", `${history}\n\nAsystent: ${REDUCTION}\n\nUżytkownik: Przełączam na pismo proste.`);
    expect(simple.status).toBe(200);
    expect(simple.body.processWorkflow).toBeUndefined();
    expect(simple.body.workflow?.id).toBe("SIMPLE_LETTER_V1");
    auth.close();
  }, 600_000);
});
