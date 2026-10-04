import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { moduleMap, triggeredModules } from "../src/skill-module-map.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

describe("module maps from SKILL.md", () => {
  it("contract type picks the contract modules", () => {
    const picked = triggeredModules(moduleMap(registry, "analizator-umow-v1"), { text: "Przeanalizuj umowę najmu lokalu z zakazem konkurencji" }).map((entry) => entry.resource);
    expect(picked).toEqual(expect.arrayContaining(["analizator-umow-v1/references/mod-J1-najem.md", "analizator-umow-v1/references/zakaz-konkurencji.md"]));
    expect(picked).not.toContain("analizator-umow-v1/references/mod-J7-pzp.md");
  });

  it("a pleading's W2 modules apply at stage W2 only; a conditional one only when its condition is met", () => {
    const map = moduleMap(registry, "pisma-procesowe-v3");
    const atW2 = triggeredModules(map, { text: "apelacja od wyroku", stage: "W2" }).map((entry) => entry.resource);
    expect(atW2).toContain("pisma-procesowe-v3/modules/MOD-SZABLONY.md");
    expect(atW2).not.toContain("shared/ZAZALENIE-ADRESAT-GATE.md");
    expect(triggeredModules(map, { text: "zażalenie na postanowienie", stage: "W2" }).map((entry) => entry.resource)).toContain("shared/ZAZALENIE-ADRESAT-GATE.md");
    expect(triggeredModules(map, { text: "apelacja od wyroku", stage: "W1" }).map((entry) => entry.resource)).not.toContain("pisma-procesowe-v3/modules/MOD-SZABLONY.md");
  });
});

describe("AUTO: modules of the chosen skill that the case triggers", () => {
  it("loads the lease module for a lease contract", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "auto",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Analiza umowy." };
      }
    });
    const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
      query: "Czy mogę podpisać tę umowę najmu mieszkania?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "LAIK"
    });
    expect(calls[0]!.systemPrompt).toContain("## MODUŁ: analizator-umow-v1/references/mod-J1-najem.md");
    expect(result.mandatoryPath!.steps.find((step) => step.id === "MODUŁY:analizator-umow-v1")).toBeTruthy();
  }, 60_000);
});
