import { describe, expect, it } from "vitest";
import type {
  CoreActRecord,
  CoreActRef,
  CoreActSummary
} from "../src/core-law-index.js";
import {
  resolveActByTitle,
  verifyFromCoreLaw,
  type CoreLawVerificationIndex
} from "../src/core-law-verification.js";
import { FinalizationGate } from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";

const NOW = Date.parse("2026-09-29T10:00:00.000Z");
const KW_URL = "https://api.sejm.gov.pl/eli/acts/DU/2025/734/text.html";
const TRZ_URL = "https://api.sejm.gov.pl/eli/acts/DU/2026/1214/text.html";

type Act = {
  ref: CoreActRef;
  record: CoreActRecord;
  summary: CoreActSummary;
};

function act(options: {
  eli: string;
  title: string;
  labels: string[];
  url: string;
  articles: Record<string, string>;
  status?: string;
  amendmentsAfter?: CoreActSummary["amendmentsAfter"];
  relationsCheckedAt?: string | null;
}): Act {
  const ref: CoreActRef = {
    eli: options.eli,
    consolidated: true,
    labels: options.labels,
    domains: ["dr-03-prawo-karne-wykroczenia-egzekucja"],
    notes: []
  };
  const record: CoreActRecord = {
    eli: options.eli,
    title: options.title,
    type: "Ustawa",
    status: options.status ?? "obowiązujący",
    promulgation: "2025-06-02",
    textSource: "html",
    fetchedAt: "2026-09-20T08:00:00.000Z",
    sourceUrl: options.url,
    articleOrder: Object.keys(options.articles),
    articles: options.articles,
    text: ""
  };
  const summary: CoreActSummary = {
    eli: options.eli,
    title: options.title,
    status: record.status,
    consolidated: true,
    labels: options.labels,
    domains: ref.domains,
    textSource: "html",
    articleCount: record.articleOrder.length,
    fetchedAt: record.fetchedAt,
    lastError: null,
    relationsCheckedAt: options.relationsCheckedAt ?? null,
    currentEli: options.eli,
    amendmentsAfter: options.amendmentsAfter ?? []
  };
  return { ref, record, summary };
}

const KW_ART_51 =
  "Art. 51. § 1. Kto krzykiem, hałasem, alarmem lub innym wybrykiem zakłóca spokój, porządek publiczny, spoczynek nocny albo wywołuje zgorszenie w miejscu publicznym, podlega karze aresztu, ograniczenia wolności albo grzywny.";

function kw(extra: Partial<Parameters<typeof act>[0]> = {}): Act {
  return act({
    eli: "DU/2025/734",
    title: "Kodeks wykroczeń",
    labels: ["KW"],
    url: KW_URL,
    articles: { "51": KW_ART_51 },
    ...extra
  });
}

function trzezwosc(): Act {
  return act({
    eli: "DU/2026/1214",
    title: "Ustawa z dnia 26 października 1982 r. o wychowaniu w trzeźwości i przeciwdziałaniu alkoholizmowi",
    labels: ["Ustawa o wychowaniu w trzeźwości (1982, + sekcja DO MONITOROWANIA"],
    url: TRZ_URL,
    articles: { "43": "Art. 43. 1. Kto sprzedaje lub podaje napoje alkoholowe w wypadkach, w których jest to zabronione, podlega grzywnie." }
  });
}

function index(...acts: Act[]): CoreLawVerificationIndex {
  return {
    // Rozpoznanie po etykiecie mapy / ELI (jak CoreLawIndex.resolve): tu tylko dokładne.
    resolve: (value: string) =>
      acts.find(
        (item) =>
          item.ref.eli === value.trim() ||
          item.ref.labels.some((label) => label.toLocaleLowerCase("pl") === value.trim().toLocaleLowerCase("pl"))
      )?.ref ?? null,
    summaries: () => acts.map((item) => item.summary),
    summary: (eli: string) => acts.find((item) => item.ref.eli === eli)?.summary ?? null,
    currentRecord: (eli: string) => acts.find((item) => item.ref.eli === eli)?.record ?? null
  };
}

function verify(
  idx: CoreLawVerificationIndex,
  args: { claim?: string; act?: string; quote?: string; asOf?: string } = {}
) {
  return verifyFromCoreLaw({
    index: idx,
    claim: args.claim ?? "art. 51 § 1 KW",
    kind: "statute",
    act: args.act ?? "KW",
    toolCallId: "call_1",
    now: NOW,
    ...(args.quote ? { quote: args.quote } : {}),
    ...(args.asOf ? { asOf: args.asOf } : {})
  });
}

