import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { simpleFormQuestion } from "../src/matter-complexity.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { classifyRoute, parseRouteChoice, routeAmbiguity } from "../src/route-classifier.js";
import { SESSION_EXECUTION_INTERNAL, SafeSessionExecutor } from "../src/session-executor.js";
import { schemaCatalog } from "../src/skill-module-map.js";
import { decideTask, parseActivationMatrix, parseRedactionTest, parseRoutingTable } from "../src/task-routing.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

describe("ambiguous questions go to the model, clear ones stay with the patterns (task 05)", () => {
  it("names the ambiguity", () => {
    expect(routeAmbiguity({ question: "Czy powinienem złożyć apelację?", decided: "pisma-procesowe-v3", wordsOnly: null, simpleForm: false })).toMatch(/nazwa pisma/u);
    expect(routeAmbiguity({ question: "Napisz apelację od wyroku", decided: "pisma-procesowe-v3", wordsOnly: null, simpleForm: false })).toBeNull();
    expect(routeAmbiguity({ question: "Co dalej?", decided: "analizator-dowodow-v3", wordsOnly: "analiza-sadowa-v6", simpleForm: false })).toMatch(/materiał/u);
    expect(routeAmbiguity({ question: "Czy ten świadek był wiarygodny?", decided: "przesluchanie-swiadkow-v2-min90", wordsOnly: null, simpleForm: false })).toMatch(/krótkie pytanie/u);
    expect(routeAmbiguity({ question: "Ile wynosi opłata od pozwu o zapłatę 5000 zł", decided: null, wordsOnly: null, simpleForm: true })).toMatch(/nazwa pisma/u);
    expect(routeAmbiguity({ question: "Przeanalizuj dowody w tej sprawie", decided: "analizator-dowodow-v3", wordsOnly: "analizator-dowodow-v3", simpleForm: false })).toBeNull();
  });

  it("reads only allowed answers", () => {
    expect(parseRouteChoice('{"form":"PROSTA","skill":null}')).toEqual({ form: "PROSTA", skill: null });
    expect(parseRouteChoice('Wynik: {"form":"PELNA","skill":"analiza-sadowa-v6"}')).toEqual({ form: "PELNA", skill: "analiza-sadowa-v6" });
    expect(parseRouteChoice('{"form":"PELNA","skill":"nieznany"}')).toBeNull();
    expect(parseRouteChoice("nie wiem")).toBeNull();
  });

  it("asks once per question text; a failure gives no choice", async () => {
    let asked = 0;
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream() {
        asked += 1;
        return { fullText: '{"form":"PROSTA","skill":null}' };
      }
    });
    const gateway = new ProviderGateway(providers);
    const first = await classifyRoute(gateway, { provider: "openai", model: "x" }, "Jaki jest termin na zażalenie?", []);
    const again = await classifyRoute(gateway, { provider: "openai", model: "x" }, "Jaki jest termin na zażalenie?", []);
    expect(first.choice).toEqual({ form: "PROSTA", skill: null });
    expect(again.cached).toBe(true);
    expect(asked).toBe(1);
    const failing = new ProviderRegistry();
    failing.register({ id: "openai", label: "x", capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false }, async stream() { throw new Error("timeout"); } });
    expect((await classifyRoute(new ProviderGateway(failing), { provider: "openai", model: "x" }, "Czy mogę złożyć sprzeciw?", [])).choice).toBeNull();
  });

  it("in a turn: the model's answer decides and both proposals are recorded", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(request) {
        calls.push(request);
        return { fullText: request.systemPrompt.startsWith("Jesteś klasyfikatorem") ? '{"form":"PROSTA","skill":null}' : "Odpowiedź symulowana." };
      }
    });
    const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers)).execute({
      query: "Użytkownik: Czy powinienem złożyć pismo procesowe w sprawie o zapłatę wynagrodzenia?",
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-04-prawo-pracy-zus-swiadczenia",
      modelSelectsSkills: true,
      mode: "PRAWNIK"
    } as never);
    expect(calls.filter((call) => call.systemPrompt.startsWith("Jesteś klasyfikatorem"))).toHaveLength(1);
    const gate = (result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? []).find((event) => event.target === "ROUTING_CLASSIFIER");
    expect(String(gate?.detail?.detail)).toMatch(/reason=nazwa pisma[^;]*;patterns=[^;]+;model=PROSTA/u);
    const main = calls.filter((call) => !call.systemPrompt.startsWith("Jesteś klasyfikatorem")).map((call) => call.systemPrompt).join("\n");
    expect(main).not.toContain("SKILL WYKONAWCZY WG ROUTERA: pisma-procesowe-v3");
  }, 60_000);

  it("the share of ambiguous questions in the routing set is small (extra call only there)", () => {
    const read = (file: string) => fs.readFileSync(path.join(CORPUS, file), "utf8");
    const routes = parseRoutingTable(read("prawny-router-v3/SKILL.md"));
    const matrix = parseActivationMatrix(read("shared/ACTIVATION-MATRIX.md"));
    const redaction = parseRedactionTest(read("pisma-procesowe-v3/SKILL.md"));
    const simple = { skill: "pisma-proste-v2", entries: schemaCatalog(registry, "pisma-proste-v2") };
    const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "routing-domains-500.json"), "utf8")) as Array<{ q: string }>;
    const ambiguous = cases.filter((item) =>
      routeAmbiguity({ question: item.q, decided: decideTask(routes, matrix, item.q, [], redaction, simple)?.primary ?? null, wordsOnly: null, simpleForm: simpleFormQuestion(item.q) })
    );
    // Measured 2026-11-24: 34 of 500 (6,8%); the classifier runs for these only.
    expect(ambiguous.length / cases.length).toBeLessThan(0.15);
  });
});
