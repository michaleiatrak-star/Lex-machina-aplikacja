import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { warmChatPaths } from "../src/chat-warmup.js";
import { SecureCaseArtifactStore } from "../src/case-artifact-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { SecureCaseUploadStore } from "../src/case-secure-store.js";
import { EncryptedCaseWorkspaceStore } from "../src/case-workspace-store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { createLexHttpApp } from "../src/http/app.js";
import { registerWorkspaceRoutes } from "../src/http/workspace-routes.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

// Every chat path over HTTP with the real gates, router and executor and a simulated model:
// which lane each message takes, what the model gets (prompt size, tools, cache split) and how
// long the runtime itself takes. Timings printed with LEX_CHAT_BENCH=1 (npm run
// benchmark:chat-paths). Measured 2026-11-04: warm turns 15-60 ms of runtime per path; the first
// legal question after start 2.9-3.9 s before chat-warmup.ts, 0.5 s after it.

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const ANSWER = "Zgodnie z art. 415 Kodeksu cywilnego, kto z winy swej wyrządził drugiemu szkodę, obowiązany jest do jej naprawienia.";
const ROUTER = "# LEX MACHINA — MODEL ROUTER AUTO";
const CIVIL = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const CRIMINAL = "dr-03-prawo-karne-wykroczenia-egzekucja";

type Call = {
  systemPrompt: string;
  systemPromptCachePrefix: number | undefined;
  systemPromptSharedPrefix: number | undefined;
  promptCacheTtl: ProviderStreamParams["promptCacheTtl"] | undefined;
  tools: number;
  last: string;
};
const calls: Call[] = [];
// Texts the personal-data recognizer was run on.
const recognized: string[] = [];
let app: express.Express;
let authorization = "";
let root = "";
const bench = process.env.LEX_CHAT_BENCH === "1";
const timings: string[] = [];

const envelope = (text: string) => `__LEX_SKILLS_V1__ ${JSON.stringify({ auto: true, manual: [], caseType: "AUTO" })}\n${text}`;

async function turn(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown>; calls: Call[]; ms: number }> {
  calls.length = 0;
  const started = performance.now();
  const response = await request(app).post("/api/sessions/execute").set("Authorization", authorization).send(body);
  return { status: response.status, body: response.body as Record<string, unknown>, calls: [...calls], ms: performance.now() - started };
}

async function measured(name: string, body: Record<string, unknown>) {
  const first = await turn(body);
  const second = await turn(body);
  if (bench) timings.push(`${name}: ${Math.round(first.ms)} / ${Math.round(second.ms)} ms; ${first.calls.map((call) => `system=${call.systemPrompt.length} tools=${call.tools}`).join(" | ")}`);
  return second;
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-chat-paths-"));
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
  const warm = warmChatPaths(registry);
  if (bench) timings.push(`warm-up: ${warm} ms`);
  const providers = new ProviderRegistry();
  for (const id of ["openai", "anthropic"] as const) {
    providers.register({
      id,
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(params: ProviderStreamParams) {
        const last = String(params.messages.at(-1)?.content ?? "");
        calls.push({
          systemPrompt: params.systemPrompt,
          systemPromptCachePrefix: params.systemPromptCachePrefix,
          systemPromptSharedPrefix: params.systemPromptSharedPrefix,
          promptCacheTtl: params.promptCacheTtl,
          tools: params.tools?.length ?? 0,
          last
        });
        if (params.systemPrompt.startsWith(ROUTER)) {
          const domain = /pobił/u.test(last) ? CRIMINAL : CIVIL;
          return { fullText: JSON.stringify({ legal: true, primarySkill: domain, domainSkills: [domain], executionSkills: [], workflowExecutionSkill: null }) };
        }
        return { fullText: ANSWER };
      }
    } as never);
  }
  app = express();
  app.use(express.json({ limit: "20mb" }));
  registerWorkspaceRoutes(app, {
    authService: auth,
    caseAccessService: cases,
    uploads,
    templates: { templatesDir: path.join(root, "templates"), listTemplates: async () => [], readTemplate: async () => { throw new Error("UNUSED"); } },
    privacyVaults: { deleteDocumentVault: async () => false },
    documentService: { forget: () => false },
    workspace,
    rootDir: root
  } as never);
  app.use(
    createLexHttpApp({
      registry,
      modelCatalog: { list: async () => [] },
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
      sessionExecutor: new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, undefined, { recognize: async (text: string) => { recognized.push(text); return []; } } as never)
    } as never)
  );
  const boot = await request(app).post("/api/auth/bootstrap").send({ loginName: "chat-paths", displayName: "Owner", password: "Chat paths strong password 2026" });
  authorization = `Bearer ${boot.body.sessionToken as string}`;
}, 60_000);

afterAll(() => {
  if (bench) console.log(["# Ścieżki czatu (symulowany model, czas runtime: pierwsza / druga tura)", ...timings].join("\n"));
  fs.rmSync(root, { recursive: true, force: true });
});

