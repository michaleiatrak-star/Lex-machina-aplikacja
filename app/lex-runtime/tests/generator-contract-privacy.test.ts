import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCUMENT_OUTPUT_CONTRACT_HEADING } from "../src/document-output-contract.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";

// E2E 2026-10-21: the document generator's contract went through the chat's recognizers with
// the user's text; "PII ALIAS" became [PII:PERSON:...] in the model's instructions.
const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const verification = (() => ({
  schemas: () => [],
  systemPromptAppendix: () => "",
  auditEvents: () => [],
  async runTools(calls: Array<{ id: string }>) {
    return calls.map((call) => ({ tool_use_id: call.id, content: "{}" }));
  }
})) as never;
// Marks every capitalised two-word run as a person, as the gazetteer did with "PII ALIAS".
const greedy = {
  async recognize(text: string) {
    return [...text.matchAll(/\b(?:Jan Kowalski|PII ALIAS)\b/gu)].map((match) => ({
      start: match.index!,
      end: match.index! + match[0].length,
      kind: "PERSON" as const,
      value: match[0],
      confidence: 0.9,
      source: "AUTO" as const
    }));
  }
};

describe("document generator's contract", () => {
  it("reaches the model as written; the user's text before it is pseudonymized", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "contract",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: "WEZWANIE DO ZAPŁATY" };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification, greedy as never);
    await executor
      .execute({
        query: `Napisz wezwanie do zapłaty dla Jan Kowalski.\n\n${DOCUMENT_OUTPUT_CONTRACT_HEADING}\nUse only aliases.\n\n# PROVIDER-SAFE PII ALIAS MAP\n(no aliases available)`,
        provider: "openai",
        model: "account/openai/default",
        primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
        mode: "PRAWNIK"
      } as never)
      .catch(() => undefined);
    const sent = JSON.stringify(calls[0]?.messages ?? []);
    expect(sent).toContain("# PROVIDER-SAFE PII ALIAS MAP");
    expect(sent).not.toContain("Jan Kowalski");
  }, 120_000);
});
