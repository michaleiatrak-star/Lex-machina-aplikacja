import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { mechanicalTurn, SafeSessionExecutor, type SessionExecutionResponse } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

// Mechanical mode, each executive skill on its own: the router gives only its mandatory part
// (KROK 2 routing and the domain coverage are a reference, the user chose the skill), while
// its core, gates and self-check, the DR skill and prawo-polskie-v2 stay; no catalog of the
// other skills. AUTO keeps the routing whole.
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
const KK = "dr-03-prawo-karne-wykroczenia-egzekucja";
const KC = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const DOC = "PROTOKÓŁ z 12.06.2026. Świadek Jan Nowak widział zdarzenie 3.05.2026 r. Umowa pożyczki 40 000 zł, zwrot do 3.09.2026 r.";
type Sc = { skill: string; dr: string; q: string; ctx?: Record<string, unknown> };
const SC: Sc[] = [
  { skill: "analizator-przepisow-v2", dr: KK, q: "Zbadaj zmianę treści w artykule 286 kodeksu karnego." },
  { skill: "przewodnik-prawny-v2", dr: KC, q: "Co mam zrobić, gdy pożyczkobiorca nie oddaje 40 000 zł?", ctx: { guideContext: { revision: 1, audience: "LAIK", interactionMode: "GUIDED", rawAnalysis: null, step: "INTAKE", guidedQuestionIndex: 0, pendingIrreversibleAction: null } } },
  { skill: "orzeczenia-sadowe-v2", dr: KC, q: "Znajdź orzecznictwo SN o wymagalności zwrotu pożyczki bez terminu." },
  { skill: "pisma-proste-v2", dr: KC, q: "Przygotuj wezwanie do zapłaty 40 000 zł z umowy pożyczki." },
  { skill: "pisma-procesowe-v3", dr: KC, q: "Przygotuj pozew o zapłatę 40 000 zł z umowy pożyczki.", ctx: { processWorkflowContext: { stage: "W1", checkpoint: "CP-1a", mode: "CHECKPOINT" } } },
  { skill: "analiza-sadowa-v6", dr: KC, q: "Przeanalizuj akta sprawy o zapłatę 40 000 zł z umowy pożyczki.", ctx: { courtWorkflowContext: { stage: "EVIDENCE_SCAN", checkpoint: "SD_VER_COMPLETE" } } },
  { skill: "analizator-dowodow-v3", dr: KC, q: "Oceń dowody w sprawie pożyczki.", ctx: { orderedCaseWorkflowContext: { workflowId: "EVIDENCE_ANALYSIS_V1", checkpoint: "AD-KROK1-INTAKE", revision: 3 } } },
  { skill: "analizator-umow-v1", dr: KC, q: "Przeanalizuj umowę pożyczki.", ctx: { contractWorkflowContext: { mode: "ANALYSIS", stage: "INTAKE", checkpoint: "AU-F0" } } },
  { skill: "chronologia-sprawy-v1", dr: KC, q: "Ułóż chronologię sprawy pożyczki.", ctx: { chronologyWorkflowContext: { stage: "INVENTORY", checkpoint: "DOCUMENT_INVENTORY_COMPLETE", temporalGateRequired: true } } },
  { skill: "przesluchanie-swiadkow-v2-min90", dr: KC, q: "Przygotuj przesłuchanie świadka Jana Nowaka.", ctx: { orderedCaseWorkflowContext: { workflowId: "WITNESS_QUESTIONING_V1", checkpoint: "W1-INTAKE", revision: 4 } } },
  { skill: "raport-klienta-v1", dr: KC, q: "Przygotuj raport dla klienta w sprawie pożyczki." },
  { skill: "raport-sytuacyjny-v2", dr: KC, q: "Przygotuj raport sytuacyjny sprawy pożyczki." }
];
const WORKFLOW: Record<string, string> = {
  "analizator-przepisow-v2": "STATUTE_ANALYSIS_V1",
  "przewodnik-prawny-v2": "LEGAL_GUIDE_V1",
  "orzeczenia-sadowe-v2": "CASE_LAW_V1",
  "pisma-proste-v2": "SIMPLE_LETTER_V1",
  "pisma-procesowe-v3": "PROCESS_PLEADING_V1",
  "analiza-sadowa-v6": "COURT_ANALYSIS_V1",
  "analizator-dowodow-v3": "EVIDENCE_ANALYSIS_V1",
  "analizator-umow-v1": "CONTRACT_ANALYSIS_V1",
  "chronologia-sprawy-v1": "CHRONOLOGY_V1",
  "przesluchanie-swiadkow-v2-min90": "WITNESS_QUESTIONING_V1",
  "raport-klienta-v1": "CLIENT_REPORT_V1",
  "raport-sytuacyjny-v2": "SITUATION_REPORT_V1"
};
const ANSWER = "Brak danych do pełnej odpowiedzi. Podaj datę doręczenia wezwania.\n\n[CZEKAM NA ODPOWIEDŹ]";

