import type { CoreLawIndex } from "./core-law-index.js";
import type {
  VerificationKind,
  VerificationRecord
} from "./verification-ledger.js";

/**
 * verify_legal_reference dla aktów spoza rejestru deterministycznego (KC, KPC, KPK, KK):
 * akt z map DR i jego tekst z lokalnej kopii ELI (CoreLawIndex).
 *
 * - nowelizacje po tekście jednolitym, akt nieobowiązujący, stan historyczny -> odmowa;
 * - relacje ELI sprawdzone w ciągu 24 h -> VERIFIED (jak ścieżka sieciowa);
 * - brak takiego sprawdzenia (offline, stara kopia) -> SUPPORTED z datą kopii, nigdy VERIFIED.
 */
export const CORE_LAW_FRESH_CHECK_MS = 24 * 60 * 60 * 1000;

export type CoreLawVerificationOutcome =
  | {
      decision: "DENY";
      reason: string;
    }
  | {
      decision: "RECORD";
      record: VerificationRecord;
      act: {
        eli: string;
        currentEli: string;
        title: string;
        relationsCheckedAt: string | null;
      };
    };

function articleToken(claim: string): string | null {
  return /\bart\.?\s+(\d+[a-ząćęłńóśźż]*)/iu
    .exec(claim)?.[1]
    ?.toLocaleLowerCase("pl") ?? null;
}

function journalMatches(claim: string, elis: string[]): boolean {
  const year = /\b(19\d{2}|20\d{2})\b/u.exec(claim)?.[1];
  const position = /\bpoz\.?\s*(\d+)\b/iu.exec(claim)?.[1];
  if (!year || !position) return false;
  return elis.includes(`DU/${year}/${Number(position)}`);
}

export function localCopyMarker(record: VerificationRecord): string | null {
  if (
    record.status !== "SUPPORTED" ||
    record.supportScope !== "LOCAL_ELI_COPY" ||
    !record.sourceUrl ||
    !record.localCopyFetchedAt
  ) {
    return null;
  }
  return [
    "[KOPIA-ELI: ",
    record.sourceUrl,
    ", kopia z ",
    record.localCopyFetchedAt.slice(0, 10),
    ", ",
    record.freshnessCheckedAt
      ? "nowelizacje sprawdzone " + record.freshnessCheckedAt.slice(0, 10)
      : "nowelizacji nie sprawdzono",
    "]"
  ].join("");
}

export function verifyFromCoreLaw(args: {
  index: Pick<CoreLawIndex, "resolve" | "summary" | "currentRecord">;
  claim: string;
  kind: VerificationKind;
  act: string;
  asOf?: string;
  toolCallId: string;
  now?: number;
}): CoreLawVerificationOutcome {
  if (args.asOf) {
    return { decision: "DENY", reason: "CORE_LAW_CURRENT_STATE_ONLY" };
  }
  const ref = args.index.resolve(args.act);
  if (!ref) return { decision: "DENY", reason: "UNKNOWN_LEGAL_ACT" };
  const summary = args.index.summary(ref.eli);
  if (!summary) return { decision: "DENY", reason: "CORE_LAW_ACT_NOT_IN_MAP" };
  const record = args.index.currentRecord(ref.eli);
  if (!record || record.articleOrder.length === 0) {
    return { decision: "DENY", reason: "CORE_LAW_TEXT_UNAVAILABLE" };
  }
  if (summary.amendmentsAfter.length > 0) {
    return { decision: "DENY", reason: "TEMPORAL_POST_TJ_AMENDMENTS" };
  }
  if (
    record.status &&
    !record.status.toLocaleLowerCase("pl").includes("obowiązując")
  ) {
    return { decision: "DENY", reason: "TEMPORAL_ACT_NOT_IN_FORCE" };
  }

  let evidence: string | undefined;
  if (args.kind === "statute") {
    const article = articleToken(args.claim);
    evidence = article ? record.articles[article] : undefined;
  } else if (args.kind === "journal") {
    evidence = journalMatches(args.claim, [summary.eli, record.eli])
      ? record.title
      : undefined;
  } else {
    return { decision: "DENY", reason: "CORE_LAW_UNSUPPORTED_KIND" };
  }

  const now = args.now ?? Date.now();
  const checkedAt = summary.relationsCheckedAt;
  const freshlyChecked =
    summary.consolidated &&
    checkedAt !== null &&
    !Number.isNaN(Date.parse(checkedAt)) &&
    now - Date.parse(checkedAt) < CORE_LAW_FRESH_CHECK_MS;

  const base = {
    claim: args.claim,
    kind: args.kind,
    sourceUrl: record.sourceUrl,
    sourceTier: "R1" as const,
    toolCallId: args.toolCallId,
    verificationMethod: "file_read" as const,
    sourceFormat: record.textSource === "pdf" ? "PDF" as const : "TEXT" as const,
    temporalMode: "CURRENT" as const,
    currentEli: record.eli
  };

  const verificationRecord: VerificationRecord = !evidence
    ? {
        ...base,
        status: "UNVERIFIED",
        fetchedAt: new Date(now).toISOString(),
        evidence:
          "Lokalna kopia ELI aktu nie zawiera wskazanej jednostki redakcyjnej."
      }
    : freshlyChecked
      ? {
          ...base,
          status: "VERIFIED",
          fetchedAt: record.fetchedAt,
          temporalFreshnessStatus: "CURRENT",
          freshnessCheckedAt: checkedAt!,
          evidence: evidence.slice(0, 4_000)
        }
      : {
          ...base,
          status: "SUPPORTED",
          fetchedAt: record.fetchedAt,
          supportScope: "LOCAL_ELI_COPY",
          localCopyFetchedAt: record.fetchedAt,
          ...(checkedAt ? { freshnessCheckedAt: checkedAt } : {}),
          evidence: evidence.slice(0, 4_000)
        };

  return {
    decision: "RECORD",
    record: verificationRecord,
    act: {
      eli: summary.eli,
      currentEli: record.eli,
      title: record.title,
      relationsCheckedAt: checkedAt
    }
  };
}
