import { SN_REPERTORIES, courtOfSignature, signaturesIn } from "./court-of-signature.js";
import { createHash } from "node:crypto";
import { caseLawRepository } from "./case-law-store.js";
import { documentText } from "./official-text.js";
import type {
  VerificationRecord
} from "./verification-ledger.js";

export type CaseLawFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

export type CaseVerificationStatus =
  | "FOUND"
  | "NOT_FOUND"
  | "AMBIGUOUS"
  | "OUT_OF_SCOPE";

export type SupremeCourtCaseVerificationRequest = {
  claim: string;
  signature: string;
  toolCallId: string;
  // The decision's card (sn.pl ?orzeczenie=ID) or its ID: picks that record when
  // one signature has several (judgment, decision, reasons).
  cardUrl?: string;
};

/** ID of an SN decision card ("…?orzeczenie=ZuUy…" or the bare ID). */
export function supremeCourtCardId(value: string | undefined): string | null {
  const text = value?.trim() ?? "";
  const fromUrl = /[?&]orzeczenie=([\w-]{6,80})/u.exec(text)?.[1];
  if (fromUrl) return fromUrl;
  return /^[A-Za-z0-9_-]{12,40}$/u.test(text) && /[A-Za-z]/.test(text) && /\d|[A-Z].*[a-z]|[a-z].*[A-Z]/.test(text) ? text : null;
}

export type SupremeCourtQuoteVerificationRequest = {
  caseClaim: string;
  signature: string;
  quote: string;
  toolCallId: string;
};

export type CaseQuoteVerificationStatus =
  | "VERIFIED"
  | "QUOTE_NOT_FOUND"
  | "INVALID_QUOTE"
  | "CASE_NOT_VERIFIED";

export type SupremeCourtCaseVerificationResult = {
  status: CaseVerificationStatus;
  normalizedSignature: string;
  rejectedNearMatches: string[];
  record?: VerificationRecord;
  judgment?: {
    id: string;
    signature: string;
    date?: string;
    form?: string;
    sourceUrl: string;
    contentScope: "FULL_TEXT";
    normalizedFullText: string;
  };
  reason?: string;
};

export type SupremeCourtQuoteVerificationResult = {
  status: CaseQuoteVerificationStatus;
  normalizedSignature: string;
  caseResult: SupremeCourtCaseVerificationResult;
  quoteRecord?: VerificationRecord;
  evidenceHash?: string;
  reason?: string;
};

const SN_PROXY =
  "https://sn.pl/index.php";
const SN_HUMAN =
  "https://sn.pl/pl/wyszukiwarka-orzeczen";

// Bez sesji użytkownika: uczciwy identyfikator klienta. Zapory sn.pl (Incapsula) nie obchodzimy
// podmianą UA; przy 403 użytkownik przechodzi weryfikację w oknie sn.pl, a sesja niesie UA jego przeglądarki.
const SN_CLIENT_UA =
  "Lex-Machina/1.0 (+https://github.com/michaleiatrak-star/Lex-machina-aplikacja)";

const SN_HOSTS = new Set([
  "sn.pl",
  "www.sn.pl"
]);

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_SEARCH_RECORDS = 25;
const MAX_BASE64_CHARS = 8_000_000;


