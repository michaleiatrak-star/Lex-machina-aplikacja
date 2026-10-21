import fs from "node:fs";
import path from "node:path";
import { CHRONOLOGY_CHECKPOINT_SECTIONS, COURT_CHECKPOINT_SECTIONS, ORDERED_CHECKPOINT_SECTIONS } from "../src/checkpoint-skill-sections.js";
import { ORDERED_CASE_WORKFLOW_SEQUENCES } from "../src/ordered-case-workflow-state.js";
import { describe, expect, it } from "vitest";
import { documentTriggerText } from "../src/execution-engine.js";
import { anthropicSystem } from "../src/providers/ai-sdk-adapter.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { buildDocumentContextForTest, SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";
import { skillModules, triggeredModules } from "../src/skill-module-map.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

const verification = (() => ({
  schemas: () => [],
  systemPromptAppendix: () => "",
  auditEvents: () => [],
  async runTools(calls: Array<{ id: string }>) {
    return calls.map((call) => ({ tool_use_id: call.id, content: "{}" }));
  }
})) as never;

const CASE =
  "Przygotuj pozew o zapłatę 48 000 zł z umowy o roboty budowlane. Pozwany Budex sp. z o.o. nie zapłacił faktury końcowej FV 7/2026, termin minął 30.06.2026.";
const DOC = "PROTOKÓŁ ODBIORU KOŃCOWEGO z 12.06.2026. Zamawiający Budex sp. z o.o. odbiera roboty bez zastrzeżeń. Wynagrodzenie 48 000 zł brutto.";

async function run(checkpoint: string, stage: string, query: string): Promise<ProviderStreamParams> {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "mechanical",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: `[${checkpoint}] zakończony.` };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
  const envelope = { auto: false, manual: ["pisma-procesowe-v3"], caseType: ["pisma-procesowe-v3"] };
  await executor.execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\n${query}`,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
    mode: "PRAWNIK",
    processWorkflowContext: { stage, checkpoint, mode: "CHECKPOINT" },
    documentAttachments: [{ documentId: "doc_umowa", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: DOC }] }]
  } as never);
  return calls[0]!;
}

describe("mechanical mode: pisma-procesowe-v3, one checkpoint per turn", () => {
  it("the checkpoint's part closes the prompt; the rest is one cached block shared by the next checkpoint", async () => {
    const later = `Użytkownik: ${CASE}\n\nAsystent: Punkt zakończony.\n\nUżytkownik: Kontynuuj.`;
    const a = await run("CP-1c-skan", "W1", later);
    const b = await run("CP-1d", "W1", later);
    const c = await run("CP-ATAK", "W2", later);
    for (const call of [a, b, c]) {
      const prompt = call.systemPrompt;
      const tail = prompt.slice(call.systemPromptCachePrefix!);
      expect(call.promptCacheTtl).toBe("1h");
      // The turn's part: placeholder legend, recognitions, then the checkpoint, closed by its state.
      expect(tail).toMatch(/# CHECKPOINT CP-/u);
      expect(tail.lastIndexOf("# ACTIVE PROCESS PLEADING STATE")).toBeGreaterThan(tail.lastIndexOf("# CHECKPOINT CP-"));
      expect(prompt.slice(0, call.systemPromptCachePrefix!)).not.toContain("[PII:");
      expect(prompt.slice(0, call.systemPromptCachePrefix!)).not.toMatch(/# CHECKPOINT CP-|# MODUŁY ETAPU|ACTIVE PROCESS PLEADING STATE/u);
    }
    expect(a.systemPrompt.slice(0, a.systemPromptCachePrefix!)).toBe(b.systemPrompt.slice(0, b.systemPromptCachePrefix!));
    expect(c.systemPrompt.slice(0, c.systemPromptCachePrefix!)).toBe(a.systemPrompt.slice(0, a.systemPromptCachePrefix!));
    expect(c.systemPrompt.slice(c.systemPromptCachePrefix!)).toContain("# MODUŁY ETAPU W2");
  }, 180_000);

  it("a construction claim with an attached protocol selects no employer or party-identity module", async () => {
    const call = await run("CP-ATAK", "W2", `Użytkownik: ${CASE}\n\nAsystent: Punkt zakończony.\n\nUżytkownik: Kontynuuj.`);
    expect(call.systemPrompt).not.toMatch(/- \S*(?:MOD-PRACODAWCA-RZECZYWISTY|MOD-IDENTYFIKACJA-STRONY-UMOWY)\.md — warunek/u);
    expect(call.systemPrompt).not.toMatch(/moduły aktu dla tej sprawy:[^\n]*mod-PrUpad-zakonczenie/u);
  }, 120_000);
});

describe("text that selects modules", () => {
  it("drops the application's labels of attached documents, keeps a file name", () => {
    const context = buildDocumentContextForTest([
      { documentId: "doc_umowa", title: "pozew_rozwodowy.pdf", selectedByUser: true, totalPages: 2, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "Treść." }] }
    ] as never);
    const text = documentTriggerText(context, 10_000);
    expect(text).not.toMatch(/STRON|doc_umowa|CHUNK/u);
    expect(text).toContain("pozew_rozwodowy.pdf");
    expect(text).toContain("Treść.");
  });

  it("a trigger listing situations „a / b / c” needs one situation, not one common word", () => {
    const entry = {
      resource: "x.md",
      condition: "⛔ OBOWIĄZKOWE gdy: w materiale widoczne są ≥2 podmioty / różne KRS na umowach / zmiana nazwy pracodawcy",
      heading: "MAPA",
      stage: null,
      always: false
    };
    expect(triggeredModules([entry], { text: "Umowa o roboty budowlane, umowach stron." })).toHaveLength(0);
    expect(triggeredModules([entry], { text: "Pracodawca zmienił nazwę spółki w trakcie zatrudnienia." })).toHaveLength(1);
    // A list of single examples after the trigger still needs one of them (shared/terminy.md).
    const termin = skillModules(registry, "pisma-proste-v2", { text: "Napisz sprzeciw od nakazu zapłaty" });
    expect(termin.map((item) => item.resource)).toContain("shared/terminy.md");
  });
});

describe("Anthropic API: the workflow's unchanged part as its own cached system block", () => {
  const model = { provider: "anthropic.messages", modelId: "claude" } as never;
  const systemPrompt = `${"A".repeat(5_000)}\n\n# ACTIVE STATE`;
  it("splits at the prefix with a breakpoint on the first block", () => {
    const system = anthropicSystem(model, { model: "m", systemPrompt, systemPromptCachePrefix: 5_002, promptCacheTtl: "1h", messages: [] });
    expect(Array.isArray(system)).toBe(true);
    const blocks = system as Array<{ content: string; providerOptions?: unknown }>;
    expect(blocks.map((block) => block.content).join("")).toBe(systemPrompt);
    expect(blocks[0]!.providerOptions).toEqual({ anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } });
    expect(blocks[1]!.providerOptions).toBeUndefined();
  });

  it("one string for other providers, a short prefix or none", () => {
    expect(anthropicSystem({ provider: "openai.responses" } as never, { model: "m", systemPrompt, systemPromptCachePrefix: 5_002, messages: [] })).toBe(systemPrompt);
    expect(anthropicSystem(model, { model: "m", systemPrompt, systemPromptCachePrefix: 100, messages: [] })).toBe(systemPrompt);
    expect(anthropicSystem(model, { model: "m", systemPrompt, messages: [] })).toBe(systemPrompt);
  });
});

