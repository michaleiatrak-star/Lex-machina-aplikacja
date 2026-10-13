import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveActModules } from "../src/act-map-resolver.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { SKILL_SELECTION_ENVELOPE_PREFIX } from "../src/skill-selection.js";
import { markdownSection } from "../src/skill-sections.js";

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

  it("AU-A..AU-F: the checkpoint's module of the core checklist is in the checkpoint part, the rest of the prompt stays shared", async () => {
    const later = "Użytkownik: Przeanalizuj tę umowę B2B przed podpisaniem.\n\nAsystent: Punkt zakończony.\n\nUżytkownik: Kontynuuj.";
    const a = await run({ query: later, contract: { mode: "ANALYSIS", stage: "ANALYSIS", checkpoint: "AU-A" } });
    const f = await run({ query: later, contract: { mode: "ANALYSIS", stage: "ANALYSIS", checkpoint: "AU-F" } });
    const tailA = a.systemPrompt.slice(a.systemPromptCachePrefix!);
    const tailF = f.systemPrompt.slice(f.systemPromptCachePrefix!);
    expect(tailA).toContain("# CZĘŚĆ SKILLA DO WYKONANIA W PUNKCIE AU-A");
    expect(tailA).toContain("## MODUŁ A — IDENTYFIKACJA DOKUMENTU");
    expect(tailA).not.toContain("## MODUŁ B");
    // MODUŁ F: the report template in a code block ("## 13. DISCLAIMER") stays in the section.
    expect(tailF).toContain("## MODUŁ F — RAPORT KOŃCOWY ANALIZY");
    expect(tailF).toContain("## 13. DISCLAIMER");
    expect(tailF).toContain("### F.3 Widget statusu sprawy");
    expect(tailF).toContain("## SKALOWANIE RAPORTU WG WARTOŚCI UMOWY");
    expect(tailF).not.toContain("## REGUŁY NADRZĘDNE");
    expect(a.systemPrompt.slice(0, a.systemPromptCachePrefix!)).toBe(f.systemPrompt.slice(0, f.systemPromptCachePrefix!));
  }, 120_000);
});

describe("markdownSection", () => {
  it("a heading inside a code block does not end the section", () => {
    const text = ["# T", "## A", "a1", "```", "## 1. W BLOKU", "```", "a2", "### A.1", "a3", "## B", "b"].join("\n");
    expect(markdownSection(text, /^## A\b/u)).toBe(["## A", "a1", "```", "## 1. W BLOKU", "```", "a2", "### A.1", "a3"].join("\n"));
    expect(markdownSection(text, /^## B\b/u)).toBe("## B\nb");
    expect(markdownSection(text, /^## C\b/u)).toBe("");
  });

  it("a matching line inside a code block is not the section's heading", () => {
    const text = ["```", "## A", "```", "## A", "real", "## B"].join("\n");
    expect(markdownSection(text, /^## A\b/u)).toBe("## A\nreal");
  });
});
