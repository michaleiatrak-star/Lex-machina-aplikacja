import fs from "node:fs";
import path from "node:path";
import { CHRONOLOGY_CHECKPOINT_SECTIONS, COURT_CHECKPOINT_SECTIONS } from "../src/checkpoint-skill-sections.js";
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
      expect(tail).toMatch(/^# (?:MODUŁY ETAPU|CHECKPOINT CP-)/u);
      expect(tail).toContain("# ACTIVE PROCESS PLEADING STATE");
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