describe("court analysis and chronology: the checkpoint names the skill's part", () => {
  // Each mapping quotes a heading of the skill; a renamed heading breaks the mapping silently.
  it.each([
    ["analiza-sadowa-v6", COURT_CHECKPOINT_SECTIONS],
    ["chronologia-sprawy-v1", CHRONOLOGY_CHECKPOINT_SECTIONS]
  ] as const)("%s: every checkpoint quotes a heading present in SKILL.md", (skill, sections) => {
    const body = fs.readFileSync(path.join(CORPUS, skill, "SKILL.md"), "utf8");
    for (const [checkpoint, text] of Object.entries(sections)) {
      const quoted = text.match(/[A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ0-9 .—-]{9,}[A-ZĄĆĘŁŃÓŚŹŻ]/gu) ?? [];
      expect(quoted.length, checkpoint).toBeGreaterThan(0);
      expect(quoted.some((heading) => body.includes(heading)), `${checkpoint}: ${quoted.join(" | ")}`).toBe(true);
    }
  });
});

describe("evidence and witness workflows: the checkpoint names the skill's part", () => {
  // The checkpoint names are only in the frontmatter list; each mapping must start with a heading of the body.
  it.each([
    ["EVIDENCE_ANALYSIS_V1", "analizator-dowodow-v3"],
    ["WITNESS_QUESTIONING_V1", "przesluchanie-swiadkow-v2-min90"]
  ] as const)("%s: every checkpoint maps to a heading present in SKILL.md", (workflow, skill) => {
    const headings = fs
      .readFileSync(path.join(CORPUS, skill, "SKILL.md"), "utf8")
      .split("\n")
      .filter((line) => /^#{2,4}\s/u.test(line))
      .map((line) => line.replace(/^#+\s*/u, "").trim());
    const sections = ORDERED_CHECKPOINT_SECTIONS[workflow]!;
    expect(Object.keys(sections).sort()).toEqual([...ORDERED_CASE_WORKFLOW_SEQUENCES[workflow]].sort());
    for (const [checkpoint, text] of Object.entries(sections)) {
      const lead = text.replace(/^#+\s*/u, "").replace(/^ETAP W1: /u, "").split(/ \(| oraz |\.$/u)[0]!.trim();
      expect(headings.some((heading) => heading.startsWith(lead)), `${checkpoint}: ${lead}`).toBe(true);
    }
  });

  it("the active evidence checkpoint names the register of parties, not the minimal mode of KROK 2", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "evidence",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Rejestr stron." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
    await executor.execute({
      query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual: ["analizator-dowodow-v3"], caseType: ["analizator-dowodow-v3"] })}\nOceń dowody w sprawie pożyczki.`,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK",
      orderedCaseWorkflowContext: { workflowId: "EVIDENCE_ANALYSIS_V1", checkpoint: "AD-BLOKG-STRONY", revision: 7 }
    } as never);
    expect(calls[0]!.systemPrompt).toContain("Część skilla analizator-dowodow-v3 dla tego punktu: ## BLOK G — Rejestr stron");
  }, 120_000);
});

describe("client report: the report the model wrote without its blueprint", () => {
  it("one repair call with only submit_report_blueprint turns it into a presentable report", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "report",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        const repair = String(received.messages.at(-1)?.content ?? "").includes("submit_report_blueprint");
        if (repair && received.tools?.some((tool) => tool.function.name === "submit_report_blueprint")) {
          await received.runTools?.([
            {
              id: "b1",
              name: "submit_report_blueprint",
              input: {
                reportType: "CLIENT_REPORT_V1",
                blueprint: {
                  profile: "IND",
                  tryb: "standard",
                  kancelaria: null,
                  klient: "Klient A",
                  prawnik: null,
                  sprawa: "Spór o zapłatę za roboty budowlane.",
                  etap: "I instancja",
                  kontekst: "Brak nowych zdarzeń.",
                  ocena: { opis: "Pozycja stabilna.", podstawa: "Dostarczone dokumenty." },
                  assessment: { level: "neutral" },
                  potwierdzenie_odbioru: null
                }
              }
            }
          ]);
          return { fullText: "Raport zapisany." };
        }
        return { fullText: "Raport dla klienta: sprawa w I instancji, pozycja stabilna." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
    const result = await executor.execute({
      query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual: ["raport-klienta-v1"], caseType: ["raport-klienta-v1"] })}\nPrzygotuj raport dla klienta o stanie sprawy budowlanej.`,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK"
    } as never);
    const repair = calls.find((call) => call.tools?.length === 1);
    expect(repair?.tools?.[0]?.function.name).toBe("submit_report_blueprint");
    expect(repair?.systemPrompt).toContain("raport-klienta-v1/references/BLUEPRINT-SCHEMA.md");
    expect(result.workflow?.id).toBe("CLIENT_REPORT_V1");
    expect(result.reportBlueprint?.kind).toBe("CLIENT_REPORT_V1");
    expect(result.status).toBe("DRAFT_PRESENTABLE");
  }, 120_000);
});

