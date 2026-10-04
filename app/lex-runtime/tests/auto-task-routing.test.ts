import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { classifyTask, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const routes = parseRoutingTable(fs.readFileSync(path.join(CORPUS, "prawny-router-v3/SKILL.md"), "utf8"));

describe("router KROK 2 table from the corpus", () => {
  it("reads rows [1]–[11] with their PRIMARY skill", () => {
    expect(routes.map((route) => route.id)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]);
    expect(routes.find((route) => route.id === "3")!.primary).toBe("pisma-procesowe-v3");
    expect(routes.find((route) => route.id === "11")!.phrases.length).toBeGreaterThan(3);
  });

  it.each([
    ["Napisz apelację od wyroku sądu rejonowego", "pisma-procesowe-v3"],
    ["Napisz sprzeciw od nakazu zapłaty", "pisma-proste-v2"],
    ["Przeanalizuj tę umowę najmu, czy mogę podpisać?", "analizator-umow-v1"],
    ["Dostałem nakaz zapłaty, jakie mam szanse?", "analiza-sadowa-v6"],
    ["Znajdź wyrok SN o zasiedzeniu", "orzeczenia-sadowe-v2"],
    ["Mam maile i SMS-y od pracodawcy, czy to dowód?", "analizator-dowodow-v3"],
    ["Przygotuj pytania do świadka", "przesluchanie-swiadkow-v2-min90"],
    ["Wykaż różnice pomiędzy 233 kk, 234 kk i 238 kk.", "analizator-przepisow-v2"],
    ["Sprawdź tę opinię prawną", "analizator-przepisow-v2"]
  ])("%s -> %s", (question, skill) => {
    expect(classifyTask(routes, question)?.route.primary).toBe(skill);
  });

  it("a plain domain question names no executive skill", () => {
    expect(classifyTask(routes, "Sąsiad uszkodził mi samochód, należy mi się odszkodowanie?")).toBeNull();
  });
});

describe("AUTO: the router's executive skill is loaded mechanically", () => {
  it("loads pisma-procesowe-v3 with its contract for an appeal and registers it", async () => {
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
        return { fullText: "Apelację wnosi się za pośrednictwem sądu pierwszej instancji." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const result = await executor.execute({
      query: "Napisz apelację od wyroku sądu rejonowego w sprawie o zapłatę",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    });
    const prompt = calls[0]!.systemPrompt ?? "";
    expect(prompt).toContain("# SKILL WYKONAWCZY WG ROUTERA [3]");
    expect(prompt).toContain("# KONTRAKT SKILLA WYKONAWCZEGO: pisma-procesowe-v3");
    expect(prompt).toContain("tryb mechaniczny");
    const steps = result.mandatoryPath!.steps;
    expect(steps.find((step) => step.id === "SKILL:pisma-procesowe-v3")).toMatchObject({ status: "MET", by: "APLIKACJA" });
    expect(steps.find((step) => step.id === "KONTRAKT:pisma-procesowe-v3")).toBeTruthy();
    expect(result.mandatoryPath!.routingTrace).toContain("PRIMARY: pisma-procesowe-v3 — ROUTER-WCZYTANY: TAK");
  }, 60_000);
});
