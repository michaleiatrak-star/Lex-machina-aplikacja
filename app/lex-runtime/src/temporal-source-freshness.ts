import { todayWarsaw } from "./warsaw-date.js";
import { ARTICLE_LEAD } from "./legal-act-abbreviations.js";
import { superscriptsAsCaret } from "./legal-source-verifier.js";
import {
  LocalPdfTextExtractor,
  type PdfTextExtractor
} from "./pdf-text-extractor.js";
import {
  AmendmentApplicabilityResolver,
  partEntryDates,
  type AmendmentApplicabilityDecision
} from "./amendment-applicability.js";
import type {
  LegalActDescriptor
} from "./legal-act-resolver.js";

export type TemporalFreshnessStatus =
  | "CURRENT"
  | "HISTORICAL"
  | "STALE_CONSOLIDATED_TEXT"
  | "POST_TJ_AMENDMENTS"
  // The t.j. already holds an amendment of the article that is not in force yet: the text
  // may carry the future wording (two wordings with an "enters into force" note).
  | "PENDING_WORDING_IN_CONSOLIDATED_TEXT"
  | "AMENDMENT_EFFECT_DATE_UNKNOWN"
  | "CURRENT_TEXT_REQUIRES_PDF"
  | "HISTORICAL_TEXT_REQUIRES_PDF"
  | "REPEALED_CONSOLIDATED_TEXT"
  | "ACT_NOT_IN_FORCE_AT_DATE"
  | "NO_HISTORICAL_CONSOLIDATED_TEXT"
  | "HISTORICAL_POST_TJ_AMENDMENTS"
  | "INVALID_HISTORICAL_DATE"
  | "NO_CURRENT_CONSOLIDATED_TEXT"
  | "SOURCE_METADATA_UNAVAILABLE";

export type TemporalAmendment = {
  eli: string;
  displayAddress: string;
  promulgation: string;
  relationDate?: string;
  title: string;
  provenance: "DATE" | "API" | "DATE+API";
};

export type TemporalFreshnessResult = {
  status: TemporalFreshnessStatus;
  mode: "CURRENT" | "HISTORICAL";
  checkedAt: string;
  baseEli: string;
  pinnedEli: string;
  requestedAsOf?: string;
  currentEli?: string;
  currentPromulgation?: string;
  sourceUrl?: string;
  actValidFrom?: string;
  actValidTo?: string;
  amendmentsAfter: TemporalAmendment[];
  amendmentApplicability?: AmendmentApplicabilityDecision[];
  // Amendments not yet in force whose change of the article the consolidated text already
  // prints: the article is verified only by the wording its footnotes put in force today.
  pendingWordingAmendments?: string[];
  // Amendments in force whose change of this article enters into force later (staged dates).
  notYetForArticle?: string[];
  // Transitional provisions of the amendments touching the article, from their own text.
  transitionalProvisions?: Array<{ eli: string; text: string }>;
  // The registry's pinned t.j. was replaced in ELI: the in-force one (currentEli) is used.
  pinnedSuperseded?: boolean;
  // The in-force t.j. is announced but ELI has no text of it yet: the wording comes from the
  // previous t.j. (textEli) checked against every amendment after it.
  textPendingEli?: string;
  textEli?: string;
  reason?: string;
};

export type TemporalFreshnessOptions = {
  asOf?: string;
  claim?: string;
};

export type EliFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

type EliAct = {
  ELI?: unknown;
  year?: unknown;
  pos?: unknown;
  status?: unknown;
  displayAddress?: unknown;
  title?: unknown;
  promulgation?: unknown;
  announcementDate?: unknown;
  entryIntoForce?: unknown;
  validFrom?: unknown;
  repealDate?: unknown;
  expirationDate?: unknown;
  legalStatusDate?: unknown;
  date?: unknown;
  textHTML?: unknown;
  textPDF?: unknown;
};

type HistoricalCandidate = {
  eli: string;
  metadata: EliAct;
  stateDate: string;
  sourceUrl?: string;
};

