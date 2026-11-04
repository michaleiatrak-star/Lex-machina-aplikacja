// The wokanda of a common court: hearings of a case by its signature, read from the court's own
// site on the user's request (one search and the details of each hearing found; never a scan).
// Most courts publish it in the Ministry's court portal (index.php?p=cases): a search by the
// signature's department, repertory, number and year. Courts whose wokanda only a browser opens
// (a browser verification, reCAPTCHA, another system) get its address instead. The register of
// which court publishes how: app/courts/probe_wokanda.py, re-checked from the user's computer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { courtByName } from "./court-base.js";
import { WOKANDA_REGISTER } from "./wokanda-registry-data.js";

export type WokandaStatus = "PORTAL" | "BROWSER" | "NONE" | "UNREACHABLE";

export type WokandaCourt = {
  nazwa: string;
  domena: string;
  status: WokandaStatus;
  url?: string;
  powod?: string;
};

export type WokandaRegister = { sprawdzono: string; sady: WokandaCourt[] };

export type WokandaHearing = {
  sygnatura: string;
  wydzial: string;
  data: string;
  godzina: string;
  sala: string;
  status: string;
  miejsce?: string;
  przewodniczacy?: string;
  sklad?: string;
  url: string;
};

export type WokandaResult =
  | { state: "FOUND" | "NOT_FOUND"; court: string; signature: string; searchUrl: string; hearings: WokandaHearing[]; checkedAt: string }
  // The court's wokanda needs a browser, or the court publishes none: its address to open.
  | {
      state: "BROWSER_ONLY" | "NO_WOKANDA" | "UNREACHABLE";
      court: string;
      signature: string;
      url?: string;
      reason: string;
      checkedAt: string;
      // A browser verification the user passes in the court's window of the application (as for
      // sn.pl); after it the check runs again with that session.
      verification?: { domain: string; url: string; savedSession: boolean };
    };

export type FetchText = (url: string, headers?: Record<string, string>) => Promise<{ status: number; url: string; text: string }>;

export const WOKANDA_USER_AGENT = "LexMachina (wokanda; zapytanie uzytkownika o jego sprawe)";
const TIMEOUT_MS = 20_000;
const MAX_HEARINGS = 10;
// A browser verification page (JavaScript challenge), reCAPTCHA or a similar guard: the
// application does not get past it and gives the address instead.
const GUARD = /weryfikacja przeglądarki|g-recaptcha|recaptcha_response|mosparo|cf-challenge/iu;

