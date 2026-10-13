import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor, type SessionExecutionResponse } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

// Every executive skill of the mechanical mode, first turn and a later checkpoint
// ("Kontynuuj."): the model asks the user for missing facts. Before, the court, report and
// letter workflows blocked such an answer or ran a correction round over it.

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
const DOC = "PROTOKÓŁ z 12.06.2026. Świadek Jan Nowak widział zdarzenie 3.05.2026 r. Umowa pożyczki 40 000 zł, zwrot do 3.09.2026 r.";
type Sc = { skill: string; q: string; ctx: Record<string, unknown>[] };
const SC: Sc[] = [
  { skill: "analiza-sadowa-v6", q: "Przeanalizuj akta sprawy o zapłatę 40 000 zł z umowy pożyczki.", ctx: [{ courtWorkflowContext: { stage: "EVIDENCE_SCAN", checkpoint: "SD_VER_COMPLETE" } }, { courtWorkflowContext: { stage: "PASS_II_LAW", checkpoint: "PASS_II_SOURCES_VERIFIED" } }] },
  { skill: "chronologia-sprawy-v1", q: "Ułóż chronologię sprawy pożyczki.", ctx: [{ chronologyWorkflowContext: { stage: "INVENTORY", checkpoint: "DOCUMENT_INVENTORY_COMPLETE", temporalGateRequired: true } }, { chronologyWorkflowContext: { stage: "EXTRACTION", checkpoint: "EVENT_EXTRACTION_COMPLETE", temporalGateRequired: true } }] },
  { skill: "analizator-dowodow-v3", q: "Oceń dowody w sprawie pożyczki.", ctx: [{ orderedCaseWorkflowContext: { workflowId: "EVIDENCE_ANALYSIS_V1", checkpoint: "AD-KROK1-INTAKE", revision: 3 } }, { orderedCaseWorkflowContext: { workflowId: "EVIDENCE_ANALYSIS_V1", checkpoint: "AD-KROK3-WYKONANIE", revision: 8 } }] },
  { skill: "przesluchanie-swiadkow-v2-min90", q: "Przygotuj przesłuchanie świadka Jana Nowaka.", ctx: [{ orderedCaseWorkflowContext: { workflowId: "WITNESS_QUESTIONING_V1", checkpoint: "W1-INTAKE", revision: 4 } }, { orderedCaseWorkflowContext: { workflowId: "WITNESS_QUESTIONING_V1", checkpoint: "W3-QUESTIONS", revision: 7 } }] },
  { skill: "analizator-umow-v1", q: "Przeanalizuj umowę pożyczki.", ctx: [{ contractWorkflowContext: { mode: "ANALYSIS", stage: "INTAKE", checkpoint: "AU-F0" } }, { contractWorkflowContext: { mode: "ANALYSIS", stage: "ANALYSIS", checkpoint: "AU-B" } }] },
  { skill: "pisma-procesowe-v3", q: "Przygotuj pozew o zapłatę 40 000 zł z umowy pożyczki.", ctx: [{ processWorkflowContext: { stage: "W1", checkpoint: "CP-1a", mode: "CHECKPOINT" } }, { processWorkflowContext: { stage: "W2", checkpoint: "CP-ATAK", mode: "CHECKPOINT" } }] },
  { skill: "pisma-proste-v2", q: "Przygotuj wezwanie do zapłaty 40 000 zł z umowy pożyczki.", ctx: [{}, {}] },
  { skill: "analizator-przepisow-v2", q: "Przeanalizuj art. 720 KC — przesłanki umowy pożyczki.", ctx: [{}, {}] },
  { skill: "orzeczenia-sadowe-v2", q: "Znajdź orzecznictwo SN o wymagalności zwrotu pożyczki bez terminu.", ctx: [{}, {}] },
  { skill: "raport-sytuacyjny-v2", q: "Przygotuj raport sytuacyjny sprawy pożyczki.", ctx: [{}, {}] },
  { skill: "raport-klienta-v1", q: "Przygotuj raport dla klienta w sprawie pożyczki.", ctx: [{}, {}] }
];
const QUESTION = "Podaj datę doręczenia wezwania do zwrotu pożyczki.\n\n=== CZEKAM NA ODPOWIEDŹ ===";

async function turn(sc: Sc, index: number): Promise<{ result: SessionExecutionResponse; calls: ProviderStreamParams[] }> {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "mechanical",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: QUESTION };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
  const query = index === 0 ? sc.q : `Użytkownik: ${sc.q}\n\nAsystent: Punkt zakończony.\n\nUżytkownik: Kontynuuj.`;
  const result = await executor.execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify({ auto: false, manual: [sc.skill], caseType: [sc.skill] })}\n${query}`,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
    mode: "PRAWNIK",
    ...sc.ctx[index],
    documentAttachments: [{ documentId: "doc_a", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: DOC }] }]
  } as never);
  return { result, calls };
}

describe("mechanical mode, every executive skill: a turn that asks the user", () => {
  for (const sc of SC) {
    it(`${sc.skill}: presented in one call, flagged, marker removed; executive SKILL.md once; stable cached part`, async () => {
      const prefixes: string[] = [];
      for (const index of [0, 1]) {
        const { result, calls } = await turn(sc, index);
        expect(result.status).toBe("DRAFT_PRESENTABLE");
        expect(result.waitingForUser).toBe(true);
        expect(result.answer ?? "").toContain("Podaj datę doręczenia");
        expect(result.answer ?? "").not.toContain("CZEKAM NA ODPOWIEDŹ");
        expect(calls).toHaveLength(1);
        const prompt = calls[0]!.systemPrompt;
        expect(prompt.split(`# SKILL WYKONAWCZY: ${sc.skill}`).length - 1).toBe(1);
        expect(prompt).toContain("=== CZEKAM NA ODPOWIEDŹ ===");
        if (calls[0]!.systemPromptCachePrefix) prefixes.push(prompt.slice(0, calls[0]!.systemPromptCachePrefix));
      }
      if (prefixes.length === 2) expect(prefixes[0]).toBe(prefixes[1]);
    }, 120_000);
  }
});