async function run(sc: Sc, automatic: boolean): Promise<{ result: SessionExecutionResponse; calls: ProviderStreamParams[] }> {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "mechanical",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: ANSWER };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
  const envelope = automatic ? { auto: true, manual: [], caseType: ["AUTO"] } : { auto: false, manual: [sc.skill], caseType: [sc.skill] };
  const result = await executor.execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\n${sc.q}`,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: sc.dr,
    mode: "PRAWNIK",
    ...(automatic ? {} : sc.ctx ?? {}),
    documentAttachments: [{ documentId: "doc_a", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: DOC }] }]
  } as never);
  return { result, calls };
}

const ROUTING_REFERENCE = "## KROK 2 — ROUTING [1]–[11] [wykonuje aplikacja: ROUTING]";

describe("tryb mechaniczny: rozpoznanie tury", () => {
  const q = (envelope: object) => `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\nPytanie`;
  it("tylko skill przypięty przez użytkownika; AUTO i routing modelu nie", () => {
    expect(mechanicalTurn({ query: q({ auto: false, manual: ["analizator-przepisow-v2"] }) })).toBe(true);
    expect(mechanicalTurn({ query: q({ auto: true, manual: [] }) })).toBe(false);
    expect(mechanicalTurn({ query: q({ auto: false, manual: ["analizator-przepisow-v2"], modelRouted: true }) })).toBe(false);
    expect(mechanicalTurn({ query: q({ auto: false, manual: ["analizator-przepisow-v2"] }), modelSelectsSkills: true })).toBe(false);
    expect(mechanicalTurn({ query: "Pytanie bez koperty" })).toBe(false);
  });
});

describe("tryb mechaniczny, każdy skill wykonawczy osobno: router tylko w części obowiązkowej", () => {
  for (const sc of SC) {
    it(`${sc.skill}`, async () => {
      const { result, calls } = await run(sc, false);
      expect(result.status).not.toBe("BLOCKED");
      expect(calls.length).toBeGreaterThan(0);
      const prompt = calls[0]!.systemPrompt;
      // The pipeline of the pinned skill (the guide included: type ux-guide, pinned by the user).
      expect(prompt).toContain(`Workflow: ${WORKFLOW[sc.skill]}.`);
      // Router: routing as a reference, mandatory part whole.
      expect(prompt).toContain(ROUTING_REFERENCE);
      expect(prompt).not.toContain("### [9] ANALIZA PRZEPISU");
      expect(prompt).toContain("## ŁADOWANE ZAWSZE — BEZWZGLĘDNIE");
      expect(prompt).toContain("## KROK 5–6 — SEKWENCJA END-TO-END");
      expect(prompt).toContain("## REGUŁY NADRZĘDNE");
      expect(prompt).toContain("SELF-CHECK");
      expect(prompt).toContain("PRAWO-HARDGATE");
      // The answer comes from the executive skill with the DR skill and the Polish-law facade.
      expect(prompt).toContain(`SEMANTIC CONTRACT: ${sc.skill}`);
      expect(prompt).toContain("SEMANTIC CONTRACT: prawo-polskie-v2");
      expect(prompt).toContain(`# SKILL: ${sc.dr}`);
      // No catalog of other skills in the knowledge map.
      expect(prompt).not.toContain("## Pozostałe skille w korpusie");
    }, 120_000);
  }

  it("art. 286 KK w analizatorze przepisów: DR-03, moduł rozdziału XXXV i kwalifikator karny w kontekście", async () => {
    const { calls } = await run(SC[0]!, false);
    const prompt = calls[0]!.systemPrompt;
    expect(prompt).toContain("Przestępstwa przeciwko mieniu — Kodeks karny, rozdział XXXV");
    expect(prompt).toContain("mod-KK-kwalifikator-karnomaterialny");
    expect(prompt).toContain("# SKILL WYKONAWCZY: analizator-przepisow-v2");
  }, 120_000);

  it("AUTO: routing routera w całości (model sam dobiera skill)", async () => {
    const { calls } = await run(SC[0]!, true);
    const prompt = calls[0]!.systemPrompt;
    expect(prompt).not.toContain(ROUTING_REFERENCE);
    expect(prompt).toContain("### [9] ANALIZA PRZEPISU");
  }, 120_000);
});

