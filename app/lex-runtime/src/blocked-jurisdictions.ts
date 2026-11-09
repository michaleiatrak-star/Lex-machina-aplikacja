/**
 * Jurisdictions outside the system (user, 2026-11-09): no reader, no country, no fetch, no search hit.
 * Applied at every outbound channel: national-law readers, auxiliary-source fetcher (each redirect hop)
 * and web-search results.
 */
export const BLOCKED_COUNTRIES = ["RU"] as const;

// Country-code TLDs of the Russian Federation: .ru, .su, .рф (punycode xn--p1ai).
const BLOCKED_HOST = /(?:^|\.)(?:ru|su|xn--p1ai|рф)\.?$/iu;

export function isBlockedCountry(code: string | undefined): boolean {
  return !!code && (BLOCKED_COUNTRIES as readonly string[]).includes(code.trim().toUpperCase());
}

export function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOST.test(hostname.trim().toLowerCase());
}

export function isBlockedUrl(raw: string | URL): boolean {
  try {
    return isBlockedHost(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export const BLOCKED_JURISDICTION_CODE = "JURISDICTION_BLOCKED";
