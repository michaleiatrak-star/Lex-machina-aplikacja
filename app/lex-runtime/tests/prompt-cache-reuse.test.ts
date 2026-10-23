import path from "node:path";
import { expect, it } from "vitest";
import { SEMANTIC_JUDGE_SYSTEM } from "../src/case-semantic-check.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

// Test 500: 87% of the API cost were prompt cache writes. The shared part of the AUTO prompt
// had no breakpoint (the placeholder legend opened it) and each correcting round sent its own
// ~65k-token prompt. Now: one shared prefix for every case, corrections over the main prompt.
it("caches one shared prefix across cases and runs correcting rounds over the main call's prompt", async () => {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const calls: any[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "anthropic",
    label: "probe",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(params: any) {
      calls.push(params);
      if (String(params.systemPrompt).startsWith(SEMANTIC_JUDGE_SYSTEM)) return { fullText: "" };
      // A deferral without substance: the application asks for the answer in a correcting round.
      return { fullText: params.toolChoice ? "Odpowiedź: termin wynosi 6 lat." : "Nie mogę jeszcze udzielić odpowiedzi; zostanie przygotowana po zakończeniu kontroli." };
    }
  } as never);
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  const ask = (query: string, primarySkill: string) =>
    executor.execute({ query, provider: "anthropic", model: "claude-opus-5-5", primarySkill, modelSelectsSkills: true, mode: "PRAWNIK" } as never).catch(() => null);
  await ask("Czy roszczenie o zapłatę ceny za usługę z 2019 r. jest przedawnione?", "dr-02-prawo-cywilne-rodzinne-gospodarcze");
  await ask("Czy urząd może zawiesić przedawnienie zaległości PIT za 2019 r.?", "dr-06-podatki-finanse-publiczne-aml");

  const main = calls.filter((call) => !call.toolChoice && !String(call.systemPrompt).startsWith(SEMANTIC_JUDGE_SYSTEM));
  expect(main.length).toBeGreaterThanOrEqual(2);
  const prefix = (call: any) => String(call.systemPrompt).slice(0, call.systemPromptCachePrefix);
  expect(main[0].systemPromptCachePrefix).toBeGreaterThan(100_000);
  expect(main[0].promptCacheTtl).toBe("1h");
  // The same prefix for two different domains.
  expect(prefix(main.at(-1))).toBe(prefix(main[0]));

  const corrections = calls.filter((call) => call.toolChoice === "none");
  expect(corrections.length).toBeGreaterThan(0);
  for (const correction of corrections) {
    const owner = main.filter((call) => call.systemPrompt === correction.systemPrompt);
    expect(owner.length).toBeGreaterThan(0);
    expect(correction.messages.slice(0, owner[0].messages.length)).toEqual(owner[0].messages);
    expect(correction.messages.at(-2).role).toBe("assistant");
  }
}, 120_000);
