import { isBlockedUrl } from "./blocked-jurisdictions.js";
import { clearLawSourceSession, isChallengePage, LAW_SOURCE_VERIFICATION_REQUIRED, lawSourceSessionHeaders } from "./eli/law-source-sessions.js";
import { signatureRedirect, signaturesIn } from "./court-of-signature.js";
import {
  classifyKnownLegalSourceUrl,
  type LegalSourceTier
} from "./legal-source-policy.js";
import {
  effectiveSearchOrder,
  firecrawlApiKey,
  geminiSearchKey,
  STARTPAGE_HOST,
  webSearchSettings,
  type SearchEngineName,
  type WebSearchSettings
} from "./web-search-settings.js";

/**
 * General internet search for every model in the Lex tool path (ChatGPT,
 * Claude, Bielik, Mistral). Ports the search half of installer/llama-web-mcp.py
 * so it no longer depends on llama.cpp native agent mode.
 *
 * Results are discovery only: snippets are never evidence. R1/R2A hits must go
 * through the native verifiers, R2B/R3 hits through fetch_auxiliary_legal_source.
 */

export type WebSearchHit = {
  title: string;
  url: string;
  snippet: string;
};

export type WebSearchProviderName =
  | "startpage"
  | "duckduckgo"
  | "searxng"
  | "firecrawl"
  | "gemini";

export type WebSearchResponse = {
  provider: WebSearchProviderName;
  hits: WebSearchHit[];
  /** A source that needs the user's check (LAW_SOURCE_VERIFICATION_REQUIRED:<host>); hits came from the next engine. */
  verificationRequired?: string;
};

export interface WebSearchProvider {
  search(
    query: string,
    maxResults: number
  ): Promise<WebSearchResponse>;
}

export class WebSearchError extends Error {
  constructor(
    readonly code:
      | "WEB_SEARCH_QUERY_INVALID"
      | "WEB_SEARCH_CASE_DATA_FORBIDDEN"
      | "WEB_SEARCH_JURISDICTION_BLOCKED"
      | "WEB_SEARCH_DISABLED"
      | "WEB_SEARCH_NO_RESULTS",
    detail?: string
  ) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "WebSearchError";
  }
}

const MAX_QUERY_CHARS = 300;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) LexMachina/1.0";

export function assertPublicWebSearchQuery(
  raw: unknown
): string {
  const query =
    typeof raw === "string"
      ? raw.replace(/\s+/g, " ").trim()
      : "";
  if (
    !query ||
    query.length > MAX_QUERY_CHARS
  ) {
    throw new WebSearchError(
      "WEB_SEARCH_QUERY_INVALID"
    );
  }
  // The chat is pseudonymized before it reaches any model; a query carrying
  // vault tokens or document markers would leak case context to a search engine.
  if (
    /\[(?:LM)?PII:/iu.test(query) ||
    /\[(?:DOCUMENT|CASE KNOWLEDGE|FIRM KNOWLEDGE)\s/iu.test(query)
  ) {
    throw new WebSearchError(
      "WEB_SEARCH_CASE_DATA_FORBIDDEN"
    );
  }
  // site: on a jurisdiction outside the system (technical block).
  for (const match of query.matchAll(/\bsite:(\S+)/giu)) {
    if (isBlockedUrl(`https://${match[1]!.replace(/^https?:\/\//iu, "")}`)) {
      throw new WebSearchError("WEB_SEARCH_JURISDICTION_BLOCKED");
    }
  }
  return query;
}

function decodeEntities(
  value: string
): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number(dec))
    )
    .replace(/&quot;/g, "\"")
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function decodeDuckDuckGoUrl(
  href: string
): string {
  let value =
    decodeEntities(href);
  if (value.startsWith("//")) {
    value = `https:${value}`;
  } else if (value.startsWith("/")) {
    value = `https://duckduckgo.com${value}`;
  }
  try {
    const parsed = new URL(value);
    if (parsed.hostname.endsWith("duckduckgo.com")) {
      const target =
        parsed.searchParams.get("uddg");
      if (target) return target;
    }
  } catch {
    return "";
  }
  return value;
}

