import { afterEach, describe, expect, it } from "vitest";
import { clearLawSourceSession, isChallengePage, LAW_SOURCES_WITH_CHECK, lawSourceSessionHeaders, lawSourceWithCheck, probeLawSourceSession } from "../src/eli/law-source-sessions.js";
import { readNationalLaw } from "../src/eli/national-law.js";

const CLOUDFLARE = "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id=\"challenge-platform\"></div></body></html>";
const LAW_PAGE = "<html><body><h1>SECTION 125.27</h1><p>125.27 Murder in the first degree. A person is guilty of murder in the first degree when, with intent to cause the death of another person, he causes the death of such person.</p></body></html>";

afterEach(() => LAW_SOURCES_WITH_CHECK.forEach((item) => clearLawSourceSession(item.host)));

describe("law sources behind a bot check (as sn.pl): the user passes it in the source's window", () => {
  it("closed list of hosts; the check's own page is recognised", () => {
    expect(lawSourceWithCheck("www.nysenate.gov")?.code).toBe("US-NY");
    expect(lawSourceWithCheck("nysenate.gov")?.host).toBe("www.nysenate.gov");
    expect(lawSourceWithCheck("nmonesource.com")?.code).toBe("US-NM");
    expect(lawSourceWithCheck("example.com")).toBeUndefined();
    expect(isChallengePage(403, CLOUDFLARE)).toBe(true);
    expect(isChallengePage(200, CLOUDFLARE)).toBe(true);
    expect(isChallengePage(200, LAW_PAGE)).toBe(false);
  });

  it("probe: the window's cookies are kept only when the source itself answers", async () => {
    expect(await probeLawSourceSession("www.nysenate.gov", "cf_clearance=x", "UA", async () => ({ status: 403, text: CLOUDFLARE }))).toEqual({ ready: false });
    expect(lawSourceSessionHeaders("www.nysenate.gov")).toBeNull();
    expect(await probeLawSourceSession("www.nysenate.gov", "cf_clearance=x", "Mozilla/5.0 test", async () => ({ status: 200, text: LAW_PAGE }))).toEqual({ ready: true });
    expect(lawSourceSessionHeaders("nysenate.gov")).toEqual({ cookie: "cf_clearance=x", "user-agent": "Mozilla/5.0 test" });
    await expect(probeLawSourceSession("example.com", "a=b", "UA")).rejects.toThrow("LAW_SOURCE_UNKNOWN");
  });

  it("reader: a challenge asks for the verification; with the session the section is read", async () => {
    const page = (status: number, html: string) => async (_url: string, init: { headers: Record<string, string> }) => {
      const body = new TextEncoder().encode(init.headers.cookie ? LAW_PAGE : html);
      return { ok: init.headers.cookie ? true : status === 200, status: init.headers.cookie ? 200 : status, headers: { get: () => "text/html; charset=utf-8" }, arrayBuffer: async () => body.buffer };
    };
    await expect(readNationalLaw({ url: "https://www.nysenate.gov/legislation/laws/PEN/125.27", unit: "125.27", country: "US" }, page(403, CLOUDFLARE) as never)).rejects.toThrow("LAW_SOURCE_VERIFICATION_REQUIRED:www.nysenate.gov");
    await probeLawSourceSession("www.nysenate.gov", "cf_clearance=x", "Mozilla/5.0 test", async () => ({ status: 200, text: LAW_PAGE }));
    const answer = await readNationalLaw({ url: "https://www.nysenate.gov/legislation/laws/PEN/125.27", unit: "125.27", country: "US" }, page(403, CLOUDFLARE) as never);
    expect(answer.articles[0]!.text).toMatch(/^125\.27 Murder in the first degree\./u);
  });
});
