import { describe, expect, it } from "vitest";
import type {
  CoreActRecord,
  CoreActRef,
  CoreActSummary,
  CoreLawIndex
} from "../src/core-law-index.js";
import {
  CORE_LAW_FRESH_CHECK_MS,
  localCopyMarker,
  verifyFromCoreLaw
} from "../src/core-law-verification.js";
import {
  FinalizationGate,
  isLocalCopyOnlyDegradation
} from "../src/finalization-gate.js";
import { VerificationLedger } from "../src/verification-ledger.js";
import { LegalVerificationToolRuntime } from "../src/verification-tool-runtime.js";

const NOW = Date.parse("2026-09-29T10:00:00.000Z");
const KW_URL = "https://api.sejm.gov.pl/eli/acts/DU/2025/734/text.html";

function fakeIndex(options: {
  relationsCheckedAt?: string | null;
  amendmentsAfter?: CoreActSummary["amendmentsAfter"];
  status?: string;
} = {}): Pick<CoreLawIndex, "resolve" | "summary" | "currentRecord"> {
  const ref: CoreActRef = {
    eli: "DU/2025/734",
    consolidated: true,
    labels: ["KW", "Kodeks wykroczeń (KW) — current-state"],
    domains: ["dr-03-prawo-karne-wykroczenia-egzekucja"],
    notes: []
  };
  const record: CoreActRecord = {
    eli: "DU/2025/734",
    title: "Kodeks wykroczeń",
    type: "Ustawa",
    status: options.status ?? "obowiązujący",
    promulgation: "2025-06-02",
    textSource: "html",
    fetchedAt: "2026-09-20T08:00:00.000Z",
    sourceUrl: KW_URL,
    articleOrder: ["51"],
    articles: {
      "51": "Art. 51. § 1. Kto krzykiem, hałasem, alarmem lub innym wybrykiem zakłóca spokój, porządek publiczny, spoczynek nocny albo wywołuje zgorszenie w miejscu publicznym, podlega karze aresztu, ograniczenia wolności albo grzywny."
    },
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
    relationsCheckedAt:
      options.relationsCheckedAt === undefined
        ? "2026-09-29T06:00:00.000Z"
        : options.relationsCheckedAt,
    currentEli: ref.eli,
    amendmentsAfter: options.amendmentsAfter ?? []
  };
  return {
    resolve: (act: string) =>
      ["kw", "kodeks wykroczeń", "du/2025/734"].includes(act.trim().toLocaleLowerCase("pl"))
        ? ref
        : null,
    summary: (eli: string) => (eli === ref.eli ? summary : null),
    currentRecord: (eli: string) => (eli === ref.eli ? record : null)
  };
}

function verify(
  index: ReturnType<typeof fakeIndex>,
  claim = "art. 51 § 1 KW",
  extra: { asOf?: string } = {}
) {
  return verifyFromCoreLaw({
    index,
    claim,
    kind: "statute",
    act: "KW",
    toolCallId: "call_1",
    now: NOW,
    ...extra
  });
}

