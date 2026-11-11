import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearLawSourceSession, configureBrowserSessionsFile, registerPageCheck } from "../src/eli/law-source-sessions.js";
import { passCheckInServerBrowser } from "../src/eli/server-browser-session.js";

function fakePlaywright(pages: string[], cookies = [{ name: "cf_clearance", value: "abc" }]) {
  let calls = 0;
  return async () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => undefined,
            content: async () => pages[Math.min(calls++, pages.length - 1)]!,
            waitForTimeout: async () => undefined,
            evaluate: async <T,>() => "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130" as T
          }),
          cookies: async () => cookies
        }),
        close: async () => undefined
      })
    }
  });
}

describe("server mode: a source's bot check in the server's own browser", () => {
  const dirs: string[] = [];
  afterEach(() => {
    configureBrowserSessionsFile(null);
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("waits until the check's page turns into the source, then probes its cookies", async () => {
    const probed: Array<[string, string]> = [];
    const result = await passCheckInServerBrowser(
      "https://orzeczenia.example.pl/",
      "/nowhere",
      async (cookie, userAgent) => {
        probed.push([cookie, userAgent]);
        return { ready: true };
      },
      fakePlaywright(["<title>Just a moment...</title>", "<html>Portal orzeczeń</html>"]),
      5_000
    );
    expect(result).toEqual({ ready: true });
    expect(probed).toEqual([["cf_clearance=abc", "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/130"]]);
  });

  it("says when the server has no browser and when the source still refuses", async () => {
    expect(await passCheckInServerBrowser("https://x.example.pl/", "/nowhere", async () => ({ ready: true }), async () => null)).toEqual({
      ready: false,
      reason: "SERVER_BROWSER_MISSING"
    });
    expect(
      await passCheckInServerBrowser("https://x.example.pl/", "/nowhere", async () => ({ ready: false }), fakePlaywright(["<title>Just a moment...</title>"]), 2_000)
    ).toEqual({ ready: false, reason: "SERVER_REJECTED" });
  });

  it("hands the window's session to the MCP connectors through a private file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-browser-sessions-"));
    dirs.push(dir);
    const file = path.join(dir, "browser-sessions.json");
    configureBrowserSessionsFile(file);
    const source = registerPageCheck("https://orzeczenia.ms.gov.pl/search")!;
    const { setLawSourceSession } = await import("../src/eli/law-source-sessions.js");
    setLawSourceSession(source.host, "cf_clearance=abc", "Mozilla/5.0 (Windows NT 10.0) Chrome/130");
    const written = JSON.parse(fs.readFileSync(file, "utf8")) as { hosts: Record<string, { cookie: string; userAgent: string }> };
    expect(written.hosts["orzeczenia.ms.gov.pl"]).toMatchObject({ cookie: "cf_clearance=abc", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130" });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    clearLawSourceSession(source.host);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).hosts["orzeczenia.ms.gov.pl"]).toBeUndefined();
  });
});
