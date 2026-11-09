import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreActRecord, CoreActRef, CoreActSummary } from "../src/core-law-index.js";
import type { CoreLawVerificationIndex } from "../src/core-law-verification.js";
import { applyAutomaticVerificationMarkers } from "../src/gate-i-auto-verification.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderStreamParams } from "../src/providers/types.js";
import { LexSkillRegistry } from "../src/registry.js";
import { SafeSessionExecutor } from "../src/session-executor.js";
import { statuteContentWarning, statuteItems } from "../src/statute-content-check.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";

// 2026-11-09: Bielik przypisał art. 100 § 2 KP „zasadę proporcjonalności”, a aplikacja postawiła ✅,
// bo przepis istniał. Teraz teza jest porównywana z brzmieniem: runda korekty, a gdy nie pomoże —
// ostrzeżenie zamiast ✅.

const NOW = Date.parse("2026-09-25T10:00:00.000Z");
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], now: NOW }));
afterEach(() => vi.useRealTimers());

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

const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
registry.scan();

const WRONG = "Za zakłócanie spokoju art. 51 § 1 KW przewiduje karę dożywotniego pozbawienia wolności.";
const RIGHT = "Za zakłócanie spokoju art. 51 § 1 KW przewiduje karę aresztu, ograniczenia wolności albo grzywny.";

function verdict(claim: "SUPPORTED" | "UNSUPPORTED"): string {
  return JSON.stringify({
    verdicts: [
      {
        signature: "art. 51 § 1 KW",
        criteria: "kara za zakłócanie spokoju",
        thesis: claim === "SUPPORTED" ? "kara aresztu, ograniczenia wolności albo grzywny" : "kara dożywotniego pozbawienia wolności",
        topic: "MATCH",
        claim,
        reason: claim === "SUPPORTED" ? "Brzmienie przewiduje te kary." : "Przepis przewiduje areszt, ograniczenie wolności albo grzywnę, nie dożywocie.",
        quote: QUOTE
      }
    ]
  });
}

async function run(model: string, correction: string) {
  const calls: Array<"answer" | "judge" | "correction"> = [];
  const providers = new ProviderRegistry();
  providers.register({
    id: "openai",
    label: "statute",
    capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
    async stream(params: ProviderStreamParams) {
      const last = String(params.messages.at(-1)?.content ?? "");
      if (params.systemPrompt?.includes("OCENA ZGODNOŚCI")) {
        calls.push("judge");
        return { fullText: verdict(last.includes("dożywotniego") ? "UNSUPPORTED" : "SUPPORTED") };
      }
      if (last.includes("KONTROLA TREŚCI PRZEPISÓW")) {
        calls.push("correction");
        return { fullText: correction };
      }
      calls.push("answer");
      return { fullText: WRONG };
    }
  });
  const executor = new SafeSessionExecutor(
    registry,
    new ProviderGateway(providers),
    undefined,
    (ledger) => new LegalVerificationToolRuntime(ledger, undefined, undefined, null, undefined, undefined, kwIndex(), undefined, null, true)
  );
  const result = await executor.execute({
    query: "Jaka kara grozi za zakłócanie spokoju krzykiem w nocy?",
    provider: "openai",
    model,
    primarySkill: "dr-03-prawo-karne-wykroczenia-egzekucja",
    mode: "PRAWNIK"
  });
  return { result, calls };
}

describe("kontrola treści przepisów", () => {
  it("teza sprzeczna z brzmieniem: runda korekty, poprawiona odpowiedź z ✅ (także model lokalny)", async () => {
    const { result, calls } = await run("local/bielik-11b-v3-q4km", RIGHT);
    const answer = result.answer ?? "";
    expect(calls).toContain("correction");
    expect(answer).toContain("aresztu, ograniczenia wolności albo grzywny");
    expect(answer).not.toContain("dożywotniego");
    expect(answer).toMatch(/art\. 51 § 1 KW[^\n]*✅ \[VER:/u);
    expect(result.corrections?.some((item) => item.round === "STATUTE_CONTENT")).toBe(true);
  }, 60_000);

  it("korekta nie pomogła: zamiast ✅ ostrzeżenie z brzmieniem przepisu", async () => {
    const { result } = await run("local/bielik-11b-v3-q4km", WRONG);
    const answer = result.answer ?? "";
    expect(answer).toContain("dożywotniego");
    expect(answer).toContain("⚠️ [PRZEPIS ODCZYTANY, TEZA NIEPOTWIERDZONA:");
    expect(answer).toContain(`„${QUOTE}”`);
    expect(answer).not.toMatch(/dożywotniego[^\n]*✅ \[VER:/u);
  }, 60_000);
});

describe("pomocnicze", () => {
  it("statuteItems paruje powołanie z rekordem z brzmieniem; pomija już ocenione", () => {
    const ledger = new VerificationLedger();
    const runtime = new LegalVerificationToolRuntime(ledger, undefined, undefined, null, undefined, undefined, kwIndex(), undefined, null, true);
    return runtime.runTools([{ id: "c1", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } }]).then(() => {
      const items = statuteItems(WRONG, ledger.all());
      expect(items.map((item) => item.record.claim)).toEqual(["art. 51 § 1 KW"]);
      expect(items[0]!.document.text).toContain("aresztu");
      expect(statuteItems(WRONG, ledger.all(), new Set(["art 51 § 1 kw"]))).toEqual([]);
      const warned = applyAutomaticVerificationMarkers(
        WRONG,
        ledger,
        undefined,
        new Map([["art. 51 § 1 KW", statuteContentWarning({ signature: "art. 51 § 1 KW", topic: "MATCH", claim: "UNSUPPORTED", reason: "Nie dożywocie.", quote: QUOTE })]])
      );
      expect(warned.text).toContain("⚠️ [PRZEPIS ODCZYTANY, TEZA NIEPOTWIERDZONA: Nie dożywocie.");
      expect(warned.text).not.toContain("✅");
    });
  });
});
