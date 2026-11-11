/**
 * Official law sources behind a bot check (Cloudflare, DataDome), handled as sn.pl and the courts'
 * wokanda: the application never passes the check itself. The user passes it in the application's
 * window of that source; the window's cookies and the browser's User-Agent then serve this user's
 * reads of that source. Kept in memory for a limited time, never returned or logged; a source whose
 * session the user chose to keep (Google, Ustawienia > Wyszukiwarka internetowa) is also sealed on disk
 * by the store set with configureLawSourceSessionStore and survives a restart.
 *
 * Only the hosts below: an official source whose text the app reads once the check is passed.
 */
export type VerifiedLawSource = {
  host: string;
  // The jurisdiction (us-states.ts code or a country).
  code: string;
  // The page opened in the verification window and probed with its cookies.
  url: string;
  label: string;
};

export const LAW_SOURCES_WITH_CHECK: readonly VerifiedLawSource[] = [
  { host: "www.nysenate.gov", code: "US-NY", url: "https://www.nysenate.gov/legislation/laws/CONSOLIDATED", label: "Senat stanu Nowy Jork (Consolidated Laws)" },
  { host: "nmonesource.com", code: "US-NM", url: "https://nmonesource.com/nmos/nmsa/en/nav_date.do", label: "NMOneSource (New Mexico Statutes Annotated)" },
  { host: "leginfo.legislature.ca.gov", code: "US-CA", url: "https://leginfo.legislature.ca.gov/faces/codes.xhtml", label: "California Legislative Information (kodeksy Kalifornii)" },
  { host: "www.oscn.net", code: "US-OK", url: "https://www.oscn.net/applications/oscn/index.asp?ftdb=STOKST", label: "OSCN (Oklahoma Statutes)" },
  { host: "www.capitol.hawaii.gov", code: "US-HI", url: "https://www.capitol.hawaii.gov/docs/HRS.htm", label: "Hawaii State Legislature (Hawaii Revised Statutes)" },
  // Not a law source: Google search on the user's own session (Ustawienia > Wyszukiwarka
  // internetowa, off by default). The user passes Google's consent page and captcha; results
  // are leads only, verified at the official source.
  { host: "www.google.com", code: "SEARCH", url: "https://www.google.com/search?q=kodeks+karny&hl=pl", label: "Google (wyszukiwanie na Twojej sesji)" }
];

export const LAW_SOURCE_VERIFICATION_REQUIRED = "LAW_SOURCE_VERIFICATION_REQUIRED";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
// A kept session: until the source asks again (captcha) or 30 days pass.
const KEPT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type LawSourceSession = { cookie: string; userAgent: string; at: number };
const sessions = new Map<string, LawSourceSession>();

/** Disk store of the sessions the user chose to keep (sealed; web-search-settings.ts). */
export type LawSourceSessionStore = {
  keeps(host: string): boolean;
  load(host: string): LawSourceSession | null;
  save(host: string, session: LawSourceSession | null): void;
};
let store: LawSourceSessionStore | null = null;

export function configureLawSourceSessionStore(next: LawSourceSessionStore | null): void {
  store = next;
}

function keeps(host: string): boolean {
  try {
    return Boolean(store?.keeps(host));
  } catch {
    return false;
  }
}

// The check's own page, not the source's (Cloudflare "Just a moment…", DataDome's captcha frame).
// Google: its "unusual traffic" page (/sorry/, reCAPTCHA) and the consent page before the first search.
const CHALLENGE = /Just a moment\.\.\.|cf-chl-|challenge-platform|captcha-delivery\.com|geo\.captcha|datadome|Attention Required! \| Cloudflare|google\.com\/sorry\/|unusual traffic from your computer|nietypowy ruch|g-recaptcha|consent\.google\.com|Zanim przejdziesz do Google|Before you continue to Google/iu;

// Auxiliary pages (R2B/R3: articles, commentaries, authorities' and chambers' sites) behind a bot
// check, met while answering: the page the runtime itself tried to read, never one named by the
// browser. Kept for this run, at most PAGE_CHECKS_MAX hosts.
const pageChecks = new Map<string, VerifiedLawSource>();
const PAGE_CHECKS_MAX = 50;

