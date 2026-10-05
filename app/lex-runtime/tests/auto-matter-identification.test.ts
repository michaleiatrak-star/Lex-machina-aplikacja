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

  it("recognises a criminal matter told in everyday words (Karne: +kwalifikator)", () => {
    for (const text of [
      "Kolega pobił mnie na imprezie, złamany nos",
      "Ktoś ukradł mi telefon w autobusie",
      "Zatrzymano mnie za jazdę po alkoholu, 0,6 promila",
      "Oszustwo internetowe na OLX, zapłaciłem a towaru brak",
      "Mąż stosuje przemoc domową, chcę założyć niebieską kartę",
      "Stalking ze strony byłego partnera",
      "Zażalenie na postanowienie o umorzeniu śledztwa",
      "Dostałem mandat za przekroczenie prędkości"
    ]) {
      expect(criminalMatter(text), text).toBe(true);
    }
    for (const text of ["Pobieram zasiłek chorobowy", "Dochodzenie roszczeń od ubezpieczyciela", "Wygaśnięcie mandatu radnego", "Mandat posła a immunitet"]) {
      expect(criminalMatter(text), text).toBe(false);
    }
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

describe("AUTO: a skill counts as read only when its SKILL.md was read to the end", () => {
  async function run(parts: number) {
    const registry = new LexSkillRegistry(CORPUS);
    registry.scan();
    const providers = new ProviderRegistry();
    const results: Array<Record<string, unknown>> = [];
    providers.register({
      id: "openai",
      label: "auto",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        if (received.runTools && received.tools?.length) {
          let offset = 0;
          for (let part = 0; part < parts; part += 1) {
            const [result] = await received.runTools([
              { id: `r${part}`, name: "read_legal_resource", input: { skill: "dr-02-prawo-cywilne-rodzinne-gospodarcze", path: "SKILL.md", offset } }
            ]);
            const payload = JSON.parse(result!.content) as Record<string, unknown>;
            results.push(payload);
            offset = Number(payload.nextOffset ?? 0);
          }
        }
        return { fullText: "Odpowiedzialność deliktowa: art. 415 KC." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const result = await executor.execute({
      query: "Sąsiad uszkodził mi samochód, czy należy mi się odszkodowanie?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    });
    return { result, results };
  }

  it("a first part only: the register says so and the model is told to read on", async () => {
    const { result, results } = await run(1);
    expect(String(results[0]!.instruction)).toContain("does not count as read");
    expect(result.mandatoryPath!.steps.find((step) => step.id === "SKILL:dr-02-prawo-cywilne-rodzinne-gospodarcze")).toMatchObject({
      status: "MISSING",
      evidence: expect.stringContaining("tylko w części")
    });
    expect(result.mandatoryPath!.routingTrace).toContain("ROUTER-WCZYTANY: NIE");
  }, 60_000);

  it("the whole file: the domain skill and the preloaded facade are read", async () => {
    const { result } = await run(2);
    const steps = result.mandatoryPath!.steps;
    expect(steps.find((step) => step.id === "SKILL:dr-02-prawo-cywilne-rodzinne-gospodarcze")).toMatchObject({ status: "MET", by: "MODEL" });
    expect(steps.find((step) => step.id === "SKILL:prawo-polskie-v2")).toMatchObject({ status: "MET", by: "APLIKACJA" });
    expect(result.mandatoryPath!.routingTrace).toContain("PRIMARY: dr-02-prawo-cywilne-rodzinne-gospodarcze — ROUTER-WCZYTANY: TAK");
  }, 60_000);
});