describe("mechanical checkpoint that asks the user", () => {
  it("the rule is in the checkpoint part; the answer is flagged and presented, not blocked", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "mechanical",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Podaj datę doręczenia faktury FV 7/2026.\n\n[CZEKAM NA ODPOWIEDŹ]" };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
    const envelope = { auto: false, manual: ["pisma-procesowe-v3"], caseType: ["pisma-procesowe-v3"] };
    const result = await executor.execute({
      query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\n${CASE}`,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK",
      processWorkflowContext: { stage: "W1", checkpoint: "CP-1a", mode: "AUTO" }
    } as never);
    const call = calls[0]!;
    expect(call.systemPrompt.slice(call.systemPromptCachePrefix!)).toContain("[CZEKAM NA ODPOWIEDŹ]");
    expect(result.waitingForUser).toBe(true);
    expect(result.answer ?? "").toContain("Podaj datę doręczenia");
    // The chat's automatic continuation reads the marker in the answer.
    expect(result.answer ?? "").toContain("[CZEKAM NA ODPOWIEDŹ]");
  }, 120_000);
});


describe("AUTO pleading: a step that asks the user ends the server's batch", () => {
  it("stops with WAITING_FOR_USER; the step that asked stays open for the reply", async () => {
    const { runBoundedProcessAutoSequence } = await import("../src/process-pleading-auto-runner.js");
    const { acceptProcessPleadingStart, createProcessPleadingState } = await import("../src/process-pleading-state.js");
    const { waitsForUser, WAIT_FOR_USER_MARKER } = await import("../src/workflow-wait.js");
    const initial = acceptProcessPleadingStart(createProcessPleadingState(`case_${"b".repeat(32)}`, "AUTO"));
    const answers = ["[CP-1a] raport ✅ CHECKPOINT CLAIM-VALIDATION — ZAKOŃCZONY", `Brak daty doręczenia nakazu. Podaj ją.\n${WAIT_FOR_USER_MARKER}`, "nie powinien się wykonać"];
    let call = 0;
    const result = await runBoundedProcessAutoSequence({
      initialState: initial,
      execute: async () => {
        const answer = answers[call++]!;
        return { result: answer, commit: true, waitingForUser: waitsForUser(answer) };
      },
      persist: async (_previous, next) => next
    });
    expect(result.stopped).toBe("WAITING_FOR_USER");
    expect(result.steps).toHaveLength(1);
    expect(result.waitingResult).toContain("Podaj ją.");
    expect(call).toBe(2);
  });
});
