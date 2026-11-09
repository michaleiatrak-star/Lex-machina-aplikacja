export const LAW_SOURCES_WITH_CHECK = [
    { host: "www.nysenate.gov", code: "US-NY", url: "https://www.nysenate.gov/legislation/laws/CONSOLIDATED", label: "Senat stanu Nowy Jork (Consolidated Laws)" },
    { host: "nmonesource.com", code: "US-NM", url: "https://nmonesource.com/nmos/nmsa/en/nav_date.do", label: "NMOneSource (New Mexico Statutes Annotated)" }
];
export const LAW_SOURCE_VERIFICATION_REQUIRED = "LAW_SOURCE_VERIFICATION_REQUIRED";
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const sessions = new Map();
// The check's own page, not the source's (Cloudflare "Just a moment…", DataDome's captcha frame).
const CHALLENGE = /Just a moment\.\.\.|cf-chl-|challenge-platform|captcha-delivery\.com|geo\.captcha|datadome|Attention Required! \| Cloudflare/iu;
export function lawSourceWithCheck(host) {
    const name = host.toLowerCase();
    return LAW_SOURCES_WITH_CHECK.find((item) => item.host === name || item.host === `www.${name}` || `www.${item.host}` === name);
}
export function isChallengePage(status, text) {
    return [401, 403, 429, 503].includes(status) || CHALLENGE.test(text.slice(0, 20_000));
}
export function setLawSourceSession(host, cookie, userAgent) {
    const source = lawSourceWithCheck(host);
    if (!source)
        throw new Error("LAW_SOURCE_UNKNOWN");
    if (!cookie.trim() || cookie.length > 16_384 || /[\r\n]/u.test(cookie + userAgent) || userAgent.length > 512)
        throw new Error("LAW_SOURCE_SESSION_INVALID");
    sessions.set(source.host, { cookie: cookie.trim(), userAgent: userAgent.trim(), at: Date.now() });
}
/** Headers of the session the user opened for this source, or null (none, or expired). */
export function lawSourceSessionHeaders(host) {
    const source = lawSourceWithCheck(host);
    const session = source ? sessions.get(source.host) : undefined;
    if (!session || Date.now() - session.at > SESSION_TTL_MS)
        return null;
    return { cookie: session.cookie, ...(session.userAgent ? { "user-agent": session.userAgent } : {}) };
}
export function clearLawSourceSession(host) {
    const source = lawSourceWithCheck(host);
    if (source)
        sessions.delete(source.host);
}
const defaultFetchPage = async (url, headers) => {
    const reply = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    return { status: reply.status, text: await reply.text() };
};
/** The window's cookies tried on the source's page: kept when the source itself answers. */
export async function probeLawSourceSession(host, cookie, userAgent, fetchPage = defaultFetchPage) {
    const source = lawSourceWithCheck(host);
    if (!source)
        throw new Error("LAW_SOURCE_UNKNOWN");
    if (!cookie.trim())
        return { ready: false };
    try {
        const page = await fetchPage(source.url, { cookie, ...(userAgent ? { "user-agent": userAgent } : {}) });
        const ready = page.status === 200 && !isChallengePage(page.status, page.text);
        if (ready)
            setLawSourceSession(source.host, cookie, userAgent);
        return { ready };
    }
    catch {
        return { ready: false };
    }
}
