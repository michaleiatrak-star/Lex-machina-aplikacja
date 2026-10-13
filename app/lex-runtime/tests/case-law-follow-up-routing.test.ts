import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

// Wersja 0.1.27: po "Znajdź wyrok SN o halucynacjach AI prawnika" dopytanie "Wyszukaj w takim
// razie innego wyroku, z polski" uruchomiło analizę sądową (SD-VER bez plików), a "ok, robisz
// to." straciło skill wyszukiwania orzeczeń.
const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();
const FIRST = "Znajdź wyrok z sądu najwyższego dotyczący użycia AI i jego halucynacji przez prawnika";

async function primaryOf(query: string): Promise<string> {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "auto",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: "Nie znalazłem orzeczenia spełniającego te kryteria." };
    }
  });
  const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
    query,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
    modelSelectsSkills: true,
    mode: "LAIK"
  } as never);
  expect(result.courtWorkflow ?? null).toBeNull();
  return /# SKILL WYKONAWCZY WG ROUTERA: (\S+)/u.exec(calls[0]!.systemPrompt ?? "")?.[1] ?? "";
}

describe("case-law follow-ups stay a case-law search", () => {
  it.each([
    "Wyszukaj w takim razie innego wyroku, z polski",
    "prosiłem o inny wyrok z polski dotyczący AI użytego przez prawnika, wyrok wydany przez kogoś innego jak sąd najwyższy",
    "ok, robisz to."
  ])("%s -> orzeczenia-sadowe-v2, no court analysis", async (followUp) => {
    expect(await primaryOf(`${FIRST}\n\nAsystent: Nie znaleziono w bazie SN.\n\nUżytkownik: ${followUp}`)).toBe("orzeczenia-sadowe-v2");
  }, 60_000);

  it("a judgment the user has is still analysed", async () => {
    expect(await primaryOf("Przeanalizuj ten wyrok sądu rejonowego, który dostałem")).toBe("analiza-sadowa-v6");
  }, 60_000);
});