describe("verifyFromCoreLaw", () => {
  it("VERIFIED when ELI relations were checked within 24 hours", () => {
    const outcome = verify(fakeIndex());
    expect(outcome.decision).toBe("RECORD");
    if (outcome.decision !== "RECORD") return;
    expect(outcome.record).toMatchObject({
      status: "VERIFIED",
      sourceUrl: KW_URL,
      sourceTier: "R1",
      temporalFreshnessStatus: "CURRENT",
      freshnessCheckedAt: "2026-09-29T06:00:00.000Z",
      currentEli: "DU/2025/734"
    });
    expect(outcome.record.evidence).toContain("Art. 51. § 1.");
    new VerificationLedger().add(outcome.record);
  });

  it("SUPPORTED with the copy date when the check is stale or missing, never VERIFIED", () => {
    const stale = new Date(NOW - CORE_LAW_FRESH_CHECK_MS - 1).toISOString();
    for (const relationsCheckedAt of [stale, null]) {
      const outcome = verify(fakeIndex({ relationsCheckedAt }));
      expect(outcome.decision).toBe("RECORD");
      if (outcome.decision !== "RECORD") return;
      expect(outcome.record.status).toBe("SUPPORTED");
      expect(outcome.record.supportScope).toBe("LOCAL_ELI_COPY");
      expect(outcome.record.localCopyFetchedAt).toBe("2026-09-20T08:00:00.000Z");
      new VerificationLedger().add(outcome.record);
    }
    const outcome = verify(fakeIndex({ relationsCheckedAt: null }));
    if (outcome.decision !== "RECORD") throw new Error("expected record");
    expect(localCopyMarker(outcome.record)).toBe(
      `[KOPIA-ELI: ${KW_URL}, kopia z 2026-09-20, nowelizacji nie sprawdzono]`
    );
  });

  it("refuses amended, repealed, historical and unknown acts", () => {
    expect(
      verify(fakeIndex({ amendmentsAfter: [{ eli: "DU/2025/1814", title: null, promulgation: null }] }))
    ).toEqual({ decision: "DENY", reason: "TEMPORAL_POST_TJ_AMENDMENTS" });
    expect(verify(fakeIndex({ status: "uchylony" }))).toEqual({
      decision: "DENY",
      reason: "TEMPORAL_ACT_NOT_IN_FORCE"
    });
    expect(verify(fakeIndex(), "art. 51 § 1 KW", { asOf: "2020-01-01" })).toEqual({
      decision: "DENY",
      reason: "CORE_LAW_CURRENT_STATE_ONLY"
    });
    expect(
      verifyFromCoreLaw({
        index: fakeIndex(),
        claim: "art. 1 XYZ",
        kind: "statute",
        act: "XYZ",
        toolCallId: "call_1",
        now: NOW
      })
    ).toEqual({ decision: "DENY", reason: "UNKNOWN_LEGAL_ACT" });
  });

  it("UNVERIFIED when the article is absent from the copy", () => {
    const outcome = verify(fakeIndex(), "art. 999 KW");
    expect(outcome.decision === "RECORD" && outcome.record.status).toBe("UNVERIFIED");
  });
});

describe("local ELI copy in finalization", () => {
  it("degrades only through the copy marker and blocks when the marker is missing", () => {
    const outcome = verify(fakeIndex({ relationsCheckedAt: null }));
    if (outcome.decision !== "RECORD") throw new Error("expected record");
    const ledger = new VerificationLedger();
    ledger.add(outcome.record);
    const marker = localCopyMarker(outcome.record)!;

    const marked = new FinalizationGate().evaluate(`Zgodnie z art. 51 § 1 KW ${marker} wzywam.`, ledger);
    expect(marked.result).toBe("DEGRADED");
    expect(marked.findings.map((finding) => finding.status)).toEqual(["SUPPORTED_LOCAL_COPY"]);
    expect(isLocalCopyOnlyDegradation(marked.findings.map((finding) => finding.status))).toBe(true);

    const unmarked = new FinalizationGate().evaluate("Zgodnie z art. 51 § 1 KW wzywam.", ledger);
    expect(unmarked.result).toBe("BLOCKED");

    expect(isLocalCopyOnlyDegradation(["SUPPORTED_LOCAL_COPY", "UNVERIFIED_MARKED"])).toBe(false);
    expect(isLocalCopyOnlyDegradation([])).toBe(false);
  });
});

describe("verify_legal_reference with the core law index", () => {
  it("falls back to the local ELI copy for acts outside the deterministic registry", async () => {
    const ledger = new VerificationLedger();
    const runtime = new LegalVerificationToolRuntime(
      ledger,
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      fakeIndex({ relationsCheckedAt: null })
    );
    const [result] = await runtime.runTools([
      { id: "call_kw", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } }
    ]);
    const payload = JSON.parse(result!.content) as { status: string; marker: string };
    expect(payload.status).toBe("SUPPORTED");
    expect(payload.marker).toContain("[KOPIA-ELI: ");
    expect(ledger.latest("art. 51 § 1 KW")?.status).toBe("SUPPORTED");
    expect(runtime.auditEvents().some((event) => event.reason === "CORE_LAW_LOCAL_ELI_COPY")).toBe(true);

    const [unknown] = await runtime.runTools([
      { id: "call_x", name: "verify_legal_reference", input: { claim: "art. 1 XYZ", kind: "statute", act: "XYZ" } }
    ]);
    expect(JSON.parse(unknown!.content)).toEqual({ status: "DENIED", error: "UNKNOWN_LEGAL_ACT" });
  });
});
