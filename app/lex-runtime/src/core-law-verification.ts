import type { CoreLawIndex } from "./core-law-index.js";
import { searchStems } from "./core-law-search.js";
import { anchoredUrl } from "./source-anchor.js";
import {
  FRESHNESS_MAX_AGE_MS,
  type VerificationKind,
  type VerificationRecord
} from "./verification-ledger.js";

/**
 * verify_legal_reference na lokalnej kopii ELI (CoreLawIndex, akty z map DR), bez sieci.
 *
 * O wyniku decyduje prawidłowość powołania, nie skrót aktu:
 * - akt rozpoznany po ELI, Dz.U., nazwie z mapy albo po treści tytułu (rdzenie słów,
 *   odporne na odmianę: "ustawy o wychowaniu w trzeźwości" = tytuł aktu);
 * - jednostka redakcyjna musi istnieć w tekście jednolitym, a podany cytat musi się w niej
 *   znajdować; wtedy VERIFIED ze wskazaniem ELI i daty kopii, inaczej UNVERIFIED;
 * - odmowa tylko wtedy, gdy kopia nie może być prawidłowa: znane nowelizacje po tekście
 *   jednolitym, akt nieobowiązujący, stan historyczny albo brak tekstu.
 */

export type CoreLawVerificationIndex = Pick<
  CoreLawIndex,
  "resolve" | "summary" | "summaries" | "currentRecord"
> &
  // Sprawdzenie w ELI przy użyciu kopii (CoreLawIndex); bez niego kopia bez kontroli na żywo.
  Partial<Pick<CoreLawIndex, "confirmCurrent">>;

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
        resolvedBy: "REFERENCE" | "TITLE";
        relationsCheckedAt: string | null;
      };
    };

// Nazwa podana przez model musi być w >= 75% pokryta rdzeniami tytułu aktu.
const TITLE_MATCH_MIN = 0.75;

function articleToken(claim: string): string | null {
  return /\bart(?:\.|ykuł\p{L}*)?\s+(\d+[a-ząćęłńóśźż]*)/iu
    .exec(claim)?.[1]
    ?.toLocaleLowerCase("pl") ?? null;
}

function journalMatches(claim: string, elis: string[]): boolean {
  const year = /\b(19\d{2}|20\d{2})\b/u.exec(claim)?.[1];
  const position = /\bpoz\.?\s*(\d+)\b/iu.exec(claim)?.[1];
  if (!year || !position) return false;
  return elis.includes(`DU/${year}/${Number(position)}`);
}