export function parseDuckDuckGoHtml(
  html: string,
  maxResults: number
): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const anchor =
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while (
    (match = anchor.exec(html)) !== null
  ) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const classes =
      /\bclass\s*=\s*"([^"]*)"/i.exec(attributes)?.[1]
        ?.split(/\s+/) ?? [];
    if (classes.includes("result__a")) {
      const href =
        /\bhref\s*=\s*"([^"]*)"/i.exec(attributes)?.[1] ?? "";
      const url =
        decodeDuckDuckGoUrl(href);
      const title =
        decodeEntities(body);
      if (
        title &&
        /^https?:\/\//i.test(url)
      ) {
        hits.push({
          title,
          url,
          snippet: ""
        });
      }
    } else if (
      classes.includes("result__snippet") &&
      hits.length > 0
    ) {
      hits[hits.length - 1]!.snippet =
        decodeEntities(body);
    }
  }
  return hits.slice(0, maxResults);
}

/**
 * Organic results of a Startpage results page (server-rendered; markup seen in 2024-2026:
 * a.result-title / a.result-link with h2/h3, then p.description / .w-gl__description). Startpage's
 * own links and ads ("Reklama", /do/ redirects) are skipped. Best effort: the markup changes.
 */
export function parseStartpageHtml(html: string, maxResults: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null && hits.length < maxResults) {
    const attributes = match[1] ?? "";
    const classes = /\bclass\s*=\s*"([^"]*)"/iu.exec(attributes)?.[1] ?? "";
    if (!/\b(?:result-title|result-link|w-gl__result-title)\b/u.test(classes)) continue;
    const href = decodeEntities(/\bhref\s*=\s*"([^"]*)"/iu.exec(attributes)?.[1] ?? "");
    if (!/^https?:\/\//iu.test(href)) continue;
    let host = "";
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (/(^|\.)startpage\.com$/iu.test(host) || seen.has(href)) continue;
    const body = match[2] ?? "";
    const heading = /<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/iu.exec(body)?.[1] ?? body;
    const title = decodeEntities(heading);
    if (!title) continue;
    seen.add(href);
    const after = html.slice(anchor.lastIndex, anchor.lastIndex + 4_000);
    const snippet = /<(?:p|div|span)\b[^>]*class\s*=\s*"[^"]*\b(?:description|w-gl__description)\b[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/iu.exec(after)?.[1] ?? "";
    hits.push({ title, url: href, snippet: decodeEntities(snippet).slice(0, 400) });
  }
  return hits;
}

type GeminiPayload = {
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: Array<{ web?: { uri?: unknown; title?: unknown } }>;
      groundingSupports?: Array<{ segment?: { text?: unknown }; groundingChunkIndices?: unknown }>;
    };
  }>;
};

