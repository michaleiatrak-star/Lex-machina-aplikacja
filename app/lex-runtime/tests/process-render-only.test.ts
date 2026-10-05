import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");

function executor() {
  const registry = new LexSkillRegistry(CORPUS);
  registry.scan();
  const calls: string[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "test",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(request) {
      calls.push(request.systemPrompt);
      return { fullText: '{"schemaVersion":"1","documentType":"pleading","locale":"pl-PL","styleProfile":"lex-classic-clean-v1","blocks":[]}' };
    }
  });
  return { calls, executor: new SafeSessionExecutor(registry, new ProviderGateway(providers)) };
}

const request = {
  query: "Napisz pozew o zapłatę.",
  provider: "openai",
  model: "gpt-test",
  primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
  mode: "PRAWNIK",
  documentAstOutput: true
} as const;

describe("pleading file rendered from the case pipeline", () => {
  it("blocks a pleading file without the pipeline's state", async () => {
    const current = executor();
    await expect(current.executor.execute({ ...request } as never)).rejects.toThrow();
    expect(current.calls).toHaveLength(0);
  });

  it("renders the file when the route confirmed the pipeline (render-only binding)", async () => {
    const current = executor();
    const result: any = await current.executor.execute({ ...request, processRenderOnly: { stage: "W3" } } as never);
    expect(current.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.audit)).not.toContain("PROCESS_STATE_CONTEXT_MISSING");
  });
});
