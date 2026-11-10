import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Internet search settings (Ustawienia > Wyszukiwarka internetowa): the SearXNG address and the
 * provider order measured by the comparison test run from this computer (web-search-benchmark.ts).
 * Env LEX_WEB_SEARCH_PROVIDER / LEX_SEARXNG_URL override the file (server configuration).
 */
export type SearchEngineName = "searxng" | "duckduckgo" | "firecrawl";

// Firecrawl last among the untested: its free plan has a monthly credit limit.
export const SEARCH_ENGINES: SearchEngineName[] = ["searxng", "duckduckgo", "firecrawl"];
export type SearchEngineScore = {
  engine: SearchEngineName;
  score: number;
  availability: number;
  officialSources: number;
  /** Answered queries whose best useful source is a free (also commercial) legal page. */
  freeSources?: number;
  relevance: number;
  medianMs: number | null;
  queries: number;
  answered: number;
  error?: string;
};

export type WebSearchTestResult = {
  testedAt: string;
  scores: SearchEngineScore[];
};

export type WebSearchSettings = {
  searxngUrl: string;
  order: SearchEngineName[];
  lastTest: WebSearchTestResult | null;
  /** A Firecrawl API key is saved (the key itself never leaves the runtime). */
  firecrawlConfigured: boolean;
};

type SealedKey = { nonce: string; ciphertext: string; tag: string };

type StoredSettings = {
  searxngUrl?: string;
  order?: SearchEngineName[];
  lastTest?: WebSearchTestResult | null;
  firecrawl?: SealedKey | undefined;
};

let settingsFile: string | null = null;
let keyFile: string | null = null;

export function configureWebSearchSettings(dir: string | null): void {
  settingsFile = dir ? path.join(dir, "web-search.json") : null;
  keyFile = dir ? path.join(dir, "web-search.key") : null;
}

// The API key is sealed with AES-256-GCM under a random key in a 0600 file next to the settings,
// as the server's secrets (server-mode/secret-box.ts): the settings file alone does not reveal it.
function rootKey(create: boolean): Buffer | null {
  if (!keyFile) return null;
  if (fs.existsSync(keyFile)) {
    const key = fs.readFileSync(keyFile);
    return key.byteLength === 32 ? key : null;
  }
  if (!create) return null;
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  fs.writeFileSync(keyFile, key, { flag: "wx", mode: 0o600 });
  return key;
}

const KEY_AAD = Buffer.from("lex-web-search:firecrawl", "utf8");

function seal(secret: string): SealedKey {
  const key = rootKey(true);
  if (!key) throw new Error("WEB_SEARCH_SETTINGS_NOT_CONFIGURED");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(KEY_AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

function unseal(sealed: SealedKey | undefined): string {
  const key = rootKey(false);
  if (!sealed || !key) return "";
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.nonce, "base64"));
    decipher.setAAD(KEY_AAD);
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** The Firecrawl key: env FIRECRAWL_API_KEY (server configuration) or the sealed one from Settings. */
export function firecrawlApiKey(): string {
  return process.env.FIRECRAWL_API_KEY?.trim() || unseal(stored().firecrawl);
}

export function firecrawlKeyForced(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

export function normalizeSearxngUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("WEB_SEARCH_SEARXNG_URL_INVALID");
  }
  if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("WEB_SEARCH_SEARXNG_URL_INVALID");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/u, "");
}

function stored(): StoredSettings {
  if (!settingsFile) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsFile, "utf8")) as StoredSettings;
  } catch {
    return {};
  }
}

export function webSearchSettings(): WebSearchSettings {
  const file = stored();
  const envUrl = process.env.LEX_SEARXNG_URL?.trim();
  let searxngUrl = "";
  try {
    searxngUrl = normalizeSearxngUrl(envUrl || file.searxngUrl);
  } catch {
    searxngUrl = "";
  }
  const order = Array.isArray(file.order)
    ? file.order.filter((item): item is SearchEngineName => SEARCH_ENGINES.includes(item as SearchEngineName))
    : [];
  return {
    searxngUrl,
    order: [...new Set(order)],
    lastTest: file.lastTest && Array.isArray(file.lastTest.scores) ? file.lastTest : null,
    firecrawlConfigured: Boolean(firecrawlApiKey())
  };
}

export function searxngUrlForced(): boolean {
  return Boolean(process.env.LEX_SEARXNG_URL?.trim());
}

/** Merges into the stored file (the sealed key stays unless replaced). */
function write(next: StoredSettings): void {
  if (!settingsFile) throw new Error("WEB_SEARCH_SETTINGS_NOT_CONFIGURED");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const merged: StoredSettings = { ...stored(), ...next };
  if (!merged.firecrawl) delete merged.firecrawl;
  const temporary = `${settingsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(merged), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, settingsFile);
}

export function setSearxngUrl(raw: unknown): WebSearchSettings {
  if (searxngUrlForced()) throw new Error("WEB_SEARCH_SEARXNG_URL_FORCED");
  const file = stored();
  const searxngUrl = normalizeSearxngUrl(raw);
  const current = webSearchSettings();
  // A new address invalidates the measured place of SearXNG until the next test.
  const order = searxngUrl === current.searxngUrl ? current.order : current.order.filter((item) => item !== "searxng");
  write({ searxngUrl, order, lastTest: file.lastTest ?? null });
  return webSearchSettings();
}

/** Saves (or with "" removes) the Firecrawl API key; a new key drops Firecrawl's measured place. */
export function setFirecrawlApiKey(raw: unknown): WebSearchSettings {
  if (firecrawlKeyForced()) throw new Error("WEB_SEARCH_FIRECRAWL_KEY_FORCED");
  const key = typeof raw === "string" ? raw.trim() : "";
  if (key && !/^fc-[A-Za-z0-9_-]{8,200}$/u.test(key)) throw new Error("WEB_SEARCH_FIRECRAWL_KEY_INVALID");
  const current = webSearchSettings();
  write({ order: current.order.filter((item) => item !== "firecrawl"), firecrawl: key ? seal(key) : undefined });
  return webSearchSettings();
}

/** Saves the test result; the order is every engine that scored above zero, best first. */
export function saveWebSearchTest(result: WebSearchTestResult): WebSearchSettings {
  const order = [...result.scores]
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.engine);
  write({ order, lastTest: result });
  return webSearchSettings();
}

/**
 * Order used by the search tool in auto mode: the tested order first, then every remaining
 * engine that can run (SearXNG only with an address).
 */
export function effectiveSearchOrder(settings: WebSearchSettings = webSearchSettings()): SearchEngineName[] {
  const usable = (engine: SearchEngineName) =>
    engine === "searxng" ? Boolean(settings.searxngUrl) : engine === "firecrawl" ? settings.firecrawlConfigured : true;
  const tested = settings.order.filter(usable);
  const rest = SEARCH_ENGINES.filter((engine) => usable(engine) && !tested.includes(engine));
  return [...tested, ...rest];
}
