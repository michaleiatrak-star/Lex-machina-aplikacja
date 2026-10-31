import { signatureRedirect, signaturesIn } from "./court-of-signature.js";
import {
  classifyKnownLegalSourceUrl,
  type LegalSourceTier
} from "./legal-source-policy.js";

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
  | "duckduckgo";

export type WebSearchResponse = {
  provider: WebSearchProviderName;
  hits: WebSearchHit[];
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
    private readonly botCheckPauseMs = 2_500
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
          await this.searchBrave(query, maxResults, braveKey);
        if (hits.length > 0) {
          return { provider: "brave", hits };
        }
      } catch (error) {
        errors.push(
          `brave:${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    if (
      provider === "auto" ||
      provider === "duckduckgo" ||
      provider === "ddg"
    ) {
      // A bot check passes after a short pause more often than not (seen while checking the
      // disciplinary courts' portals): one more try before "refused".
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const hits =
            await this.searchDuckDuckGo(query, maxResults);
          if (hits.length > 0) {
            return { provider: "duckduckgo", hits };
          }
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "BOT_CHECK" && attempt === 1) {
            await new Promise((resolve) => setTimeout(resolve, this.botCheckPauseMs));
            continue;
          }
          errors.push(`duckduckgo:${message}`);
          break;
        }
      }
    }

    throw new WebSearchError(
      "WEB_SEARCH_NO_RESULTS",
      errors.join("; ") || `provider=${provider}`
    );
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

const PAID_DATABASES = new Set(["lex.pl", "sip.lex.pl", "legalis.pl", "sip.legalis.pl"]);

function hostOf(url: string): string {
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