export const defaultFetchText: FetchText = async (url, headers = {}) => {
  const response = await fetch(url, { headers: { "user-agent": WOKANDA_USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  const text = await response.text();
  return { status: response.status, url: response.url || url, text: text.slice(0, 1_000_000) };
};

// --- Sessions after a browser verification done by the user --------------------------------
// As for sn.pl: the user passes the court's verification in the application's window of that
// court; its cookies and the browser's User-Agent serve this user's wokanda queries to that
// court. Kept in memory only; never returned or logged.

type WokandaSession = { cookie: string; userAgent: string; at: number };
const sessions = new Map<string, WokandaSession>();
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

export function courtDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./u, "");
}

function sessionHeaders(domain: string): Record<string, string> | null {
  const session = sessions.get(courtDomain(domain));
  if (!session || Date.now() - session.at > SESSION_TTL_MS) return null;
  return { cookie: session.cookie, "user-agent": session.userAgent };
}

export function setWokandaSession(domain: string, cookie: string, userAgent: string): void {
  if (!cookie.trim() || cookie.length > 16_384 || /[\r\n]/u.test(cookie + userAgent) || userAgent.length > 512) throw new Error("WOKANDA_SESSION_INVALID");
  sessions.set(courtDomain(domain), { cookie: cookie.trim(), userAgent: userAgent.trim() || WOKANDA_USER_AGENT, at: Date.now() });
}

export function clearWokandaSessions(): void {
  sessions.clear();
}

/** The court's wokanda page read with the window's cookies: the portal answered, the session is kept. */
export async function probeWokandaSession(domain: string, cookie: string, userAgent: string, fetchText: FetchText = defaultFetchText): Promise<{ ready: boolean }> {
  const court = WOKANDA_REGISTER.sady.find((item) => item.domena === courtDomain(domain));
  if (!court) throw new Error("WOKANDA_COURT_UNKNOWN");
  if (!cookie.trim()) return { ready: false };
  try {
    const page = await fetchText(`https://${court.domena}/wokanda`, { cookie, "user-agent": userAgent || WOKANDA_USER_AGENT });
    const ready = page.status === 200 && !GUARD.test(page.text) && page.text.includes('name="nrspr"');
    if (ready) setWokandaSession(court.domena, cookie, userAgent);
    return { ready };
  } catch {
    return { ready: false };
  }
}

/** "XI C 1768/26" -> department XI, repertory C, number 1768, year 2026. */
export function parseCommonSignature(value: string): { wydzial: string; repertorium: string; numer: string; rok: string } | null {
  const text = value.normalize("NFKC").replace(/^sygn\.?\s*(?:akt)?\s*:?\s*/iu, "").replace(/\s+/gu, " ").trim();
  const match = /^([IVXL]{1,6}) ([0-9]?[A-Z][A-Za-z]{0,5}(?:-[A-Za-z]+)?) (\d{1,6})\/(\d{2}|\d{4})$/u.exec(text);
  if (!match) return null;
  const [, wydzial, repertorium, numer, rok] = match as unknown as [string, string, string, string, string];
  return { wydzial, repertorium, numer, rok: rok.length === 2 ? `20${rok}` : rok };
}

export function wokandaRegister(): WokandaRegister {
  return WOKANDA_REGISTER;
}

export function wokandaCourt(name: string): WokandaCourt | null {
  const canonical = courtByName(name)?.nazwa ?? name;
  return WOKANDA_REGISTER.sady.find((court) => court.nazwa === canonical) ?? null;
}

/** The portal's search address for one signature. */
export function portalSearchUrl(portalUrl: string, signature: ReturnType<typeof parseCommonSignature> & object): string {
  const root = /^https?:\/\/[^/]+/u.exec(portalUrl)?.[0] ?? portalUrl;
  const query = new URLSearchParams({
    p: "cases",
    action: "search",
    nr_wydzial: signature.wydzial,
    reper: signature.repertorium,
    nrspr: signature.numer,
    rok_rozpr: signature.rok,
    wydzial: "0",
    data: "",
    godz: "",
    sala: ""
  });
  return `${root}/index.php?${query.toString()}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/giu, (entity, code: string) =>
      code.startsWith("#x") ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith("#") ? String.fromCodePoint(Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? entity)
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function field(block: string, label: string): string {
  const match = new RegExp(`${label}\\s*:\\s*<span[^>]*>([\\s\\S]*?)</span>`, "iu").exec(block);
  return match ? plain(match[1]!) : "";
}

/** Hearings listed by the portal's search (results page). */
export function parsePortalResults(html: string, pageUrl: string): WokandaHearing[] {
  const start = html.indexOf("cases-results-wrapper");
  if (start < 0) return [];
  const root = /^https?:\/\/[^/]+/u.exec(pageUrl)?.[0] ?? "";
  return [...html.slice(start).matchAll(/<li>\s*<div class="row">([\s\S]*?)<\/li>/gu)]
    .map((match) => match[1]!)
    .map((block) => {
      const link = /href="([^"]+)"[^>]*class="more-link"/u.exec(block)?.[1] ?? "";
      return {
        sygnatura: field(block, "Sygnatura sprawy"),
        wydzial: field(block, "Wydział"),
        status: field(block, "Status"),
        data: field(block, "Data"),
        sala: field(block, "Sala"),
        godzina: field(block, "Godzina"),
        url: link ? (link.startsWith("http") ? link : `${root}/${link.replace(/^\//u, "")}`) : pageUrl
      };
    })
    .filter((hearing) => hearing.sygnatura && /^\d{4}-\d{2}-\d{2}$/u.test(hearing.data));
}

/** The hearing's details page: place, presiding judge and the rest of the bench. */
export function parsePortalDetails(html: string): Partial<Pick<WokandaHearing, "miejsce" | "przewodniczacy" | "sklad" | "godzina">> {
  const text = plain(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gu, " "));
  const after = (label: string, next: string) => {
    const match = new RegExp(`${label}:\\s*(.*?)\\s*(?:${next})[^:]{0,40}:`, "u").exec(text);
    return match?.[1]?.trim() || undefined;
  };
  const godzina = after("Godzina", "Przewodniczący|Pozostały skład|Sygnatura akt");
  const miejsce = after("Miejsce", "Sala");
  const przewodniczacy = after("Przewodniczący", "Pozostały skład sędziowski|Sygnatura akt");
  const sklad = after("Pozostały skład sędziowski", "Sygnatura akt");
  return {
    ...(miejsce ? { miejsce } : {}),
    ...(przewodniczacy ? { przewodniczacy } : {}),
    ...(sklad ? { sklad } : {}),
    ...(godzina ? { godzina: godzina.replace(/^(\d{2}:\d{2}):\d{2}$/u, "$1") } : {})
  };
}