describe("verifyFromCoreLaw", () => {
  it("VERIFIED offline when the provision exists in the consolidated ELI text", () => {
    const outcome = verify(index(kw()));
    expect(outcome.decision).toBe("RECORD");
    if (outcome.decision !== "RECORD") return;
    expect(outcome.record).toMatchObject({
      status: "VERIFIED",
      sourceUrl: KW_URL,
      sourceTier: "R1",
      verificationMethod: "file_read",
      fetchedAt: "2026-09-20T08:00:00.000Z",
      temporalFreshnessStatus: "CURRENT",
      freshnessCheckedAt: "2026-09-20T08:00:00.000Z"
    });
    expect(outcome.record.evidence).toBe(KW_ART_51);
    new VerificationLedger().add(outcome.record);
  });

  it("recognises the act by its inflected title, not only by an abbreviation", () => {
    const idx = index(kw(), trzezwosc());
    for (const name of [
      "ustawy o wychowaniu w trzeźwości i przeciwdziałaniu alkoholizmowi",
      "ustawa o wychowaniu w trzeźwości",
      "Kodeksu wykroczeń"
    ]) {
      expect(resolveActByTitle(idx, name)).not.toBeNull();
    }
    const outcome = verify(idx, {
      claim: "art. 43 ust. 1 ustawy o wychowaniu w trzeźwości",
      act: "ustawy o wychowaniu w trzeźwości i przeciwdziałaniu alkoholizmowi"
    });
    expect(outcome.decision === "RECORD" && outcome.record.status).toBe("VERIFIED");
    expect(outcome.decision === "RECORD" && outcome.act.resolvedBy).toBe("TITLE");
    expect(resolveActByTitle(idx, "ustawa o czymś zupełnie innym")).toBeNull();

    const karne = index(
      act({ eli: "DU/2025/383", title: "Kodeks karny", labels: [], url: KW_URL, articles: { "1": "Art. 1. § 1." } }),
      act({ eli: "DU/2025/633", title: "Kodeks karny skarbowy", labels: [], url: KW_URL, articles: { "1": "Art. 1. § 1." } })
    );
    expect(resolveActByTitle(karne, "kodeksu karnego")).toBe("DU/2025/383");
    expect(resolveActByTitle(karne, "Kodeks karny skarbowy")).toBe("DU/2025/633");
  });

  it("checks the quoted wording against the provision", () => {
    const idx = index(kw());
    const matching = verify(idx, { quote: "zakłóca spokój, porządek publiczny, spoczynek nocny" });
    expect(matching.decision === "RECORD" && matching.record.status).toBe("VERIFIED");
    const wrong = verify(idx, { quote: "podlega karze pozbawienia wolności do lat 5" });
    expect(wrong.decision === "RECORD" && wrong.record.status).toBe("UNVERIFIED");
    const missing = verify(idx, { claim: "art. 999 KW" });
    expect(missing.decision === "RECORD" && missing.record.status).toBe("UNVERIFIED");
  });

  it("refuses when the copy cannot be correct: amendments after t.j., repealed act, past state, unknown act", () => {
    expect(verify(index(kw({ amendmentsAfter: [{ eli: "DU/2025/1814", title: null, promulgation: null }] }))))
      .toEqual({ decision: "DENY", reason: "TEMPORAL_POST_TJ_AMENDMENTS" });
    expect(verify(index(kw({ status: "uchylony" }))))
      .toEqual({ decision: "DENY", reason: "TEMPORAL_ACT_NOT_IN_FORCE" });
    expect(verify(index(kw()), { asOf: "2020-01-01" }))
      .toEqual({ decision: "DENY", reason: "CORE_LAW_CURRENT_STATE_ONLY" });
    expect(verify(index(kw()), { act: "XYZ" }))
      .toEqual({ decision: "DENY", reason: "UNKNOWN_LEGAL_ACT" });
  });

  it("the verified record passes the HARD GATE with its ELI marker", () => {
    const outcome = verify(index(kw()));
    if (outcome.decision !== "RECORD") throw new Error("expected record");
    const ledger = new VerificationLedger();
    ledger.add(outcome.record);
    const report = new FinalizationGate().evaluate(
      `Zgodnie z art. 51 § 1 KW ✅ [VER: ${KW_URL}, 2026-09-20] wzywam.`,
      ledger
    );
    expect(report.result).toBe("PASS");
  });
});

describe("verify_legal_reference with the core law index", () => {
  it("verifies an act outside the deterministic registry offline", async () => {
    const ledger = new VerificationLedger();
    const runtime = new LegalVerificationToolRuntime(
      ledger,
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      index(kw(), trzezwosc())
    );
    const [kwResult, titleResult, unknown] = await runtime.runTools([
      { id: "c1", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } },
      {
        id: "c2",
        name: "verify_legal_reference",
        input: {
          claim: "art. 43 ust. 1 ustawy o wychowaniu w trzeźwości",
          kind: "statute",
          act: "ustawy o wychowaniu w trzeźwości i przeciwdziałaniu alkoholizmowi",
          quote: "sprzedaje lub podaje napoje alkoholowe"
        }
      },
      { id: "c3", name: "verify_legal_reference", input: { claim: "art. 1 XYZ", kind: "statute", act: "XYZ" } }
    ]);
    const kwPayload = JSON.parse(kwResult!.content) as { status: string; marker: string };
    expect(kwPayload.status).toBe("VERIFIED");
    expect(kwPayload.marker).toBe(`✅ [VER: ${KW_URL}, 2026-09-20]`);
    expect(JSON.parse(titleResult!.content).status).toBe("VERIFIED");
    expect(JSON.parse(unknown!.content)).toMatchObject({ status: "DENIED", error: "UNKNOWN_LEGAL_ACT" });
    expect(ledger.latest("art. 51 § 1 KW")?.status).toBe("VERIFIED");
    expect(runtime.auditEvents().some((event) => event.reason === "CORE_LAW_LOCAL_ELI_COPY")).toBe(true);
  });
});