const ELI_API = "https://api.sejm.gov.pl/eli/acts";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dateOnly(value: unknown): string {
  const match = text(value).match(/^(\d{4}-\d{2}-\d{2})/u);
  return match?.[1] ?? "";
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function normalizeEli(value: unknown): string {
  const raw = text(value).replace(
    /^https?:\/\/[^/]+\/eli\/acts\//u,
    ""
  );
  const match = raw.match(/(DU|MP)\/(\d{4})\/(\d+)/u);
  return match?.[0] ?? "";
}

function unwrapAct(value: unknown): EliAct | null {
  if (!value || typeof value !== "object") return null;
  const wrapper = value as Record<string, unknown>;
  if (wrapper.act && typeof wrapper.act === "object") {
    const act = wrapper.act as EliAct;
    return {
      ...act,
      ...(wrapper.date !== undefined && act.date === undefined
        ? { date: wrapper.date }
        : {})
    };
  }
  return wrapper as EliAct;
}

function list(refs: unknown, relation: string): unknown[] {
  if (!refs || typeof refs !== "object") return [];
  const value = (refs as Record<string, unknown>)[relation];
  return Array.isArray(value) ? value : [];
}

function activeStatus(value: unknown): boolean {
  return text(value)
    .toLocaleLowerCase("pl")
    .includes("obowiązując");
}

function repealedStatus(value: unknown): boolean {
  const status = text(value).toLocaleLowerCase("pl");
  return (
    status.includes("uchyl") ||
    status.includes("wygaś") ||
    status.includes("utracił moc") ||
    status.includes("utrata mocy") ||
    status.includes("nieobowiąz")
  );
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function validityStart(act: EliAct): string {
  return (
    dateOnly(act.validFrom) ||
    dateOnly(act.entryIntoForce) ||
    dateOnly(act.legalStatusDate) ||
    dateOnly(act.promulgation) ||
    dateOnly(act.announcementDate)
  );
}

function validityEnd(act: EliAct): string {
  return [
    dateOnly(act.repealDate),
    dateOnly(act.expirationDate)
  ].filter(Boolean).sort()[0] ?? "";
}

function isInForceAt(
  act: EliAct,
  asOf: string
): {
  inForce: boolean;
  validFrom: string;
  validTo: string;
} {
  const validFrom = validityStart(act);
  const validTo = validityEnd(act);
  return {
    inForce:
      Boolean(validFrom) &&
      asOf >= validFrom &&
      (!validTo || asOf < validTo),
    validFrom,
    validTo
  };
}

function parts(
  eli: string
): [string, string, string] | null {
  const match = normalizeEli(eli).match(
    /^(DU|MP)\/(\d{4})\/(\d+)$/u
  );
  return match
    ? [match[1]!, match[2]!, match[3]!]
    : null;
}

function apiUrl(eli: string, suffix = ""): string | null {
  const split = parts(eli);
  if (!split) return null;
  return (
    ELI_API +
    "/" +
    split[0] +
    "/" +
    split[1] +
    "/" +
    split[2] +
    suffix
  );
}

// Zawieszone ELI nie blokuje tury na czas domyślnego limitu undici (ok. 300 s).
const ELI_REQUEST_TIMEOUT_MS = 15_000;
// Tekst noweli w PDF bywa duży (cały numer Dz.U.).
const ELI_PDF_TIMEOUT_MS = 60_000;

async function json(
  fetcher: EliFetch,
  url: string
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(ELI_REQUEST_TIMEOUT_MS),
    headers: { Accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error("ELI_HTTP_" + response.status);
  }
  return response.json();
}

function articleTokenFromClaim(
  claim?: string
): string | null {
  // "art. 385¹", "art. 385^1", "art. 385[1]", "art. 385(1)": the superscript stays a part of
  // the number (385^1), never dropped (385) nor glued to it (3851).
  const match =
    claim && superscriptsAsCaret(claim)
      .replace(/(\d)\s*[([](\d{1,3})[)\]]/gu, "$1^$2")
      .match(
        new RegExp(`${ARTICLE_LEAD}(\\d+(?:\\^\\d+)?[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)`, "iu")
      );
  return match?.[1]
    ?.toLocaleLowerCase("pl") ??
    null;
}

// One amending act is read several times in a check (does it touch the article, its entry
// dates, its transitional provisions): kept for a few minutes per fetcher.
const BODY_CACHE_MS = 10 * 60 * 1000;
const bodyCache = new WeakMap<EliFetch, Map<string, { at: number; body: Promise<string | null> }>>();

const AMENDMENT_RETRY_MS = 1500;

function amendmentBody(
  fetcher: EliFetch,
  pdfTextExtractor: PdfTextExtractor,
  eli: string
): Promise<string | null> {
  let cache = bodyCache.get(fetcher);
  if (!cache) bodyCache.set(fetcher, (cache = new Map()));
  const hit = cache.get(eli);
  if (hit && Date.now() - hit.at < BODY_CACHE_MS) return hit.body;
  // One more try after a pause: of a dozen checks run at once one read may fail (RD 121/26:
  // art. 190a and 245 KK unverified in the turn, verified when checked again).
  const body = fetchAmendmentBody(fetcher, pdfTextExtractor, eli).then(
    (first) => first ?? new Promise<string | null>((resolve) => setTimeout(() => resolve(fetchAmendmentBody(fetcher, pdfTextExtractor, eli)), AMENDMENT_RETRY_MS))
  );
  cache.set(eli, { at: Date.now(), body });
  // A failed read is not kept: the next check tries again.
  void body.then((value) => {
    if (value === null) cache!.delete(eli);
  });
  while (cache.size > 32) cache.delete(cache.keys().next().value!);
  return body;
}

// Przepisy przejściowe noweli (czynności i sprawy sprzed jej wejścia w życie): jednostki
// "Art. M." poza częściami zmieniającymi ustawy, z formułą intertemporalną.
const TRANSITIONAL =
  /dotychczasow|wszczęt\p{L}*\s+i\s+niezakończon|stosuje\s+się\s+przepisy|zachowuj\p{L}*\s+moc|przed\s+dniem\s+wejścia\s+w\s+życie\s+niniejszej\s+ustawy/u;

export function transitionalProvisions(body: string, limit = 3): string[] {
  return body
    .split(/(?=\bart\.\s*\d+[a-ząćęłńóśźż]*\.\s)/iu)
    .filter((unit) => /^art\./iu.test(unit) && !/^art\.\s*\d+[a-z]*\.\s+w\s+ustawie\b/iu.test(unit) && TRANSITIONAL.test(unit))
    .slice(0, limit)
    .map((unit) => unit.replace(/\s+/gu, " ").trim().slice(0, 900));
}

// Tekst noweli z ELI (HTML albo PDF), znormalizowany do porównań; null, gdy niedostępny.
async function fetchAmendmentBody(
  fetcher: EliFetch,
  pdfTextExtractor: PdfTextExtractor,
  eli: string
): Promise<string | null> {
  const metadataUrl =
    apiUrl(eli);
  const htmlUrl =
    apiUrl(
      eli,
      "/text.html"
    );
  if (
    !metadataUrl ||
    !htmlUrl
  ) {
    return null;
  }

  let metadata: unknown;
  try {
    metadata =
      await json(
        fetcher,
        metadataUrl
      );
  } catch {
    return null;
  }
  const act =
    unwrapAct(metadata);
  if (
    !act ||
    (
      act.textHTML !== true &&
      act.textPDF !== true
    )
  ) {
    return null;
  }

  let rawText = "";

  if (act.textHTML === true) {
    let response: Response;
    try {
      response =
        await fetcher(
          htmlUrl,
          {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(ELI_REQUEST_TIMEOUT_MS),
            headers: {
              Accept:
                "text/html,application/xhtml+xml,text/plain"
            }
          }
        );
    } catch {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    rawText =
      await response.text();
  } else if (
    act.textPDF === true
  ) {
    const pdfUrl =
      apiUrl(
        eli,
        "/text.pdf"
      );
    if (!pdfUrl) {
      return null;
    }
    let response: Response;
    try {
      response =
        await fetcher(
          pdfUrl,
          {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(ELI_PDF_TIMEOUT_MS),
            headers: {
              Accept:
                "application/pdf"
            }
          }
        );
    } catch {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    try {
      const extracted =
        await pdfTextExtractor.extract(
          new Uint8Array(
            await response.arrayBuffer()
          )
        );
      rawText =
        extracted.text;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  // Superscripts first (art. 385¹ -> 385^1): NFKC alone would make "3851" of it.
  return superscriptsAsCaret(rawText)
    .normalize("NFKC")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pl");
}

const ARTICLE_UNIT =
  "\\d+(?:\\^\\d+)?[a-ząćęłńóśźż]*";
// "art. 10", "art. 10–15", "art. 10 do 15", "art. 10, 11 i 12"; po "§", "ust.", "pkt"
// kolejne liczby to jednostki niższego rzędu, więc wyliczenie się kończy.
const ARTICLE_GROUP =
  new RegExp(
    `\\bart\\.?\\s*(${ARTICLE_UNIT}(?:\\s*(?:[–—-]|,|\\bi\\b|\\boraz\\b|\\bdo\\b)\\s*${ARTICLE_UNIT})*)(?![\\p{L}\\d])`,
    "giu"
  );
const ARTICLE_GROUP_PART =
  new RegExp(
    `([–—-]|\\bdo\\b)|(${ARTICLE_UNIT})`,
    "giu"
  );

function articleKey(
  unit: string
): [number, string] | null {
  const match =
    /^(\d+)(?:\^(\d+))?([a-ząćęłńóśźż]*)$/u.exec(
      unit.toLocaleLowerCase("pl")
    );
  // 385 < 385^1 < 385^2 < 385^10 < 385a: the superscript, padded, sorts before letters.
  return match
    ? [Number(match[1]), `${match[2] ? `^${match[2].padStart(3, "0")}` : ""}${match[3]!}`]
    : null;
}

function compareArticles(
  a: [number, string],
  b: [number, string]
): number {
  return a[0] - b[0] ||
    (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
}

/**
 * Czy tekst noweli powołuje artykuł, także w zakresie ("art. 10–15") albo wyliczeniu
 * ("art. 10, 11 i 12"). Zakres bez pewnego rozstrzygnięcia (odwrócone granice): null.
 */
export function amendmentMentionsArticle(
  body: string,
  article: string
): boolean | null {
  const wanted =
    articleKey(article);
  if (!wanted) return null;
  let uncertain = false;
  for (const group of body.matchAll(ARTICLE_GROUP)) {
    let previous: [number, string] | null = null;
    let range = false;
    for (const part of group[1]!.matchAll(ARTICLE_GROUP_PART)) {
      if (part[1]) {
        range = true;
        continue;
      }
      const key =
        articleKey(part[2]!);
      if (!key) {
        uncertain = true;
        continue;
      }
      if (compareArticles(key, wanted) === 0) return true;
      if (range && previous) {
        if (compareArticles(previous, key) > 0) uncertain = true;
        else if (
          compareArticles(previous, wanted) < 0 &&
          compareArticles(wanted, key) < 0
        ) {
          return true;
        }
      }
      previous = key;
      range = false;
    }
  }
  return uncertain ? null : false;
}

const flat = (text: string) =>
  text
    .replace(/-\s*\n\s*/gu, "")
    // A word split at a line end, after the text was put on one line ("cy- wilny").
    .replace(/(\p{Ll})-\s+(\p{Ll})/gu, "$1$2")
    .replace(/[–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pl")
    .trim();

/** The act's name as an amending act cites it ("kodeks cywilny", "o transporcie kolejowym"). */
export function actCitationKey(title: string): string {
  let key = flat(title);
  const consolidated = /jednolitego tekstu (.+)$/u.exec(key);
  if (consolidated) key = consolidated[1]!;
  return key
    .replace(/^(?:ustawy|ustawa|rozporządzenia|rozporządzenie)\s+/u, "")
    .replace(/^z dnia \d{1,2} \S+ \d{4} r\.\s*/u, "")
    .replace(/^-\s*/u, "")
    .replace(/\.$/u, "")
    .trim();
}

/**
 * The part of an amending act that amends the given act: an act amending several others
 * ("oraz niektórych innych ustaw") has one unit per act, "Art. N. W ustawie z dnia … – Kodeks
 * cywilny …". Its other units name articles of other acts. When no unit names the act (a
 * single-act amendment, an unusual layout), the whole text is searched.
 */
export function amendmentPartFor(body: string, actTitle: string | undefined): string {
  const key = actTitle ? actCitationKey(actTitle) : "";
  if (key.length < 6) return body;
  const units = body.split(/(?=\bart\.\s*\d+[a-ząćęłńóśźż]*\.\s+w\s+ustawie\b)/iu);
  if (units.length < 3) return body;
  const own = units.filter((unit) => /^art\./iu.test(unit) && flat(unit.slice(0, 700)).includes(key));
  return own.length ? own.join("\n") : body;
}

// Nowela z odrębną datą wejścia w życie części przepisów ("wchodzi w życie ...,
// z wyjątkiem art. 1 pkt 3, który wchodzi w życie ..."); bez przepisu o wejściu
// w życie w tekście też nie wiadomo, od kiedy stosuje się zmianę.
export function amendmentHasEntryIntoForceExceptions(
  body: string
): boolean {
  const entries =
    body.match(/wchodz\p{L}*\s+w\s+życie/gu) ?? [];
  return (
    entries.length !== 1 ||
    /wchodz\p{L}*\s+w\s+życie[^]{0,300}?z\s+wyjątkiem/u.test(body)
  );
}

// The article of an amending act that amends the given act ("art. 2. w ustawie … – kodeks
// cywilny"): its own entry date may differ from the act's (staged entry into force).
function amendingArticle(part: string): string | null {
  return /^\s*art\.\s*(\d+[a-ząćęłńóśźż]*)\.\s+w\s+ustawie\b/iu.exec(part)?.[1]?.toLocaleLowerCase("pl") ?? null;
}

// True when every date the act's part for this article enters into force is after `today`
// (ELI staged dates); false when one has passed or the dates are not known.
function partNotYetInForce(decision: AmendmentApplicabilityDecision, part: string, today: string): boolean {
  const article = amendingArticle(part);
  if (!article || !decision.stages?.length) return false;
  const dates = partEntryDates(decision.stages, decision.entryIntoForce, article);
  return Boolean(dates?.length) && dates!.every((date) => date > today);
}

/**
 * Nowele już ogłoszone, ale wchodzące w życie po dniu sprawdzenia: data wejścia
 * w życie z ELI dotyczy części głównej aktu, a zmiana artykułu może obowiązywać
 * wcześniej (wyjątek w przepisie o wejściu w życie). Zwraca ELI nowel, które
 * dotykają artykułu (albo nie wiadomo) i mają taki wyjątek (albo nie wiadomo).
 */
async function futureAmendmentsMayApplyToArticle(
  fetcher: EliFetch,
  pdfTextExtractor: PdfTextExtractor,
  decisions: AmendmentApplicabilityDecision[],
  today: string,
  claim?: string,
  actTitle?: string
): Promise<string[]> {
  const article =
    articleTokenFromClaim(
      claim
    );
  if (!article) return [];
  const promulgated =
    decisions.filter(
      (decision) =>
        decision.status ===
          "FUTURE" &&
        Boolean(decision.promulgation) &&
        decision.promulgation! <= today
    );
  const checks =
    await Promise.all(
      promulgated.map(
        async (decision) => {
          const body =
            await amendmentBody(
              fetcher,
              pdfTextExtractor,
              decision.eli
            );
          const part = body === null ? "" : amendmentPartFor(body, actTitle);
          const uncertain =
            body === null ||
            (
              amendmentMentionsArticle(part, article) !== false &&
              amendmentHasEntryIntoForceExceptions(body) &&
              // ELI's staged dates settle it: this part enters into force only later.
              !partNotYetInForce(decision, part, today)
            );
          return uncertain
            ? decision.eli
            : null;
        }
      )
    );
  return checks.filter(
    (eli): eli is string =>
      eli !== null
  );
}


async function effectiveAmendmentsTouchArticle(
  fetcher: EliFetch,
  pdfTextExtractor: PdfTextExtractor,
  decisions: AmendmentApplicabilityDecision[],
  claim?: string,
  actTitle?: string,
  today?: string
): Promise<
  | {
      status: "UNAFFECTED";
      checked: string[];
      // In force as an act, but its change of this article enters into force later (staged dates).
      notYet?: AmendmentApplicabilityDecision[];
    }
  | {
      status: "AFFECTED";
      checked: string[];
      affected: string[];
    }
  | {
      status: "UNKNOWN";
      checked: string[];
      unknown: string[];
    }
  | null
> {
  const article =
    articleTokenFromClaim(
      claim
    );
  if (!article) {
    return null;
  }

  const effective =
    decisions.filter(
      (decision) =>
        decision.status ===
          "EFFECTIVE"
    );
  const checks =
    await Promise.all(
      effective.map(
        async (decision) => {
          const body = await amendmentBody(fetcher, pdfTextExtractor, decision.eli);
          const part = body === null ? "" : amendmentPartFor(body, actTitle);
          const touches = body === null ? null : amendmentMentionsArticle(part, article);
          return {
            eli: decision.eli,
            decision,
            touches,
            notYet: touches === true && Boolean(today) && partNotYetInForce(decision, part, today!)
          };
        }
      )
    );
  const checked =
    checks.map(
      (item) =>
        item.eli
    );
  const notYet = checks.filter((item) => item.notYet).map((item) => item.decision);
  const affected =
    checks
      .filter(
        (item) =>
          item.touches === true && !item.notYet
      )
      .map(
        (item) =>
          item.eli
      );
  if (
    affected.length > 0
  ) {
    return {
      status: "AFFECTED",
      checked,
      affected
    };
  }
  const unknown =
    checks
      .filter(
        (item) =>
          item.touches === null
      )
      .map(
        (item) =>
          item.eli
      );
  if (
    unknown.length > 0
  ) {
    return {
      status: "UNKNOWN",
      checked,
      unknown
    };
  }
  return {
    status: "UNAFFECTED",
    checked,
    ...(notYet.length ? { notYet } : {})
  };
}

function pickCurrentConsolidated(
  refs: unknown
): {
  eli: string;
  year: number;
  pos: number;
  status: string;
} | null {
  const candidates = list(refs, "Inf. o tekście jednolitym")
    .map(unwrapAct)
    .filter((act): act is EliAct => Boolean(act))
    .map((act) => ({
      eli: normalizeEli(act.ELI),
      year: numeric(act.year),
      pos: numeric(act.pos),
      status: text(act.status)
    }))
    .filter((act) => Boolean(act.eli) && activeStatus(act.status))
    .sort((a, b) => a.year - b.year || a.pos - b.pos);

  return candidates.at(-1) ?? null;
}

// The t.j. published just before `eli` (any status): the newest whose text ELI still serves.
function previousConsolidated(
  refs: unknown,
  eli: string
): { eli: string; year: number; pos: number } | null {
  const all = list(refs, "Inf. o tekście jednolitym")
    .map(unwrapAct)
    .filter((act): act is EliAct => Boolean(act))
    .map((act) => ({ eli: normalizeEli(act.ELI), year: numeric(act.year), pos: numeric(act.pos) }))
    .filter((act) => Boolean(act.eli))
    .sort((a, b) => a.year - b.year || a.pos - b.pos);
  const index = all.findIndex((act) => act.eli === normalizeEli(eli));
  return index > 0 ? all[index - 1] ?? null : null;
}

function amendmentFromAct(
  act: EliAct
): Omit<TemporalAmendment, "provenance"> | null {
  const eli = normalizeEli(act.ELI);
  if (!eli) return null;

  const relationDate =
    dateOnly(act.date);
  const promulgation =
    dateOnly(act.promulgation) ||
    dateOnly(act.announcementDate);

  return {
    eli,
    displayAddress:
      text(act.displayAddress) || eli,
    promulgation,
    ...(relationDate
      ? { relationDate }
      : {}),
    title: text(act.title)
  };
}

function amendmentsBetween(
  refs: unknown,
  after: string,
  through: string
): Map<string, Omit<TemporalAmendment, "provenance">> {
  const result = new Map<
    string,
    Omit<TemporalAmendment, "provenance">
  >();

  if (!after || !through) return result;

  for (const item of list(refs, "Akty zmieniające")) {
    const act = unwrapAct(item);
    if (!act) continue;
    const amendment = amendmentFromAct(act);
    const relationMoment =
      amendment?.relationDate ||
      amendment?.promulgation ||
      "";

    if (
      amendment &&
      relationMoment &&
      relationMoment > after &&
      relationMoment <= through
    ) {
      result.set(
        amendment.eli,
        amendment
      );
    }
  }

  return result;
}

/**
 * Amendments the served t.j. contains (published up to it) whose change enters into force after
 * today (ELI "Akty zmieniające": the relation date is the date the change applies).
 */
function amendmentsInTextNotInForce(
  refs: unknown,
  consolidatedPromulgation: string,
  today: string
): Omit<TemporalAmendment, "provenance">[] {
  return list(refs, "Akty zmieniające")
    .map((item) => {
      const act = unwrapAct(item);
      return act ? amendmentFromAct(act) : null;
    })
    .filter(
      (amendment): amendment is Omit<TemporalAmendment, "provenance"> =>
        amendment !== null &&
        Boolean(amendment.relationDate) &&
        amendment.relationDate! > today &&
        Boolean(amendment.promulgation) &&
        amendment.promulgation <= consolidatedPromulgation
    );
}

function postTjByApi(
  refs: unknown
): Map<string, Omit<TemporalAmendment, "provenance">> {
  const result = new Map<
    string,
    Omit<TemporalAmendment, "provenance">
  >();

  for (
    const item of list(
      refs,
      "Nowelizacje po tekście jednolitym"
    )
  ) {
    const act = unwrapAct(item);
    if (!act) continue;
    const amendment = amendmentFromAct(act);
    if (amendment) result.set(amendment.eli, amendment);
  }

  return result;
}

function mergeAmendments(
  dateMap: Map<
    string,
    Omit<TemporalAmendment, "provenance">
  >,
  apiMap: Map<
    string,
    Omit<TemporalAmendment, "provenance">
  >
): TemporalAmendment[] {
  return [...new Set([...dateMap.keys(), ...apiMap.keys()])]
    .map((eli) => {
      const date = dateMap.get(eli);
      const api = apiMap.get(eli);
      const value = date ?? api;
      if (!value) return null;
      return {
        ...value,
        provenance:
          date && api
            ? "DATE+API" as const
            : date
              ? "DATE" as const
              : "API" as const
      };
    })
    .filter(
      (value): value is TemporalAmendment =>
        Boolean(value)
    )
    .sort(
      (a, b) =>
        a.promulgation.localeCompare(b.promulgation) ||
        a.eli.localeCompare(b.eli)
    );
}

async function historicalCandidate(
  fetcher: EliFetch,
  eli: string,
  asOf: string
): Promise<HistoricalCandidate | null> {
  const metadataUrl = apiUrl(eli);
  if (!metadataUrl) return null;

  let metadata: unknown;
  try {
    metadata = await json(fetcher, metadataUrl);
  } catch {
    return null;
  }

  const act = unwrapAct(metadata);
  if (!act) return null;

  const stateDate =
    dateOnly(act.legalStatusDate) ||
    dateOnly(act.validFrom) ||
    dateOnly(act.entryIntoForce) ||
    dateOnly(act.promulgation) ||
    dateOnly(act.announcementDate);

  if (!stateDate || stateDate > asOf) return null;

  const interval = isInForceAt(act, asOf);
  if (interval.validTo && !interval.inForce) {
    return null;
  }

  if (
    repealedStatus(act.status) &&
    !interval.validTo
  ) {
    return null;
  }

  const sourceUrl =
    act.textHTML === true
      ? apiUrl(eli, "/text.html") ?? undefined
      : act.textPDF === true
        ? apiUrl(eli, "/text.pdf") ?? undefined
        : undefined;

  return {
    eli,
    metadata: act,
    stateDate,
    ...(sourceUrl ? { sourceUrl } : {})
  };
}

export class TemporalSourceFreshnessChecker {
  private readonly amendmentResolver:
    AmendmentApplicabilityResolver;

  constructor(
    private readonly fetcher: EliFetch =
      globalThis.fetch.bind(globalThis),
    private readonly now: () => string =
      () => new Date().toISOString(),
    amendmentResolver?:
      AmendmentApplicabilityResolver,
    private readonly pdfTextExtractor:
      PdfTextExtractor =
      new LocalPdfTextExtractor()
  ) {
    this.amendmentResolver =
      amendmentResolver ??
      new AmendmentApplicabilityResolver(
        fetcher
      );
  }

  async check(
    descriptor: LegalActDescriptor,
    options: TemporalFreshnessOptions = {}
  ): Promise<TemporalFreshnessResult> {
    const checkedAt = this.now();
    const asOf = options.asOf?.trim();

    return asOf
      ? this.checkHistorical(
          descriptor,
          asOf,
          checkedAt,
          options.claim
        )
      : this.checkCurrent(
          descriptor,
          checkedAt,
          options.claim
        );
  }

  // Transitional provisions of the amendments that touch the article, for the model to apply.
  private async transitionalOf(elis: readonly string[]): Promise<Array<{ eli: string; text: string }>> {
    const found = await Promise.all(
      [...new Set(elis)].slice(0, 4).map(async (eli) => {
        const body = await amendmentBody(this.fetcher, this.pdfTextExtractor, eli);
        return body ? transitionalProvisions(body).map((text) => ({ eli, text })) : [];
      })
    );
    return found.flat().slice(0, 6);
  }

  private failure(
    descriptor: LegalActDescriptor,
    mode: "CURRENT" | "HISTORICAL",
    checkedAt: string,
    status: TemporalFreshnessStatus,
    reason: string,
    extra: Partial<TemporalFreshnessResult> = {}
  ): TemporalFreshnessResult {
    return {
      status,
      mode,
      checkedAt,
      baseEli: descriptor.baseEli,
      pinnedEli: descriptor.eli,
      amendmentsAfter: [],
      reason,
      ...extra
    };
  }

  private async checkHistorical(
    descriptor: LegalActDescriptor,
    asOf: string,
    checkedAt: string,
    claim?: string
  ): Promise<TemporalFreshnessResult> {
    const fail = (
      status: TemporalFreshnessStatus,
      reason: string,
      extra: Partial<TemporalFreshnessResult> = {}
    ) =>
      this.failure(
        descriptor,
        "HISTORICAL",
        checkedAt,
        status,
        reason,
        {
          requestedAsOf: asOf,
          ...extra
        }
      );

    const today = todayWarsaw(checkedAt);
    if (!validIsoDate(asOf) || asOf >= today) {
      return fail(
        "INVALID_HISTORICAL_DATE",
        "AS_OF_MUST_BE_A_PAST_ISO_DATE"
      );
    }

    const baseMetadataUrl = apiUrl(
      descriptor.baseEli
    );
    const baseRefsUrl = apiUrl(
      descriptor.baseEli,
      "/references"
    );
    if (!baseMetadataUrl || !baseRefsUrl) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "INVALID_BASE_ELI"
      );
    }

    let baseMetadata: unknown;
    let baseRefs: unknown;
    try {
      [baseMetadata, baseRefs] = await Promise.all([
        json(this.fetcher, baseMetadataUrl),
        json(this.fetcher, baseRefsUrl)
      ]);
    } catch {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "BASE_METADATA_FETCH_FAILED"
      );
    }

    const baseAct = unwrapAct(baseMetadata);
    if (!baseAct) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "BASE_METADATA_INVALID"
      );
    }

    const baseInterval = isInForceAt(
      baseAct,
      asOf
    );
    if (!baseInterval.inForce) {
      return fail(
        "ACT_NOT_IN_FORCE_AT_DATE",
        "BASE_ACT_NOT_IN_FORCE_AT_AS_OF",
        {
          ...(baseInterval.validFrom
            ? {
                actValidFrom:
                  baseInterval.validFrom
              }
            : {}),
          ...(baseInterval.validTo
            ? {
                actValidTo:
                  baseInterval.validTo
              }
            : {})
        }
      );
    }

    const candidateElis = [
      ...new Set(
        list(
          baseRefs,
          "Inf. o tekście jednolitym"
        )
          .map(unwrapAct)
          .filter(
            (act): act is EliAct =>
              Boolean(act)
          )
          .map((act) =>
            normalizeEli(act.ELI)
          )
          .filter(Boolean)
      )
    ];

    const candidates = (
      await Promise.all(
        candidateElis.map((eli) =>
          historicalCandidate(
            this.fetcher,
            eli,
            asOf
          )
        )
      )
    )
      .filter(
        (
          candidate
        ): candidate is HistoricalCandidate =>
          Boolean(candidate)
      )
      .sort(
        (a, b) =>
          a.stateDate.localeCompare(
            b.stateDate
          ) ||
          a.eli.localeCompare(b.eli)
      );

    let selected = candidates.at(-1);

    if (!selected) {
      const baseStateDate =
        dateOnly(baseAct.legalStatusDate) ||
        dateOnly(baseAct.validFrom) ||
        dateOnly(baseAct.entryIntoForce) ||
        dateOnly(baseAct.promulgation) ||
        dateOnly(
          baseAct.announcementDate
        );
      const baseEli =
        normalizeEli(baseAct.ELI) ||
        normalizeEli(
          descriptor.baseEli
        );
      const baseSourceUrl =
        baseAct.textHTML === true
          ? apiUrl(
              baseEli,
              "/text.html"
            ) ?? undefined
          : baseAct.textPDF === true
            ? apiUrl(
                baseEli,
                "/text.pdf"
              ) ?? undefined
            : undefined;

      if (
        baseStateDate &&
        baseStateDate <= asOf &&
        baseEli
      ) {
        selected = {
          eli: baseEli,
          metadata: baseAct,
          stateDate: baseStateDate,
          ...(baseSourceUrl
            ? { sourceUrl: baseSourceUrl }
            : {})
        };
      }
    }

    if (!selected) {
      return fail(
        "NO_HISTORICAL_CONSOLIDATED_TEXT",
        "NO_OFFICIAL_TEXT_APPLICABLE_AT_AS_OF",
        {
          ...(baseInterval.validFrom
            ? {
                actValidFrom:
                  baseInterval.validFrom
              }
            : {}),
          ...(baseInterval.validTo
            ? {
                actValidTo:
                  baseInterval.validTo
              }
            : {})
        }
      );
    }

    const amendmentsAfter =
      mergeAmendments(
        amendmentsBetween(
          baseRefs,
          selected.stateDate,
          asOf
        ),
        new Map()
      );

    const amendmentApplicability =
      amendmentsAfter.length > 0
        ? await this.amendmentResolver.classify(
            amendmentsAfter,
            asOf
          )
        : [];

    const unknownAmendments =
      amendmentApplicability.filter(
        (decision) =>
          decision.status === "UNKNOWN"
      );

    if (unknownAmendments.length > 0) {
      return fail(
        "AMENDMENT_EFFECT_DATE_UNKNOWN",
        "HISTORICAL_AMENDMENT_EFFECT_DATE_UNKNOWN",
        {
          currentEli: selected.eli,
          currentPromulgation:
            selected.stateDate,
          amendmentsAfter,
          amendmentApplicability
        }
      );
    }

    const effectiveAmendments =
      amendmentApplicability.filter(
        (decision) =>
          decision.status === "EFFECTIVE"
      );

    // As for the current text: amendments between the selected t.j. and the date that leave
    // the cited article untouched (in force for it only after that date) do not block it.
    const historicalImpact =
      effectiveAmendments.length > 0
        ? await effectiveAmendmentsTouchArticle(this.fetcher, this.pdfTextExtractor, amendmentApplicability, claim, descriptor.title, asOf)
        : null;
    if (effectiveAmendments.length > 0 && historicalImpact?.status !== "UNAFFECTED") {
      return fail(
        "HISTORICAL_POST_TJ_AMENDMENTS",
        historicalImpact?.status === "AFFECTED"
          ? "HISTORICAL_AMENDMENT_TOUCHES_REQUESTED_ARTICLE"
          : "EFFECTIVE_AMENDMENTS_AFTER_SELECTED_TJ_BEFORE_AS_OF",
        {
          currentEli: selected.eli,
          currentPromulgation:
            selected.stateDate,
          ...(baseInterval.validFrom
            ? {
                actValidFrom:
                  baseInterval.validFrom
              }
            : {}),
          ...(baseInterval.validTo
            ? {
                actValidTo:
                  baseInterval.validTo
              }
            : {}),
          amendmentsAfter,
          amendmentApplicability
        }
      );
    }

    const sourceUrl = selected.sourceUrl;
    if (!sourceUrl) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "HISTORICAL_TEXT_FORMAT_UNAVAILABLE",
        {
          currentEli: selected.eli,
          currentPromulgation:
            selected.stateDate
        }
      );
    }

    return {
      status: "HISTORICAL",
      mode: "HISTORICAL",
      checkedAt,
      baseEli: descriptor.baseEli,
      pinnedEli: descriptor.eli,
      requestedAsOf: asOf,
      currentEli: selected.eli,
      currentPromulgation:
        selected.stateDate,
      sourceUrl,
      ...(baseInterval.validFrom
        ? {
            actValidFrom:
              baseInterval.validFrom
          }
        : {}),
      ...(baseInterval.validTo
        ? {
            actValidTo:
              baseInterval.validTo
          }
        : {}),
      amendmentsAfter,
      ...(amendmentApplicability.length > 0
        ? { amendmentApplicability }
        : {}),
      ...(historicalImpact?.status === "UNAFFECTED"
        ? { reason: "HISTORICAL_POST_TJ_AMENDMENTS_DO_NOT_TOUCH_REQUESTED_ARTICLE" }
        : {})
    };
  }

  private async checkCurrent(
    descriptor: LegalActDescriptor,
    checkedAt: string,
    claim?: string
  ): Promise<TemporalFreshnessResult> {
    const fail = (
      status: TemporalFreshnessStatus,
      reason: string,
      extra: Partial<TemporalFreshnessResult> = {}
    ) =>
      this.failure(
        descriptor,
        "CURRENT",
        checkedAt,
        status,
        reason,
        extra
      );

    const baseRefsUrl = apiUrl(
      descriptor.baseEli,
      "/references"
    );
    if (!baseRefsUrl) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "INVALID_BASE_ELI"
      );
    }

    let baseRefs: unknown;
    try {
      baseRefs = await json(
        this.fetcher,
        baseRefsUrl
      );
    } catch {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "BASE_REFERENCES_FETCH_FAILED"
      );
    }

    const pinnedRelation = list(
      baseRefs,
      "Inf. o tekście jednolitym"
    )
      .map(unwrapAct)
      .filter(
        (act): act is EliAct =>
          Boolean(act)
      )
      .find(
        (act) =>
          normalizeEli(act.ELI) ===
          normalizeEli(descriptor.eli)
      );

    const current =
      pickCurrentConsolidated(baseRefs);

    // A repealed pinned t.j. is only the registry lagging behind ELI when another t.j. of the
    // same act is in force: that one is used (the act itself is still checked below).
    if (
      pinnedRelation &&
      repealedStatus(
        pinnedRelation.status
      ) &&
      (!current || current.eli === normalizeEli(descriptor.eli))
    ) {
      return fail(
        "REPEALED_CONSOLIDATED_TEXT",
        "PINNED_CONSOLIDATED_TEXT_REPEALED"
      );
    }

    if (!current) {
      return fail(
        "NO_CURRENT_CONSOLIDATED_TEXT",
        "NO_IN_FORCE_CONSOLIDATED_TEXT"
      );
    }

    const metadataUrl = apiUrl(
      current.eli
    );
    const currentRefsUrl = apiUrl(
      current.eli,
      "/references"
    );
    if (
      !metadataUrl ||
      !currentRefsUrl
    ) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "INVALID_CURRENT_ELI",
        { currentEli: current.eli }
      );
    }

    let metadata: unknown;
    let currentRefs: unknown;
    try {
      [metadata, currentRefs] =
        await Promise.all([
          json(
            this.fetcher,
            metadataUrl
          ),
          json(
            this.fetcher,
            currentRefsUrl
          )
        ]);
    } catch {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "CURRENT_METADATA_FETCH_FAILED",
        { currentEli: current.eli }
      );
    }

    const act =
      unwrapAct(metadata) ?? {};

    if (repealedStatus(act.status)) {
      return fail(
        "REPEALED_CONSOLIDATED_TEXT",
        "CURRENT_CONSOLIDATED_TEXT_REPEALED",
        { currentEli: current.eli }
      );
    }

    const promulgation =
      dateOnly(act.promulgation) ||
      dateOnly(
        act.announcementDate
      );

    if (!promulgation) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "CURRENT_PROMULGATION_MISSING",
        { currentEli: current.eli }
      );
    }

    // The in-force t.j. without a text in ELI yet (announced days ago): the previous t.j.
    // gives the wording, and every amendment after it is checked against the article as a
    // post-t.j. amendment would be (KK: t.j. 2026/1342 announced 16.10.2026, no text).
    let textEli = current.eli;
    let textAct: EliAct = act;
    let textPromulgation = promulgation;
    let textPendingEli: string | undefined;
    if (act.textHTML !== true && act.textPDF !== true) {
      const previous = previousConsolidated(baseRefs, current.eli);
      const previousUrl = previous ? apiUrl(previous.eli) : null;
      const previousAct = previousUrl
        ? unwrapAct(await json(this.fetcher, previousUrl).catch(() => null))
        : null;
      const previousPromulgation = previousAct
        ? dateOnly(previousAct.promulgation) || dateOnly(previousAct.announcementDate)
        : "";
      if (
        previous &&
        previousAct &&
        previousPromulgation &&
        (previousAct.textHTML === true || previousAct.textPDF === true)
      ) {
        textEli = previous.eli;
        textAct = previousAct;
        textPromulgation = previousPromulgation;
        textPendingEli = current.eli;
      }
    }

    const amendmentsAfter =
      mergeAmendments(
        amendmentsBetween(
          baseRefs,
          textPromulgation,
          todayWarsaw(checkedAt)
        ),
        postTjByApi(currentRefs)
      );

    const amendmentApplicability =
      amendmentsAfter.length > 0
        ? await this.amendmentResolver.classify(
            amendmentsAfter,
            todayWarsaw(checkedAt)
          )
        : [];

    const pinnedSuperseded =
      normalizeEli(descriptor.eli) !== current.eli;
    const common = {
      currentEli: current.eli,
      currentPromulgation:
        promulgation,
      amendmentsAfter,
      ...(amendmentApplicability.length > 0
        ? { amendmentApplicability }
        : {}),
      ...(pinnedSuperseded ? { pinnedSuperseded: true } : {}),
      ...(textPendingEli ? { textPendingEli, textEli } : {})
    };

    // A change the t.j. already contains but not in force yet: the verified wording must be
    // the one in force today, so an article such an amendment touches (or may touch) is not
    // verified from this text (DU/2026/507 amends KC from 2028-11-01; t.j. KC 2026/795).
    const article = articleTokenFromClaim(claim);
    let pendingWordingAmendments: string[] = [];
    if (article) {
      const pending = amendmentsInTextNotInForce(baseRefs, textPromulgation, todayWarsaw(checkedAt));
      const touching = (
        await Promise.all(
          pending.map(async (amendment) => {
            const body = await amendmentBody(this.fetcher, this.pdfTextExtractor, amendment.eli);
            return body === null || amendmentMentionsArticle(amendmentPartFor(body, descriptor.title), article) !== false
              ? amendment.eli
              : null;
          })
        )
      ).filter((eli): eli is string => eli !== null);
      // The text prints the article's change not yet in force: verified only by the wording
      // in force today, which its footnotes give (the verifier refuses when they do not).
      if (touching.length > 0) pendingWordingAmendments = touching;
    }

    const unknownAmendments =
      amendmentApplicability.filter(
        (decision) =>
          decision.status === "UNKNOWN"
      );

    if (unknownAmendments.length > 0) {
      return fail(
        "AMENDMENT_EFFECT_DATE_UNKNOWN",
        "OFFICIAL_AMENDMENT_EFFECT_DATE_UNKNOWN",
        common
      );
    }

    const earlyFuture =
      await futureAmendmentsMayApplyToArticle(
        this.fetcher,
        this.pdfTextExtractor,
        amendmentApplicability,
        todayWarsaw(checkedAt),
        claim,
        descriptor.title
      );

    if (earlyFuture.length > 0) {
      return fail(
        "AMENDMENT_EFFECT_DATE_UNKNOWN",
        "FUTURE_AMENDMENT_ARTICLE_EFFECT_DATE_UNKNOWN",
        common
      );
    }

    const effectiveAmendments =
      amendmentApplicability.filter(
        (decision) =>
          decision.status === "EFFECTIVE"
      );

    if (effectiveAmendments.length > 0) {
      // Never treat the base act /text.html as an automatically unified text:
      // for ELI it may be the promulgated/original wording. For an exact
      // article claim, prove that every effective post-t.j. amendment leaves
      // that article untouched. Only then may the latest official consolidated
      // text verify the requested article.
      const impact =
        await effectiveAmendmentsTouchArticle(
          this.fetcher,
          this.pdfTextExtractor,
          amendmentApplicability,
          claim,
          descriptor.title,
          todayWarsaw(checkedAt)
        );
      // The act is in force, its change of this article only later (staged dates): the
      // consolidated text's wording stands; one the text already prints is chosen by footnotes.
      for (const decision of impact?.status === "UNAFFECTED" ? impact.notYet ?? [] : []) {
        if (decision.promulgation && decision.promulgation <= textPromulgation) pendingWordingAmendments.push(decision.eli);
      }
      const notYetForArticle = impact?.status === "UNAFFECTED" ? (impact.notYet ?? []).map((decision) => decision.eli) : [];

      if (
        impact?.status ===
          "UNAFFECTED"
      ) {
        const sourceUrl =
          textAct.textHTML === true
            ? apiUrl(
                textEli,
                "/text.html"
              )
            : textAct.textPDF === true
              ? apiUrl(
                  textEli,
                  "/text.pdf"
                )
              : null;
        if (!sourceUrl) {
          return fail(
            "SOURCE_METADATA_UNAVAILABLE",
            "CURRENT_TEXT_FORMAT_UNAVAILABLE",
            common
          );
        }
        return {
          status: "CURRENT",
          mode: "CURRENT",
          checkedAt,
          baseEli:
            descriptor.baseEli,
          pinnedEli:
            descriptor.eli,
          currentEli:
            current.eli,
          currentPromulgation:
            promulgation,
          sourceUrl,
          amendmentsAfter,
          amendmentApplicability,
          ...(pendingWordingAmendments.length ? { pendingWordingAmendments } : {}),
          ...(notYetForArticle.length ? { notYetForArticle } : {}),
          ...(pinnedSuperseded ? { pinnedSuperseded: true } : {}),
          ...(textPendingEli ? { textPendingEli, textEli } : {}),
          ...(await this.transitionalOf([...notYetForArticle, ...pendingWordingAmendments]).then((found) =>
            found.length ? { transitionalProvisions: found } : {}
          )),
          reason: textPendingEli
            ? "CURRENT_TJ_TEXT_PENDING_PREVIOUS_TJ_AMENDMENTS_DO_NOT_TOUCH_ARTICLE"
            : "POST_TJ_AMENDMENTS_DO_NOT_TOUCH_REQUESTED_ARTICLE"
        };
      }

      const transitional = impact?.status === "AFFECTED" ? await this.transitionalOf(impact.affected) : [];
      return fail(
        "POST_TJ_AMENDMENTS",
        impact?.status ===
          "AFFECTED"
          ? "POST_TJ_AMENDMENT_TOUCHES_REQUESTED_ARTICLE"
          : impact?.status ===
              "UNKNOWN"
            ? "POST_TJ_AMENDMENT_ARTICLE_IMPACT_UNKNOWN"
            : "EFFECTIVE_AMENDMENTS_AFTER_CONSOLIDATED_TEXT",
        { ...common, ...(transitional.length ? { transitionalProvisions: transitional } : {}) }
      );
    }

    if (
      textAct.textHTML !== true &&
      textAct.textPDF !== true
    ) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "CURRENT_TEXT_FORMAT_UNAVAILABLE",
        common
      );
    }

    const sourceUrl =
      textAct.textHTML === true
        ? apiUrl(
            textEli,
            "/text.html"
          )
        : apiUrl(
            textEli,
            "/text.pdf"
          );
    if (!sourceUrl) {
      return fail(
        "SOURCE_METADATA_UNAVAILABLE",
        "CURRENT_TEXT_URL_INVALID",
        common
      );
    }

    return {
      status: "CURRENT",
      mode: "CURRENT",
      checkedAt,
      baseEli: descriptor.baseEli,
      pinnedEli: descriptor.eli,
      currentEli: current.eli,
      currentPromulgation:
        promulgation,
      sourceUrl,
      amendmentsAfter,
      ...(amendmentApplicability.length > 0
        ? { amendmentApplicability }
        : {}),
      ...(pendingWordingAmendments.length ? { pendingWordingAmendments } : {}),
      ...(pinnedSuperseded ? { pinnedSuperseded: true, reason: "PINNED_TJ_SUPERSEDED_CURRENT_TJ_USED" } : {}),
      ...(textPendingEli ? { textPendingEli, textEli } : {})
    };
  }
}