function stripDotsAndSpace(
  value: string
): string {
  return value
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCaseSignature(
  value: string
): string {
  return stripDotsAndSpace(value)
    .toLocaleUpperCase("pl");
}

function signatureParts(
  value: string
): {
  repertory: string;
  year: number;
} | null {
  const normalized =
    stripDotsAndSpace(value);

  const match = normalized.match(
    /^(?:[IVXL]+\s+)?([A-Za-z][A-Za-z-]*)\s+(\d+)\/(\d{2,4})$/u
  );

  if (!match) return null;

  let year = Number(match[3]);
  if (year < 100) {
    year += year > 50 ? 1900 : 2000;
  }

  return {
    repertory:
      match[1]!.toLocaleUpperCase("pl"),
    year
  };
}

export function isSupremeCourtSignature(
  value: string
): boolean {
  // Wielkość liter rozstrzyga przed normalizacją: "II Cz 123/20" i "III Ko 5/21" to sądy
  // powszechne, nie repertoria SN CZ i KO.
  const court = courtOfSignature(value);
  if (court && court !== "SN") return false;
  const parts = signatureParts(value);
  return Boolean(
    parts &&
    SN_REPERTORIES.has(parts.repertory)
  );
}

function proxyUrl(
  task: string,
  params: Record<string, string>
): string {
  const url = new URL(SN_PROXY);
  url.searchParams.set("option", "com_ajax");
  url.searchParams.set("plugin", "snproxy");
  url.searchParams.set("format", "json");
  url.searchParams.set("task", task);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export function supremeCourtSearchUrl(
  signature: string
): string {
  return proxyUrl(
    "searchOrzeczenia",
    {
      sygnatura:
        stripDotsAndSpace(signature),
      strona: "1",
      rozmiar_strony:
        String(MAX_SEARCH_RECORDS)
    }
  );
}

function supremeCourtTextUrl(
  id: string
): string {
  return proxyUrl(
    "OrzeczeniePlikHtml",
    { id }
  );
}

function humanUrl(
  id: string
): string {
  const url = new URL(SN_HUMAN);
  url.searchParams.set(
    "orzeczenie",
    id
  );
  return url.toString();
}

function cookiesFrom(
  response: Response
): string[] {
  const headers =
    response.headers as Headers & {
      getSetCookie?: () => string[];
    };

  const values =
    headers.getSetCookie?.() ??
    (
      response.headers.get("set-cookie")
        ? [
            response.headers.get(
              "set-cookie"
            )!
          ]
        : []
    );

  return values
    .map((value) =>
      value.split(";", 1)[0]?.trim()
    )
    .filter(
      (value): value is string =>
        Boolean(value)
    );
}

function mergeCookies(
  current: string[],
  incoming: string[]
): string[] {
  const byName =
    new Map<string, string>();

  for (const cookie of [
    ...current,
    ...incoming
  ]) {
    const name =
      cookie.split("=", 1)[0]?.trim();

    if (name) {
      byName.set(name, cookie);
    }
  }

  return [...byName.values()];
}

// sn.pl answers the search widget's own requests; a bare request may meet the
// site's bot protection: an HTTP 403 page, or HTTP 200 with a browser-check HTML
// page instead of JSON. Requests look like the widget's (same referer, XHR, JSON
// accept) and, when blocked, the search page is opened once for its session
// cookies before one more try. Still blocked: a 403 (bot protection), never an
// HTML page handed to a JSON parser.
async function fetchSn(
  fetcher: CaseLawFetch,
  input: string
): Promise<Response> {
  const first = await fetchSnOnce(fetcher, input, []);
  if (input === SN_HUMAN || !(await snBlocked(first.response))) return first.response;
  const warm = await fetchSnOnce(fetcher, SN_HUMAN, first.cookies).catch(() => null);
  const second = (await fetchSnOnce(fetcher, input, warm ? warm.cookies : first.cookies)).response;
  return (await snBlocked(second))
    ? new Response(null, { status: 403, statusText: "SN_BOT_PROTECTION" })
    : second;
}

export type SnSession = { cookie: string; userAgent: string | null };

/**
 * sn.pl requests with the session the user verified in the app's sn.pl window
 * (Imperva captcha): its cookies, and its browser's User-Agent the session is bound
 * to. Cookies sn.pl sets on the way keep their newer value. Other hosts unchanged.
 */
export function withSnSession(base: CaseLawFetch, session: () => SnSession | null): CaseLawFetch {
  return async (input, init) => {
    const saved = session();
    let host = "";
    try {
      host = new URL(String(input)).hostname;
    } catch {
      host = "";
    }
    if (!saved || !SN_HOSTS.has(host)) return base(input, init);
    const headers = new Headers(init?.headers);
    const byName = new Map<string, string>();
    for (const part of [...saved.cookie.split(";"), ...(headers.get("cookie") ?? "").split(";")]) {
      const pair = part.trim();
      const name = pair.split("=")[0];
      if (name && pair.includes("=")) byName.set(name, pair);
    }
    headers.set("cookie", [...byName.values()].join("; "));
    if (saved.userAgent) headers.set("user-agent", saved.userAgent);
    return base(input, { ...init, headers });
  };
}

/** A 403, or an HTML page where the widget's endpoints answer JSON (or PDF). */
async function snBlocked(response: Response): Promise<boolean> {
  if (response.status === 403) return true;
  if (!response.ok) return false;
  const type = response.headers.get("content-type") ?? "";
  if (/json|pdf|octet-stream/i.test(type)) return false;
  const head = (await response.clone().text().catch(() => "")).slice(0, 200);
  return /^\s*</.test(head);
}

async function fetchSnOnce(
  fetcher: CaseLawFetch,
  input: string,
  initialCookies: string[]
): Promise<{ response: Response; cookies: string[] }> {
  let url = input;
  let cookies: string[] = initialCookies;
  const page = input === SN_HUMAN;

  for (
    let redirect = 0;
    redirect <= MAX_REDIRECTS;
    redirect += 1
  ) {
    const response =
      await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal:
          AbortSignal.timeout(
            REQUEST_TIMEOUT_MS
          ),
        headers: {
          "User-Agent":
            SN_CLIENT_UA,
          "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.8",
          ...(page
            ? { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" }
            : {
                Accept: "application/json, text/javascript, */*; q=0.01",
                Referer: SN_HUMAN,
                "X-Requested-With": "XMLHttpRequest"
              }),
          ...(cookies.length
            ? {
                Cookie:
                  cookies.join("; ")
              }
            : {})
        }
      });

    cookies = mergeCookies(
      cookies,
      cookiesFrom(response)
    );

    if (
      response.status >= 300 &&
      response.status < 400
    ) {
      const location =
        response.headers.get(
          "location"
        );

      if (!location) {
        throw new Error(
          "SN_REDIRECT_WITHOUT_LOCATION"
        );
      }

      const next =
        new URL(location, url);

      if (
        next.protocol !== "https:" ||
        !SN_HOSTS.has(
          next.hostname.toLowerCase()
        )
      ) {
        throw new Error(
          "SN_REDIRECT_HOST_DENIED"
        );
      }

      url = next.toString();
      continue;
    }

    return { response, cookies };
  }

  throw new Error(
    "SN_REDIRECT_LIMIT_EXCEEDED"
  );
}

function object(
  value: unknown
): Record<string, unknown> | null {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    ? value as Record<string, unknown>
    : null;
}

function array(
  value: unknown
): unknown[] {
  return Array.isArray(value)
    ? value
    : [];
}

function looksLikeSnSearchRecord(
  value: Record<string, unknown>
): boolean {
  return (
    "sygnatura_sprawy" in value ||
    "id" in value ||
    "data_wydania" in value ||
    "forma_orzeczenia" in value
  );
}

function nestedSnSearchRecords(
  value: unknown,
  depth = 0
): Record<string, unknown>[] | null {
  if (depth > 6) {
    return null;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }

    const objects =
      value
        .map(object)
        .filter(
          (
            item
          ): item is Record<string, unknown> =>
            Boolean(item)
        );

    if (
      objects.length === value.length &&
      objects.every(
        looksLikeSnSearchRecord
      )
    ) {
      return objects;
    }

    for (const item of objects) {
      const nested =
        nestedSnSearchRecords(
          item,
          depth + 1
        );
      if (nested !== null) {
        return nested;
      }
    }

    return null;
  }

  const current = object(value);
  if (!current) {
    return null;
  }

  // A single judgment returned as an object instead of a one-element list.
  if (
    "sygnatura_sprawy" in current
  ) {
    return [current];
  }

  // sn.pl has used multiple Joomla/com_ajax wrapper depths over time.
  // Follow only explicit collection-bearing keys and accept an array only
  // when its objects look like SN judgment records. Unknown shapes remain
  // fail-closed as SN_SEARCH_SCHEMA_DRIFT.
  for (
    const key
    of [
      "data",
      "items",
      "records",
      "results",
      "orzeczenia"
    ]
  ) {
    if (!(key in current)) {
      continue;
    }
    const nested =
      nestedSnSearchRecords(
        current[key],
        depth + 1
      );
    if (nested !== null) {
      return nested;
    }
  }

  // PHP json_encode turns a non-sequential list into {"0": {...}, "1": {...}}.
  const members =
    Object.values(current)
      .map(object)
      .filter(
        (
          item
        ): item is Record<string, unknown> =>
          Boolean(item)
      );
  if (
    members.length > 0 &&
    members.length === Object.keys(current).length &&
    members.every(
      (item) =>
        "sygnatura_sprawy" in item
    )
  ) {
    return members;
  }

  // A collection under a key not listed above: still only arrays whose objects
  // look like SN judgment records are accepted.
  for (
    const [key, member]
    of Object.entries(current)
  ) {
    if (
      [
        "data",
        "items",
        "records",
        "results",
        "orzeczenia",
        "message",
        "messages"
      ].includes(key) ||
      member === null ||
      typeof member !== "object"
    ) {
      continue;
    }
    const nested =
      nestedSnSearchRecords(
        member,
        depth + 1
      );
    if (
      nested !== null &&
      nested.length > 0
    ) {
      return nested;
    }
  }

  return null;
}

