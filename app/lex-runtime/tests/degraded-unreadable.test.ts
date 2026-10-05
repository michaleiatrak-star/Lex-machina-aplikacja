import path from "node:path";
import { expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

it("names a mandatory resource it could not read, to the model and in the answer (PROFIL-LEKKI)", async () => {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "degraded",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: "Art. 233 KK dotyczy fałszywych zeznań." };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  const read = (executor as unknown as { readCorpus(resource: string): string | null }).readCorpus.bind(executor);
  (executor as unknown as { readCorpus(resource: string): string | null }).readCorpus = (resource) =>
    resource.endsWith("HIERARCHIA-ZRODEL.md") ? null : read(resource);

  const result = await executor.execute({
    query: "Wykaż różnice pomiędzy 233 kk i 234 kk.",
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
    modelSelectsSkills: true,
    mode: "PRAWNIK"
  });

  expect(calls[0]!.systemPrompt).toContain("Aplikacja nie wczytała: shared/HIERARCHIA-ZRODEL.md");
  expect(result.answer).toContain("⛔ TRYB ZDEGRADOWANY");
  expect(result.answer).toContain("nie wczytano: shared/HIERARCHIA-ZRODEL.md");
}, 120_000);
