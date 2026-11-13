import fs from "node:fs";
import path from "node:path";

/**
 * Google Programmable Search (Custom Search JSON API) for web_search and the ruling lookup:
 * the official API with the firm's own key and search engine id (cx); google.com itself is not
 * scraped. Kept like the CEIDG key: a private file (0600) in the settings, or the environment
 * (LEX_GOOGLE_CSE_KEY, LEX_GOOGLE_CSE_CX), which wins.
 */
let settingsFile: string | null = null;

export function configureGoogleSearchKey(dir: string | null): void {
  settingsFile = dir ? path.join(dir, "google-search.json") : null;
}

export type GoogleSearchKey = { key: string; cx: string };

export function googleSearchKey(env: NodeJS.ProcessEnv = process.env): GoogleSearchKey | null {
  const key = env.LEX_GOOGLE_CSE_KEY?.trim();
  const cx = env.LEX_GOOGLE_CSE_CX?.trim();
  if (key && cx) return { key, cx };
  if (!settingsFile) return null;
  try {
    const value = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Partial<GoogleSearchKey>;
    return typeof value.key === "string" && value.key && typeof value.cx === "string" && value.cx ? { key: value.key, cx: value.cx } : null;
  } catch {
    return null;
  }
}

export function setGoogleSearchKey(value: GoogleSearchKey | null): void {
  if (!settingsFile) throw new Error("GOOGLE_SEARCH_NOT_CONFIGURED");
  if (value === null) {
    fs.rmSync(settingsFile, { force: true });
    return;
  }
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(value.key) || !/^[A-Za-z0-9:_-]{5,80}$/.test(value.cx)) throw new Error("GOOGLE_SEARCH_KEY_INVALID");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, settingsFile);
}

/** Settings view: whether a key is set and where from; never the key. */
export function googleSearchStatus(env: NodeJS.ProcessEnv = process.env): { configured: boolean; fromEnvironment: boolean } {
  const fromEnvironment = Boolean(env.LEX_GOOGLE_CSE_KEY?.trim() && env.LEX_GOOGLE_CSE_CX?.trim());
  return { configured: Boolean(googleSearchKey(env)), fromEnvironment };
}

/**
 * SearXNG: the firm's own instance (open-source metasearch; it merges Google, Startpage, Bing,
 * DuckDuckGo, Mojeek and others as its operator configures it). Public instances answer
 * programs with a browser check, so only an own instance is supported. LEX_SEARXNG_URL wins.
 * Plain http only for this computer or a local network address.
 */
let searxngFile: string | null = null;

export function configureSearxngUrl(dir: string | null): void {
  searxngFile = dir ? path.join(dir, "searxng.json") : null;
}

export function normalizeSearxngUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("SEARXNG_URL_INVALID");
  }
  const local = /^(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\[::1\]|[\w-]+\.local)$/iu.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("SEARXNG_URL_INVALID");
  if (url.username || url.password || url.search || url.hash) throw new Error("SEARXNG_URL_INVALID");
  return url.toString().replace(/\/+$/u, "");
}

export function searxngUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.LEX_SEARXNG_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/+$/u, "");
  if (!searxngFile) return null;
  try {
    const value = (JSON.parse(fs.readFileSync(searxngFile, "utf8")) as { url?: unknown }).url;
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

export function setSearxngUrl(value: string | null): void {
  if (!searxngFile) throw new Error("SEARXNG_NOT_CONFIGURED");
  if (value === null) {
    fs.rmSync(searxngFile, { force: true });
    return;
  }
  const url = normalizeSearxngUrl(value);
  fs.mkdirSync(path.dirname(searxngFile), { recursive: true });
  const temporary = `${searxngFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ url }), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, searxngFile);
}

/**
 * Provider order chosen by the comparison test (Ustawienia -> Integracje): the best-scoring
 * provider is asked first. Absent: SearXNG, Google, Brave, DuckDuckGo.
 */
let orderFile: string | null = null;
export const SEARCH_PROVIDERS = ["searxng", "google", "brave", "duckduckgo"] as const;
export type SearchProviderId = (typeof SEARCH_PROVIDERS)[number];

export function configureSearchOrder(dir: string | null): void {
  orderFile = dir ? path.join(dir, "web-search-order.json") : null;
}

export function searchOrder(): SearchProviderId[] {
  try {
    if (orderFile) {
      const saved = (JSON.parse(fs.readFileSync(orderFile, "utf8")) as { order?: unknown }).order;
      if (Array.isArray(saved)) {
        const known = saved.filter((item): item is SearchProviderId => (SEARCH_PROVIDERS as readonly string[]).includes(item as string));
        return [...known, ...SEARCH_PROVIDERS.filter((item) => !known.includes(item))];
      }
    }
  } catch {
    // default order
  }
  return [...SEARCH_PROVIDERS];
}

export function setSearchOrder(order: SearchProviderId[] | null): void {
  if (!orderFile) return;
  if (order === null) {
    fs.rmSync(orderFile, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(orderFile), { recursive: true });
  fs.writeFileSync(orderFile, JSON.stringify({ order }), "utf8");
}
