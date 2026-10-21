import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

// A skill that works on documents, pinned without any: the application asks for the material
// itself, without the model (the probe of 2026-10-21: the request depended on the model).
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

async function turn(skill: string, query: string, extra: Record<string, unknown>) {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "material",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: "Analiza umowy.\n\n[CZEKAM NA ODPOWIEDŹ]" };
    }
  });
  const result = await new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification).execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual: [skill], caseType: [skill] })}\n${query}`,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
    mode: "PRAWNIK",
    ...extra
  } as never);
  return { result, calls };
}

const contract = { contractWorkflowContext: { mode: "ANALYSIS", stage: "INTAKE", checkpoint: "AU-F0" } };
const contractDoc = {
  ...contract,
  documentAttachments: [{ documentId: "doc_u", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "UMOWA NAJMU. § 1. Wynajmujący oddaje najemcy lokal." }] }]
};

describe("material gate", () => {
  it("asks for the contract without a model call when nothing is attached", async () => {
    const { result, calls } = await turn("analizator-umow-v1", "Przeanalizuj tę umowę najmu pod kątem ryzyk.", contract);
    expect(calls).toHaveLength(0);
    expect(result.answer).toContain("Do tej pracy potrzebny jest materiał: umowa");
    expect(result.waitingForUser).toBe(true);
  }, 120_000);

  it.each([
    ["analiza-sadowa-v6", "Oceń wyrok sądu pierwszej instancji i szanse apelacji.", { courtWorkflowContext: { stage: "EVIDENCE_SCAN", checkpoint: "SD_VER_COMPLETE" } }],
    ["chronologia-sprawy-v1", "Zrób chronologię sprawy.", { chronologyWorkflowContext: { stage: "INVENTORY", checkpoint: "DOCUMENT_INVENTORY_COMPLETE", temporalGateRequired: true } }],
    ["przesluchanie-swiadkow-v2-min90", "Przygotuj pytania do świadka.", { orderedCaseWorkflowContext: { workflowId: "WITNESS_QUESTIONING_V1", checkpoint: "W1-INTAKE", revision: 4 } }]
  ] as const)("%s without material: the application's question", async (skill, query, extra) => {
    const { result, calls } = await turn(skill, query, extra);
    expect(calls).toHaveLength(0);
    expect(result.answer).toContain("Do tej pracy potrzebny jest materiał");
  }, 120_000);

  it("calls the model when the contract is attached, pasted, or the skill drafts a new one", async () => {
    expect((await turn("analizator-umow-v1", "Przeanalizuj tę umowę najmu.", contractDoc)).calls.length).toBeGreaterThan(0);
    const pasted = `Przeanalizuj umowę:\n${"§ 1. Wynajmujący oddaje najemcy lokal mieszkalny do używania. ".repeat(30)}`;
    expect((await turn("analizator-umow-v1", pasted, contract)).calls.length).toBeGreaterThan(0);
    const draft = { contractWorkflowContext: { mode: "DRAFT", stage: "INTAKE", checkpoint: "AU-F0" } };
    expect((await turn("analizator-umow-v1", "Napisz umowę najmu lokalu.", draft)).calls.length).toBeGreaterThan(0);
  }, 240_000);

  it("leaves skills that need no material alone", async () => {
    expect((await turn("pisma-proste-v2", "Napisz wezwanie do zapłaty 5 000 zł.", {})).calls.length).toBeGreaterThan(0);
  }, 120_000);
});
