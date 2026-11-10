import { isBlockedUrl } from "./blocked-jurisdictions.js";
import {
  LAW_SOURCE_VERIFICATION_REQUIRED,
  clearLawSourceSession,
  isChallengePage,
  lawSourceSessionHeaders
} from "./eli/law-source-sessions.js";
import { signatureRedirect, signaturesIn } from "./court-of-signature.js";
import {
  classifyKnownLegalSourceUrl,
  type LegalSourceTier
} from "./legal-source-policy.js";
import {
  effectiveSearchOrder,
  firecrawlApiKey,
  geminiSearchKey,
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
  | "brave"
  | "duckduckgo"
  | "searxng"
  | "firecrawl"
  | "gemini"
  | "google";

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

/** Organic results of a Google results page: a link with a heading (h3) inside; Google's own pages skipped. */
export function parseGoogleHtml(html: string, maxResults: number): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null && hits.length < maxResults) {
    const heading = /<h3\b[^>]*>([\s\S]*?)<\/h3>/iu.exec(match[2] ?? "");
    if (!heading) continue;
    let href = decodeEntities(match[1] ?? "");
    if (href.startsWith("/url?")) {
      href = new URLSearchParams(href.slice(5)).get("q") ?? new URLSearchParams(href.slice(5)).get("url") ?? "";
    }
    if (!/^https?:\/\//iu.test(href)) continue;
    let host = "";
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (/(^|\.)google\.[a-z.]+$/iu.test(host) || seen.has(href)) continue;
    seen.add(href);
    // The snippet: the first text block after the link (Google's markup changes; best effort).
    const after = html.slice(anchor.lastIndex, anchor.lastIndex + 4_000);
    const snippet = /<(?:div|span)\b[^>]*(?:VwiC3b|data-sncf)[^>]*>([\s\S]*?)<\/(?:div|span)>/iu.exec(after)?.[1] ?? "";
    hits.push({ title: decodeEntities(heading[1] ?? ""), url: href, snippet: decodeEntities(snippet).slice(0, 400) });
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
    const braveKey =
      this.env.BRAVE_SEARCH_API_KEY?.trim();
    if (
      braveKey &&
      (provider === "auto" || provider === "brave")
    ) {
      try {
        const hits =
          withoutBlocked(await this.searchBrave(query, maxResults, braveKey));
        if (hits.length > 0) {
          return { provider: "brave", hits };
        }
      } catch (error) {
        errors.push(
          `brave:${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

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
              : provider === "google"
                ? ["google"]
          : provider === "duckduckgo" || provider === "ddg"
            ? ["duckduckgo"]
            : [];
    let verificationRequired: string | undefined;
    for (const engine of engines) {
      try {
        const hits = withoutBlocked(await this.searchEngine(engine, query, maxResults, settings));
        if (hits.length > 0) {
          return { provider: engine, hits, ...(verificationRequired ? { verificationRequired } : {}) };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith(LAW_SOURCE_VERIFICATION_REQUIRED)) verificationRequired ??= message;
        errors.push(`${engine}:${message}`);
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
    if (engine === "searxng") {
      if (!settings.searxngUrl) throw new Error("NOT_CONFIGURED");
      return this.searchSearxng(query, maxResults, settings.searxngUrl);
    }
    if (engine === "google") return this.searchGoogle(query, maxResults);
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

  /**
   * Google on the user's session (as sn.pl): the cookies and User-Agent of the window in which the
   * user passed Google's consent page and captcha. No session, or Google answers with its captcha:
   * the session is dropped and the window is shown to the user again (LAW_SOURCE_VERIFICATION_REQUIRED).
   */
  private async searchGoogle(query: string, maxResults: number): Promise<WebSearchHit[]> {
    const required = `${LAW_SOURCE_VERIFICATION_REQUIRED}:www.google.com`;
    const session = lawSourceSessionHeaders("www.google.com");
    if (!session) throw new Error(required);
    const url = new URL("https://www.google.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("hl", "pl");
    url.searchParams.set("num", String(Math.min(Math.max(maxResults, 1), 10)));
    const response = await this.fetchImpl(url, {
      headers: { Accept: "text/html", "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.6", ...session },
      redirect: "follow",
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    const html = await readLimitedText(response);
    if (isChallengePage(response.status, html) || /\/sorry\//u.test(response.url)) {
      clearLawSourceSession("www.google.com");
      throw new Error(required);
    }
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return parseGoogleHtml(html, maxResults);
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
    const model = (this.env.LEX_GEMINI_SEARCH_MODEL ?? "gemini-2.5-flash").trim();
    const response =
      await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey, "User-Agent": USER_AGENT },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: `Wyszukaj w Google strony na temat: ${query}. Podaj krótko, co zawierają.` }] }],
          tools: [{ google_search: {} }]
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    if (response.status === 429) throw new Error("RATE_LIMITED");
    if (response.status === 401 || response.status === 403) throw new Error("KEY_REJECTED");
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const hits = parseGeminiGrounding(JSON.parse(await readLimitedText(response)) as GeminiPayload, maxResults);
    return Promise.all(hits.map(async (hit) => ({ ...hit, url: await this.resolveRedirect(hit.url) })));
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
    return parseSearxngResults(payload, maxResults);
  }

  private async searchBrave(
    query: string,
    maxResults: number,
    apiKey: string
  ): Promise<WebSearchHit[]> {
    const url =
      new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(maxResults));
    const response =
      await this.fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
          "User-Agent": USER_AGENT
        },
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    if (!response.ok) {
      throw new Error(`HTTP_${response.status}`);
    }
    const payload =
      JSON.parse(await readLimitedText(response)) as {
        web?: {
          results?: Array<{
            url?: unknown;
            title?: unknown;
            description?: unknown;
          }>;
        };
      };
    return (payload.web?.results ?? [])
      .map((item) => ({
        title:
          typeof item.title === "string"
            ? decodeEntities(item.title)
            : "",
        url:
          typeof item.url === "string"
            ? item.url.trim()
            : "",
        snippet:
          typeof item.description === "string"
            ? decodeEntities(item.description)
            : ""
      }))
      .filter((item) =>
        item.title &&
        /^https?:\/\//i.test(item.url)
      )
      .slice(0, maxResults);
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
