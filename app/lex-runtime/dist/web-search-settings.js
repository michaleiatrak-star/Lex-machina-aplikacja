import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
// Untested order (a test sets its own): SearXNG (with an address), Startpage (on the user's session),
// DuckDuckGo; paid-beyond-a-limit engines last:
// Firecrawl (monthly credits), Gemini with Google Search (free quota, then billed on the user's key).
export const SEARCH_ENGINES = ["searxng", "startpage", "duckduckgo", "firecrawl", "gemini"];
// The Google (Gemini) API key from the provider credentials (Settings > models), set at start.
let geminiKeySource = null;
export function configureGeminiSearchKey(source) {
    geminiKeySource = source;
}
export async function geminiSearchKey() {
    try {
        return (await geminiKeySource?.())?.trim() || process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() || "";
    }
    catch {
        return "";
    }
}
let settingsFile = null;
let keyFile = null;
/** Directory of the search settings (the local SearXNG files go beside them). */
export function webSearchDataDirectory() {
    return settingsFile ? path.dirname(settingsFile) : null;
}
export function configureWebSearchSettings(dir) {
    settingsFile = dir ? path.join(dir, "web-search.json") : null;
    keyFile = dir ? path.join(dir, "web-search.key") : null;
}
// The API key is sealed with AES-256-GCM under a random key in a 0600 file next to the settings,
// as the server's secrets (server-mode/secret-box.ts): the settings file alone does not reveal it.
function rootKey(create) {
    if (!keyFile)
        return null;
    if (fs.existsSync(keyFile)) {
        const key = fs.readFileSync(keyFile);
        return key.byteLength === 32 ? key : null;
    }
    if (!create)
        return null;
    fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
    const key = randomBytes(32);
    fs.writeFileSync(keyFile, key, { flag: "wx", mode: 0o600 });
    return key;
}
const KEY_AAD = Buffer.from("lex-web-search:firecrawl", "utf8");
function seal(secret, aad = KEY_AAD) {
    const key = rootKey(true);
    if (!key)
        throw new Error("WEB_SEARCH_SETTINGS_NOT_CONFIGURED");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return { nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
function unseal(sealed, aad = KEY_AAD) {
    const key = rootKey(false);
    if (!sealed || !key)
        return "";
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.nonce, "base64"));
        decipher.setAAD(aad);
        decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
    }
    catch {
        return "";
    }
}
/** The Firecrawl key: env FIRECRAWL_API_KEY (server configuration) or the sealed one from Settings. */
export function firecrawlApiKey() {
    return process.env.FIRECRAWL_API_KEY?.trim() || unseal(stored().firecrawl);
}
export function firecrawlKeyForced() {
    return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}