/** Sources of a grounded Gemini answer: one hit per source, the passages it supports as snippet. */
export function parseGeminiGrounding(payload: GeminiPayload, maxResults: number): WebSearchHit[] {
  const metadata = payload.candidates?.[0]?.groundingMetadata;
  const chunks = Array.isArray(metadata?.groundingChunks) ? metadata!.groundingChunks : [];
  const snippets = new Map<number, string[]>();
  for (const support of Array.isArray(metadata?.groundingSupports) ? metadata!.groundingSupports : []) {
    const text = typeof support.segment?.text === "string" ? support.segment.text : "";
    if (!text || !Array.isArray(support.groundingChunkIndices)) continue;
    for (const index of support.groundingChunkIndices) {
      if (typeof index === "number") snippets.set(index, [...(snippets.get(index) ?? []), text]);
    }
  }
  const seen = new Set<string>();
  return chunks
    .map((chunk, index) => ({
      title: typeof chunk.web?.title === "string" ? decodeEntities(chunk.web.title) : "",
      url: typeof chunk.web?.uri === "string" ? chunk.web.uri.trim() : "",
      snippet: (snippets.get(index) ?? []).join(" ").slice(0, 400)
    }))
    .filter((item) => item.title && /^https?:\/\//iu.test(item.url) && !seen.has(item.url) && seen.add(item.url))
    .slice(0, maxResults);
}

type FirecrawlSearchPayload = {
  success?: boolean;
  data?: { web?: Array<{ url?: unknown; title?: unknown; description?: unknown }> } | Array<{ url?: unknown; title?: unknown; description?: unknown }>;
};

export function parseFirecrawlResults(payload: FirecrawlSearchPayload, maxResults: number): WebSearchHit[] {
  const items = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.data?.web) ? payload.data.web : [];
  return items
    .map((item) => ({
      title: typeof item.title === "string" ? decodeEntities(item.title) : "",
      url: typeof item.url === "string" ? item.url.trim() : "",
      snippet: typeof item.description === "string" ? decodeEntities(item.description) : ""
    }))
    .filter((item) => item.title && /^https?:\/\//i.test(item.url))
    .slice(0, maxResults);
}

type SearxngPayload = { results?: Array<{ engines?: unknown }>; unresponsive_engines?: unknown };

// Which engines of the local SearXNG answered and which refused (Settings > search test, user 2026-11-15).
const searxngEngines = { answered: new Map<string, number>(), refused: new Map<string, string>() };

function recordSearxngEngines(payload: SearxngPayload): void {
  for (const item of Array.isArray(payload.results) ? payload.results : []) {
    for (const engine of Array.isArray(item.engines) ? item.engines : []) {
      if (typeof engine === "string") searxngEngines.answered.set(engine, (searxngEngines.answered.get(engine) ?? 0) + 1);
    }
  }
  for (const entry of Array.isArray(payload.unresponsive_engines) ? payload.unresponsive_engines : []) {
    if (Array.isArray(entry) && typeof entry[0] === "string") searxngEngines.refused.set(entry[0], String(entry[1] ?? ""));
  }
}

export function resetSearxngEngineReport(): void {
  searxngEngines.answered.clear();
  searxngEngines.refused.clear();
}

/** Engines with results (and how many), engines that refused (and why) since the last reset. */
export function searxngEngineReport(): { answered: Array<{ name: string; results: number }>; refused: Array<{ name: string; reason: string }> } {
  return {
    answered: [...searxngEngines.answered].map(([name, results]) => ({ name, results })).sort((a, b) => b.results - a.results),
    refused: [...searxngEngines.refused].filter(([name]) => !searxngEngines.answered.has(name)).map(([name, reason]) => ({ name, reason }))
  };
}

export function parseSearxngResults(
  payload: { results?: Array<{ url?: unknown; title?: unknown; content?: unknown }> },
  maxResults: number
): WebSearchHit[] {
  return (Array.isArray(payload.results) ? payload.results : [])
    .map((item) => ({
      title: typeof item.title === "string" ? decodeEntities(item.title) : "",
      url: typeof item.url === "string" ? item.url.trim() : "",
      snippet: typeof item.content === "string" ? decodeEntities(item.content) : ""
    }))
    .filter((item) => item.title && /^https?:\/\//i.test(item.url))
    .slice(0, maxResults);
}

async function readLimitedText(
  response: Response
): Promise<string> {
  const buffer =
    Buffer.from(await response.arrayBuffer());
  return buffer
    .subarray(0, MAX_BODY_BYTES)
    .toString("utf8");
}

const GEMINI_SEARCH_DEFAULT = "gemini-2.5-flash";
// Flash-Lite has its own free quota: the second try when the Flash quota is used up.
const GEMINI_SEARCH_FALLBACK = "gemini-2.5-flash-lite";

/**
 * A 429 from the Gemini API (user, 2026-11-15: 0 of 8 answers, "limit"): which quota refused, from
 * Google's QuotaFailure and RetryInfo details. A per-minute limit is waited out once; a used-up daily
 * quota or a zero free quota is reported as such instead of "rate limit".
 */
export function geminiQuotaRefusal(body: string): { kind: "MINUTE" | "DAY" | "ZERO" | "OTHER"; retryMs: number | null } {
  let message = body;
  let quotaIds: string[] = [];
  let retryMs: number | null = null;
  try {
    const error = (JSON.parse(body) as { error?: { message?: string; details?: Array<Record<string, unknown>> } }).error;
    message = error?.message ?? body;
    for (const detail of error?.details ?? []) {
      const violations = (detail.violations as Array<{ quotaId?: string }> | undefined) ?? [];
      quotaIds = quotaIds.concat(violations.map((violation) => violation.quotaId ?? "").filter(Boolean));
      const delay = typeof detail.retryDelay === "string" ? /^(\d+(?:\.\d+)?)s$/u.exec(detail.retryDelay) : null;
      if (delay) retryMs = Math.round(Number(delay[1]) * 1000);
    }
  } catch {
    // not JSON: the plain message decides
  }
  const ids = quotaIds.join(" ");
  if (/limit:\s*0\b/u.test(message)) return { kind: "ZERO", retryMs };
  if (/PerDay/u.test(ids)) return { kind: "DAY", retryMs };
  if (/PerMinute/u.test(ids)) return { kind: "MINUTE", retryMs };
  return { kind: "OTHER", retryMs };
}
// The model found for this run of the application after a 404 (see searchGemini).
let geminiSearchModel: string | null = null;

/**
 * A Flash model the key can call with generateContent: no lite, image, audio, live, TTS or embedding
 * variants; a stable name before a preview; the highest version first.
 */
export function pickGeminiSearchModel(models: Array<{ name?: string; supportedGenerationMethods?: string[] }>): string | null {
  const names = models
    .filter((model) => (model.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((model) => (model.name ?? "").replace(/^models\//u, ""))
    .filter((name) => /^gemini-[\d.]+-flash/u.test(name) && !/lite|image|audio|live|tts|embedding|thinking-exp/u.test(name));
  const version = (name: string) => Number(/^gemini-([\d.]+)/u.exec(name)?.[1] ?? 0);
  names.sort((a, b) => version(b) - version(a) || Number(/preview|exp/u.test(a)) - Number(/preview|exp/u.test(b)) || a.length - b.length);
  return names[0] ?? null;
}

export class PublicWebSearch implements WebSearchProvider {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly botCheckPauseMs = 2_500,
    private readonly settings: () => WebSearchSettings = webSearchSettings
  ) {}

  async search(
    query: string,
    maxResults: number
  ): Promise<WebSearchResponse> {
    const provider = (
      this.env.LEX_WEB_SEARCH_PROVIDER ??
      "auto"
    ).trim().toLowerCase();
    if (
      provider === "off" ||
      provider === "disabled"
    ) {
      throw new WebSearchError(
        "WEB_SEARCH_DISABLED"
      );
    }

    const errors: string[] = [];
    // Auto: the order measured by the comparison test (Ustawienia > Wyszukiwarka internetowa),
    // then the remaining engines; a named provider runs alone.
    const settings = this.settings();
    const engines: SearchEngineName[] =
      provider === "auto"
        ? effectiveSearchOrder(settings)
        : provider === "searxng"
          ? ["searxng"]
          : provider === "firecrawl"
            ? ["firecrawl"]
            : provider === "gemini"
              ? ["gemini"]
          : provider === "duckduckgo" || provider === "ddg"
            ? ["duckduckgo"]
            : provider === "startpage"
              ? ["startpage"]
              : [];
    // An engine read through a paid or limited API (Firecrawl, Gemini, SearXNG) that is refused for
    // its limit, credits or key falls back to reading results pages: DuckDuckGo's HTML results
    // (user, 2026-11-14).
    const API_ENGINES: SearchEngineName[] = ["firecrawl", "gemini", "searxng"];
    const SCRAPED: SearchEngineName[] = ["duckduckgo"];
    const apiRefused = (message: string) => /^(?:RATE_LIMITED|CREDITS_EXHAUSTED|KEY_REJECTED|NOT_CONFIGURED|QUOTA|HTTP_(?:4\d\d|5\d\d))/u.test(message);
    let verificationRequired: string | undefined;
    for (let index = 0; index < engines.length; index += 1) {
      const engine = engines[index]!;
      try {
        const hits = withoutBlocked(await this.searchEngine(engine, query, maxResults, settings));
        if (hits.length > 0) {
          return { provider: engine, hits, ...(verificationRequired ? { verificationRequired } : {}) };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith(LAW_SOURCE_VERIFICATION_REQUIRED)) verificationRequired ??= message;
        errors.push(`${engine}:${message}`);
        if (API_ENGINES.includes(engine) && apiRefused(message)) {
          for (const fallback of SCRAPED) if (!engines.includes(fallback)) engines.push(fallback);
        }
      }
    }

    throw new WebSearchError(
      "WEB_SEARCH_NO_RESULTS",
      errors.join("; ") || `provider=${provider}`
    );
  }

  /** One engine, no fallback (the comparison test and the auto order). */
  async searchEngine(
    engine: SearchEngineName,
    query: string,
    maxResults: number,
    settings: WebSearchSettings = this.settings()
  ): Promise<WebSearchHit[]> {
    if (engine === "startpage") {
      if (!settings.startpageSession) throw new Error("NOT_CONFIGURED");
      return this.searchStartpage(query, maxResults);
    }
    if (engine === "searxng") {
      if (!settings.searxngUrl) throw new Error("NOT_CONFIGURED");
      return this.searchSearxng(query, maxResults, settings.searxngUrl);
    }
    if (engine === "gemini") {
      const key = await geminiSearchKey();
      if (!key) throw new Error("NOT_CONFIGURED");
      return this.searchGemini(query, maxResults, key);
    }
    if (engine === "firecrawl") {
      const key = this.env.FIRECRAWL_API_KEY?.trim() || (settings.firecrawlConfigured ? firecrawlApiKey() : "");
      if (!key) throw new Error("NOT_CONFIGURED");
      return this.searchFirecrawl(query, maxResults, key);
    }
    // A bot check passes after a short pause more often than not (seen while checking the
    // disciplinary courts' portals): one more try before "refused".
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.searchDuckDuckGo(query, maxResults);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "BOT_CHECK" && attempt === 1) {
          await new Promise((resolve) => setTimeout(resolve, this.botCheckPauseMs));
          continue;
        }
        throw error;
      }
    }
  }

  /** Firecrawl search API (v2): 2 credits per 10 results; the free plan has a monthly limit. */
  private async searchFirecrawl(
    query: string,
    maxResults: number,
    apiKey: string
  ): Promise<WebSearchHit[]> {
    const response =
      await this.fetchImpl("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": USER_AGENT
        },
        body: JSON.stringify({ query, limit: Math.min(Math.max(maxResults, 1), 10), lang: "pl" }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    // 402: credits used up (free plan limit); 429: rate limit; 401: wrong key.
    if (response.status === 402) throw new Error("CREDITS_EXHAUSTED");
    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (response.status === 401 || response.status === 403) throw new Error("KEY_REJECTED");
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return parseFirecrawlResults(JSON.parse(await readLimitedText(response)) as FirecrawlSearchPayload, maxResults);
  }

  /**
   * Gemini with Grounding with Google Search: real Google results through the user's own Gemini
   * API key. The model's answer is not used; only the sources it grounded on (title, address)
   * and the passages they support, as leads. Grounding links are redirects: resolved to the page
   * address without downloading the page.
   */
  private async searchGemini(
    query: string,
    maxResults: number,
    apiKey: string
  ): Promise<WebSearchHit[]> {
    const ask = (model: string) =>
      this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, "User-Agent": USER_AGENT },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Wyszukaj w Google strony na temat: ${query}. Podaj krótko, co zawierają.` }] }],
          tools: [{ google_search: {} }]
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    const configured = this.env.LEX_GEMINI_SEARCH_MODEL?.trim();
    let response = await ask(configured || geminiSearchModel || GEMINI_SEARCH_DEFAULT);
    // 404: the model is not offered for this key any more (Google retires models). The models the
    // key can use are listed and a current Flash model is taken, instead of a name fixed in code.
    if (response.status === 404 && !configured) {
      const found = await this.discoverGeminiModel(apiKey);
      if (found) {
        geminiSearchModel = found;
        response = await ask(found);
      }
    }
    let model = configured || geminiSearchModel || GEMINI_SEARCH_DEFAULT;
    for (let attempt = 0; response.status === 429 && attempt < 2; attempt++) {
      const refusal = geminiQuotaRefusal(await readLimitedText(response).catch(() => ""));
      if (refusal.kind === "MINUTE" && attempt === 0 && (refusal.retryMs ?? 0) <= 60_000) {
        await new Promise((resolve) => setTimeout(resolve, Math.max(refusal.retryMs ?? 10_000, 1000)));
        response = await ask(model);
        continue;
      }
      if ((refusal.kind === "DAY" || refusal.kind === "ZERO") && !configured && model !== GEMINI_SEARCH_FALLBACK) {
        model = GEMINI_SEARCH_FALLBACK;
        response = await ask(model);
        if (response.status !== 429) {
          geminiSearchModel = model;
          break;
        }
        const second = geminiQuotaRefusal(await readLimitedText(response).catch(() => ""));
        throw new Error(second.kind === "ZERO" || refusal.kind === "ZERO" ? "QUOTA_ZERO" : "QUOTA_DAILY");
      }
      // The kind of limit is shown in the test (Settings): a minute limit still there after the wait is not "a limit".
      throw new Error(refusal.kind === "DAY" ? "QUOTA_DAILY" : refusal.kind === "ZERO" ? "QUOTA_ZERO" : refusal.kind === "MINUTE" ? "QUOTA_MINUTE" : "RATE_LIMITED");
    }
    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (response.status === 401 || response.status === 403) throw new Error("KEY_REJECTED");
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const hits = parseGeminiGrounding(JSON.parse(await readLimitedText(response)) as GeminiPayload, maxResults);
    return Promise.all(hits.map(async (hit) => ({ ...hit, url: await this.resolveRedirect(hit.url) })));
  }

  private async discoverGeminiModel(apiKey: string): Promise<string | null> {
    try {
      const response = await this.fetchImpl("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        headers: { "x-goog-api-key": apiKey, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
      if (!response.ok) return null;
      const payload = JSON.parse(await readLimitedText(response)) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
      return pickGeminiSearchModel(payload.models ?? []);
    } catch {
      return null;
    }
  }

  private async resolveRedirect(url: string): Promise<string> {
    if (!/^https:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//u.test(url)) return url;
    try {
      const response = await this.fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(5_000) });
      const location = response.headers.get("location");
      return location && /^https?:\/\//iu.test(location) ? location : url;
    } catch {
      return url;
    }
  }

  private async searchSearxng(
    query: string,
    maxResults: number,
    baseUrl: string
  ): Promise<WebSearchHit[]> {
    const url = new URL(`${baseUrl}/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "pl");
    url.searchParams.set("safesearch", "0");
    const response =
      await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6",
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    // Public instances answer bots with 429 or a browser check; JSON output off gives 403.
    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (response.status === 403) throw new Error("JSON_FORMAT_DISABLED");
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const text = await readLimitedText(response);
    let payload: { results?: Array<{ url?: unknown; title?: unknown; content?: unknown }> };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      throw new Error("BOT_CHECK");
    }
    recordSearxngEngines(payload as SearxngPayload);
    return parseSearxngResults(payload, maxResults);
  }

  /**
   * Startpage on the user's session (as sn.pl): the cookies and User-Agent of the window in which the
   * user passed Startpage's check. No session, or Startpage asks again (Anubis, a suspension page):
   * the session is dropped and the window is shown to the user again (LAW_SOURCE_VERIFICATION_REQUIRED);
   * the next engine answers this search.
   */
  private async searchStartpage(query: string, maxResults: number): Promise<WebSearchHit[]> {
    const required = `${LAW_SOURCE_VERIFICATION_REQUIRED}:${STARTPAGE_HOST}`;
    const session = lawSourceSessionHeaders(STARTPAGE_HOST);
    if (!session) throw new Error(required);
    const url = new URL(`https://${STARTPAGE_HOST}/sp/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("cat", "web");
    url.searchParams.set("language", "polski");
    url.searchParams.set("lui", "polski");
    const response = await this.fetchImpl(url, {
      headers: { Accept: "text/html", "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6", ...session },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const html = await readLimitedText(response);
    if (isChallengePage(response.status, html)) {
      clearLawSourceSession(STARTPAGE_HOST);
      throw new Error(required);
    }
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return parseStartpageHtml(html, maxResults);
  }

  private async searchDuckDuckGo(
    query: string,
    maxResults: number
  ): Promise<WebSearchHit[]> {
    const url =
      new URL("https://html.duckduckgo.com/html/");
    url.searchParams.set("q", query);
    const response =
      await this.fetchImpl(url, {
        headers: {
          Accept: "text/html",
          "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6",
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    const html = await readLimitedText(response);
    const hits = parseDuckDuckGoHtml(html, maxResults);
    // A bot check (HTTP 202, an "anomaly" page) is not "no results": the model is told the
    // search was refused, not that nothing exists.
    if (!hits.length && (response.status === 202 || /anomaly|captcha|unusual traffic|bots? (?:use|detected)/iu.test(html))) {
      throw new Error("BOT_CHECK");
    }
    return hits;
  }
}

// Leads in a title or snippet of any result, verified at their official source before use
// (gradation of sources: a commercial database or a news site can point to a ruling, an
// amendment or a date of entry into force, but never stands as their source).
export type WebSearchLeads = {
  signatures?: Array<{ signature: string; court: string; verifyWith: string }>;
  journals?: Array<{ citation: string; eli: string }>;
  entryIntoForce?: string[];
};

// "Dz. U. z 2024 r. poz. 1061", "Dz.U. 2024 poz. 1061", LEX style "Dz.U.2024.1061".
const JOURNAL = /Dz\.\s?U\.\s*(?:z\s*)?(\d{4})(?:\s*(?:r\.)?\s*(?:,?\s*Nr\s*\d+\s*)?,?\s*poz\.\s*|\.)(\d{1,5})/gu;
const IN_FORCE = /(?:wchodzi|wejdzie|wesz[łl]\p{L}*|wejści\p{L}*)\s+w\s+życi\p{L}*[^.;\n]{0,80}|obowiązuj\p{L}*\s+od\s+[^.;\n]{0,60}/giu;

export function webSearchLeads(text: string): WebSearchLeads {
  const leads: WebSearchLeads = {};
  const signatures = signaturesIn(text)
    .map((item) => ({ item, redirect: signatureRedirect(item.signature) }))
    .filter((entry) => entry.redirect)
    .map(({ item, redirect }) => ({ signature: item.signature, court: redirect!.court, verifyWith: redirect!.useInstead }));
  if (signatures.length) leads.signatures = signatures.slice(0, 5);
  const journals = [...text.matchAll(JOURNAL)].map((match) => ({ citation: `Dz.U. ${match[1]} poz. ${match[2]}`, eli: `DU/${match[1]}/${match[2]}` }));
  if (journals.length) leads.journals = journals.filter((item, index) => journals.findIndex((other) => other.eli === item.eli) === index).slice(0, 5);
  const inForce = [...text.matchAll(IN_FORCE)].map((match) => match[0].replace(/\s+/g, " ").trim());
  if (inForce.length) leads.entryIntoForce = [...new Set(inForce)].slice(0, 3);
  return leads;
}

export const PAID_DATABASES = new Set(["lex.pl", "sip.lex.pl", "legalis.pl", "sip.legalis.pl"]);

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

export type ClassifiedWebSearchHit =
  WebSearchHit & {
    sourceTier: LegalSourceTier;
    nextStep: string;
    leads?: WebSearchLeads;
  };

export function classifyWebSearchHits(
  hits: WebSearchHit[]
): ClassifiedWebSearchHit[] {
  return hits.map((hit) => {
    const sourceTier =
      classifyKnownLegalSourceUrl(hit.url) ?? "R3";
    const leads = webSearchLeads(`${hit.title}\n${hit.snippet}`);
    const hasLeads = Boolean(leads.signatures || leads.journals || leads.entryIntoForce);
    return {
      ...hit,
      sourceTier,
      ...(hasLeads ? { leads } : {}),
      nextStep:
        sourceTier === "R1"
          ? "Official statute source: verify the exact provision with verify_legal_reference before citing."
          : sourceTier === "R2A"
            ? "Official case-law/register source: verify with the matching verify_case_* tool or federated document fetch before citing."
            : PAID_DATABASES.has(hostOf(hit.url))
              ? "Commercial database (LEX/Legalis, usually behind a login): do not cite it and do not read the paid page; use the leads it shows (case signature and date, Dz.U. of an amendment, date of entry into force) and verify each at the official source: signatures with leads.signatures[].verifyWith, acts and amendments with verify_legal_reference (asOf) / ELI. A lead not confirmed officially stays unverified."
              : "Lead, not a source: verify every signature, Dz.U. reference and date it shows at the official source (leads[].verifyWith, verify_legal_reference / ELI) before citing; read the page with fetch_auxiliary_legal_source when the snippet is not enough. It can never be the sole legal basis."
    };
  });
}

/** Hits from jurisdictions outside the system never reach the model (technical block). */
function withoutBlocked(hits: WebSearchHit[]): WebSearchHit[] {
  return hits.filter((hit) => !isBlockedUrl(hit.url));
}
