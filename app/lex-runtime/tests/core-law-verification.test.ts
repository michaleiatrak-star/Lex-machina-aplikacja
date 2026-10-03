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
import { OfficialLegalSourceVerifier } from "../src/legal-source-verifier.js";
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
  pendingConsolidated?: CoreActSummary["pendingConsolidated"];
  pendingAmendments?: CoreActSummary["pendingAmendments"];
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
    unavailable: null,
    relationsCheckedAt: options.relationsCheckedAt ?? null,
    currentEli: options.eli,
    amendmentsAfter: options.amendmentsAfter ?? [],
    pendingConsolidated: options.pendingConsolidated ?? null,
    pendingAmendments: options.pendingAmendments ?? [],
    origin: "MAP",
    addedAt: null,
    addedBy: null
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

  it("sends an article flagged by the PDF extraction check to ELI instead of VERIFIED", () => {
    const flagged = kw();
    flagged.record.textSource = "pdf";
    flagged.record.extractionCheck = { gaps: ["52"], outOfOrder: 0, duplicates: 0, suspectArticles: ["51"] };
    expect(verify(index(flagged))).toMatchObject({ decision: "DENY", reason: "CORE_LAW_EXTRACTION_SUSPECT" });
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
    // Found by a check but not applied yet (automatic updates off).
    expect(verify(index(kw({ pendingConsolidated: { eli: "DU/2026/77", title: null, promulgation: null } }))))
      .toEqual({ decision: "DENY", reason: "TEMPORAL_UPDATE_PENDING" });
    expect(verify(index(kw({ pendingAmendments: [{ eli: "DU/2026/78", title: null, promulgation: null }] }))))
      .toEqual({ decision: "DENY", reason: "TEMPORAL_UPDATE_PENDING" });
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
  it("model lokalny (Bielik, Mistral) weryfikuje offline na lokalnej kopii ELI (RAG)", async () => {
    const ledger = new VerificationLedger();
    const runtime = new LegalVerificationToolRuntime(
      ledger,
      undefined,
      undefined,
      null,
      undefined,
      undefined,
      index(kw(), trzezwosc()),
      undefined,
      null,
      true
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
    expect(JSON.parse(unknown!.content)).toMatchObject({ status: "DENIED", localCopy: "UNKNOWN_LEGAL_ACT" });
    expect(ledger.latest("art. 51 § 1 KW")?.status).toBe("VERIFIED");
    expect(runtime.auditEvents().some((event) => event.reason === "CORE_LAW_LOCAL_ELI_COPY")).toBe(true);
  });
});

describe("verify_legal_reference: akty spoza rejestru najpierw w źródle (ELI)", () => {
  const CHECKED = "2026-09-29T10:00:00.000Z";
  const DROGI_URL = "https://api.sejm.gov.pl/eli/acts/DU/2025/889/text.html";

  // Kontrola aktualności na żywo: bieżący t.j. i jego adres (tu bez nowelizacji po t.j.).
  const freshness = {
    check: async (descriptor: { baseEli: string; eli: string }) => ({
      status: "CURRENT" as const,
      mode: "CURRENT" as const,
      checkedAt: CHECKED,
      baseEli: descriptor.baseEli,
      pinnedEli: descriptor.eli,
      currentEli: descriptor.eli === "DU/2025/734" ? "DU/2025/734" : "DU/2025/889",
      sourceUrl: descriptor.eli === "DU/2025/734" ? KW_URL : DROGI_URL,
      amendmentsAfter: []
    })
  };

  function eli(options: { down?: boolean } = {}) {
    const requested: string[] = [];
    const fetcher = async (url: string) => {
      requested.push(url);
      if (options.down) throw new Error("ECONNREFUSED");
      if (url.endsWith("/DU/2025/734/references")) {
        return Response.json({ "Tekst jednolity dla aktu": [{ act: { ELI: "DU/1971/114" } }] });
      }
      if (url.endsWith("/DU/1971/114")) {
        return Response.json({ title: "Ustawa z dnia 20 maja 1971 r. - Kodeks wykroczeń", status: "obowiązujący" });
      }
      if (url.includes("/search?")) {
        return Response.json({
          items: [
            { ELI: "DU/1985/14", title: "Ustawa z dnia 21 marca 1985 r. o drogach publicznych", status: "obowiązujący" },
            { ELI: "DU/2025/889", title: "Obwieszczenie Marszałka Sejmu w sprawie ogłoszenia jednolitego tekstu ustawy o drogach publicznych", status: "obowiązujący" }
          ]
        });
      }
      if (url.endsWith("/DU/1985/14/references")) return Response.json({});
      if (url.endsWith("/DU/1985/14")) {
        return Response.json({ title: "Ustawa z dnia 21 marca 1985 r. o drogach publicznych", status: "obowiązujący" });
      }
      return new Response("", { status: 404 });
    };
    return { fetcher, requested };
  }

  function officialText(url: string): Response {
    const body =
      url === KW_URL
        ? `<html><body><p>Kodeks wykroczeń</p><p>${KW_ART_51}</p></body></html>`
        : "<html><body><p>o drogach publicznych</p><p>Art. 4. Użyte w ustawie określenia oznaczają: 2) droga - budowla.</p></body></html>";
    return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }

  function runtime(
    ledger: VerificationLedger,
    eliFetch: ReturnType<typeof eli>,
    adopted: unknown[],
    options: { localModel?: boolean; freshness?: unknown; acts?: Act[]; index?: CoreLawVerificationIndex } = {}
  ) {
    return new LegalVerificationToolRuntime(
      ledger,
      new OfficialLegalSourceVerifier(async (input: string | URL) => officialText(String(input)), () => CHECKED),
      undefined,
      (options.freshness ?? freshness) as never,
      undefined,
      undefined,
      options.index ?? index(...(options.acts ?? [kw()])),
      eliFetch.fetcher as never,
      (act) => adopted.push(act),
      options.localModel === true
    );
  }

  it("KW z map DR weryfikowany w źródle ELI, nie tylko w lokalnej kopii", async () => {
    const ledger = new VerificationLedger();
    const adopted: unknown[] = [];
    const [result] = await runtime(ledger, eli(), adopted).runTools([
      { id: "w1", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } }
    ]);
    const payload = JSON.parse(result!.content);
    expect(payload).toMatchObject({ status: "VERIFIED", act: { id: "ELI", title: "Kodeks wykroczeń", baseEli: "DU/1971/114" } });
    expect(payload.marker).toBe(`✅ [VER: ${KW_URL}, 2026-09-29]`);
    expect(adopted).toMatchObject([{ eli: "DU/2025/734", baseEli: "DU/1971/114" }]);
  });

  it("akt spoza map znaleziony po tytule w ELI, zweryfikowany i dołączony do kopii (RAG)", async () => {
    const ledger = new VerificationLedger();
    const adopted: unknown[] = [];
    const [result] = await runtime(ledger, eli(), adopted).runTools([
      {
        id: "w2",
        name: "verify_legal_reference",
        input: { claim: "art. 4 ustawy o drogach publicznych", kind: "statute", act: "ustawy o drogach publicznych" }
      }
    ]);
    expect(JSON.parse(result!.content)).toMatchObject({ status: "VERIFIED", act: { id: "ELI", title: "o drogach publicznych" } });
    expect(adopted).toMatchObject([{ eli: "DU/2025/889", baseEli: "DU/1985/14" }]);
  });

  it("model w chmurze: lokalna kopia tylko przy awarii ELI, z wyraźną informacją", async () => {
    const ledger = new VerificationLedger();
    const adopted: unknown[] = [];
    const rt = runtime(ledger, eli({ down: true }), adopted);
    const [kwResult, outside] = await rt.runTools([
      { id: "w3", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } },
      { id: "w4", name: "verify_legal_reference", input: { claim: "art. 4 ustawy o drogach publicznych", kind: "statute", act: "ustawy o drogach publicznych" } }
    ]);
    const kwPayload = JSON.parse(kwResult!.content);
    expect(kwPayload).toMatchObject({
      status: "VERIFIED",
      act: { sourceKind: "local_eli_copy" },
      sourceNotice: { eliUnavailable: true, localCopyDate: "2026-09-20" }
    });
    expect(kwPayload.sourceNotice.cause).toMatch(/^ELI_UNAVAILABLE:/);
    expect(kwPayload.instruction).toContain("lokalnej kopii ELI");
    expect(JSON.parse(outside!.content)).toMatchObject({ status: "DENIED", localCopy: "UNKNOWN_LEGAL_ACT" });
    expect(JSON.parse(outside!.content).error).toMatch(/^ELI_UNAVAILABLE:/);
    expect(adopted).toEqual([]);
  });

  it("model w chmurze: KK z ELI; kopia przy braku metadanych ELI, nie przy nowelizacjach po t.j.", async () => {
    const at = (status: string) => ({
      check: async (descriptor: { baseEli: string; eli: string }) => ({
        status,
        mode: "CURRENT" as const,
        checkedAt: CHECKED,
        baseEli: descriptor.baseEli,
        pinnedEli: descriptor.eli,
        amendmentsAfter: []
      })
    });
    const kk = act({
      eli: "DU/2025/383",
      title: "Kodeks karny",
      labels: ["KK"],
      url: "https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf",
      articles: { "178a": "Art. 178a. § 1. Kto, znajdując się w stanie nietrzeźwości, prowadzi pojazd mechaniczny, podlega karze." }
    });
    const call = { id: "k1", name: "verify_legal_reference", input: { claim: "art. 178a § 1 KK", kind: "statute", act: "KK" } };

    const outage = await runtime(new VerificationLedger(), eli(), [], { freshness: at("SOURCE_METADATA_UNAVAILABLE"), acts: [kk] })
      .runTools([call]);
    expect(JSON.parse(outage[0]!.content)).toMatchObject({
      status: "VERIFIED",
      sourceNotice: { eliUnavailable: true, cause: "ELI_UNAVAILABLE:TEMPORAL_SOURCE_METADATA_UNAVAILABLE" }
    });

    const amended = await runtime(new VerificationLedger(), eli(), [], { freshness: at("POST_TJ_AMENDMENTS"), acts: [kk] })
      .runTools([call]);
    const payload = JSON.parse(amended[0]!.content);
    expect(payload).toMatchObject({ status: "DENIED", error: "TEMPORAL_POST_TJ_AMENDMENTS" });
    expect(payload.sourceNotice).toBeUndefined();
  });

  it("model lokalny: najpierw kopia (bez ELI); gdy kopia nie ma aktu, ELI i dołączenie do RAG", async () => {
    const ledger = new VerificationLedger();
    const adopted: unknown[] = [];
    const eliFetch = eli();
    const rt = runtime(ledger, eliFetch, adopted, { localModel: true });
    const [kwResult, outside] = await rt.runTools([
      { id: "l1", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } },
      { id: "l2", name: "verify_legal_reference", input: { claim: "art. 4 ustawy o drogach publicznych", kind: "statute", act: "ustawy o drogach publicznych" } }
    ]);
    expect(JSON.parse(kwResult!.content)).toMatchObject({ status: "VERIFIED", act: { sourceKind: "local_eli_copy" } });
    expect(JSON.parse(kwResult!.content).sourceNotice).toBeUndefined();
    expect(JSON.parse(outside!.content)).toMatchObject({ status: "VERIFIED", act: { id: "ELI" } });
    expect(adopted).toMatchObject([{ eli: "DU/2025/889" }]);
    expect(eliFetch.requested.some((url) => url.includes("/DU/2025/734"))).toBe(false);
  });
  it("model lokalny: przed użyciem kopii sprawdzenie w ELI; nowsza wersja -> weryfikacja w ELI, brak ELI -> kopia z informacją", async () => {
    const withCheck = (state: "CURRENT" | "UPDATE_FOUND" | "UNREACHABLE") => {
      const current = kw();
      const checked: string[] = [];
      const idx: CoreLawVerificationIndex = {
        ...index(current),
        confirmCurrent: async (eli: string) => {
          checked.push(eli);
          // Jak CoreLawIndex: znaleziona zmiana jest zapisywana jako oczekująca.
          if (state === "UPDATE_FOUND") {
            current.summary.pendingConsolidated = { eli: "DU/2026/77", title: null, promulgation: null };
          }
          return state === "UNREACHABLE"
            ? { state, checkedAt: null, error: "ELI_HTTP_503" }
            : { state, checkedAt: CHECKED };
        }
      };
      return { idx, checked, act: current };
    };
    const call = { id: "u1", name: "verify_legal_reference", input: { claim: "art. 51 § 1 KW", kind: "statute", act: "KW" } };

    const current = withCheck("CURRENT");
    const [ok] = await runtime(new VerificationLedger(), eli(), [], { localModel: true, index: current.idx }).runTools([call]);
    expect(current.checked).toEqual(["DU/2025/734"]);
    expect(JSON.parse(ok!.content)).toMatchObject({
      status: "VERIFIED",
      act: { sourceKind: "local_eli_copy" },
      freshness: { liveCheck: "CURRENT" }
    });

    const updated = withCheck("UPDATE_FOUND");
    const adopted: unknown[] = [];
    const [live] = await runtime(new VerificationLedger(), eli(), adopted, { localModel: true, index: updated.idx }).runTools([call]);
    const livePayload = JSON.parse(live!.content);
    expect(livePayload).toMatchObject({ status: "VERIFIED", act: { id: "ELI" } });
    expect(livePayload.act.sourceKind).not.toBe("local_eli_copy");
    expect(adopted).toMatchObject([{ eli: "DU/2025/734" }]);

    const down = withCheck("UNREACHABLE");
    const [copy] = await runtime(new VerificationLedger(), eli(), [], { localModel: true, index: down.idx }).runTools([call]);
    expect(JSON.parse(copy!.content)).toMatchObject({
      status: "VERIFIED",
      act: { sourceKind: "local_eli_copy" },
      freshness: { liveCheck: "UNREACHABLE" },
      sourceNotice: { eliUnavailable: true, cause: "ELI_UNAVAILABLE:ELI_HTTP_503", localCopyDate: "2026-09-20" }
    });
  });
});