function searchRecords(
  payload: unknown
): Record<string, unknown>[] | null {
  return nestedSnSearchRecords(
    payload
  );
}

// sn.pl snproxy reports a failed upstream call inside a successful com_ajax
// envelope: root.data[0].data = { error, debug }. That is an outage on the
// sn.pl side, not a schema change, and must not be reported as drift.
export function snUpstreamError(
  payload: unknown
): string | null {
  let current: unknown = payload;

  for (
    let depth = 0;
    depth <= 4;
    depth += 1
  ) {
    const node =
      object(current) ??
      object(array(current)[0]);
    if (!node) {
      return null;
    }

    const error = node.error;
    if (
      error !== undefined &&
      error !== null &&
      error !== false &&
      !("sygnatura_sprawy" in node)
    ) {
      const text =
        typeof error === "string"
          ? error
          : JSON.stringify(error);
      return text
        .replace(/[\u0000-\u001f\u007f]+/gu, " ")
        .trim()
        .slice(0, 300) || "UNKNOWN";
    }

    current = node.data;
  }

  return null;
}

function rawFullText(
  payload: unknown
): string | null {
  const root = object(payload);
  const first =
    object(array(root?.data)[0]);

  const directRaw =
    first?.raw;
  if (
    typeof directRaw === "string" &&
    directRaw.length > 0
  ) {
    return directRaw;
  }

  // Current sn.pl com_ajax wraps the plugin
  // JsonResponse once more:
  // root.data[0].data.raw.
  const nested =
    object(first?.data);
  const nestedRaw =
    nested?.raw;

  if (
    typeof nestedRaw === "string" &&
    nestedRaw.length > 0
  ) {
    return nestedRaw;
  }

  return null;
}