const sameSignature = (a: string, b: string) => a.replace(/\s+/gu, " ").trim().toLowerCase() === b.replace(/\s+/gu, " ").trim().toLowerCase();

/** The hearings of one case (court and signature) from the court's wokanda. */
export async function checkWokanda(
  courtName: string,
  signature: string,
  fetchText: FetchText = defaultFetchText,
  now: () => Date = () => new Date(),
  register: (name: string) => WokandaCourt | null = wokandaCourt
): Promise<WokandaResult> {
  const checkedAt = now().toISOString();
  const court = register(courtName);
  const base = { court: courtByName(courtName)?.nazwa ?? courtName, signature, checkedAt };
  if (!court) return { ...base, state: "NO_WOKANDA", reason: "Sądu nie ma w rejestrze wokand (sądy powszechne)." };
  if (court.status === "NONE") return { ...base, state: "NO_WOKANDA", ...(court.url ? { url: court.url } : {}), reason: "Strona sądu nie publikuje wokandy." };
  const verifiable = court.status === "PORTAL" || (court.status === "BROWSER" && court.powod === "weryfikacja przeglądarki");
  const verification = (savedSession: boolean) => ({ domain: court.domena, url: court.url ?? `https://${court.domena}/wokanda`, savedSession });
  const session = verifiable ? sessionHeaders(court.domena) : null;
  if (court.status === "BROWSER" && !session) {
    return {
      ...base,
      state: "BROWSER_ONLY",
      ...(court.url ? { url: court.url } : {}),
      reason: verifiable
        ? "Strona sądu wymaga weryfikacji przeglądarki: przejdź ją w oknie sądu, a sprawdzenie ponowi się samo."
        : `Wokanda tego sądu otwiera się tylko w przeglądarce (${court.powod ?? "inny system"}).`,
      ...(verifiable ? { verification: verification(false) } : {})
    };
  }
  const fetchPage: FetchText = session ? (url) => fetchText(url, session) : fetchText;
  const parsed = parseCommonSignature(signature);
  if (!parsed) return { ...base, state: "UNREACHABLE", reason: "Sygnatura nie ma postaci sądu powszechnego (np. XI C 1768/26)." };
  const searchUrl = portalSearchUrl(court.url ?? `https://${court.domena}/wokanda`, parsed);
  let page: Awaited<ReturnType<FetchText>>;
  try {
    page = await fetchPage(searchUrl);
  } catch (error) {
    return { ...base, state: "UNREACHABLE", url: court.url ?? searchUrl, reason: `Strona sądu nie odpowiedziała (${error instanceof Error ? error.name : "błąd"}).` };
  }
  if (GUARD.test(page.text)) {
    return {
      ...base,
      state: "BROWSER_ONLY",
      url: searchUrl,
      reason: session ? "Sesja z weryfikacji wygasła: zweryfikuj się ponownie w oknie sądu." : "Strona sądu wymaga teraz weryfikacji przeglądarki: przejdź ją w oknie sądu.",
      verification: verification(Boolean(session))
    };
  }
  if (page.status !== 200) return { ...base, state: "UNREACHABLE", url: searchUrl, reason: `Strona sądu odpowiedziała kodem ${page.status}.` };
  const listed = parsePortalResults(page.text, page.url).filter((hearing) => sameSignature(hearing.sygnatura, signature.replace(/^sygn\.?\s*(?:akt)?\s*:?\s*/iu, "")));
  const hearings: WokandaHearing[] = [];
  for (const hearing of listed.slice(0, MAX_HEARINGS)) {
    try {
      const details = await fetchPage(hearing.url);
      hearings.push(details.status === 200 && !GUARD.test(details.text) ? { ...hearing, ...parsePortalDetails(details.text) } : hearing);
    } catch {
      hearings.push(hearing);
    }
  }
  hearings.sort((a, b) => `${a.data} ${a.godzina}`.localeCompare(`${b.data} ${b.godzina}`));
  return { ...base, state: hearings.length ? "FOUND" : "NOT_FOUND", searchUrl, hearings };
}