export function normalizeSearxngUrl(raw) {
    if (typeof raw !== "string" || !raw.trim())
        return "";
    let parsed;
    try {
        parsed = new URL(raw.trim());
    }
    catch {
        throw new Error("WEB_SEARCH_SEARXNG_URL_INVALID");
    }
    if (!/^https?:$/u.test(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error("WEB_SEARCH_SEARXNG_URL_INVALID");
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/u, "");
}
function stored() {
    if (!settingsFile)
        return {};
    try {
        return JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    }
    catch {
        return {};
    }
}
export function webSearchSettings() {
    const file = stored();
    const envUrl = process.env.LEX_SEARXNG_URL?.trim();
    let searxngUrl = "";
    try {
        searxngUrl = normalizeSearxngUrl(envUrl || file.searxngUrl);
    }
    catch {
        searxngUrl = "";
    }
    const order = Array.isArray(file.order)
        ? file.order.filter((item) => SEARCH_ENGINES.includes(item))
        : [];
    return {
        searxngUrl,
        order: [...new Set(order)],
        // A test saved before an engine was removed: its rows of removed engines are not shown.
        lastTest: file.lastTest && Array.isArray(file.lastTest.scores)
            ? { ...file.lastTest, scores: file.lastTest.scores.filter((score) => SEARCH_ENGINES.includes(score.engine)) }
            : null,
        firecrawlConfigured: Boolean(firecrawlApiKey()),
        startpageSession: file.startpageSession === true,
        startpageSessionKeep: file.startpageSession === true && file.startpageSessionKeep === true,
        startpageSessionSaved: file.startpageSession === true && file.startpageSessionKeep === true && Boolean(file.startpageCookies),
        accountModelWebSearch: file.accountModelWebSearch === true
    };
}
export function searxngUrlForced() {
    return Boolean(process.env.LEX_SEARXNG_URL?.trim());
}
/** Merges into the stored file (the sealed key stays unless replaced). */
function write(next) {
    if (!settingsFile)
        throw new Error("WEB_SEARCH_SETTINGS_NOT_CONFIGURED");
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const merged = { ...stored(), ...next };
    if (!merged.firecrawl)
        delete merged.firecrawl;
    if (!merged.startpageCookies)
        delete merged.startpageCookies;
    // Fields of the removed engines (Brave key, Google session cookies) go at the next write.
    for (const legacy of ["brave", "googleSession", "googleSessionKeep", "googleCookies"])
        delete merged[legacy];
    const temporary = `${settingsFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(merged), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, settingsFile);
}
export function setSearxngUrl(raw) {
    if (searxngUrlForced())
        throw new Error("WEB_SEARCH_SEARXNG_URL_FORCED");
    const file = stored();
    const searxngUrl = normalizeSearxngUrl(raw);
    const current = webSearchSettings();
    // A new address invalidates the measured place of SearXNG until the next test.
    const order = searxngUrl === current.searxngUrl ? current.order : current.order.filter((item) => item !== "searxng");
    write({ searxngUrl, order, lastTest: file.lastTest ?? null });
    return webSearchSettings();
}
export const STARTPAGE_HOST = "www.startpage.com";
const STARTPAGE_AAD = Buffer.from("lex-web-search:startpage-session", "utf8");
export function setStartpageSession(enabled) {
    if (typeof enabled !== "boolean")
        throw new Error("WEB_SEARCH_STARTPAGE_SESSION_INVALID");
    // Turned off: the kept session goes too.
    write(enabled ? { startpageSession: true } : { startpageSession: false, startpageCookies: undefined });
    return webSearchSettings();
}
/** Keep (or stop keeping, which removes the saved cookies) the Startpage session across restarts. */
export function setAccountModelWebSearch(enabled) {
    if (typeof enabled !== "boolean")
        throw new Error("WEB_SEARCH_ACCOUNT_MODEL_INVALID");
    write({ accountModelWebSearch: enabled });
    return webSearchSettings();
}
export function setStartpageSessionKeep(enabled) {
    if (typeof enabled !== "boolean")
        throw new Error("WEB_SEARCH_STARTPAGE_SESSION_KEEP_INVALID");
    write(enabled ? { startpageSessionKeep: true } : { startpageSessionKeep: false, startpageCookies: undefined });
    return webSearchSettings();
}
/**
 * The law-source session store (eli/law-source-sessions.ts) for Startpage: the window's cookies and
 * User-Agent sealed (AES-256-GCM, own AAD) in web-search.json, only while the user keeps them.
 */
export const startpageSessionStore = {
    keeps: (host) => host === STARTPAGE_HOST && Boolean(settingsFile) && webSearchSettings().startpageSessionKeep,
    load(host) {
        if (host !== STARTPAGE_HOST)
            return null;
        const text = unseal(stored().startpageCookies, STARTPAGE_AAD);
        if (!text)
            return null;
        try {
            const value = JSON.parse(text);
            return typeof value.cookie === "string" && typeof value.userAgent === "string" && typeof value.at === "number"
                ? { cookie: value.cookie, userAgent: value.userAgent, at: value.at }
                : null;
        }
        catch {
            return null;
        }
    },
    save(host, session) {
        if (host !== STARTPAGE_HOST || !settingsFile)
            return;
        if (!session) {
            if (stored().startpageCookies)
                write({ startpageCookies: undefined });
            return;
        }
        if (webSearchSettings().startpageSessionKeep)
            write({ startpageCookies: seal(JSON.stringify(session), STARTPAGE_AAD) });
    }
};
const WOKANDA_AAD = Buffer.from("lex-wokanda:sessions", "utf8");
/**
 * Sessions of the courts' wokanda windows (courts/wokanda.ts), sealed (AES-256-GCM, own AAD) next to
 * the settings so a verification passed by the user survives a restart (report 2026-11-11). Values
 * are never returned or logged; a court that asks again simply opens its window again.
 */
export const wokandaSessionDiskStore = {
    load() {
        if (!settingsFile)
            return {};
        const text = unseal(stored().wokandaSessions, WOKANDA_AAD);
        if (!text)
            return {};
        try {
            const value = JSON.parse(text);
            const out = {};
            for (const [domain, item] of Object.entries(value)) {
                if (typeof item?.cookie === "string" && typeof item.userAgent === "string" && typeof item.at === "number") {
                    out[domain] = { cookie: item.cookie, userAgent: item.userAgent, at: item.at };
                }
            }
            return out;
        }
        catch {
            return {};
        }
    },
    save(all) {
        if (!settingsFile)
            return;
        try {
            write({ wokandaSessions: Object.keys(all).length ? seal(JSON.stringify(all), WOKANDA_AAD) : undefined });
        }
        catch {
            // Not kept on disk: the session still serves until the application closes.
        }
    }
};
/** Saves (or with "" removes) the Firecrawl API key; a new key drops Firecrawl's measured place. */
export function setFirecrawlApiKey(raw) {
    if (firecrawlKeyForced())
        throw new Error("WEB_SEARCH_FIRECRAWL_KEY_FORCED");
    const key = typeof raw === "string" ? raw.trim() : "";
    if (key && !/^fc-[A-Za-z0-9_-]{8,200}$/u.test(key))
        throw new Error("WEB_SEARCH_FIRECRAWL_KEY_INVALID");
    const current = webSearchSettings();
    write({ order: current.order.filter((item) => item !== "firecrawl"), firecrawl: key ? seal(key) : undefined });
    return webSearchSettings();
}
/** Saves the test result; the order is every engine that scored above zero, best first. */
export function saveWebSearchTest(result) {
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
export function effectiveSearchOrder(settings = webSearchSettings()) {
    const usable = (engine) => engine === "searxng"
        ? Boolean(settings.searxngUrl)
        : engine === "firecrawl"
            ? settings.firecrawlConfigured
            : engine === "startpage"
                ? settings.startpageSession
                : true;
    const tested = settings.order.filter(usable);
    const rest = SEARCH_ENGINES.filter((engine) => usable(engine) && !tested.includes(engine));
    return [...tested, ...rest];
}
