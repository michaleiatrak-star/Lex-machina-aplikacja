import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

// Audyt 2026-10-09: moduł aktu drugiej, silnej dziedziny sprawy (kwalifikator, element
// zagraniczny, fraza własna) idzie z promptem — bez osobnej rundy modelu po jego odczyt.
describe("act module of a second domain", () => {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "sim",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(request) {
      calls.push(request);
      return { fullText: "Odpowiedź symulowana." };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  const run = async (query: string) => {
    calls.length = 0;
    const result = await executor.execute({
      query: `Użytkownik: ${query}`,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    } as never);
    return { prompt: calls.map((call) => call.systemPrompt).join("\n"), result: JSON.stringify(result) };
  };

  it("loads it for a domain the case's own phrase or kind names", async () => {
    const { prompt } = await run("Pracodawca nie wypłacił mi wynagrodzenia, a monitoring w szatni nagrywa pracowników. Co grozi szefowi karnie?");
    expect(prompt).toContain("# MODUŁ AKTU DZIEDZINY WTÓRNEJ");
    expect(prompt).toMatch(/## dr-(?:03|11)-[^\n]+\/modules\/mod-/);
  });

  it("leaves a domain of one shared word to the model", async () => {
    const { prompt } = await run("Fałszywy podpis na umowie, fałszerstwo dokumentu");
    expect(prompt).not.toContain("# MODUŁ AKTU DZIEDZINY WTÓRNEJ");
    expect(prompt).toMatch(/Dziedzina możliwa \(jedno wspólne słowo\)/);
  });
});
