import fs from "node:fs";
import path from "node:path";
export const LAW_SOURCES_WITH_CHECK = [
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
const sessions = new Map();
let store = null;
export function configureLawSourceSessionStore(next) {
    store = next;
}
// The MCP connectors (R2A sources: courts' portals, CBOSA, TK, KIO, UODO, EUREKA...) are processes of
// their own: the sessions of the verification windows reach them through this file (0600, read by
// the connectors' shared layer, wspolne/sesja-przegladarki.mjs). Values are never logged.
let sessionsFile = null;
export function configureBrowserSessionsFile(file) {
    sessionsFile = file;
    writeSessionsFile();
}
function writeSessionsFile() {
    if (!sessionsFile)
        return;
    const hosts = {};
    for (const [host, session] of sessions) {
        if (Date.now() - session.at > (keeps(host) ? KEPT_SESSION_TTL_MS : SESSION_TTL_MS))
            continue;
        hosts[host] = { cookie: session.cookie, userAgent: session.userAgent, saved_at: new Date(session.at).toISOString() };
    }
    try {
        fs.mkdirSync(path.dirname(sessionsFile), { recursive: true });
        const temp = `${sessionsFile}.${process.pid}.tmp`;
        fs.writeFileSync(temp, JSON.stringify({ hosts }) + "\n", { encoding: "utf8", mode: 0o600 });
        fs.renameSync(temp, sessionsFile);
    }
    catch {
        // The connectors then ask for the check again; the runtime's own reads keep the session.
    }
}
function keeps(host) {
    try {
        return Boolean(store?.keeps(host));
    }
    catch {
        return false;
    }
}
// The check's own page, not the source's (Cloudflare "Just a moment…", DataDome's captcha frame).
// Google: its "unusual traffic" page (/sorry/, reCAPTCHA) and the consent page before the first search.
const CHALLENGE = /Just a moment\.\.\.|cf-chl-|challenge-platform|captcha-delivery\.com|geo\.captcha|datadome|Attention Required! \| Cloudflare|google\.com\/sorry\/|unusual traffic from your computer|nietypowy ruch|g-recaptcha|consent\.google\.com|Zanim przejdziesz do Google|Before you continue to Google/iu;
// Auxiliary pages (R2B/R3: articles, commentaries, authorities' and chambers' sites) behind a bot
// check, met while answering: the page the runtime itself tried to read, never one named by the
// browser. Kept for this run, at most PAGE_CHECKS_MAX hosts.
const pageChecks = new Map();
const PAGE_CHECKS_MAX = 50;
/** Registers an auxiliary page the runtime could not read past a bot check; its host as a source. */
export function registerPageCheck(rawUrl) {
    let url;
    try {
        url = new URL(rawUrl);
    }
    catch {
        return null;
    }
    if (url.protocol !== "https:" || !/^[a-z0-9.-]+$/u.test(url.hostname))
        return null;
    const host = url.hostname.toLowerCase();
    const fixed = LAW_SOURCES_WITH_CHECK.find((item) => item.host === host);
    if (fixed)
        return fixed;
    const source = { host, code: "PAGE", url: url.toString(), label: host };
    pageChecks.delete(host);
    pageChecks.set(host, source);
    while (pageChecks.size > PAGE_CHECKS_MAX)
        pageChecks.delete(pageChecks.keys().next().value);
    return source;
}
export function lawSourceWithCheck(host) {
    const name = host.toLowerCase();
    return (LAW_SOURCES_WITH_CHECK.find((item) => item.host === name || item.host === `www.${name}` || `www.${item.host}` === name) ??
        pageChecks.get(name));
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
    const session = { cookie: cookie.trim(), userAgent: userAgent.trim(), at: Date.now() };
    sessions.set(source.host, session);
    writeSessionsFile();
    if (keeps(source.host)) {
        try {
            store.save(source.host, session);
        }
        catch {
            // The session still serves this run from memory.
        }
    }
}
/** Headers of the session the user opened for this source, or null (none, or expired). */
export function lawSourceSessionHeaders(host) {
    const source = lawSourceWithCheck(host);
    if (!source)
        return null;
    const kept = keeps(source.host);
    let session = sessions.get(source.host);
    if (!session && kept) {
        try {
            session = store.load(source.host) ?? undefined;
        }
        catch {
            session = undefined;
        }
        if (session)
            sessions.set(source.host, session);
    }
    if (!session || Date.now() - session.at > (kept ? KEPT_SESSION_TTL_MS : SESSION_TTL_MS))
        return null;
    return { cookie: session.cookie, ...(session.userAgent ? { "user-agent": session.userAgent } : {}) };
}
/** Saves the live session of a source the user just chose to keep (no new window needed). */
export function keepLawSourceSession(host) {
    const source = lawSourceWithCheck(host);
    const session = source ? sessions.get(source.host) : undefined;
    if (!source || !session || Date.now() - session.at > SESSION_TTL_MS || !keeps(source.host))
        return;
    try {
        store.save(source.host, session);
    }
    catch {
        // Kept in memory for this run.
    }
}
export function clearLawSourceSession(host) {
    const source = lawSourceWithCheck(host);
    if (!source)
        return;
    sessions.delete(source.host);
    writeSessionsFile();
    try {
        store?.save(source.host, null);
    }
    catch {
        // Nothing kept to remove.
    }
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
