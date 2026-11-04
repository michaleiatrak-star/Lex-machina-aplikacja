import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWokanda, clearWokandaSessions, parseCommonSignature, probeWokandaSession, parsePortalDetails, parsePortalResults, portalSearchUrl, recheckWokandaCourt, wokandaCourt, wokandaRegister, type FetchText } from "../src/courts/wokanda.js";
import { COURT_BASE } from "../src/courts/court-base-data.js";

// Pages of the Ministry's court portal (Sąd Okręgowy w Krakowie, 2026-11-04), judges' names
// replaced: the search for XI C 1768/26 and that hearing's details.
const FIXTURES = path.resolve(__dirname, "fixtures/wokanda");
const SEARCH = fs.readFileSync(path.join(FIXTURES, "portal-search.html"), "utf8");
const DETAILS = fs.readFileSync(path.join(FIXTURES, "portal-details.html"), "utf8");

describe("wokanda: register of the common courts", () => {
  it("covers every court of the court base, each with one status", () => {
    const names = [...COURT_BASE.sa, ...COURT_BASE.so, ...COURT_BASE.sr].map((court) => court.nazwa);
    const register = wokandaRegister();
    expect(register.sady.map((court) => court.nazwa).sort()).toEqual([...names].sort());
    for (const court of register.sady) expect(["PORTAL", "BROWSER", "NONE", "UNREACHABLE"]).toContain(court.status);
    expect(register.sady.filter((court) => court.status === "PORTAL").length).toBeGreaterThan(50);
    expect(wokandaCourt("Sąd Okręgowy w Krakowie")?.status).toBe("PORTAL");
  });
});

