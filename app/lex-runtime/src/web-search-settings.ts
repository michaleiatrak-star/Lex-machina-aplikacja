import fs from "node:fs";
import path from "node:path";

/**
 * Internet search settings (Ustawienia > Wyszukiwarka internetowa): the SearXNG address and the
 * provider order measured by the comparison test run from this computer (web-search-benchmark.ts).
 * Env LEX_WEB_SEARCH_PROVIDER / LEX_SEARXNG_URL override the file (server configuration).
 */
export type SearchEngineName = "searxng" | "duckduckgo";

export const SEARCH_ENGINES: SearchEngineName[] = ["searxng", "duckduckgo"];

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
};

let settingsFile: string | null = null;

export function configureWebSearchSettings(dir: string | null): void {
  settingsFile = dir ? path.join(dir, "web-search.json") : null;
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

function stored(): Partial<WebSearchSettings> {
  if (!settingsFile) return {};
  try {
    return JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Partial<WebSearchSettings>;
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
    lastTest: file.lastTest && Array.isArray(file.lastTest.scores) ? file.lastTest : null
  };
}

export function searxngUrlForced(): boolean {
  return Boolean(process.env.LEX_SEARXNG_URL?.trim());
}

function write(next: WebSearchSettings): void {
  if (!settingsFile) throw new Error("WEB_SEARCH_SETTINGS_NOT_CONFIGURED");
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  const temporary = `${settingsFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(next), "utf8");
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

/** Saves the test result; the order is every engine that scored above zero, best first. */
export function saveWebSearchTest(result: WebSearchTestResult): WebSearchSettings {
  const order = [...result.scores]
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.engine);
  write({ searxngUrl: typeof stored().searxngUrl === "string" ? stored().searxngUrl! : "", order, lastTest: result });
  return webSearchSettings();
}

/**
 * Order used by the search tool in auto mode: the tested order first, then every remaining
 * engine that can run (SearXNG only with an address).
 */
export function effectiveSearchOrder(settings: WebSearchSettings = webSearchSettings()): SearchEngineName[] {
  const usable = (engine: SearchEngineName) => engine !== "searxng" || Boolean(settings.searxngUrl);
  const tested = settings.order.filter(usable);
  const rest = SEARCH_ENGINES.filter((engine) => usable(engine) && !tested.includes(engine));
  return [...tested, ...rest];
}
