import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { decodePromptBudget, encodePromptBudget, promptBudget } from "../src/prompt-budget.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

describe("instruction budget of a turn", () => {
  it("measures the system prompt by top-level section and round-trips through the event", () => {
    const budget = promptBudget("intro\n# A\naaaa\n# B: x|y\nb");
    expect(budget.chars).toBe(25);
    expect(budget.sections).toEqual([
      { label: "B: x|y", chars: 11 },
      { label: "A", chars: 9 },
      { label: "(wstęp)", chars: 6 }
    ]);
    expect(decodePromptBudget(encodePromptBudget(budget))!.sections[0]).toEqual({ label: "B: x y", chars: 11 });
  });

  it("reports the instruction text of a legal turn in the response context", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "budget",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Art. 286 KK — oszustwo." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const result = await executor.execute({
      query: "Czy to oszustwo z art. 286 KK?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    });
    const context = result.context!;
    expect(context.instructionChars).toBe((calls[0]!.systemPrompt ?? "").length);
    expect(context.instructionSections!.length).toBeGreaterThan(3);
    if (process.env.LEX_PRINT_BUDGET) {
      console.log("BUDGET", context.instructionChars, JSON.stringify(context.instructionSections, null, 1));
    }
  }, 60_000);
});