describe("wokanda: the court portal", () => {
  it("reads a common-court signature into the portal's search fields", () => {
    expect(parseCommonSignature("XI C 1768/26")).toEqual({ wydzial: "XI", repertorium: "C", numer: "1768", rok: "2026" });
    expect(parseCommonSignature("sygn. akt II 1Ca 45/2025")).toEqual({ wydzial: "II", repertorium: "1Ca", numer: "45", rok: "2025" });
    expect(parseCommonSignature("III CZP 12/24 extra")).toBeNull();
    expect(portalSearchUrl("https://krakow.so.gov.pl/wokanda", parseCommonSignature("XI C 1768/26")!)).toBe(
      "https://krakow.so.gov.pl/index.php?p=cases&action=search&nr_wydzial=XI&reper=C&nrspr=1768&rok_rozpr=2026&wydzial=0&data=&godz=&sala="
    );
  });

  it("reads the hearings found and a hearing's details", () => {
    const hearings = parsePortalResults(SEARCH, "https://krakow.so.gov.pl/index.php?p=cases");
    expect(hearings).toEqual([
      { sygnatura: "XI C 1768/26", wydzial: "XI Wydział Cywilny Rodzinny SO", status: "", data: "2026-11-05", sala: "A-17", godzina: "08:00", url: "https://krakow.so.gov.pl/wokanda,410" }
    ]);
    expect(parsePortalDetails(DETAILS)).toEqual({ miejsce: "ul. Przy Rondzie 7", przewodniczacy: "SSO Anna Testowa", sklad: "Ewa Przykładowa, Jan Wzorcowy", godzina: "08:00" });
  });

  it("checks one case: the search, then each hearing's details; nothing else is fetched", async () => {
    const asked: string[] = [];
    const fetchText: FetchText = async (url) => {
      asked.push(url);
      return { status: 200, url, text: url.includes("index.php") ? SEARCH : DETAILS };
    };
    const result = await checkWokanda("Sąd Okręgowy w Krakowie", "XI C 1768/26", fetchText, () => new Date("2026-11-04T12:00:00Z"));
    expect(result.state).toBe("FOUND");
    expect(result.state === "FOUND" && result.hearings[0]).toMatchObject({ data: "2026-11-05", godzina: "08:00", sala: "A-17", przewodniczacy: "SSO Anna Testowa" });
    expect(asked).toEqual([expect.stringContaining("nrspr=1768"), "https://krakow.so.gov.pl/wokanda,410"]);
  });

  it("another signature on the page is not this case's hearing", async () => {
    const result = await checkWokanda("Sąd Okręgowy w Krakowie", "XI C 1769/26", async (url) => ({ status: 200, url, text: SEARCH }));
    expect(result.state).toBe("NOT_FOUND");
  });

  it("a browser verification or a court without the portal: the address, no attempt to get past it", async () => {
    const guarded = await checkWokanda("Sąd Okręgowy w Krakowie", "XI C 1768/26", async (url) => ({ status: 403, url, text: "<title>Trwa weryfikacja przeglądarki...</title>" }));
    expect(guarded).toMatchObject({ state: "BROWSER_ONLY" });
    const browser = wokandaRegister().sady.find((court) => court.status === "BROWSER")!;
    let fetched = false;
    const result = await checkWokanda(browser.nazwa, "I C 1/26", async (url) => {
      fetched = true;
      return { status: 200, url, text: "" };
    });
    expect(result).toMatchObject({ state: "BROWSER_ONLY", url: browser.url });
    expect(fetched).toBe(false);
    const failed = await checkWokanda("Sąd Okręgowy w Krakowie", "XI C 1768/26", async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    expect(failed).toMatchObject({ state: "UNREACHABLE" });
  });

  it("re-check of a court from this computer: portal, verification, unreachable", async () => {
    const court = { nazwa: "Sąd Okręgowy w Krakowie", domena: "krakow.so.gov.pl", status: "UNREACHABLE" as const };
    const portal = '<form class="cases-form"><input name="p" type="hidden" value="cases" /><input name="nrspr"/></form>';
    expect((await recheckWokandaCourt(court, async (url) => ({ status: 200, url, text: portal }))).status).toBe("PORTAL");
    expect((await recheckWokandaCourt(court, async (url) => ({ status: 403, url, text: "Trwa weryfikacja przeglądarki" }))).status).toBe("BROWSER");
    expect((await recheckWokandaCourt(court, async () => { throw new Error("x"); })).status).toBe("UNREACHABLE");
  });
});

describe("wokanda: browser verification passed by the user (as sn.pl)", () => {
  it("asks for the court's window, keeps the window's session once the portal answers, then checks with it", async () => {
    clearWokandaSessions();
    const guarded = wokandaRegister().sady.find((court) => court.status === "BROWSER" && court.powod === "weryfikacja przeglądarki")!;
    const first = await checkWokanda(guarded.nazwa, "XI C 1768/26", async () => {
      throw new Error("no request without a session");
    });
    expect(first).toMatchObject({ state: "BROWSER_ONLY", verification: { domain: guarded.domena, savedSession: false } });

    const portal = '<form class="cases-form"><input name="p" type="hidden" value="cases" /><input name="nrspr"/></form>';
    const seen: Array<Record<string, string> | undefined> = [];
    const site: FetchText = async (url, headers) => {
      seen.push(headers);
      if (headers?.cookie !== "verified=1") return { status: 403, url, text: "Trwa weryfikacja przeglądarki" };
      return { status: 200, url, text: url.endsWith("/wokanda") ? portal : url.includes("index.php") ? SEARCH.replaceAll("https://krakow.so.gov.pl", `https://${guarded.domena}`) : DETAILS };
    };
    expect(await probeWokandaSession(guarded.domena, "pending=1", "Mozilla/5.0 WebView", site)).toEqual({ ready: false });
    expect(await probeWokandaSession(`www.${guarded.domena}`, "verified=1", "Mozilla/5.0 WebView", site)).toEqual({ ready: true });
    await expect(probeWokandaSession("example.com", "verified=1", "x", site)).rejects.toThrow("WOKANDA_COURT_UNKNOWN");

    const checked = await checkWokanda(guarded.nazwa, "XI C 1768/26", site);
    expect(checked.state).toBe("FOUND");
    // The window's cookies and its browser's User-Agent go with every request of that court.
    expect(seen.slice(-2).every((headers) => headers?.cookie === "verified=1" && headers["user-agent"] === "Mozilla/5.0 WebView")).toBe(true);

    // The session refused later: verification again, marked as an expired session.
    const expired = await checkWokanda(guarded.nazwa, "XI C 1768/26", async (url) => ({ status: 403, url, text: "Trwa weryfikacja przeglądarki" }));
    expect(expired).toMatchObject({ state: "BROWSER_ONLY", verification: { savedSession: true } });
    clearWokandaSessions();
  });

  it("a court with another system gets only its address, no verification window", async () => {
    const other = wokandaRegister().sady.find((court) => court.status === "BROWSER" && court.powod !== "weryfikacja przeglądarki")!;
    const result = await checkWokanda(other.nazwa, "I C 1/26");
    expect(result).toMatchObject({ state: "BROWSER_ONLY", url: other.url });
    expect("verification" in result).toBe(false);
  });
});
