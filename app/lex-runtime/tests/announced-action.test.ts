import path from "node:path";
import { describe, expect, it } from "vitest";
import { onlyAnnouncesWork } from "../src/announced-action.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const DISCLAIMER = "\n\n⚖️ Ważna informacja: Niniejsza analiza ma charakter wyłącznie informacyjny i edukacyjny.";

describe("an answer that only announces the work", () => {
  it.each([
    "Szukam teraz polskiego orzeczenia innego sądu niż Sąd Najwyższy — przede wszystkim sądów powszechnych oraz administracyjnych — dotyczącego użycia AI przez prawnika.",
    "Oficjalna baza Sądu Najwyższego wymaga dodatkowej weryfikacji użytkownika (captcha), więc nie mogę jeszcze potwierdzić wyroku. Przeszukuję bazę pomocniczą SAOS; znaleziony wynik będzie oznaczony jako kandydat i wymaga potwierdzenia na stronie SN."
  ])("is recognised (0.1.27): %s", (answer) => {
    expect(onlyAnnouncesWork(answer + DISCLAIMER)).toBe(true);
  });

  it.each([
    "Nie znaleziono w oficjalnej bazie Sądu Najwyższego wyroku dotyczącego halucynacji AI. Sprawdzam też, czy chodzi o sprawę zagraniczną.",
    "Uchwała SN z 2.10.2024 r., sygn. I KZP 3/24, dotyczy udziału neosędziów w składzie.",
    "Sprawdzam, czy dobrze rozumiem: chodzi o wyrok sądu powszechnego?",
    "Termin przedawnienia roszczenia o zapłatę ceny wynosi dwa lata."
  ])("a finished answer is not: %s", (answer) => {
    expect(onlyAnnouncesWork(answer + DISCLAIMER)).toBe(false);
  });
});

describe("the announced search runs in the same turn", () => {
  it("a second round with the tools replaces the announcement", async () => {
    const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
    registry.scan();
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "announce",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return {
          fullText:
            calls.length === 1
              ? "Szukam teraz polskiego orzeczenia innego sądu niż Sąd Najwyższy dotyczącego użycia AI przez prawnika."
              : "Nie znalazłem polskiego orzeczenia spełniającego te kryteria. Sprawdzono CBOSA i portal orzeczeń sądów powszechnych."
        };
      }
    });
    const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
      query: "Znajdź polski wyrok innego sądu niż SN dotyczący użycia AI przez prawnika",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "LAIK"
    } as never);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.tools?.length).toBeGreaterThan(0);
    expect(typeof calls[1]!.runTools).toBe("function");
    expect(result.answer).toContain("Nie znalazłem polskiego orzeczenia");
    expect(result.answer).not.toContain("Szukam teraz");
  }, 60_000);
});