function comparable(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("pl")
    .replace(/[„”"«»]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function titleStems(value: string): Set<string> {
  return new Set(
    searchStems(
      value.replace(/\b(?:z\s+dnia\s+)?\d{1,2}\s+\S+\s+\d{4}\s*r?\.?/giu, " ")
    ).filter((stem) => !/^\d+$/.test(stem) && stem !== "dnia")
  );
}

// Odmiana skraca albo zmienia końcówkę ("karny"/"karnego" -> "karny"/"karneg"): wspólny
// przedrostek >= 4 liter, najwyżej jedna litera krócej niż krótszy rdzeń.
function stemsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
  return common >= 4 && common >= Math.min(a.length, b.length) - 1;
}

/**
 * Akt po treści nazwy (odporne na odmianę): pokrycie rdzeni nazwy z zapytania przez tytuł,
 * remis rozstrzyga pokrycie tytułu ("kodeks karny" -> KK, nie KKS); bez jednoznaczności null.
 */
export function resolveActByTitle(
  index: Pick<CoreLawIndex, "summaries">,
  act: string
): string | null {
  const wanted = titleStems(act);
  if (wanted.size === 0) return null;
  const scored = index
    .summaries()
    .filter((summary) => summary.title && summary.articleCount > 0)
    .map((summary) => {
      const title = titleStems(summary.title!);
      const shared = [...wanted].filter((stem) =>
        [...title].some((candidate) => stemsMatch(stem, candidate))
      ).length;
      return {
        eli: summary.eli,
        query: shared / wanted.size,
        title: title.size ? shared / title.size : 0
      };
    })
    .filter((item) => item.query >= TITLE_MATCH_MIN)
    .sort((a, b) => b.query - a.query || b.title - a.title);
  const [best, second] = scored;
  if (!best) return null;
  if (second && second.query === best.query && second.title === best.title) return null;
  return best.eli;
}

export function verifyFromCoreLaw(args: {
  index: CoreLawVerificationIndex;
  claim: string;
  kind: VerificationKind;
  act: string;
  quote?: string;
  asOf?: string;
  toolCallId: string;
  now?: number;
}): CoreLawVerificationOutcome {
  if (args.asOf) {
    return { decision: "DENY", reason: "CORE_LAW_CURRENT_STATE_ONLY" };
  }
  const byReference = args.index.resolve(args.act)?.eli ?? null;
  const eli = byReference ?? resolveActByTitle(args.index, args.act);
  if (!eli) return { decision: "DENY", reason: "UNKNOWN_LEGAL_ACT" };
  const summary = args.index.summary(eli);
  if (!summary) return { decision: "DENY", reason: "CORE_LAW_ACT_NOT_IN_MAP" };
  const record = args.index.currentRecord(eli);
  if (!record || record.articleOrder.length === 0) {
    return { decision: "DENY", reason: "CORE_LAW_TEXT_UNAVAILABLE" };
  }
  if (summary.amendmentsAfter.length > 0) {
    return { decision: "DENY", reason: "TEMPORAL_POST_TJ_AMENDMENTS" };
  }
  // Tekst z OCR skanu może mieć błędy odczytu: nie jest podstawą VERIFIED.
  if (record.textSource === "ocr") {
    return { decision: "DENY", reason: "CORE_LAW_OCR_TEXT" };
  }
  // A newer t.j. or new amendments were found but not applied yet
  // (automatic updates off): the copy is not the current wording.
  if (summary.pendingConsolidated || summary.pendingAmendments.length > 0) {
    return { decision: "DENY", reason: "TEMPORAL_UPDATE_PENDING" };
  }
  if (
    record.status &&
    !record.status.toLocaleLowerCase("pl").includes("obowiązując")
  ) {
    return { decision: "DENY", reason: "TEMPORAL_ACT_NOT_IN_FORCE" };
  }
  // T.j. zawiera zmiany w vacatio legis (KP t.j. 2026/1245 ze zmianą od 5.11.2026): bez
  // tekstu noweli nie wiadomo, czy dotyka artykułu, więc brzmienie z kopii nie jest
  // pewnym brzmieniem obowiązującym dziś. Numer Dz.U. t.j. pozostaje prawidłowy.
  if (args.kind === "statute" && summary.notYetInForce.length > 0) {
    return { decision: "DENY", reason: "TEMPORAL_NOT_YET_IN_FORCE" };
  }

  let evidence: string | undefined;
  let anchor: string | undefined;
  let failure = "";
  if (args.kind === "statute") {
    const article = articleToken(args.claim);
    anchor = article ? record.articleAnchors?.[article] : undefined;
    evidence = article ? record.articles[article] : undefined;
    // Zgubiony nagłówek przy wyciąganiu z PDF: ten artykuł może zawierać tekst następnego.
    if (article && record.extractionCheck?.suspectArticles.includes(article)) {
      return { decision: "DENY", reason: "CORE_LAW_EXTRACTION_SUSPECT" };
    }
    if (!evidence) {
      failure = "Tekst jednolity ELI nie zawiera wskazanej jednostki redakcyjnej.";
    } else if (
      args.quote?.trim() &&
      !comparable(evidence).includes(comparable(args.quote))
    ) {
      evidence = undefined;
      failure = "Podany cytat nie występuje w tej jednostce redakcyjnej tekstu jednolitego ELI.";
    }
  } else if (args.kind === "journal") {
    evidence = journalMatches(args.claim, [summary.eli, record.eli])
      ? record.title
      : undefined;
    if (!evidence) failure = "Numer Dz.U. nie odpowiada rozpoznanemu aktowi.";
  } else {
    return { decision: "DENY", reason: "CORE_LAW_UNSUPPORTED_KIND" };
  }

  const now = args.now ?? Date.now();
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

  // Brzmienie na dzień pobrania kopii z ELI; ostatnie sprawdzenie relacji, jeśli było późniejsze.
  const checkedAt =
    summary.relationsCheckedAt &&
    Date.parse(summary.relationsCheckedAt) > Date.parse(record.fetchedAt)
      ? summary.relationsCheckedAt
      : record.fetchedAt;

  // Kopia niesprawdzana w ELI dłużej niż limit (ELI zablokowane, odświeżanie wyłączone)
  // nie jest podstawą VERIFIED/CURRENT.
  if (evidence && !(now - Date.parse(checkedAt) <= FRESHNESS_MAX_AGE_MS)) {
    return { decision: "DENY", reason: "TEMPORAL_COPY_STALE" };
  }

  const sourceAnchorUrl = anchoredUrl(record.sourceUrl, anchor);
  const verificationRecord: VerificationRecord = evidence
    ? {
        ...base,
        status: "VERIFIED",
        ...(sourceAnchorUrl ? { sourceAnchorUrl } : {}),
        fetchedAt: record.fetchedAt,
        temporalFreshnessStatus: "CURRENT",
        freshnessCheckedAt: checkedAt,
        evidence: evidence.slice(0, 4_000)
      }
    : {
        ...base,
        status: "UNVERIFIED",
        fetchedAt: new Date(now).toISOString(),
        evidence: failure
      };

  return {
    decision: "RECORD",
    record: verificationRecord,
    act: {
      eli: summary.eli,
      currentEli: record.eli,
      title: record.title,
      resolvedBy: byReference ? "REFERENCE" : "TITLE",
      relationsCheckedAt: summary.relationsCheckedAt
    }
  };
}
