import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";
import { escalationOffer, reductionOffer } from "../src/skill-switch.js";

const CORPUS = path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana");
const registry = new LexSkillRegistry(CORPUS);
registry.scan();

const verification = (() => ({
  schemas: () => [],
  systemPromptAppendix: () => "",
  auditEvents: () => [],
  async runTools(calls: Array<{ id: string }>) {
    return calls.map((call) => ({ tool_use_id: call.id, content: "{}" }));
  }
})) as never;

const ESCALATION = [
  "⚠ ESKALACJA DO pisma-procesowe-v3",
  "",
  "Przyczyna: więcej niż jedna podstawa prawna wymagająca analizy (przedawnienie, potrącenie, abuzywność).",
  "Sprawa wymaga wyważenia kilku zarzutów.",
  "Czy przełączyć wątek na pismo procesowe?"
].join("\n");

const REDUCTION = [
  "KROK 0 — Test B: wniosek o nadanie klauzuli wykonalności (art. 781 KPC) — jedno żądanie, jedna podstawa, katalog.",
  "Proponuję przygotować go w pisma-proste-v2 (szybciej, bez etapów W1-W3).",
  "Czy przełączyć na pismo proste?"
].join("\n");

async function turn(skill: string, query: string, reply: string, context: Record<string, unknown> = {}) {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "mechanical",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: reply };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
  const envelope = { auto: false, manual: [skill], caseType: [skill] };
  const result = await executor.execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\n${query}`,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
    mode: "PRAWNIK",
    ...context
  } as never);
  return { result, calls };
}

describe("offers between the letter skills", () => {
  it("M7 escalation message with its reason", () => {
    expect(escalationOffer(ESCALATION)).toEqual({
      from: "pisma-proste-v2",
      to: "pisma-procesowe-v3",
      direction: "ESCALATION",
      reason: "więcej niż jedna podstawa prawna wymagająca analizy (przedawnienie, potrącenie, abuzywność)."
    });
    expect(escalationOffer("TREŚĆ PISMA\nSprzeciw od nakazu zapłaty...")).toBeNull();
    expect(escalationOffer("TREŚĆ PISMA\nSprzeciw...\n\nUWAGI PRAKTYCZNE\nESKALACJA DO pisma-procesowe-v3 nie jest wymagana.\nPrzyczyna: jeden zarzut.")).toBeNull();
    expect(escalationOffer("⚠ ESKALACJA DO pisma-procesowe-v3")).toBeNull();
    // In lay words (live C12-027): the question names the pleading skill and asks to switch.
    expect(escalationOffer("Takie pismo lepiej przygotować w trybie pism złożonych (pisma-procesowe-v3).\n\nCzy przełączyć na pisma-procesowe-v3?")).toMatchObject({
      to: "pisma-procesowe-v3",
      direction: "ESCALATION"
    });
    expect(escalationOffer("Ten tryb (pisma-procesowe-v3) przygotowuje pełne pisma.")).toBeNull();
  });

  it("Test B proposal asked as a question; a passing mention of the skill is not an offer", () => {
    expect(reductionOffer(REDUCTION)?.direction).toBe("REDUCTION");
    expect(reductionOffer("REDUKCJA DO pisma-proste-v2\nPrzyczyna: jedno żądanie.")?.reason).toBe("jedno żądanie.");
    expect(reductionOffer("MOD-ROUTE: pismo proste z katalogu → pisma-proste-v2.\nCzy pozwany kwestionuje odsetki?")).toBeNull();
    expect(reductionOffer("Proponuję pisma-proste-v2.")).toBeNull();
  });
});

describe("mechanical pisma-proste-v2: escalation", () => {
  it("the escalation message is presented as an offer, not blocked as a letter without sections", async () => {
    const { result } = await turn("pisma-proste-v2", "Przygotuj sprzeciw od nakazu zapłaty: roszczenie przedawnione, potrącenie i abuzywna klauzula.", ESCALATION);
    expect(result.status).toBe("DRAFT_PRESENTABLE");
    expect(result.skillSwitch).toMatchObject({ to: "pisma-procesowe-v3", direction: "ESCALATION" });
    expect(result.waitingForUser).toBe(true);
    expect(result.answer ?? "").toContain("ESKALACJA DO pisma-procesowe-v3");
  }, 120_000);

  it("several defences in the user's text: the escalation check is in the checkpoint part", async () => {
    const { calls } = await turn("pisma-proste-v2", "Przygotuj sprzeciw od nakazu zapłaty: roszczenie przedawnione, potrącenie i abuzywna klauzula.", ESCALATION);
    expect(calls[0]!.systemPrompt).toContain("# KONTROLA ESKALACJI (aplikacja)");
    const single = await turn("pisma-proste-v2", "Przygotuj sprzeciw od nakazu zapłaty: roszczenie jest przedawnione.", "TREŚĆ PISMA\n...");
    expect(single.calls[0]!.systemPrompt).not.toContain("# KONTROLA ESKALACJI");
  }, 120_000);
});

describe("mechanical pisma-procesowe-v3: reduction (Test B)", () => {
  it("at CP-1a the proposal is presented and the checkpoint is not corrected or committed", async () => {
    const { result, calls } = await turn("pisma-procesowe-v3", "Potrzebuję wniosku o nadanie klauzuli wykonalności wyrokowi zaocznemu.", REDUCTION, {
      processWorkflowContext: { stage: "W1", checkpoint: "CP-1a", mode: "CHECKPOINT" }
    });
    expect(result.status).toBe("DRAFT_PRESENTABLE");
    expect(result.skillSwitch).toMatchObject({ to: "pisma-proste-v2", direction: "REDUCTION" });
    expect(result.waitingForUser).toBe(true);
    // No correction round asking for CLAIM-VALIDATION.
    expect(calls).toHaveLength(1);
  }, 120_000);

  it("after CP-1a a mention of pisma-proste-v2 is no reduction offer", async () => {
    const { result } = await turn(
      "pisma-procesowe-v3",
      "Przygotuj pozew o zapłatę 48 000 zł z umowy o roboty budowlane.",
      "Projekt pisma.\nProponuję w przyszłości pisma-proste-v2 dla wezwania. Czy zgłaszasz dowód z opinii biegłego?",
      { processWorkflowContext: { stage: "W2", checkpoint: "CP-ATAK", mode: "CHECKPOINT" } }
    );
    expect(result.skillSwitch).toBeUndefined();
  }, 120_000);
});
