import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor, type SessionExecutionResponse } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

// Mechanical mode, the user pinned one skill: a request the activation matrix gives to another
// skill is not dropped (escalation of a pleading asked of the simple letter, a next stage under
// the answer), several pinned skills are not run silently one only, and a chronology's report
// leads to the letter. The model is a stub; the answers stand for what a model writes.
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
const KC = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const DOC = "Umowa pożyczki z 1.03.2026 r. na 40 000 zł, zwrot do 3.09.2026 r. 10.09.2026 wezwanie do zapłaty. 1.10.2026 mail z uznaniem 30 000 zł.";
const PROCESS = { processWorkflowContext: { stage: "W1", checkpoint: "CP-1a", mode: "CHECKPOINT" } };
const WAIT = "Raport.\n\n[CZEKAM NA ODPOWIEDŹ]";
const CHRONOLOGY = ["CHRONOLOGIA SPRAWY", "INWENTARYZACJA DOKUMENTÓW", "OŚ CZASU — WĄTEK", "OŚ CZASU — WIDOK ZBIORCZY", "FAKTY BEZSPORNE", "INDEKS SPRZECZNOŚCI", "ZDARZENIA WYDEDUKOWANE — REJESTR", "LUKI CZASOWE", "ZDARZENIA NIEUSTALONE CHRONOLOGICZNIE", "REKOMENDACJE DO PISMA"]
  .map((heading) => `## ${heading}\ntreść`)
  .join("\n\n");

async function run(manual: string[], q: string, answer: string, extra: Record<string, unknown> = {}, doc = false): Promise<{ result: SessionExecutionResponse; prompt: string }> {
  const prompts: string[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "stub",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      prompts.push(received.systemPrompt);
      return { fullText: answer };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
  const result = await executor.execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual, caseType: manual })}\n${q}`,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: KC,
    mode: "PRAWNIK",
    auxiliaryText: q,
    ...extra,
    ...(doc ? { documentAttachments: [{ documentId: "doc_a", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: DOC }] }] } : {})
  } as never);
  return { result, prompt: prompts[0] ?? "" };
}
const nextSkills = (result: SessionExecutionResponse) => (result.pipelineNext?.choices ?? []).map((choice) => choice.skill);

describe("tryb mechaniczny: współpraca skilli", () => {
  const pozew = "Przygotuj pozew o zapłatę 40 000 zł do sądu okręgowego z wnioskiem o zabezpieczenie.";

  it("pismo proste przypięte, prośba o pozew: eskalacja aplikacji, także gdy model napisze pismo", async () => {
    const letter = "TREŚĆ PISMA\nPOZEW o zapłatę\nUWAGI PRAKTYCZNE\n-\nCO DALEJ\n-\nHYBRID-VALIDATION\nPASS";
    const { result, prompt } = await run(["pisma-proste-v2"], pozew, letter);
    expect(prompt).toContain("# ROZPOZNANIE APLIKACJI: PISMO PROCESOWE (M7-eskalacja)");
    expect(result.skillSwitch).toMatchObject({ from: "pisma-proste-v2", to: "pisma-procesowe-v3", direction: "ESCALATION" });
  }, 120_000);

  it("redukcja zaproponowana przez model: jedna propozycja, bez przycisku tego samego skilla", async () => {
    const { result } = await run(["pisma-procesowe-v3"], "Napisz krótkie wezwanie do zapłaty 500 zł do sąsiada.", "Proponuję pisma-proste-v2 (Test B). Czy przełączyć?\n\n[CZEKAM NA ODPOWIEDŹ]", PROCESS);
    expect(result.skillSwitch).toMatchObject({ direction: "REDUCTION", to: "pisma-proste-v2" });
    expect(nextSkills(result)).not.toContain("pisma-proste-v2");
  }, 120_000);

  it("pozew z umową w aktach: umowa to materiał pisma, nie osobne zadanie", async () => {
    const { result } = await run(["pisma-procesowe-v3"], "Przygotuj pozew o zapłatę na podstawie dokumentów.", WAIT, PROCESS, true);
    expect(nextSkills(result)).not.toContain("analizator-umow-v1");
  }, 120_000);

  it("pismo procesowe i chronologia przypięte: chronologia proponowana, nie pomijana", async () => {
    const { result } = await run(["pisma-procesowe-v3", "chronologia-sprawy-v1"], "Przygotuj pozew o zapłatę na podstawie dokumentów.", WAIT, PROCESS, true);
    expect(nextSkills(result)).toContain("chronologia-sprawy-v1");
  }, 120_000);

  it("raport chronologii zamknięty: kolejny etap to pismo", async () => {
    const { result } = await run(["chronologia-sprawy-v1"], "Ułóż chronologię sprawy pożyczki.", CHRONOLOGY, {
      chronologyWorkflowContext: { stage: "REPORT", checkpoint: "CHRONOLOGY_REPORT_COMPLETE", temporalGateRequired: true }
    }, true);
    expect(nextSkills(result).some((skill) => /^pisma-/u.test(skill))).toBe(true);
  }, 120_000);

  it.each([
    ["analizator-przepisow-v2", "Przeanalizuj art. 415 KC i napisz pozew o odszkodowanie.", {}],
    ["przewodnik-prawny-v2", "Sąsiad nie oddaje 40 000 zł, chcę go pozwać, napisz pozew.", { guideContext: { revision: 1, audience: "LAIK", interactionMode: "GUIDED", rawAnalysis: null, step: "INTAKE", guidedQuestionIndex: 0, pendingIrreversibleAction: null } }]
  ])("%s + prośba o pozew: odpowiada przypięty skill, pismo procesowe jako kolejny etap", async (skill, q, extra) => {
    const { result, prompt } = await run([skill], q, WAIT, extra);
    expect(prompt).toContain(`# SKILL WYKONAWCZY: ${skill}`);
    expect(prompt).toContain("# ROZPOZNANIE APLIKACJI: KOLEJNY ETAP");
    expect(nextSkills(result)[0]).toBe("pisma-procesowe-v3");
  }, 120_000);
});
