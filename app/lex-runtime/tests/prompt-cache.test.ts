import path from "node:path";
import { describe, expect, it } from "vitest";
import { modelUsage, promptCacheRouting } from "../src/providers/ai-sdk-adapter.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

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

async function ask(skill: string, domain: string, query: string): Promise<ProviderStreamParams> {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "anthropic",
    label: "cache",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: "Odpowiedź." };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
  const envelope = { auto: false, manual: [skill], caseType: [skill] };
  await executor.execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\n${query}`,
    provider: "anthropic",
    model: "anthropic/claude-test",
    primarySkill: domain,
    mode: "PRAWNIK"
  } as never);
  return calls[0]!;
}

const prefix = (call: ProviderStreamParams): string => call.systemPrompt.slice(0, call.systemPromptCachePrefix ?? 0);

describe("prompt cache: the stable prefix of a mechanical turn", () => {
  it("is the same for different questions and domains of one executive skill; the turn's part follows it", async () => {
    const a = await ask("pisma-proste-v2", "dr-02-prawo-cywilne-rodzinne-gospodarcze", "Napisz wezwanie do zapłaty 12 000 zł za fakturę FV 3/2026 dla Jana Kowalskiego.");
    const b = await ask("pisma-proste-v2", "dr-04-prawo-pracy-zus-swiadczenia", "Przygotuj wniosek do pracodawcy o wydanie świadectwa pracy, art. 97 KP.");
    expect(a.systemPromptCachePrefix).toBeGreaterThan(4_096);
    expect(prefix(a)).toBe(prefix(b));
    expect(a.promptCacheKey).toBe(b.promptCacheKey);
    // Nothing of the question or the domain is in the cached part.
    expect(prefix(a)).not.toMatch(/\[PII:|12 000|świadectwa pracy|# MODUŁ/u);
    // The cached part is the bulk of the prompt.
    expect(prefix(a).length / a.systemPrompt.length).toBeGreaterThan(0.5);
  }, 180_000);

  it("differs between executive skills, so their caches do not collide", async () => {
    const a = await ask("pisma-proste-v2", "dr-02-prawo-cywilne-rodzinne-gospodarcze", "Napisz wezwanie do zapłaty 5 000 zł.");
    const b = await ask("analizator-przepisow-v2", "dr-02-prawo-cywilne-rodzinne-gospodarcze", "Przeanalizuj art. 415 KC.");
    expect(a.promptCacheKey).not.toBe(b.promptCacheKey);
  }, 180_000);
});

describe("prompt cache: provider settings and meter", () => {
  const model = (provider: string) => ({ provider, modelId: "m" }) as never;
  const params = { systemPrompt: "x", messages: [], promptCacheKey: "k1" } as unknown as ProviderStreamParams;

  it("routes OpenAI by prompt_cache_key and xAI by its conversation header; others need nothing", () => {
    expect(promptCacheRouting(model("openai.responses"), params)).toEqual({ providerOptions: { openai: { promptCacheKey: "k1" } } });
    expect(promptCacheRouting(model("xai.responses"), params)).toEqual({ headers: { "x-grok-conv-id": "k1" } });
    expect(promptCacheRouting(model("google.generative-ai"), params)).toEqual({});
    expect(promptCacheRouting(model("openai.responses"), { ...params, promptCacheKey: undefined } as never)).toEqual({});
  });

  it("reads cache reads and writes from the provider's usage", () => {
    expect(modelUsage({ inputTokens: 1000, outputTokens: 10, inputTokenDetails: { cacheReadTokens: 900, cacheWriteTokens: 0, noCacheTokens: 100 } } as never)).toEqual({
      inputTokens: 1000,
      outputTokens: 10,
      cacheReadTokens: 900
    });
    expect(modelUsage({ inputTokens: 5, outputTokens: 1 } as never)).toEqual({ inputTokens: 5, outputTokens: 1 });
  });
});
