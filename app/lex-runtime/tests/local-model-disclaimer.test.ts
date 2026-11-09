import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { endsWithDisclaimer } from "../src/legal-disclaimer.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

// 2026-11-09: odpowiedź Bielika (analiza porozumienia o rozwiązaniu umowy o pracę) bez
// disclaimera — aplikacja dokładała go tylko modelom spoza local/. KROK 7 obowiązuje każdy model.
const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();

async function answer(model: string, text: string): Promise<string> {
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "local",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream() {
      return { fullText: text };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  const result = await executor.execute({
    query: "Czy pracownik może zrzec się ekwiwalentu za urlop?",
    provider: "openai",
    model,
    primarySkill: "dr-04-prawo-pracy-zus-swiadczenia",
    mode: "LAIK"
  });
  return result.answer ?? "";
}

describe("KROK 7 przy modelu lokalnym", () => {
  it("aplikacja dokłada kanoniczny disclaimer, gdy model lokalny go pominął", async () => {
    const text = await answer("local/bielik-11b-v3-q4km", "Zrzeczenie się prawa do wynagrodzenia jest nieważne (art. 84 KP).");
    expect(endsWithDisclaimer(text)).toBe(true);
    expect(text).toMatch(/Nie stanowi porady prawnej/u);
  }, 60_000);

  it("własny disclaimer modelu lokalnego zastępuje tekst kanoniczny, bez dubla", async () => {
    const text = await answer(
      "local/bielik-11b-v3-q4km",
      "Zrzeczenie się prawa do wynagrodzenia jest nieważne (art. 84 KP).\n\n⚖️ Zastrzeżenie: informacja ogólna, nie stanowi porady prawnej."
    );
    expect(text.match(/nie stanowi porady prawnej/giu)?.length).toBe(1);
  }, 60_000);
});
