import path from "node:path";
import { describe, expect, it } from "vitest";
import { orderedCheckpointGaps } from "../src/ordered-checkpoint-contract.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SESSION_EXECUTION_INTERNAL, SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();

describe("the step messages of the evidence and witness skills (task 03)", () => {
  it("names what the skill requires and nothing for a step without a format", () => {
    expect(orderedCheckpointGaps("EVIDENCE_ANALYSIS_V1", "AD-KROK0a-MODE", "Tryb pracy: MODE=B (spór)")).toEqual([]);
    expect(orderedCheckpointGaps("EVIDENCE_ANALYSIS_V1", "AD-KROK0a-MODE", "Ustalono tryb pracy.")).toHaveLength(1);
    expect(orderedCheckpointGaps("EVIDENCE_ANALYSIS_V1", "AD-BLOKH-DIS", "DIS01 — wynagrodzenie. Fakty bezsporne: umowa. art. 22 KP — wymaga weryfikacji w ELI")).toEqual([]);
    expect(orderedCheckpointGaps("EVIDENCE_ANALYSIS_V1", "AD-KROK3-WYKONANIE", "cokolwiek")).toEqual([]);
    expect(orderedCheckpointGaps("WITNESS_QUESTIONING_V1", "CHECKPOINT-W2", "ŚWIADEK: S1\nTYP: 1\nSCORING W2: 6/10\nMODEL: LEJEK")).toEqual(["LUKI DOWODOWE", "CHRONOLOGIA ZDARZEŃ"]);
    expect(orderedCheckpointGaps("WITNESS_QUESTIONING_V1", "W1-INTAKE", "dane świadka")).toEqual([]);
  });

  const run = async (answers: string[]) => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(received) {
        calls.push(received);
        return { fullText: answers[Math.min(calls.length - 1, answers.length - 1)]! };
      }
    });
    const verification = (() => ({ schemas: () => [], systemPromptAppendix: () => "", auditEvents: () => [], async runTools(list: Array<{ id: string }>) { return list.map((call) => ({ tool_use_id: call.id, content: "{}" })); } })) as never;
    const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification).execute({
      query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual: ["przesluchanie-swiadkow-v2-min90"], caseType: ["przesluchanie-swiadkow-v2-min90"] })}\nPrzygotuj pytania do świadka.`,
      provider: "openai",
      model: "account/openai/default",
      primarySkill: "dr-04-prawo-pracy-zus-swiadczenia",
      mode: "PRAWNIK",
      orderedCaseWorkflowContext: { workflowId: "WITNESS_QUESTIONING_V1", checkpoint: "CHECKPOINT-W2", revision: 1 },
      documentAttachments: [{ documentId: "doc_p", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "PROTOKÓŁ ROZPRAWY. Świadek zeznał, że koordynował pracę zespołu od marca." }] }]
    } as never);
    const gate = (result[SESSION_EXECUTION_INTERNAL]?.auditEvents ?? []).find((event) => event.target === "ORDERED_CHECKPOINT_CORRECTION");
    return { result, calls, gate };
  };

  const partial = "CHECKPOINT W2\nŚWIADEK: S1\nTYP: 1\nSCORING W2: 6/10 — istotny\nMODEL: LEJEK\nTEZY: T1 — zakres obowiązków. Świadek koordynował pracę zespołu od marca, co potwierdza protokół.";
  const complete = `${partial}\nLUKI DOWODOWE: brak dokumentu zakresu obowiązków.\nCHRONOLOGIA ZDARZEŃ: marzec — początek koordynacji.`;

  it("a missing element: one completing round on the same messages; the completed message is taken", async () => {
    const { result, calls, gate } = await run([partial, complete]);
    expect(String(calls[1]?.messages.at(-1)?.content)).toContain("LUKI DOWODOWE");
    expect(result.answer).toContain("CHRONOLOGIA ZDARZEŃ: marzec");
    expect(gate?.status).toBe("OK");
  }, 120_000);

  it("a shortened rewrite is not taken: the first message stays", async () => {
    const { result, gate } = await run([partial, "LUKI DOWODOWE. CHRONOLOGIA."]);
    expect(result.answer).toContain("Świadek koordynował pracę zespołu od marca");
    expect(gate?.status).toBe("BLOCKED");
  }, 120_000);
});
