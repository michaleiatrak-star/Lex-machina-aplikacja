import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEMANTIC_JUDGE_SYSTEM } from "../src/case-semantic-check.js";
import { LegalFederationToolRuntime } from "../src/legal-federation-tool-runtime.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { NormalizedToolCall, NormalizedToolResult, ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SESSION_EXECUTION_INTERNAL, SafeSessionExecutor } from "../src/session-executor.js";

// Wersja 0.1.27: CBOSA zwróciła II SAB/Po 175/26 (informacja publiczna), model opisał go jako
// orzeczenie o halucynacjach AI. Teraz runda korekty, a gdy model się nie poprawi — ostrzeżenie.
const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const CBOSA = JSON.stringify({
  sygnatura: "II SAB/Po 175/26",
  hasla: "Informacja publiczna; Bezczynność organu",
  tresc: "Sprawa ze skargi na bezczynność Burmistrza Miasta i Gminy w przedmiocie udostępnienia informacji publicznej."
});

class CbosaOnly extends LegalFederationToolRuntime {
  override async runTools(calls: NormalizedToolCall[]): Promise<NormalizedToolResult[]> {
    return calls.map((call) => ({ tool_use_id: call.id, content: CBOSA }));
  }
}

const FABRICATED =
  "WSA w Poznaniu, wyrok z 16 września 2026 r., sygn. II SAB/Po 175/26.\n\nSąd uznał, że pisma mogły być przygotowane z pomocą AI, a powołane orzeczenia były halucynacjami.";
const HONEST =
  "Nie znalazłem polskiego orzeczenia o halucynacjach AI pełnomocnika. Pobrany wyrok WSA w Poznaniu, sygn. II SAB/Po 175/26, dotyczy bezczynności burmistrza w udostępnieniu informacji publicznej.";

async function run(correction: string) {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "grounding",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      if (calls.length === 1) {
        await received.runTools?.([{ id: "g1", name: "get_federated_legal_document", input: { source: "cbosa", documentId: "88E37DB76C" } }]);
        return { fullText: FABRICATED + "\n\n⚖️ Informacja ma charakter edukacyjny i nie stanowi porady prawnej." };
      }
      return { fullText: correction + "\n\n⚖️ Informacja ma charakter edukacyjny i nie stanowi porady prawnej." };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, undefined, undefined, new CbosaOnly());
  const result = await executor.execute({
    query: "Znajdź polski wyrok innego sądu niż SN dotyczący użycia AI i jego halucynacji przez prawnika",
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
    modelSelectsSkills: true,
    mode: "LAIK"
  } as never);
  const gate = (result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? []).find((event) => event.target === "CASE_CONTENT_GROUNDING");
  return { result, calls, gate };
}

describe("case content grounding in a turn", () => {
  it("a correcting round replaces the fabricated description", async () => {
    const { result, calls, gate } = await run(HONEST);
    // The semantic judge (a separate call) is not part of the answer's calls.
    const answerCalls = calls.filter((call) => call.systemPrompt !== SEMANTIC_JUDGE_SYSTEM);
    expect(answerCalls).toHaveLength(2);
    expect(String(answerCalls[1]!.messages.at(-1)?.content)).toContain("sygn. II SAB/Po 175/26: w pobranym tekście nie ma: AI");
    expect(result.answer).toContain("dotyczy bezczynności burmistrza");
    expect(result.answer).not.toContain("Kontrola aplikacji");
    // 0.1.27: the model's shortened disclaimer stayed; the canonical LAIK text replaces it.
    expect(result.answer).not.toContain("Informacja ma charakter edukacyjny");
    expect(result.answer).toContain("Niniejsza analiza ma charakter wyłącznie informacyjny");
    expect(gate?.status).toBe("OK");
  }, 60_000);

  it("the user is warned when the model keeps the fabricated description", async () => {
    const { result, gate } = await run(FABRICATED);
    expect(result.answer).toContain("⚠️ Kontrola aplikacji: w tekście orzeczenia sygn. II SAB/Po 175/26");
    expect(gate?.status).toBe("DEGRADED");
    // The canonical disclaimer (shared/DISCLAIMER.md) stays the last element, after the warning.
    const answer = result.answer ?? "";
    expect(answer.indexOf("Kontrola aplikacji")).toBeGreaterThan(-1);
    expect(answer.indexOf("Kontrola aplikacji")).toBeLessThan(answer.indexOf("Niniejsza analiza ma charakter"));
  }, 60_000);
});
