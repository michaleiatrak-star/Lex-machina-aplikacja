import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveActModules } from "../src/act-map-resolver.js";
import { CONTRACT_CHECKPOINT_SECTIONS, markdownSection } from "../src/checkpoint-skill-sections.js";
import { CONTRACT_CHECKPOINTS } from "../src/contract-analysis-state.js";
import fs from "node:fs";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";

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

const B2B =
  "UMOWA O ŚWIADCZENIE USŁUG zawarta pomiędzy Softex sp. z o.o. (Zamawiający) a Janem Kowalskim prowadzącym działalność gospodarczą (Wykonawca). " +
  "§1 Przedmiot: usługi programistyczne. §2 Wynagrodzenie 18 000 zł netto miesięcznie, płatne w terminie 60 dni. " +
  "§3 Zakaz konkurencji przez 24 miesiące bez odszkodowania. §4 Kara umowna 100 000 zł za naruszenie poufności.";

type Turn = {
  query: string;
  contract: { mode: "ANALYSIS" | "REDACTION" | "DRAFT" | "SUPPLEMENT"; stage: "INTAKE" | "ANALYSIS" | "GENERATION" | "FINALIZATION"; checkpoint: string };
  doc?: string;
};

async function run(turn: Turn): Promise<ProviderStreamParams> {
  const calls: ProviderStreamParams[] = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "mechanical",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(received) {
      calls.push(received);
      return { fullText: "Punkt AU wykonany." };
    }
  });
  const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers), undefined, verification);
  const envelope = { auto: false, manual: ["analizator-umow-v1"], caseType: ["analizator-umow-v1"] };
  await executor.execute({
    query: `${SKILL_SELECTION_ENVELOPE_PREFIX} ${JSON.stringify(envelope)}\n${turn.query}`,
    provider: "openai",
    model: "account/openai/default",
    primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze",
    mode: "PRAWNIK",
    contractWorkflowContext: turn.contract,
    ...(turn.doc
      ? { documentAttachments: [{ documentId: "doc_umowa", selectedByUser: true, totalPages: 1, chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: turn.doc }] }] }
      : {})
  } as never);
  return calls[0]!;
}

const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("MAPA-AKTOW: common words of a contract do not select another act", () => {
  it("B2B contract: no hunting-law module („działalność gospodarcza”) and no KP wages („wynagrodzenie” + „świadczenie”)", () => {
    const modules = resolveActModules(registry, `Przeanalizuj umowę B2B.\n${B2B}`).map((item) => item.resource);
    expect(modules.join(" ")).not.toMatch(/lowieckie|KP-dzial-III-wynagrodzenie/);
  });

  it("a domain phrase of the row's tail still selects its module („czas pracy”)", () => {
    expect(resolveActModules(registry, "Nie wypłacono mi nadgodzin od roku, czas pracy").map((item) => item.resource).join(" ")).toContain(
      "KP-dzial-VI-czas-pracy"
    );
  });
});