function decodeBase64Html(
  raw: string
): string | null {
  if (
    raw.length > MAX_BASE64_CHARS ||
    !/^[A-Za-z0-9+/=\s]+$/u.test(raw)
  ) {
    return null;
  }

  try {
    return Buffer
      .from(
        raw.replace(/\s+/g, ""),
        "base64"
      )
      .toString("utf8");
  } catch {
    return null;
  }
}

function normalizeQuoteText(
  value: string
): string {
  return value
    .normalize("NFKC")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pl");
}

function quoteEvidenceHash(
  signature: string,
  quote: string
): string {
  return createHash("sha256")
    .update(
      normalizeCaseSignature(signature) +
      "\n" +
      normalizeQuoteText(quote),
      "utf8"
    )
    .digest("hex")
    .slice(0, 20);
}

export function propositionEvidenceHash(
  signature: string,
  proposition: string,
  supportQuote: string
): string {
  return createHash("sha256")
    .update(
      normalizeCaseSignature(signature) +
      "\n" +
      normalizeQuoteText(proposition) +
      "\n" +
      normalizeQuoteText(supportQuote),
      "utf8"
    )
    .digest("hex")
    .slice(0, 20);
}

function normalizeOfficialText(
  html: string
): string {
  return html
    .replace(
      /<script\b[^>]*>[\s\S]*?<\/script>/giu,
      " "
    )
    .replace(
      /<style\b[^>]*>[\s\S]*?<\/style>/giu,
      " "
    )
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .normalize("NFKC")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("pl");
}

export class SupremeCourtCaseVerifier {
  constructor(
    private readonly fetcher:
      CaseLawFetch =
        globalThis.fetch.bind(
          globalThis
        ),
    private readonly now:
      () => string =
        () => new Date().toISOString()
  ) {}

  /** The signature of the decision on an sn.pl card, read from its official text. */
  signatureFromCard(card: string): Promise<{ signature: string; cardUrl: string } | null> {
    return supremeCourtSignatureFromCard(card, this.fetcher);
  }

