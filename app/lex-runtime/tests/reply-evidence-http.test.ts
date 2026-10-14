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
const D: Record<string, string> = {
  pozew: "Sąd Rejonowy dla Krakowa-Śródmieścia w Krakowie\nPowód: ABC sp. z o.o.\nPozwany: Jan Kowalski\nWartość przedmiotu sporu: 12 000 zł\nPOZEW O ZAPŁATĘ\nWnoszę o zasądzenie kwoty 12 000 zł.",
  zarzadzenie: "Sąd Rejonowy w Krakowie I Wydział Cywilny\nSygn. akt I C 900/26\nZARZĄDZENIE\nPrzewodniczący zarządza: doręczyć pozwanemu odpis pozwu i zobowiązać go do złożenia odpowiedzi na pozew w terminie dwóch tygodni.",
  nakaz: "Sygn. akt I Nc 1234/26\nNAKAZ ZAPŁATY W POSTĘPOWANIU UPOMINAWCZYM\nReferendarz sądowy nakazuje pozwanemu, aby zapłacił powodowi kwotę 12 000 zł albo wniósł sprzeciw."
};
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
// Delivered files over HTTP with the real executor: a question about a delivered pleading is
// answered (no 409 *_STATE_REQUIRED from the word "pozew"); a request for the pleading still
// waits for the pipeline the chat offers to start; the case's own number does not block.
const ANSWER = "W sprawie o sygn. akt I C 900/26 należy złożyć odpowiedź na pozew w terminie dwóch tygodni od doręczenia (art. 205^3 § 2 KPC ⚠️ [NIEWERYFIKOWANE]).";
const SCEN: Array<[string, string[], number]> = [
  ["Dostałem pozew, co mam zrobić?", ["pozew"], 200],
  ["Mam pozew, wyjaśnij mi o co chodzi.", ["pozew"], 200],
  ["Przygotuj odpowiedź na pozew.", ["pozew"], 409],
  ["Napisz zarzuty od nakazu zapłaty.", ["nakaz"], 200],
  ["Co wynika z tego zarządzenia?", ["zarzadzenie"], 200]
];
it("replies to delivered documents over HTTP", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-reply-http-"));
  const authStore = new LocalAuthStore({ rootDir: root });
  const auth = new LocalAuthService(authStore, { sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }), kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 } });
  const files = new LocalCaseFileStore({ rootDir: root });
  const cases = new LocalCaseAccessService(authStore, auth, files);
  const workspace = new EncryptedCaseWorkspaceStore({ rootDir: root });
  const registry = new LexSkillRegistry(CORPUS); registry.scan();
  const providers = new ProviderRegistry();
  providers.register({ id: "openai", label: "sim", capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false }, async stream() { return { fullText: ANSWER }; } } as never);
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  const documentService = {
    resolveProtectedChunks: vi.fn(async (selection: any) => { const name = Object.keys(D)[parseInt(selection.documentId.slice(4), 16)]!; const text = D[name] ?? "brak"; return { documentId: selection.documentId, chunks: [{ index: 1, pageStart: 1, pageEnd: 1, text }], totalChars: text.length }; }),
    ingestPdf: vi.fn(), ingestImage: vi.fn(), review: vi.fn(), finalizeReview: vi.fn(), forget: vi.fn(() => false)
  };
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use(createLexHttpApp({ registry, modelCatalog: { list: vi.fn(async () => []) }, authService: auth, caseFileStore: files, secureCaseUploadStore: new SecureCaseUploadStore({ rootDir: root }), caseAccessService: cases,
    contractWorkflowStore: workspace, processWorkflowStore: workspace, chronologyWorkflowStore: workspace, courtAnalysisWorkflowStore: workspace, orderedCaseWorkflowStore: workspace, secureCaseArtifactStore: new SecureCaseArtifactStore({ rootDir: root }), sessionExecutor: executor, documentService } as never));
  const boot = await request(app).post("/api/auth/bootstrap").send({ loginName: "reply-http", displayName: "Reply", password: "Reply over HTTP strong password 2026" });
  const authorization = `Bearer ${boot.body.sessionToken}`;
  for (const [q, docs, expected] of SCEN) {
    const caseId = (await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: q.slice(0, 20) })).body.caseId;
    const attachments = docs.map((d) => ({ documentId: `doc_${Object.keys(D).indexOf(d).toString(16).padStart(24, "0")}`, chunkIndices: [1], caseId }));
    const res = await request(app).post("/api/sessions/execute").set("Authorization", authorization).send({
      query: `__LEX_SKILLS_V1__ {"auto":true,"manual":[],"caseType":"AUTO"}\n${q}`, provider: "openai", model: "account/openai/default", primarySkill: "AUTO", mode: "PRAWNIK",
      knowledge: { caseId, includeCase: false, includeFirm: false, limit: 8 }, ...(attachments.length ? { attachments } : {}) });
    const b = res.body ?? {};
    expect(res.status, q).toBe(expected);
    if (expected === 409) expect(b.error).toBe("PROCESS_PLEADING_STATE_REQUIRED");
    else expect(b.status, q).toBe("DRAFT_PRESENTABLE");
    // The court's letter names the case: its number is the case's own, not a judgment to verify.
    if (docs.includes("zarzadzenie")) expect((b.blockedReferences ?? []).filter((item: { kind: string }) => item.kind === "case")).toEqual([]);
  }
  auth.close();
  fs.rmSync(root, { recursive: true, force: true });
}, 300_000);