// The chat guesses the domain from words shared with skill descriptions; "art. 415 KC" or
// "artykule 286 kodeksu karnego" came out as DR-01. In mechanical mode the runtime takes the
// domain from the act the question cites (act maps), then from a routing phrase.
describe("tryb mechaniczny: dziedzina z aktu w pytaniu, nie ze zgadywania czatu", () => {
  const CASES: Array<[string, string, string]> = [
    ["Zbadaj zmianę treści w artykule 286 kodeksu karnego.", "dr-03-", "mod-KK-art278-295"],
    ["Wyjaśnij przesłanki odpowiedzialności z art. 415 KC.", "dr-02-", "mod-KC-cywilne-zobowiazania"],
    ["Czy sprzedaż roweru za 2500 zł jest zwolniona z podatku od czynności cywilnoprawnych (art. 9 pkt 6)?", "dr-06-", "mod-ustawa-PCC"],
    ["Kto płaci opłatę miejscową od 2027 roku?", "dr-06-", "OPŁATA MIEJSCOWA"],
    ["Analiza art. 299 KSH — odpowiedzialność członków zarządu.", "dr-02-", "mod-KSH"],
    ["Jakie terminy załatwienia sprawy wynikają z art. 35 KPA?", "dr-05-", "mod-KPA"],
    ["Przeanalizuj art. 23 ustawy o obszarach morskich RP i administracji morskiej.", "dr-09-", "mod-ustawa-obszary-morskie"]
  ];
  for (const [q, domain, module] of CASES) {
    it(q, async () => {
      // The chat's guess: DR-01 (no word of the question in its descriptions).
      const { calls } = await run({ skill: "analizator-przepisow-v2", dr: "dr-01-ustroj-konstytucyjny-i-zrodla-prawa", q }, false);
      const prompt = calls[0]!.systemPrompt;
      expect([...prompt.matchAll(/# SKILL: (dr-\d\d-[a-z-]+)/gu)].map((m) => m[1])).toContain(
        [...registry.skills.keys()].find((name) => name.startsWith(domain))
      );
      expect(prompt).toContain(module);
    }, 120_000);
  }

  it("dziedzina wybrana przez użytkownika zostaje", async () => {
    const calls: ProviderStreamParams[] = [];
    const providers = new ProviderRegistry();
    providers.register({ id: "openai", label: "m", capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false }, async stream(r) { calls.push(r); return { fullText: ANSWER }; } });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
    const envelope = { auto: false, manual: ["analizator-przepisow-v2", KC], caseType: ["analizator-przepisow-v2"] };
    await executor.execute({ query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\nZbadaj art. 286 KK.`, provider: "openai", model: "account/openai/default", primarySkill: KC, mode: "PRAWNIK" } as never);
    expect(calls[0]!.systemPrompt).toContain(`# SKILL: ${KC}`);
  }, 120_000);
});
