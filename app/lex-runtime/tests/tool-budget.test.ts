import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { NormalizedToolResult } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SESSION_EXECUTION_INTERNAL, SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

afterEach(() => {
  delete process.env.LEX_TOOL_CALL_BUDGET;
  delete process.env.LEX_TOOL_BROKER_MODE;
});

async function run(): Promise<{ results: NormalizedToolResult[]; events: Array<{ target: string; status: string }> }> {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  let results: NormalizedToolResult[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "budget",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      const calls = Array.from({ length: 5 }, (_value, index) => ({ id: `c${index}`, name: "no_such_tool", input: {} }));
      results = (await received.runTools?.(calls)) ?? [];
      return { fullText: "Odpowiedź." };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
  const result = await executor.execute({
    query: "Czy sąsiad odpowiada za szkodę wyrządzoną przez psa?",
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
    modelSelectsSkills: true,
    mode: "PRAWNIK"
  });
  const events = result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? [];
  return { results, events: events.map((event) => ({ target: event.target, status: event.status })) };
}

describe("tool call budget per turn", () => {
  it("refuses the calls over the limit and records it", async () => {
    process.env.LEX_TOOL_CALL_BUDGET = "3";
    const { results, events } = await run();
    const statuses = results.map((result) => JSON.parse(result.content).error);
    expect(statuses).toEqual(["UNKNOWN_RUNTIME_TOOL", "UNKNOWN_RUNTIME_TOOL", "UNKNOWN_RUNTIME_TOOL", "TOOL_CALL_BUDGET_EXCEEDED", "TOOL_CALL_BUDGET_EXCEEDED"]);
    expect(events).toContainEqual({ target: "TOOL_CALL_BUDGET", status: "BLOCKED" });
  }, 60_000);

  it("only records in audit mode", async () => {
    process.env.LEX_TOOL_CALL_BUDGET = "3";
    process.env.LEX_TOOL_BROKER_MODE = "audit";
    const { results, events } = await run();
    expect(results.every((result) => JSON.parse(result.content).error === "UNKNOWN_RUNTIME_TOOL")).toBe(true);
    expect(events).toContainEqual({ target: "TOOL_CALL_BUDGET", status: "DEGRADED" });
  }, 60_000);
});