/** One court's wokanda checked again (developer settings): its page, one request. */
export async function recheckWokandaCourt(court: WokandaCourt, fetchText: FetchText = defaultFetchText): Promise<WokandaCourt> {
  const url = court.status === "PORTAL" || !court.url ? `https://${court.domena}/wokanda` : court.url;
  try {
    const page = await fetchText(url);
    if (page.status === 200 && page.text.includes('name="nrspr"') && page.text.includes('value="cases"')) return { nazwa: court.nazwa, domena: court.domena, status: "PORTAL", url: page.url };
    if (GUARD.test(page.text)) return { nazwa: court.nazwa, domena: court.domena, status: "BROWSER", url: page.url, powod: "weryfikacja przeglądarki" };
    if (page.status === 200 && /wokand/iu.test(page.text)) return { nazwa: court.nazwa, domena: court.domena, status: "BROWSER", url: page.url, powod: court.powod ?? "inny system wokandy" };
    if (page.status === 200 || page.status === 404) return { nazwa: court.nazwa, domena: court.domena, status: court.status === "NONE" ? "NONE" : court.status, ...(court.url ? { url: court.url } : {}), ...(court.powod ? { powod: court.powod } : {}) };
    return { nazwa: court.nazwa, domena: court.domena, status: "UNREACHABLE", url, powod: `HTTP ${page.status}` };
  } catch (error) {
    return { nazwa: court.nazwa, domena: court.domena, status: "UNREACHABLE", url, powod: error instanceof Error ? error.name : "błąd sieci" };
  }
}

// --- The register as this computer sees it ---------------------------------------------------
// A re-check from the user's computer replaces the shipped status of that court (a site that
// blocks one network may answer another); kept in %LOCALAPPDATA%\LexMachina\wokanda.json.

export type WokandaCourtView = WokandaCourt & { sprawdzono: string; zrodlo: "WYDANIE" | "TEN_KOMPUTER" };

export function wokandaOverridesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "LexMachina", "wokanda.json") : path.join(os.tmpdir(), "LexMachina-wokanda.json");
}

function readOverrides(file: string): Record<string, WokandaCourt & { sprawdzono: string }> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, WokandaCourt & { sprawdzono: string }>) : {};
  } catch {
    return {};
  }
}

/** Every court with its status: the re-check on this computer where there is one. */
export function wokandaCourtsView(file: string = wokandaOverridesPath()): WokandaCourtView[] {
  const overrides = readOverrides(file);
  return WOKANDA_REGISTER.sady.map((court) => {
    const local = overrides[court.nazwa];
    return local ? { ...local, nazwa: court.nazwa, zrodlo: "TEN_KOMPUTER" as const } : { ...court, sprawdzono: WOKANDA_REGISTER.sprawdzono, zrodlo: "WYDANIE" as const };
  });
}

/** The court's status for a check: this computer's re-check first. */
export function effectiveWokandaCourt(name: string, file: string = wokandaOverridesPath()): WokandaCourt | null {
  const shipped = wokandaCourt(name);
  if (!shipped) return null;
  const local = readOverrides(file)[shipped.nazwa];
  return local ? { nazwa: shipped.nazwa, domena: local.domena, status: local.status, ...(local.url ? { url: local.url } : {}), ...(local.powod ? { powod: local.powod } : {}) } : shipped;
}

/** Re-checks the named courts (all when none), a few at a time, and keeps the results. */
export async function recheckWokandaCourts(names: readonly string[] | null, fetchText: FetchText = defaultFetchText, file: string = wokandaOverridesPath(), concurrency = 6): Promise<WokandaCourtView[]> {
  const targets = WOKANDA_REGISTER.sady.filter((court) => !names || names.includes(court.nazwa));
  const checked: Array<WokandaCourt & { sprawdzono: string }> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (next < targets.length) {
        const court = targets[next++]!;
        checked.push({ ...(await recheckWokandaCourt(court, fetchText)), sprawdzono: new Date().toISOString() });
      }
    })
  );
  const overrides = readOverrides(file);
  for (const court of checked) overrides[court.nazwa] = court;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(overrides), "utf8");
  return wokandaCourtsView(file).filter((court) => checked.some((item) => item.nazwa === court.nazwa));
}
