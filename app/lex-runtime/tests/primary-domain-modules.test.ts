import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

// The act modules the routing suggests for the case's own domain are read for the model, not
// left to it (real7: labour-code modules hinted, never read).
describe("act modules of the case's domain", () => {
  it("a labour case gets its labour-code modules in the prompt, read by the application", async () => {
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
    const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
      query: "Użytkownik: Pracodawca wypowiedział mi umowę o pracę bez wskazania przyczyny. Czy mogę odwołać się do sądu pracy?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-04-prawo-pracy-zus-swiadczenia",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    } as never);
    const prompt = calls.map((call) => call.systemPrompt).join("\n");
    expect(prompt).toContain("MODUŁY AKTU DZIEDZINY SPRAWY");
    expect(prompt).toMatch(/dr-04-prawo-pracy-zus-swiadczenia\/[^\s]*mod-KP[^\s]*\.md[^\n]*wczytany przez aplikację/u);
    expect(JSON.stringify(result)).not.toMatch(/MODUŁ-AKTU:dr-04[^}]*"status":"MISSING"/u);
  }, 60_000);
});
