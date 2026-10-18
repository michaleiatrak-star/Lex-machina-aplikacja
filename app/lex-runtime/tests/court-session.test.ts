import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const recorded = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/courts/gugik-recorded-2026-10-17.json"), "utf8")) as { responses: Record<string, string> };

afterEach(() => {
  vi.unstubAllGlobals();
});

function session(letterCourt: string) {
  const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
  registry.scan();
  const calls: ProviderStreamParams[] = [];
  const toolResults: string[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "court",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      // The model sees the address as a token only, and asks the application for its court.
      const token = /\[PII:ADDRESS:\d{4}\]/u.exec(received.messages.map((message) => message.content).join("\n"))?.[0];
      if (token && received.runTools) {
        const results = await received.runTools([{ id: "c1", name: "court_for_address", input: { address: token, basis: "pozwany, art. 27 § 1 KPC", kind: "cywilne" } }]);
        toolResults.push(...results.map((result) => result.content));
      }
      return {
        fullText: [
          "=== PISMO ===",
          "Wyszków, 17 października 2026 r.",
          "",
          letterCourt,
          "I Wydział Cywilny",
          "",
          "WNIOSEK O ZWOLNIENIE OD KOSZTÓW SĄDOWYCH",
          "Wnoszę o zwolnienie od kosztów sądowych w całości.",
          "=== KONIEC PISMA ==="
        ].join("\n")
      };
    }
  });
  return { executor: new SafeSessionExecutor(registry, new ProviderGateway(providers)), calls, toolResults };
}

const query = "Napisz wniosek o przywrócenie terminu w sprawie przeciwko Janowi Kowalskiemu, zam. ul. Tadeusza Kościuszki 50, 07-200 Wyszków.";

describe("the court of a letter in a session", () => {
  it("the model gets a token, the application its court; a letter to that court passes", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const body = recorded.responses[url];
      return new Response(body ?? "", { status: body === undefined ? 404 : 200 });
    });
    const { executor, calls, toolResults } = session("Sąd Rejonowy w Wyszkowie");
    const result = await executor.execute({ query, provider: "openai", model: "gpt-test", primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze", mode: "PRAWNIK" } as never);
    const sent = calls.map((call) => [call.systemPrompt, ...call.messages.map((message) => message.content)].join("\n")).join("\n");
    expect(sent).not.toContain("Kościuszki 50");
    expect(calls[0]!.tools?.some((tool) => tool.function.name === "court_for_address")).toBe(true);
    expect(sent).toContain("# SĄD WŁAŚCIWY (aplikacja)");
    expect(JSON.parse(toolResults[0]!)).toMatchObject({ status: "FOUND", sr: { nazwa: "Sąd Rejonowy w Wyszkowie" } });
    expect(toolResults[0]).not.toContain("Tadeusza Kościuszki 50");
    expect(result.courtsFound).toContain("Sąd Rejonowy w Wyszkowie");
    expect(result.courtCheck).toBeUndefined();
  }, 120_000);

  it("a letter to a court the application did not give is marked", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const body = recorded.responses[url];
      return new Response(body ?? "", { status: body === undefined ? 404 : 200 });
    });
    const { executor } = session("Sąd Rejonowy w Ostrołęce");
    const result = await executor.execute({ query, provider: "openai", model: "gpt-test", primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze", mode: "PRAWNIK" } as never);
    // The fake model's text does not pass the workflow gates (BLOCKED): the check itself is
    // what is tested; a presentable answer carries the note "[SĄD DO SPRAWDZENIA: …]".
    expect(result.courtCheck).toEqual({ unverified: ["Sąd Rejonowy w Ostrołęce"] });
  }, 120_000);

  it("the case's court from its memory: in the prompt, and a letter to it passes without the tool", async () => {
    const { executor, calls } = session("Sąd Rejonowy dla Krakowa-Podgórza w Krakowie");
    const result = await executor.execute({
      query: "Napisz wniosek o przywrócenie terminu w tej sprawie.",
      provider: "openai",
      model: "gpt-test",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK",
      caseCourt: { nazwa: "Sąd Rejonowy dla Krakowa-Podgórza w Krakowie", wydzial: "I Wydział Cywilny", sygnatura: "I C 1234/26", zrodlo: "AKTA", at: "2026-10-17T00:00:00.000Z" }
    } as never);
    expect(calls[0]!.systemPrompt).toContain("# SĄD SPRAWY (rejestr aplikacji)");
    expect(calls[0]!.systemPrompt).toContain("Sąd Rejonowy dla Krakowa-Podgórza w Krakowie, I Wydział Cywilny, ul. Przy Rondzie 7, 31-547 Kraków; sygn. akt I C 1234/26");
    expect(result.courtCheck).toBeUndefined();
  }, 120_000);
});
