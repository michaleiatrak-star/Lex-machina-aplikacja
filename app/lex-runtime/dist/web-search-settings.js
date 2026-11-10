import fs from "node:fs";
import path from "node:path";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
// Paid-beyond-a-limit engines last among the untested: Firecrawl (monthly credits), Gemini with
// Google Search (free quota, then billed per query on the user's Google key).
export const SEARCH_ENGINES = ["google", "searxng", "duckduckgo", "firecrawl", "gemini"];
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
function seal(secret) {
    const key = rootKey(true);
    if (!key)
        throw new Error("WEB_SEARCH_SETTINGS_NOT_CONFIGURED");
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(KEY_AAD);
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return { nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}
function unseal(sealed) {
    const key = rootKey(false);
    if (!sealed || !key)
        return "";
    try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.nonce, "base64"));
        decipher.setAAD(KEY_AAD);
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
        lastTest: file.lastTest && Array.isArray(file.lastTest.scores) ? file.lastTest : null,
        firecrawlConfigured: Boolean(firecrawlApiKey()),
        // On by default (user, 2026-11-10: attached and selected); off only when turned off in Settings.
        googleSession: file.googleSession !== false
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
export function setGoogleSession(enabled) {
    if (typeof enabled !== "boolean")
        throw new Error("WEB_SEARCH_GOOGLE_SESSION_INVALID");
    write({ googleSession: enabled });
    return webSearchSettings();
}
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
            : engine === "google"
                ? settings.googleSession
                : true;
    // Google on the user's session goes first once the user turned it on (their choice, not the test's).
    if (settings.googleSession) {
        const rest = effectiveSearchOrder({ ...settings, googleSession: false });
        return ["google", ...rest];
    }
    const tested = settings.order.filter(usable);
    const rest = SEARCH_ENGINES.filter((engine) => usable(engine) && !tested.includes(engine));
    return [...tested, ...rest];
}
