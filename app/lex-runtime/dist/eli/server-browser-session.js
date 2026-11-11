import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isChallengePage, lawSourceWithCheck, probeLawSourceSession } from "./law-source-sessions.js";
async function loadPlaywright(serversDirectory) {
    try {
        const require = createRequire(path.join(serversDirectory, "package.json"));
        return (await import(pathToFileURL(require.resolve("playwright")).href));
    }
    catch {
        return null;
    }
}
/**
 * The page opened in the server's headless browser until its check passes (up to waitMs); its cookies
 * and User-Agent then probed by `probe` (the source answers with them) before they are kept.
 */
export async function passCheckInServerBrowser(url, serversDirectory, probe, load = loadPlaywright, waitMs = 25_000, 
// Whether the page is still the check's own page (by default the law sources' check pages).
challenged = (html) => isChallengePage(200, html)) {
    const playwright = await load(serversDirectory);
    if (!playwright)
        return { ready: false, reason: "SERVER_BROWSER_MISSING" };
    let browser = null;
    try {
        browser = await playwright.chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        // The check's own page reloads into the source once it passes.
        for (let waited = 0; waited < waitMs; waited += 1_000) {
            if (!challenged(await page.content()))
                break;
            await page.waitForTimeout(1_000);
        }
        const cookie = (await context.cookies(url)).map((item) => `${item.name}=${item.value}`).join("; ");
        const userAgent = await page.evaluate(() => navigator.userAgent);
        const { ready } = await probe(cookie, userAgent);
        return ready ? { ready } : { ready, reason: "SERVER_REJECTED" };
    }
    catch {
        return { ready: false, reason: "SERVER_REJECTED" };
    }
    finally {
        await browser?.close().catch(() => undefined);
    }
}
export async function attemptServerBrowserSession(host, serversDirectory, load = loadPlaywright, waitMs = 25_000) {
    const source = lawSourceWithCheck(host);
    if (!source)
        return { ready: false, reason: "LAW_SOURCE_UNKNOWN" };
    return await passCheckInServerBrowser(source.url, serversDirectory, (cookie, userAgent) => probeLawSourceSession(source.host, cookie, userAgent), load, waitMs);
}
