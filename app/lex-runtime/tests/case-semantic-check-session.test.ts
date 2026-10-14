import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEMANTIC_JUDGE_SYSTEM } from "../src/case-semantic-check.js";
import { LegalFederationToolRuntime } from "../src/legal-federation-tool-runtime.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { NormalizedToolCall, NormalizedToolResult, ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SESSION_EXECUTION_INTERNAL, SafeSessionExecutor } from "../src/session-executor.js";

// Sygnatura bez "sygn.": G8 (rejestr weryfikacji SN) nie jest tu przedmiotem testu.
// Słowa się zgadzają (kontrola leksykalna przechodzi), sens nie: odpowiedź przypisuje uchwale
// tezę odwrotną. Ten sam podpięty model, w osobnym kontekście, ocenia i cytuje tekst uchwały.
const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();
const SN = JSON.stringify({
  sygnatura: "I KZP 3/24",
  tresc: "Udział w składzie sądu neosędziów nie powoduje automatycznie nieważności orzeczenia; konieczna jest ocena okoliczności konkretnej sprawy."
});
class SnOnly extends LegalFederationToolRuntime {
  override async runTools(calls: NormalizedToolCall[]): Promise<NormalizedToolResult[]> {
    return calls.map((call) => ({ tool_use_id: call.id, content: SN }));
  }
}
const WRONG = "Uchwała SN I KZP 3/24 (siedmiu sędziów): każde orzeczenie wydane z udziałem neosędziów jest nieważne.";
const RIGHT = "Uchwała SN I KZP 3/24 (siedmiu sędziów): udział neosędziów nie powoduje automatycznie nieważności orzeczenia; decyduje ocena okoliczności sprawy.";
const verdict = (claim: string, quote: string) =>
  JSON.stringify({ verdicts: [{ signature: "I KZP 3/24", topic: "MATCH", claim, reason: claim === "SUPPORTED" ? "Zgodne z uchwałą." : "Uchwała stwierdza odwrotnie.", quote }] });

async function run(options: { correction: string; secondVerdict: string; firstQuote?: string }) {
  const calls: ProviderStreamParams[] = [];
  const judged: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "semantic",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      if (String(received.systemPrompt).startsWith(SEMANTIC_JUDGE_SYSTEM)) {
        judged.push(received);
        return { fullText: judged.length === 1 ? verdict("UNSUPPORTED", options.firstQuote ?? "nie powoduje automatycznie nieważności orzeczenia") : options.secondVerdict };
      }
      calls.push(received);
      if (calls.length === 1) {
        await received.runTools?.([{ id: "s1", name: "get_federated_legal_document", input: { source: "sn", documentId: "r10zSJcBZvGrB8P_BYpV" } }]);
        return { fullText: WRONG };
      }
      return { fullText: String(received.messages.at(-1)?.content).startsWith("KONTROLA ZGODNOŚCI Z PYTANIEM") ? options.correction : WRONG };
    }
  });
  const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, undefined, undefined, new SnOnly()).execute({
    query: "Na SN wyszukaj orzeczenia dotyczącego neosędziów",
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa",
    modelSelectsSkills: true,
    mode: "LAIK"
  } as never);
  const gate = (result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? []).find((event) => event.target === "CASE_SEMANTIC_CHECK");
  return { result, calls, judged, gate };
}

describe("semantic check of a cited judgment in a turn", () => {
  it("the connected model judges in a clean context; the correction replaces the reversed thesis", async () => {
    const { result, calls, judged, gate } = await run({ correction: RIGHT, secondVerdict: verdict("SUPPORTED", "konieczna jest ocena okoliczności konkretnej sprawy") });
    expect(judged).toHaveLength(2);
    expect(judged[0]!.model).toBe("account/openai/default");
    expect(judged[0]!.tools ?? []).toEqual([]);
    expect(String(judged[0]!.messages[0]!.content)).toContain("CO ODPOWIEDŹ MÓWI O NIM:\nUchwała SN I KZP 3/24 (siedmiu sędziów): każde orzeczenie");
    const correction = calls.find((call) => String(call.messages.at(-1)?.content).startsWith("KONTROLA ZGODNOŚCI Z PYTANIEM"));
    expect(String(correction?.messages.at(-1)?.content)).toContain("Tekst dokumentu: „nie powoduje automatycznie nieważności orzeczenia”");
    expect(result.answer).toContain("nie powoduje automatycznie nieważności");
    expect(result.answer).not.toContain("Kontrola aplikacji");
    expect(gate?.status).toBe("OK");
  }, 60_000);

  it("the user is warned when the corrected answer still misstates the judgment", async () => {
    const { result, gate } = await run({ correction: WRONG, secondVerdict: verdict("UNSUPPORTED", "nie powoduje automatycznie nieważności orzeczenia") });
    expect(result.answer).toContain("⚠️ Kontrola aplikacji: I KZP 3/24 dotyczy pytania; opis w odpowiedzi nie w pełni wynika z jego tekstu.");
    expect(gate?.status).toBe("DEGRADED");
  }, 60_000);

  it("a judge's quote that is not in the document starts no correction", async () => {
    const { result, calls, gate } = await run({ correction: RIGHT, secondVerdict: "", firstQuote: "uchwała dotyczy przedawnienia roszczeń" });
    expect(calls.some((call) => String(call.messages.at(-1)?.content).startsWith("KONTROLA ZGODNOŚCI Z PYTANIEM"))).toBe(false);
    expect(result.answer).toContain("każde orzeczenie wydane z udziałem neosędziów");
    expect(gate?.status).toBe("OK");
  }, 60_000);
});
