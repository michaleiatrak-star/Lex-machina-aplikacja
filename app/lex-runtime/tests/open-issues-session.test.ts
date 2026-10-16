import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import type { VerificationLedger } from "../src/verification-ledger.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

describe("kwestie otwarte sprawy w kolejnej turze", () => {
  it("przepis niezweryfikowany wcześniej idzie do weryfikacji przed odpowiedzią modelu, a wynik trafia do promptu", async () => {
    const verified: string[] = [];
    let modelSawCalls = -1;
    const verification = ((ledger: VerificationLedger) => ({
      schemas: () => [],
      systemPromptAppendix: () => "",
      auditEvents: () => [],
      async runTools(calls: Array<{ id: string; input: { claim: string; kind: "statute" } }>) {
        for (const call of calls) {
          verified.push(call.input.claim);
          ledger.add({ claim: call.input.claim, kind: "statute", status: "VERIFIED", sourceUrl: "https://eli.gov.pl/test", sourceTier: "R1", fetchedAt: "2026-10-16T10:00:00Z" } as never);
        }
        return calls.map((call) => ({ tool_use_id: call.id, content: "{}" }));
      }
    })) as never;
    const prompts: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "mechanical",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        prompts.push(received);
        modelSawCalls = verified.length;
        return { fullText: "Termin na odpowiedź wynosi 30 dni." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
    await executor.execute({
      query: "Jaki jest termin na odpowiedź na reklamację?",
      openIssueClaims: ["art. 410 § 2 k.c."],
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
      mode: "PRAWNIK"
    } as never);
    expect(verified.length).toBeGreaterThan(0);
    expect(modelSawCalls).toBeGreaterThan(0);
    expect(prompts[0]!.systemPrompt).toContain("Kwestie otwarte sprawy sprawdzone przez aplikację");
    expect(prompts[0]!.systemPrompt).toMatch(/art\. 410 § 2 KC: VERIFIED/u);
  });
});
