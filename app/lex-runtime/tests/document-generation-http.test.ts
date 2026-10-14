import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { createLexHttpApp } from "../src/http/app.js";
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
import { EncryptedPrivacyVaultStore } from "../src/privacy/vault-store.js";
import { DocumentGenerationStateStore } from "../src/document-generation-state.js";
import { LocalDocumentAuthoringService } from "../src/document-authoring-service.js";
import { LegalDocumentAstGenerator } from "../src/legal-document-ast-generator.js";
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const DOCS: Record<string, string> = {
  wezwanieSadu: "Sąd Rejonowy w Krakowie\nSygn. akt I C 900/26\nWEZWANIE\nSąd wzywa pełnomocnika powoda do uzupełnienia braków formalnych pozwu przez złożenie odpisu pełnomocnictwa w terminie 7 dni pod rygorem zwrotu pozwu.",
  pozew: "Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie\nSygn. akt I C 900/26\nPowód: ABC sp. z o.o.\nPozwany: Jan Kowalski\nWartość przedmiotu sporu: 12 000 zł\nPOZEW O ZAPŁATĘ\nWnoszę o zasądzenie kwoty 12 000 zł."
};
type Scen = { q: string; type: string; docs?: string[]; body: string[]; exec?: string[]; dr?: string; expect: number; error?: string };
// A file from the chat with the real executor, AST generator and authoring service: a payment
// demand ("w terminie 7 dni" is the creditor's own term, not a statutory one) and a letter
// naming the user's own case number become files; a pleading still waits for its pipeline.
const SCEN: Scen[] = [
  { q: "Przygotuj wezwanie do zapłaty 5 000 zł za fakturę FV 1/2026 w pliku docx.", type: "letter", exec: ["pisma-proste-v2"], body: ["WEZWANIE DO ZAPŁATY", "Wzywam do zapłaty kwoty 5 000 zł w terminie 7 dni od doręczenia wezwania."], expect: 201 },
  { q: "Przygotuj opinię prawną o przedawnieniu roszczenia w pliku docx.", type: "opinion", body: ["OPINIA PRAWNA", "Opinia dotyczy przedawnienia roszczenia z umowy sprzedaży."], expect: 201 },
  { q: "W mojej sprawie sygn. akt I C 900/26 przygotuj wniosek o doręczenie odpisu wyroku z uzasadnieniem w pliku docx.", type: "letter", exec: ["pisma-proste-v2"], body: ["WNIOSEK", "W sprawie o sygn. akt I C 900/26 wnoszę o doręczenie odpisu wyroku wraz z uzasadnieniem."], expect: 201 },
  { q: "Napisz pozew o zapłatę w pliku docx.", type: "pleading", exec: ["pisma-procesowe-v3"], body: ["POZEW"], expect: 409, error: "PROCESS_PLEADING_PIPELINE_REQUIRED" }
];
let current: Scen | null = null;
it("generates files from the chat", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-generation-http-"));
  const authStore = new LocalAuthStore({ rootDir: root });
  const auth = new LocalAuthService(authStore, { sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }), kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 } });
  const files = new LocalCaseFileStore({ rootDir: root });
  const cases = new LocalCaseAccessService(authStore, auth, files);
  const workspace = new EncryptedCaseWorkspaceStore({ rootDir: root });
  const registry = new LexSkillRegistry(CORPUS); registry.scan();
  const providers = new ProviderRegistry();
  const prompts: string[] = [];
  providers.register({ id: "openai", label: "sim", capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false }, async stream(req: any) {
    const all = req.systemPrompt + JSON.stringify(req.messages);
    prompts.push(all);
    if (/# DOZWOLONE DOMENY/u.test(req.systemPrompt)) {
      const exec = current!.exec ?? [];
      return { fullText: JSON.stringify({ legal: true, primarySkill: current!.dr ?? "dr-02-prawo-cywilne-rodzinne-gospodarcze", domainSkills: [current!.dr ?? "dr-02-prawo-cywilne-rodzinne-gospodarcze"], executionSkills: exec, workflowExecutionSkill: exec[0] ?? null }) };
    }
    if (/OUTPUT CONTRACT — LEGAL DOCUMENT AST/u.test(all)) {
      const blocks = [{ type: "heading", level: 1, content: [{ type: "text", text: current!.body[0]! }] }, ...current!.body.slice(1).map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }))];
      return { fullText: JSON.stringify({ schemaVersion: "1", locale: "pl-PL", documentType: current!.type, styleProfile: "lex-classic-clean-v1", blocks }) };
    }
    return { fullText: current!.body.join("\n") };
  } } as never);
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  const documentService = {
    resolveProtectedChunks: vi.fn(async (selection: any) => { const name = Object.keys(DOCS)[parseInt(selection.documentId.slice(4), 16)]!; return { documentId: selection.documentId, chunks: [{ index: 1, pageStart: 1, pageEnd: 1, text: DOCS[name]! }], totalChars: DOCS[name]!.length }; }),
    ingestPdf: vi.fn(), ingestImage: vi.fn(), review: vi.fn(), finalizeReview: vi.fn(), forget: vi.fn(() => false)
  };
  const artifacts = new SecureCaseArtifactStore({ rootDir: root });
  const states = new DocumentGenerationStateStore({ rootDir: root });
  const vaults = new EncryptedPrivacyVaultStore({ rootDir: root });
  const app = express();
  app.use(express.json({ limit: "4mb" }));
  app.use(createLexHttpApp({ registry, modelCatalog: { list: vi.fn(async () => []) }, authService: auth, caseFileStore: files, secureCaseUploadStore: new SecureCaseUploadStore({ rootDir: root }), caseAccessService: cases,
    contractWorkflowStore: workspace, processWorkflowStore: workspace, chronologyWorkflowStore: workspace, courtAnalysisWorkflowStore: workspace, orderedCaseWorkflowStore: workspace, secureCaseArtifactStore: artifacts, sessionExecutor: executor, documentService,
    documentAstGenerator: new LegalDocumentAstGenerator(executor), documentAuthoringService: new LocalDocumentAuthoringService(vaults, artifacts, states), documentGenerationState: states, privacyVaultStore: vaults } as never));
  const boot = await request(app).post("/api/auth/bootstrap").send({ loginName: "generation-http", displayName: "Generation", password: "Generation over HTTP strong password 2026" });
  const authorization = `Bearer ${boot.body.sessionToken}`;
  for (const scen of SCEN) {
    current = scen; prompts.length = 0;
    const caseId = (await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: scen.q.slice(0, 20) })).body.caseId;
    const attachments = (scen.docs ?? []).map((d) => ({ documentId: `doc_${Object.keys(DOCS).indexOf(d).toString(16).padStart(24, "0")}`, chunkIndices: [1], caseId }));
    const res = await request(app).post(`/api/cases/${caseId}/artifacts/generate`).set("Authorization", authorization).send({
      query: `__LEX_SKILLS_V1__ {"auto":true,"manual":[],"caseType":"AUTO"}\nUżytkownik: ${scen.q}`, provider: "openai", model: "account/openai/default", primarySkill: "AUTO", mode: "PRAWNIK",
      format: "docx", documentType: scen.type, styleProfile: "lex-classic-clean-v1", attachments, filename: "LexMachina-pismo.docx" });
    const b = res.body ?? {};
    expect(res.status, `${scen.q} ${JSON.stringify(b).slice(0, 400)}`).toBe(scen.expect);
    if (scen.error) expect(b.error).toBe(scen.error);
    else expect(b.artifact?.filename).toMatch(/\.docx$/u);
  }
  auth.close();
  fs.rmSync(root, { recursive: true, force: true });
}, 300_000);