  async verify(
    request:
      SupremeCourtCaseVerificationRequest
  ): Promise<SupremeCourtCaseVerificationResult> {
    const normalizedSignature =
      normalizeCaseSignature(
        request.signature
      );

    // Sąd z zapisu przed normalizacją (wielkość liter), repertorium po normalizacji.
    const writtenCourt =
      courtOfSignature(
        request.signature
      );

    if (
      !request.claim.trim() ||
      (
        writtenCourt !== null &&
        writtenCourt !== "SN"
      ) ||
      !isSupremeCourtSignature(
        normalizedSignature
      )
    ) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches: [],
        reason:
          "INVALID_OR_NON_SN_SIGNATURE"
      };
    }

    let searchResponse: Response;

    try {
      searchResponse =
        await fetchSn(
          this.fetcher,
          supremeCourtSearchUrl(
            normalizedSignature
          )
        );
    } catch {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches: [],
        reason:
          "SN_SEARCH_TRANSPORT_FAILED"
      };
    }

    if (!searchResponse.ok) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches: [],
        reason:
          "SN_SEARCH_HTTP_" +
          searchResponse.status
      };
    }

    let searchPayload: unknown;

    try {
      searchPayload =
        await searchResponse.json();
    } catch {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches: [],
        reason:
          "SN_SEARCH_JSON_DRIFT"
      };
    }

    const records =
      searchRecords(searchPayload);

    if (
      !records &&
      snUpstreamError(searchPayload) !== null
    ) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches: [],
        reason:
          "SN_UPSTREAM_ERROR"
      };
    }

    if (!records) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches: [],
        reason:
          "SN_SEARCH_SCHEMA_DRIFT"
      };
    }

    if (
      records.length >=
      MAX_SEARCH_RECORDS
    ) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches: [],
        reason:
          "SN_SEARCH_MAY_BE_TRUNCATED"
      };
    }

    const exact =
      records.filter((record) =>
        normalizeCaseSignature(
          String(
            record.sygnatura_sprawy ??
            ""
          )
        ) === normalizedSignature
      );

    const rejectedNearMatches =
      records
        .filter(
          (record) =>
            !exact.includes(record)
        )
        .map((record) =>
          String(
            record.sygnatura_sprawy ??
            ""
          ).trim()
        )
        .filter(Boolean);

    if (exact.length === 0) {
      return {
        status: "NOT_FOUND",
        normalizedSignature,
        rejectedNearMatches
      };
    }

    const cardId =
      supremeCourtCardId(request.cardUrl) ??
      supremeCourtCardId(/orzeczenie=/u.test(request.claim) ? request.claim : undefined);
    const chosen =
      cardId
        ? exact.find((record) => String(record.id ?? "").trim() === cardId)
        : undefined;

    if (exact.length > 1 && !chosen) {
      return {
        status: "AMBIGUOUS",
        normalizedSignature,
        rejectedNearMatches,
        reason:
          "MULTIPLE_EXACT_SN_RECORDS"
      };
    }

    const searchRecord =
      chosen ?? exact[0]!;

    const id =
      String(
        searchRecord.id ?? ""
      ).trim();

    if (!id) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches,
        reason:
          "SN_RECORD_ID_MISSING"
      };
    }

    let textResponse: Response;

    try {
      textResponse =
        await fetchSn(
          this.fetcher,
          supremeCourtTextUrl(id)
        );
    } catch {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches,
        reason:
          "SN_FULL_TEXT_TRANSPORT_FAILED"
      };
    }

    if (!textResponse.ok) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches,
        reason:
          "SN_FULL_TEXT_HTTP_" +
          textResponse.status
      };
    }

    let textPayload: unknown;

    try {
      textPayload =
        await textResponse.json();
    } catch {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches,
        reason:
          "SN_FULL_TEXT_JSON_DRIFT"
      };
    }

    const raw =
      rawFullText(textPayload);

    const html =
      raw
        ? decodeBase64Html(raw)
        : null;

    if (!html) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches,
        reason:
          "SN_FULL_TEXT_UNAVAILABLE"
      };
    }

    const officialText =
      normalizeOfficialText(html);

    if (
      !officialText.includes(
        normalizedSignature
      ) ||
      !officialText.includes(
        "SĄD NAJWYŻSZY"
      )
    ) {
      return {
        status: "OUT_OF_SCOPE",
        normalizedSignature,
        rejectedNearMatches,
        reason:
          "SN_FULL_TEXT_IDENTITY_MISMATCH"
      };
    }

    const sourceUrl =
      humanUrl(id);

    const date =
      typeof searchRecord.data_wydania ===
        "string"
        ? searchRecord.data_wydania
        : undefined;

    const form =
      typeof searchRecord.forma_orzeczenia ===
        "string"
        ? searchRecord.forma_orzeczenia
        : undefined;

    const fetchedAt =
      this.now();

    // The decision is downloaded once: its text is kept in the application under
    // its card, for quotes and the marked preview (the text address is temporary).
    caseLawRepository()?.put({
      cardUrl: sourceUrl,
      court: "SN",
      signature: normalizedSignature,
      ...(date ? { date } : {}),
      ...(form ? { form } : {}),
      text: documentText(html),
      fetchedAt
    });

    const verificationRecord:
      VerificationRecord = {
        claim: request.claim,
        kind: "case",
        status: "VERIFIED",
        sourceUrl,
        sourceTier: "R1",
        fetchedAt,
        toolCallId:
          request.toolCallId,
        verificationMethod:
          "web_fetch",
        sourceFormat: "TEXT",
        caseScope: "FULL_TEXT",
        caseSignature:
          normalizedSignature,
        evidence:
          [
            "Sąd Najwyższy",
            normalizedSignature,
            date,
            form
          ]
            .filter(Boolean)
            .join(" · ")
      };

    return {
      status: "FOUND",
      normalizedSignature,
      rejectedNearMatches,
      record:
        verificationRecord,
      judgment: {
        id,
        signature:
          normalizedSignature,
        ...(date
          ? { date }
          : {}),
        ...(form
          ? { form }
          : {}),
        sourceUrl,
        contentScope:
          "FULL_TEXT",
        normalizedFullText:
          officialText
      }
    };
  }

  async verifyExactQuote(
    request:
      SupremeCourtQuoteVerificationRequest
  ): Promise<
    SupremeCourtQuoteVerificationResult
  > {
    const quote =
      request.quote.trim();
    const normalizedQuote =
      normalizeQuoteText(quote);

    const caseResult =
      await this.verify({
        claim:
          request.caseClaim,
        signature:
          request.signature,
        toolCallId:
          request.toolCallId
      });

    if (
      caseResult.status !== "FOUND" ||
      !caseResult.record ||
      caseResult.record.status !== "VERIFIED" ||
      !caseResult.judgment
    ) {
      return {
        status:
          "CASE_NOT_VERIFIED",
        normalizedSignature:
          caseResult.normalizedSignature,
        caseResult,
        reason:
          caseResult.reason ??
          caseResult.status
      };
    }

    if (
      normalizedQuote.length < 24 ||
      normalizedQuote.length > 1200
    ) {
      return {
        status: "INVALID_QUOTE",
        normalizedSignature:
          caseResult.normalizedSignature,
        caseResult,
        reason:
          "QUOTE_LENGTH_OUT_OF_RANGE"
      };
    }

    if (
      !caseResult.judgment
        .normalizedFullText
        .includes(
          normalizedQuote
        )
    ) {
      return {
        status:
          "QUOTE_NOT_FOUND",
        normalizedSignature:
          caseResult.normalizedSignature,
        caseResult,
        reason:
          "EXACT_QUOTE_NOT_FOUND_IN_OFFICIAL_TEXT"
      };
    }

    const evidenceHash =
      quoteEvidenceHash(
        caseResult.normalizedSignature,
        quote
      );

    const quoteRecord:
      VerificationRecord = {
        claim: quote,
        kind: "case",
        status: "VERIFIED",
        ...(caseResult.record.sourceUrl
          ? {
              sourceUrl:
                caseResult.record.sourceUrl
            }
          : {}),
        ...(caseResult.record.sourceTier
          ? {
              sourceTier:
                caseResult.record.sourceTier
            }
          : {}),
        fetchedAt:
          caseResult.record.fetchedAt,
        toolCallId:
          request.toolCallId,
        verificationMethod:
          "web_fetch",
        sourceFormat: "TEXT",
        caseScope:
          "EXACT_QUOTE",
        caseSignature:
          caseResult.normalizedSignature,
        evidenceHash,
        evidence:
          quote.slice(0, 500)
      };

    return {
      status: "VERIFIED",
      normalizedSignature:
        caseResult.normalizedSignature,
      caseResult,
      quoteRecord,
      evidenceHash
    };
  }
}

