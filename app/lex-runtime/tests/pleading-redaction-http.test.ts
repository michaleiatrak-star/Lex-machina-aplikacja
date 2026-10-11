import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import {
  afterEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  createLexHttpApp
} from "../src/http/app.js";
import {
  registerWorkspaceRoutes
} from "../src/http/workspace-routes.js";
import {
  LexSkillRegistry
} from "../src/registry.js";
import {
  LocalAuthStore
} from "../src/auth/store.js";
import {
  LocalAuthService
} from "../src/auth/service.js";
import {
  AuthSessionManager
} from "../src/auth/session-manager.js";
import {
  LocalCaseFileStore
} from "../src/case-file-store.js";
import {
  LocalCaseAccessService
} from "../src/case-access.js";
import {
  SecureCaseUploadStore
} from "../src/case-secure-store.js";
import {
  EncryptedCaseWorkspaceStore
} from "../src/case-workspace-store.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import {
  SecureCaseArtifactStore
} from "../src/case-artifact-store.js";


const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const PLEADING =
  "\n\nPOZEW O ZAPŁATĘ\nSąd Rejonowy w Krakowie\nPowód: Jan Kowalski\nPozwany: ABC sp. z o.o.\n" +
  "Wnoszę o zasądzenie kwoty 10 000 zł wraz z odsetkami. Uzasadnienie: pozwany nie zapłacił faktury nr 1/2026.";

// pisma-procesowe-v3 KROK 0 Test A: a delivered pleading whose form is edited goes to
// MOD-REDAKCJA without W1–W3, so it must not require the process-pleading state; a new
// pleading still does (PROCESS_PLEADING_STATE_REQUIRED, the UI starts the pipeline).
describe("pleading redaction over HTTP", () => {
  it("edits a pasted pleading without the W1–W3 state and keeps the pipeline for a new one", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-pleading-redaction-"));
    roots.push(root);
    const authStore = new LocalAuthStore({ rootDir: root });
    const auth = new LocalAuthService(authStore, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const files = new LocalCaseFileStore({ rootDir: root });
    const cases = new LocalCaseAccessService(authStore, auth, files);
    const workspace = new EncryptedCaseWorkspaceStore({ rootDir: root });
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream() {
        return { fullText: "ok" };
      }
    } as never);
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use(
      createLexHttpApp({
        registry,
        modelCatalog: { list: vi.fn(async () => []) },
        authService: auth,
        caseFileStore: files,
        secureCaseUploadStore: new SecureCaseUploadStore({ rootDir: root }),
        caseAccessService: cases,
        contractWorkflowStore: workspace,
        processWorkflowStore: workspace,
        chronologyWorkflowStore: workspace,
        courtAnalysisWorkflowStore: workspace,
        orderedCaseWorkflowStore: workspace,
        secureCaseArtifactStore: new SecureCaseArtifactStore({ rootDir: root }),
        sessionExecutor: executor
      } as never)
    );
    const boot = await request(app).post("/api/auth/bootstrap").send({
      loginName: "pleading-redaction",
      displayName: "Pleading Owner",
      password: "Pleading redaction strong password 2026"
    });
    const authorization = `Bearer ${boot.body.sessionToken}`;
    const send = async (message: string) => {
      const caseId = (
        await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: message.slice(0, 20) })
      ).body.caseId;
      return request(app)
        .post("/api/sessions/execute")
        .set("Authorization", authorization)
        .send({
          query: `__LEX_SKILLS_V1__ {"auto":true,"manual":[],"caseType":"AUTO"}\n${message}`,
          provider: "openai",
          model: "account/openai/default",
          primarySkill: "AUTO",
          mode: "PRAWNIK",
          knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 }
        });
    };

    for (const message of ["Skróć ten pozew i wygładź styl.", "Popraw mój pozew, żeby był bardziej stanowczy."]) {
      const response = await send(message + PLEADING);
      expect(response.status, message).toBe(200);
      expect(response.body.taskSkill).toBe("pisma-procesowe-v3");
      expect(JSON.stringify(response.body)).toContain("MOD-REDAKCJA");
    }
    const created = await send("Napisz pozew o zapłatę 30 000 zł.");
    expect(created.status).toBe(409);
    expect(created.body.error).toBe("PROCESS_PLEADING_STATE_REQUIRED");
    auth.close();
  }, 600000);
});