describe("chat paths over HTTP", () => {
  it("a thanks and a non-legal question take the conversational lane: a short prompt, no legal tools", async () => {
    for (const [name, text, model] of [
      ["trywialna (konto)", "dzięki", "account/anthropic/default"],
      ["nieprawna (API)", "Jak upiec sernik bez spodu?", "claude-sim"],
      ["trywialna (lokalny)", "Dzień dobry", "local/bielik-11b-v3-q4km"]
    ] as const) {
      const result = await measured(name, { query: envelope(text), provider: model.startsWith("local/") ? "openai" : "anthropic", model, primarySkill: "AUTO", mode: "LAIK" });
      expect(result.status, name).toBe(200);
      expect(result.calls, name).toHaveLength(1);
      expect(result.calls[0]!.systemPrompt.length, name).toBeLessThan(2_000);
      expect(result.calls[0]!.tools, name).toBe(0);
    }
  }, 120_000);

  it("a later 'ok' after a legal answer without a question stays conversational; 'tak' after a question does not", async () => {
    const history = "Użytkownik: Ile trwa urlop macierzyński?\n\nAsystent: Urlop macierzyński trwa 20 tygodni.";
    const thanks = await turn({ query: envelope(`${history}\n\nUżytkownik: ok, dzięki`), provider: "anthropic", model: "claude-sim", primarySkill: "AUTO", mode: "LAIK" });
    expect(thanks.calls[0]!.systemPrompt.length).toBeLessThan(2_000);
    const consent = await turn({
      query: envelope("Użytkownik: Należy mi się odszkodowanie za zalanie mieszkania?\n\nAsystent: Tak. Czy mam przygotować wezwanie do zapłaty?\n\nUżytkownik: tak"),
      provider: "anthropic",
      model: "claude-sim",
      primarySkill: "AUTO",
      mode: "PRAWNIK"
    });
    expect(consent.calls[0]!.systemPrompt.length).toBeGreaterThan(50_000);
  }, 120_000);

  it("a legal question on an API model: the model picks the skills, the prompt cached in three parts", async () => {
    const civil = await measured("cywilna (API)", { query: envelope("Sąsiad zalał mi mieszkanie, czy mogę żądać odszkodowania i w jakim terminie?"), provider: "anthropic", model: "claude-sim", primarySkill: "AUTO", mode: "PRAWNIK" });
    const criminal = await measured("karna (API)", { query: envelope("Kolega pobił mnie na imprezie i złamał mi nos. Jakie to przestępstwo?"), provider: "anthropic", model: "claude-sim", primarySkill: "AUTO", mode: "PRAWNIK" });
    for (const result of [civil, criminal]) {
      expect(result.status).toBe(200);
      expect(result.calls[0]!.tools).toBeGreaterThan(0);
      expect(result.calls[0]!.promptCacheTtl).toBe("1h");
      expect(result.calls[0]!.systemPromptSharedPrefix).toBeGreaterThan(4_096);
      expect(result.calls[0]!.systemPromptSharedPrefix!).toBeLessThan(result.calls[0]!.systemPromptCachePrefix!);
    }
    // The part every domain shares is the same text: a criminal question after a civil one
    // reads it from the provider's cache.
    const shared = (call: Call) => call.systemPrompt.slice(0, call.systemPromptSharedPrefix);
    expect(shared(criminal.calls[0]!)).toBe(shared(civil.calls[0]!));
    // DR-03: the criminal qualifier is part of the criminal domain's prompt (mandatory path).
    expect(criminal.calls[0]!.systemPrompt).toMatch(/kwalifikator/iu);
  }, 120_000);

  it("a legal question on a local model: a routing pass, then the compact prompt", async () => {
    const local = await measured("cywilna (lokalny)", { query: envelope("Sąsiad zalał mi mieszkanie, czy mogę żądać odszkodowania?"), provider: "openai", model: "local/bielik-11b-v3-q4km", primarySkill: "AUTO", mode: "PRAWNIK" });
    expect(local.status).toBe(200);
    expect(local.calls[0]!.systemPrompt.startsWith(ROUTER)).toBe(true);
    expect(local.calls.at(-1)!.systemPrompt.length).toBeLessThan(20_000);
  }, 120_000);

  it("personal data of a turn is recognized once, also with a local model's routing pre-pass", async () => {
    const history = "Użytkownik: Sąsiad Jan Kowalski zalał mi mieszkanie w Krakowie.\n\nAsystent: Przysługuje odszkodowanie z art. 415 KC.\n\nUżytkownik: ";
    for (const [model, provider, question] of [
      ["claude-sim", "anthropic", "A jaki jest termin przedawnienia roszczenia?"],
      ["local/bielik-11b-v3-q4km", "openai", "Czy mogę żądać odsetek od tej kwoty?"]
    ] as const) {
      recognized.length = 0;
      const result = await turn({ query: envelope(`${history}${question}`), provider, model, primarySkill: "AUTO", mode: "PRAWNIK" });
      expect(result.calls.length, model).toBeGreaterThan(0);
      // Before: twice with history (the assistant's example data, the anonymization), three
      // times with a local model (its routing pre-pass too).
      expect(recognized, model).toHaveLength(1);
      expect(recognized[0], model).not.toContain("__LEX_SKILLS_V1__");
    }
  }, 120_000);

  it("a long conversation: the runtime's own time stays small", async () => {
    const history = Array.from({ length: 20 }, (_, index) => `Użytkownik: Pytanie ${index} o kaucję przy najmie.\n\nAsystent: Odpowiedź ${index}: ${"kaucja zwrot najem ".repeat(60)}`).join("\n\n");
    const result = await measured("20 tur rozmowy (API)", { query: envelope(`${history}\n\nUżytkownik: A czy wynajmujący może zatrzymać kaucję za zwykłe zużycie?`), provider: "anthropic", model: "claude-sim", primarySkill: "AUTO", mode: "PRAWNIK" });
    expect(result.status).toBe(200);
    // Generous for a loaded CI machine; measured 40 ms.
    expect(result.ms).toBeLessThan(5_000);
  }, 120_000);
});
