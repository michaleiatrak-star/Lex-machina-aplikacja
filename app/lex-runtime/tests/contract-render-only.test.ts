import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SESSION_EXECUTION_INTERNAL, SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

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
      return { fullText: '{"schemaVersion":"1","documentType":"contract","locale":"pl-PL","styleProfile":"lex-classic-clean-v1","blocks":[{"type":"heading","level":1,"content":[{"type":"text","text":"UMOWA POŻYCZKI"}]}]}' };
    }
  });
  return { calls, executor: new SafeSessionExecutor(registry, new ProviderGateway(providers)) };
}

const request = {
  query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual: ["analizator-umow-v1"], caseType: ["analizator-umow-v1"] })}\nUżytkownik: Przygotuj projekt umowy pożyczki.\n\nAsystent: UMOWA POŻYCZKI\n\nUżytkownik: Przygotuj plik .docx z umową z ostatniej odpowiedzi Asystenta.`,
  provider: "openai",
  model: "gpt-test",
  primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
  mode: "PRAWNIK",
  documentAstOutput: true
} as const;

describe("contract file rendered after its pipeline (E2E AU2: HTTP 422 before)", () => {
  it("still refuses a contract session without the pipeline's state", async () => {
    const current = executor();
    await expect(current.executor.execute({ ...request } as never)).rejects.toThrow("Persisted contract-analysis context is required.");
    expect(current.calls).toHaveLength(0);
  }, 30_000);

  it("renders the file of a drafted contract (AU-HYBRID and AU-STRIP checked by the route)", async () => {
    const current = executor();
    const result: any = await current.executor.execute({ ...request, contractRenderOnly: true } as never);
    expect(current.calls.length).toBeGreaterThan(0);
    const events: Array<{ target: string; status: string }> = result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? [];
    expect(events.find((event) => event.target === "G39I_CONTRACT_STATE_BINDING")?.status).toBe("OK");
    expect(events.find((event) => event.target === "G39I_WORKFLOW_CONTRACT")?.status).toBe("OK");
  }, 30_000);
});
