import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isChallengePage, lawSourceWithCheck, probeLawSourceSession } from "./law-source-sessions.js";

/**
 * Server mode (a browser on another computer, no application window): the server tries to pass a
 * source's bot check itself, in a headless Chromium of Playwright installed with the MCP connectors
 * (as sn_captcha_auto does for sn.pl). Many checks (Cloudflare's "Just a moment…") pass in a real
 * browser engine without a person; a captcha does not, and then the user pastes the session from a
 * browser in the server's network. The session is probed at the source before it is kept.
 */
export type ServerBrowserAttempt = { ready: boolean; reason?: "SERVER_BROWSER_MISSING" | "SERVER_REJECTED" | "LAW_SOURCE_UNKNOWN" };

type PlaywrightModule = {
  chromium: {
    launch(options: { headless: boolean; args?: string[] }): Promise<{
      newContext(): Promise<{
        newPage(): Promise<{
          goto(url: string, options: { waitUntil: string; timeout: number }): Promise<unknown>;
          content(): Promise<string>;
          waitForTimeout(ms: number): Promise<void>;
          evaluate<T>(fn: () => T): Promise<T>;
        }>;
        cookies(url: string): Promise<Array<{ name: string; value: string }>>;
      }>;
      close(): Promise<void>;
    }>;
  };
};

async function loadPlaywright(serversDirectory: string): Promise<PlaywrightModule | null> {
  try {
    const require = createRequire(path.join(serversDirectory, "package.json"));
    return (await import(pathToFileURL(require.resolve("playwright")).href)) as PlaywrightModule;
  } catch {
    return null;
  }
}

/**
 * The page opened in the server's headless browser until its check passes (up to waitMs); its cookies
 * and User-Agent then probed by `probe` (the source answers with them) before they are kept.
 */
export async function passCheckInServerBrowser(
  url: string,
  serversDirectory: string,
  probe: (cookie: string, userAgent: string) => Promise<{ ready: boolean }>,
  load: (dir: string) => Promise<PlaywrightModule | null> = loadPlaywright,
  waitMs = 25_000,
  // Whether the page is still the check's own page (by default the law sources' check pages).
  challenged: (html: string) => boolean = (html) => isChallengePage(200, html)
): Promise<ServerBrowserAttempt> {
  const playwright = await load(serversDirectory);
  if (!playwright) return { ready: false, reason: "SERVER_BROWSER_MISSING" };
  let browser: Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>> | null = null;
  try {
    browser = await playwright.chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // The check's own page reloads into the source once it passes.
    for (let waited = 0; waited < waitMs; waited += 1_000) {
      if (!challenged(await page.content())) break;
      await page.waitForTimeout(1_000);
    }
    const cookie = (await context.cookies(url)).map((item) => `${item.name}=${item.value}`).join("; ");
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const { ready } = await probe(cookie, userAgent);
    return ready ? { ready } : { ready, reason: "SERVER_REJECTED" };
  } catch {
    return { ready: false, reason: "SERVER_REJECTED" };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function attemptServerBrowserSession(
  host: string,
  serversDirectory: string,
  load: (dir: string) => Promise<PlaywrightModule | null> = loadPlaywright,
  waitMs = 25_000
): Promise<ServerBrowserAttempt> {
  const source = lawSourceWithCheck(host);
  if (!source) return { ready: false, reason: "LAW_SOURCE_UNKNOWN" };
  return await passCheckInServerBrowser(
    source.url,
    serversDirectory,
    (cookie, userAgent) => probeLawSourceSession(source.host, cookie, userAgent),
    load,
    waitMs
  );
}
