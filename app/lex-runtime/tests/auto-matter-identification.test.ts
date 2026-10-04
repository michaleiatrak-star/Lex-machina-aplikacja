import path from "node:path";
import { describe, expect, it } from "vitest";
import { criminalMatter } from "../src/matter-signals.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

describe("AUTO: the matter is identified from the question, not from a placeholder", () => {
  it("recognises a criminal question", () => {
    expect(criminalMatter("Wykaż różnice pomiędzy 233 kk i 234 kk.")).toBe(true);
    expect(criminalMatter("Czy grozi mi kara pozbawienia wolności?")).toBe(true);
    expect(criminalMatter("Sąsiad uszkodził mi samochód, należy mi się odszkodowanie?")).toBe(false);
  });

  it("a lay criminal question in AUTO gets PEŁNY, the qualifier up front and no placeholder skill", async () => {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "auto",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "Za kradzież grozi odpowiedzialność karna." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const result = await executor.execute({
      query: "Kolega ukradł mi telefon, czy to przestępstwo?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "LAIK"
    });
    expect(calls[0]!.systemPrompt).toContain("# MANDATORY PATH RESOURCE: dr-03-prawo-karne-wykroczenia-egzekucja/modules/mod-KK-kwalifikator-karnomaterialny.md");
    expect(calls[0]!.systemPrompt).toContain("PROFIL PEŁNY");
    expect(result.mandatoryPath?.profile).toBe("PELNY");
    expect(result.primarySkill).not.toBe("dr-01-ustroj-konstytucyjny-i-zrodla-prawa");
    expect(result.mandatoryPath?.routingTrace).not.toContain("dr-01");
  }, 60_000);
});