/**
 * The official full text (HTML) of an SN decision from its sn.pl page address
 * (the one a verified record carries), fetched the way verification does.
 * Null when the address is not an SN decision page.
 */
export async function supremeCourtFullTextHtml(
  sourceUrl: string,
  fetcher: CaseLawFetch = globalThis.fetch.bind(globalThis)
): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  const id = url.searchParams.get("orzeczenie")?.trim();
  if (url.protocol !== "https:" || !SN_HOSTS.has(url.hostname.toLowerCase()) || !id || !/^[\w-]{1,80}$/u.test(id)) {
    return null;
  }
  const response = await fetchSn(fetcher, supremeCourtTextUrl(id));
  if (!response.ok) throw new Error(`SN_FULL_TEXT_HTTP_${response.status}`);
  const raw = rawFullText(await response.json());
  const html = raw ? decodeBase64Html(raw) : null;
  if (!html) throw new Error("SN_FULL_TEXT_UNAVAILABLE");
  return html;
}

/**
 * The signature of the decision on an sn.pl card (link or bare ID), read from
 * its official text: a card given without a signature is verified as usual.
 */
export async function supremeCourtSignatureFromCard(
  card: string,
  fetcher: CaseLawFetch = globalThis.fetch.bind(globalThis)
): Promise<{ signature: string; cardUrl: string } | null> {
  const id = supremeCourtCardId(card);
  if (!id) return null;
  const cardUrl = humanUrl(id);
  const html = await supremeCourtFullTextHtml(cardUrl, fetcher);
  if (!html) return null;
  const head = documentText(html).slice(0, 4000);
  const signature = signaturesIn(head).find((item) => item.court === "SN")?.signature;
  return signature ? { signature, cardUrl } : null;
}