/** Registers an auxiliary page the runtime could not read past a bot check; its host as a source. */
export function registerPageCheck(rawUrl: string): VerifiedLawSource | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !/^[a-z0-9.-]+$/u.test(url.hostname)) return null;
  const host = url.hostname.toLowerCase();
  const fixed = LAW_SOURCES_WITH_CHECK.find((item) => item.host === host);
  if (fixed) return fixed;
  const source: VerifiedLawSource = { host, code: "PAGE", url: url.toString(), label: host };
  pageChecks.delete(host);
  pageChecks.set(host, source);
  while (pageChecks.size > PAGE_CHECKS_MAX) pageChecks.delete(pageChecks.keys().next().value!);
  return source;
}

export function lawSourceWithCheck(host: string): VerifiedLawSource | undefined {
  const name = host.toLowerCase();
  return (
    LAW_SOURCES_WITH_CHECK.find((item) => item.host === name || item.host === `www.${name}` || `www.${item.host}` === name) ??
    pageChecks.get(name)
  );
}

export function isChallengePage(status: number, text: string): boolean {
  return [401, 403, 429, 503].includes(status) || CHALLENGE.test(text.slice(0, 20_000));
}

export function setLawSourceSession(host: string, cookie: string, userAgent: string): void {
  const source = lawSourceWithCheck(host);
  if (!source) throw new Error("LAW_SOURCE_UNKNOWN");
  if (!cookie.trim() || cookie.length > 16_384 || /[\r\n]/u.test(cookie + userAgent) || userAgent.length > 512) throw new Error("LAW_SOURCE_SESSION_INVALID");
  const session = { cookie: cookie.trim(), userAgent: userAgent.trim(), at: Date.now() };
  sessions.set(source.host, session);
  if (keeps(source.host)) {
    try {
      store!.save(source.host, session);
    } catch {
      // The session still serves this run from memory.
    }
  }
}

/** Headers of the session the user opened for this source, or null (none, or expired). */
export function lawSourceSessionHeaders(host: string): Record<string, string> | null {
  const source = lawSourceWithCheck(host);
  if (!source) return null;
  const kept = keeps(source.host);
  let session = sessions.get(source.host);
  if (!session && kept) {
    try {
      session = store!.load(source.host) ?? undefined;
    } catch {
      session = undefined;
    }
    if (session) sessions.set(source.host, session);
  }
  if (!session || Date.now() - session.at > (kept ? KEPT_SESSION_TTL_MS : SESSION_TTL_MS)) return null;
  return { cookie: session.cookie, ...(session.userAgent ? { "user-agent": session.userAgent } : {}) };
}

/** Saves the live session of a source the user just chose to keep (no new window needed). */
export function keepLawSourceSession(host: string): void {
  const source = lawSourceWithCheck(host);
  const session = source ? sessions.get(source.host) : undefined;
  if (!source || !session || Date.now() - session.at > SESSION_TTL_MS || !keeps(source.host)) return;
  try {
    store!.save(source.host, session);
  } catch {
    // Kept in memory for this run.
  }
}

export function clearLawSourceSession(host: string): void {
  const source = lawSourceWithCheck(host);
  if (!source) return;
  sessions.delete(source.host);
  try {
    store?.save(source.host, null);
  } catch {
    // Nothing kept to remove.
  }
}

export type FetchPage = (url: string, headers: Record<string, string>) => Promise<{ status: number; text: string }>;

const defaultFetchPage: FetchPage = async (url, headers) => {
  const reply = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  return { status: reply.status, text: await reply.text() };
};

/** The window's cookies tried on the source's page: kept when the source itself answers. */
export async function probeLawSourceSession(host: string, cookie: string, userAgent: string, fetchPage: FetchPage = defaultFetchPage): Promise<{ ready: boolean }> {
  const source = lawSourceWithCheck(host);
  if (!source) throw new Error("LAW_SOURCE_UNKNOWN");
  if (!cookie.trim()) return { ready: false };
  try {
    const page = await fetchPage(source.url, { cookie, ...(userAgent ? { "user-agent": userAgent } : {}) });
    const ready = page.status === 200 && !isChallengePage(page.status, page.text);
    if (ready) setLawSourceSession(source.host, cookie, userAgent);
    return { ready };
  } catch {
    return { ready: false };
  }
}
