/**
 * Official law sources behind a bot check (Cloudflare, DataDome), handled as sn.pl and the courts'
 * wokanda: the application never passes the check itself. The user passes it in the application's
 * window of that source; the window's cookies and the browser's User-Agent then serve this user's
 * reads of that source. Kept in memory only, for a limited time; never returned or logged.
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
  { host: "nmonesource.com", code: "US-NM", url: "https://nmonesource.com/nmos/nmsa/en/nav_date.do", label: "NMOneSource (New Mexico Statutes Annotated)" }
];

export const LAW_SOURCE_VERIFICATION_REQUIRED = "LAW_SOURCE_VERIFICATION_REQUIRED";

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const sessions = new Map<string, { cookie: string; userAgent: string; at: number }>();

// The check's own page, not the source's (Cloudflare "Just a moment…", DataDome's captcha frame).
const CHALLENGE = /Just a moment\.\.\.|cf-chl-|challenge-platform|captcha-delivery\.com|geo\.captcha|datadome|Attention Required! \| Cloudflare/iu;

export function lawSourceWithCheck(host: string): VerifiedLawSource | undefined {
  const name = host.toLowerCase();
  return LAW_SOURCES_WITH_CHECK.find((item) => item.host === name || item.host === `www.${name}` || `www.${item.host}` === name);
}

export function isChallengePage(status: number, text: string): boolean {
  return [401, 403, 429, 503].includes(status) || CHALLENGE.test(text.slice(0, 20_000));
}

export function setLawSourceSession(host: string, cookie: string, userAgent: string): void {
  const source = lawSourceWithCheck(host);
  if (!source) throw new Error("LAW_SOURCE_UNKNOWN");
  if (!cookie.trim() || cookie.length > 16_384 || /[\r\n]/u.test(cookie + userAgent) || userAgent.length > 512) throw new Error("LAW_SOURCE_SESSION_INVALID");
  sessions.set(source.host, { cookie: cookie.trim(), userAgent: userAgent.trim(), at: Date.now() });
}

/** Headers of the session the user opened for this source, or null (none, or expired). */
export function lawSourceSessionHeaders(host: string): Record<string, string> | null {
  const source = lawSourceWithCheck(host);
  const session = source ? sessions.get(source.host) : undefined;
  if (!session || Date.now() - session.at > SESSION_TTL_MS) return null;
  return { cookie: session.cookie, ...(session.userAgent ? { "user-agent": session.userAgent } : {}) };
}

export function clearLawSourceSession(host: string): void {
  const source = lawSourceWithCheck(host);
  if (source) sessions.delete(source.host);
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