/** Fields of the sn.pl search form (the widget sends them to snproxy as named here). */
export type SupremeCourtSearchFilters = {
  // „W treści orzeczenia i uzasadnienia” — the widget sends it as both q and tresc.
  tresc?: string;
  sygnatura?: string;
  forma_orzeczenia?: string;
  data_wydania_od?: string;
  data_wydania_do?: string;
  izba?: string;
  sklad_sedziowski?: string;
  sedzia_w_skladzie?: string;
  przewodniczacy?: string;
  sprawozdawca?: string;
  wspolsprawozdawca?: string;
  autor_uzasadnienia?: string;
  strona?: number;
  rozmiar_strony?: number;
};

export function supremeCourtQueryUrl(filters: SupremeCourtSearchFilters): string {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    if (key === "tresc") {
      params.q = String(value);
      params.tresc = String(value);
    } else {
      params[key] = key === "sygnatura" ? stripDotsAndSpace(String(value)) : String(value);
    }
  }
  params.strona ??= "1";
  params.rozmiar_strony ??= String(MAX_SEARCH_RECORDS);
  return proxyUrl("searchOrzeczenia", params);
}

export type SupremeCourtSearchHit = { id: string; signature: string; date?: string; form?: string; cardUrl: string };

/** The sn.pl search with every form field; hits carry the decision's card. */
export async function supremeCourtSearch(
  filters: SupremeCourtSearchFilters,
  fetcher: CaseLawFetch = globalThis.fetch.bind(globalThis)
): Promise<SupremeCourtSearchHit[]> {
  const response = await fetchSn(fetcher, supremeCourtQueryUrl(filters));
  if (!response.ok) throw new Error(`SN_SEARCH_HTTP_${response.status}`);
  const payload: unknown = await response.json();
  const upstream = snUpstreamError(payload);
  if (upstream) throw new Error("SN_SEARCH_UPSTREAM_ERROR");
  const records = searchRecords(payload);
  if (records === null) throw new Error("SN_SEARCH_SCHEMA_DRIFT");
  return records.flatMap((record) => {
    const id = String(record.id ?? "").trim();
    const signature = typeof record.sygnatura_sprawy === "string" ? record.sygnatura_sprawy.replace(/\s+/g, " ").trim() : "";
    if (!id || !signature) return [];
    return [{
      id,
      signature,
      ...(typeof record.data_wydania === "string" ? { date: record.data_wydania.slice(0, 10) } : {}),
      ...(typeof record.forma_orzeczenia === "string" ? { form: record.forma_orzeczenia } : {}),
      cardUrl: humanUrl(id)
    }];
  });
}
