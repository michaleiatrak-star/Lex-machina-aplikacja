import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreActRecord, CoreActRef, CoreActSummary } from "../src/core-law-index.js";
import type { CoreLawVerificationIndex } from "../src/core-law-verification.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { LegalFederationToolRuntime } from "../src/legal-federation-tool-runtime.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";

// Tryb offline modelu lokalnego: tylko lokalna kopia ELI i biblioteka na dysku, żadnego źródła w sieci.
const NOW = Date.parse("2026-09-25T10:00:00.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  process.env.LEX_LOCAL_OFFLINE = "on";
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.LEX_LOCAL_OFFLINE;
});

const KW_URL = "https://api.sejm.gov.pl/eli/acts/DU/2025/734/text.html";
const KW_ART_51 =
  "Art. 51. § 1. Kto krzykiem, hałasem, alarmem lub innym wybrykiem zakłóca spokój, porządek publiczny, spoczynek nocny albo wywołuje zgorszenie w miejscu publicznym, podlega karze aresztu, ograniczenia wolności albo grzywny.";
const QUOTE = "podlega karze aresztu, ograniczenia wolności albo grzywny";

function kwIndex(): CoreLawVerificationIndex {
  const ref: CoreActRef = { eli: "DU/2025/734", consolidated: true, labels: ["KW"], domains: ["dr-03-prawo-karne-wykroczenia-egzekucja"], notes: [] };
  const record: CoreActRecord = {
    eli: ref.eli,
    title: "Kodeks wykroczeń",
    type: "Ustawa",
    status: "obowiązujący",
    promulgation: "2025-06-02",
    textSource: "html",
    fetchedAt: "2026-09-20T08:00:00.000Z",
    sourceUrl: KW_URL,
    articleOrder: ["51"],
    articles: { "51": KW_ART_51 },
    text: ""
  };
  const summary: CoreActSummary = {
    eli: ref.eli,
    title: record.title,
    status: record.status,
    consolidated: true,
    labels: ref.labels,
    domains: ref.domains,
    textSource: "html",
    articleCount: 1,
    fetchedAt: record.fetchedAt,
    lastError: null,
    unavailable: null,
    relationsCheckedAt: null,
    currentEli: ref.eli,
    amendmentsAfter: [],
    pendingConsolidated: null,
    pendingAmendments: [],
    notYetInForce: [],
    origin: "MAP",
    addedAt: null,
    addedBy: null
  };
  return {
    resolve: (value) => (value.trim().toLocaleLowerCase("pl") === "kw" || value.trim() === ref.eli ? ref : null),
    summaries: () => [summary],
    summary: (eli) => (eli === ref.eli ? summary : null),
    currentRecord: (eli) => (eli === ref.eli ? record : null)
  };
}


const noNetwork = vi.fn(async () => {
  throw new Error("NETWORK_USED_OFFLINE");
});

function runtime(ledger: VerificationLedger, offline: boolean) {
  return new LegalVerificationToolRuntime(ledger, undefined, undefined, null, undefined, undefined, kwIndex(), noNetwork as never, null, true, offline);
}

describe("weryfikacja w trybie offline", () => {
  it("przepis z lokalnej kopii; brak aktu w kopii i wyszukiwanie orzeczeń: odmowa OFFLINE_MODE bez sieci", async () => {
    const ledger = new VerificationLedger();
    const tools = runtime(ledger, true);
    expect(tools.schemas().map((schema) => schema.function.name).sort()).toEqual(["search_case_law_library", "verify_legal_reference"]);
    const [kw, missing, search] = await tools.runTools([
      { id: "a", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } },
      { id: "b", name: "verify_legal_reference", input: { claim: "art. 1 XYZ", kind: "statute", act: "XYZ" } },
      { id: "c", name: "search_case_law", input: { query: "zakłócanie spokoju", source: "SAOS" } }
    ]);
    expect(JSON.parse(kw!.content).status).toBe("VERIFIED");
    expect(JSON.parse(missing!.content)).toMatchObject({ status: "DENIED", error: "OFFLINE_MODE" });
    expect(JSON.parse(search!.content)).toMatchObject({ error: "OFFLINE_MODE" });
    expect(noNetwork).not.toHaveBeenCalled();
    expect(tools.systemPromptAppendix()).toContain("TRYB OFFLINE");
  });
});

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();

describe("sesja modelu lokalnego w trybie offline", () => {
  it("bez narzędzi federacji i wyszukiwarki, z notą o trybie offline przed zastrzeżeniem", async () => {
    let tools: string[] = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "offline",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(params: ProviderStreamParams) {
        if (!params.systemPrompt?.includes("OCENA ZGODNOŚCI")) tools = (params.tools ?? []).map((tool) => tool.function.name);
        return { fullText: params.systemPrompt?.includes("OCENA ZGODNOŚCI") ? '{"verdicts":[]}' : "Za zakłócanie spokoju art. 51 § 1 KW przewiduje karę aresztu, ograniczenia wolności albo grzywny." };
      }
    });
    const executor = new SafeSessionExecutor(
      registry,
      new ProviderGateway(providers),
      undefined,
      (ledger, context) => runtime(ledger, context?.offline === true),
      undefined,
      new LegalFederationToolRuntime()
    );
    const result = await executor.execute({
      query: "Jaka kara grozi za zakłócanie spokoju krzykiem w nocy?",
      provider: "openai",
      model: "local/bielik-11b-v3-q4km",
      primarySkill: "dr-03-prawo-karne-wykroczenia-egzekucja",
      mode: "PRAWNIK"
    });
    for (const external of ["search_federated_legal_sources", "get_federated_legal_document", "call_federated_legal_source", "fetch_auxiliary_legal_source", "web_search", "search_case_law"]) {
      expect(tools).not.toContain(external);
    }
    const answer = result.answer ?? "";
    expect(answer).toContain("Tryb offline: źródła zewnętrzne wyłączone");
    expect(answer.indexOf("Tryb offline")).toBeLessThan(answer.indexOf("Nie stanowi"));
    expect(noNetwork).not.toHaveBeenCalled();
  }, 60_000);
});