describe("mechanical mode: analizator-umow-v1 per AU checkpoint", () => {
  it("each resource once; workflow state closes the prompt; checkpoint workflows ask for a 1h prompt cache", async () => {
    const call = await run({ query: "Przeanalizuj tę umowę B2B przed podpisaniem.", contract: { mode: "ANALYSIS", stage: "INTAKE", checkpoint: "AU-F0" }, doc: B2B });
    const prompt = call.systemPrompt ?? "";
    expect(count(prompt, "# MOD-STEP-TRACKER — Śledzenie Kroków")).toBe(1);
    expect(count(prompt, "# MOD-WEJSCIE-DOKUMENTU — bramka materiału wejściowego")).toBe(1);
    expect(prompt.trimEnd()).toMatch(/# ACTIVE CONTRACT ANALYSIS STATE — RUNTIME ENFORCED[\s\S]*Active AU checkpoint: AU-F0[\s\S]*$/u);
    expect(prompt.slice(prompt.indexOf("# ACTIVE CONTRACT ANALYSIS STATE"))).not.toContain("\n# MANDATORY PATH RESOURCE");
    expect(call.promptCacheTtl).toBe("1h");
  }, 120_000);

  it("AU-HYBRID loads HYBRID-VALIDATION in full (not a mention) at the end, with the state", async () => {
    const call = await run({ query: "Kontynuuj.", contract: { mode: "DRAFT", stage: "FINALIZATION", checkpoint: "AU-HYBRID" } });
    const prompt = call.systemPrompt ?? "";
    expect(prompt).toContain("# ZASÓB PUNKTU AU-HYBRID: shared/HYBRID-VALIDATION.md");
    expect(prompt).toContain("# HYBRID-VALIDATION — Walidacja hybrydowa");
    expect(prompt.indexOf("# ZASÓB PUNKTU AU-HYBRID")).toBeGreaterThan(prompt.indexOf("# ŚCIEŻKA OBOWIĄZKOWA"));
  }, 120_000);

  it("criminal thread in a contract matter (domain dr-02) still gets the criminal qualifier", async () => {
    const call = await run({
      query: "Przeanalizuj umowę pożyczki. Pożyczkodawca grozi zawiadomieniem o oszustwie i przywłaszczeniu. Czy to przestępstwo?",
      contract: { mode: "ANALYSIS", stage: "INTAKE", checkpoint: "AU-F0" },
      doc: "UMOWA POŻYCZKI. Pożyczkodawca przekazuje 40 000 zł. Zwrot do 3.09.2026 r."
    });
    expect(call.systemPrompt ?? "").toContain("Mandatory for this criminal/misdemeanour matter: follow this decision tree");
  }, 120_000);

  it("a later checkpoint („Kontynuuj”) keeps the modules of the matter the user described earlier", async () => {
    const original = "Przygotuj projekt umowy najmu lokalu mieszkalnego na 12 miesięcy, czynsz 3200 zł, kaucja dwumiesięczna.";
    const first = await run({ query: original, contract: { mode: "DRAFT", stage: "GENERATION", checkpoint: "AU-GENBUILD" } });
    const later = await run({
      query: `Użytkownik: ${original}\n\nAsystent: Projekt gotowy. Przejście do AU-HYBRID.\n\nUżytkownik: Kontynuuj.`,
      contract: { mode: "DRAFT", stage: "FINALIZATION", checkpoint: "AU-HYBRID" }
    });
    expect(first.systemPrompt).toContain("mod-kaucja-najem-lokalu");
    expect(later.systemPrompt).toContain("mod-kaucja-najem-lokalu");
  }, 120_000);
});

describe("AU checkpoints name and carry their part of the skill", () => {
  it("AU-B gets MODUŁ B of mod-core-checklist (not A or F), at the end with the state", async () => {
    const call = await run({ query: "Kontynuuj.", contract: { mode: "ANALYSIS", stage: "ANALYSIS", checkpoint: "AU-B" }, doc: B2B });
    const tail = call.systemPrompt.slice(call.systemPromptCachePrefix!);
    expect(tail).toContain("## MODUŁ B — ANALIZA KLAUZUL");
    expect(call.systemPrompt).not.toContain("## MODUŁ A — IDENTYFIKACJA DOKUMENTU");
    expect(tail).toContain("Część skilla analizator-umow-v1 dla tego punktu: MODUŁ B — ANALIZA KLAUZUL");
  }, 120_000);

  it("MODUŁ F keeps its report template (## headings inside the code block)", () => {
    const body = fs.readFileSync(path.join(CORPUS, "analizator-umow-v1/references/mod-core-checklist.md"), "utf8");
    const f = markdownSection(body, "## MODUŁ F");
    expect(f).toContain("## 13. DISCLAIMER");
    expect(f).not.toContain("## SKALOWANIE RAPORTU");
  });

  it("every AU checkpoint has a description", () => {
    for (const checkpoint of CONTRACT_CHECKPOINTS) expect(CONTRACT_CHECKPOINT_SECTIONS[checkpoint]).toBeTruthy();
  });
});
