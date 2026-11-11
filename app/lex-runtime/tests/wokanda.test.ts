import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWokanda, clearWokandaSessions, configureWokandaSessionStore, recheckWokandaCourts, wokandaCourtsView, wokandaSessionDomains, parseCommonSignature, probeWokandaSession, sameSignature, parsePortalDetails, parsePortalResults, portalSearchUrl, recheckWokandaCourt, wokandaCourt, wokandaRegister, type FetchText } from "../src/courts/wokanda.js";
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

  it("names why a court did not answer instead of TypeError; a firewall's 403/429 goes to the court's window", async () => {
    const court = { nazwa: "Sąd Okręgowy w Białymstoku", domena: "bialystok.so.gov.pl", status: "UNREACHABLE" as const };
    const failing = (code: string) => async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code } });
    };
    expect(await recheckWokandaCourt(court, failing("UNABLE_TO_VERIFY_LEAF_SIGNATURE"))).toMatchObject({ status: "UNREACHABLE", powod: "niekompletny certyfikat strony sądu" });
    expect(await recheckWokandaCourt(court, failing("ENOTFOUND"))).toMatchObject({ powod: "adres strony sądu nie istnieje (DNS)" });
    expect(await recheckWokandaCourt(court, failing("ECONNRESET"))).toMatchObject({ powod: "strona sądu zerwała połączenie" });
    const blocked = await recheckWokandaCourt(court, async (url) => ({ status: 403, url, text: "Forbidden" }));
    expect(blocked).toMatchObject({ status: "BROWSER", powod: "strona blokuje zapytania aplikacji (HTTP 403)" });
    expect((await recheckWokandaCourt(court, async (url) => ({ status: 429, url, text: "" }))).status).toBe("BROWSER");
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

  it("keeps the window's session across a restart and the register's re-check uses it (2026-11-11)", async () => {
    clearWokandaSessions();
    const guarded = wokandaRegister().sady.find((court) => court.status === "BROWSER" && court.powod === "weryfikacja przeglądarki")!;
    let disk: Record<string, { cookie: string; userAgent: string; at: number }> = {};
    configureWokandaSessionStore({ load: () => disk, save: (all) => (disk = all) });
    const portal = '<form class="cases-form"><input name="p" type="hidden" value="cases" /><input name="nrspr"/></form>';
    const site: FetchText = async (url, headers) =>
      headers?.cookie === "verified=1" ? { status: 200, url, text: portal } : { status: 403, url, text: "Trwa weryfikacja przeglądarki" };
    expect(await probeWokandaSession(guarded.domena, "verified=1", "Mozilla/5.0 WebView", site)).toEqual({ ready: true });
    expect(Object.keys(disk)).toEqual([guarded.domena]);

    // Restart: memory empty, the sealed store brings the session back.
    const saved = disk;
    clearWokandaSessions();
    disk = saved;
    configureWokandaSessionStore({ load: () => disk, save: (all) => (disk = all) });
    expect(wokandaSessionDomains()).toContain(guarded.domena);

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-wokanda-")), "wokanda.json");
    const [court] = await recheckWokandaCourts([guarded.nazwa], site, file);
    expect(court).toMatchObject({ status: "PORTAL", powod: "przez sesję z okna sądu", zrodlo: "TEN_KOMPUTER" });
    configureWokandaSessionStore(null);
    clearWokandaSessions();
  });

  it("a re-check older than the shipped register gives way to the register's corrected address", () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-wokanda-")), "wokanda.json");
    const zagan = wokandaRegister().sady.find((court) => court.domena === "zagan.sr.gov.pl")!;
    fs.writeFileSync(file, JSON.stringify({ [zagan.nazwa]: { ...zagan, url: "https://zagan.sr.gov.pl/", sprawdzono: "2026-11-11T14:58:49Z" } }));
    expect(wokandaCourtsView(file).find((court) => court.nazwa === zagan.nazwa)).toMatchObject({ url: "https://zagan.sr.gov.pl/?mod=74", zrodlo: "WYDANIE" });
  });

  it("a court with another system gets only its address, no verification window", async () => {
    const other = wokandaRegister().sady.find((court) => court.status === "BROWSER" && court.powod !== "weryfikacja przeglądarki")!;
    const result = await checkWokanda(other.nazwa, "I C 1/26");
    expect(result).toMatchObject({ state: "BROWSER_ONLY", url: other.url });
    expect("verification" in result).toBe(false);
  });
});

describe("wokanda: other systems (probed and read live 2026-11-04: 30 of 35 courts)", () => {
  const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
  const court = (system: string, url: string, extra: Record<string, string> = {}) => ({ nazwa: "Sąd Rejonowy w Testowie", domena: "testowo.sr.gov.pl", status: "PORTAL" as const, system: system as never, url, ...extra });

  it("the same case whether a wokanda names the department and a 2- or 4-digit year or not", () => {
    expect(sameSignature("II K 151/26", "K 151/2026")).toBe(true);
    expect(sameSignature("V RC 631/26", "V RC 631/2026")).toBe(true);
    expect(sameSignature("II K 151/26", "III K 151/26")).toBe(false);
    expect(sameSignature("II K 151/26", "II Kp 151/26")).toBe(false);
    expect(sameSignature("I C 9/26", "I C 09/26")).toBe(true);
  });

  it("CMS form: reads its own fields, posts the signature, reads the results table", async () => {
    const asked: Array<{ url: string; body?: string }> = [];
    const site: FetchText = async (url, _headers, init) => {
      asked.push({ url, ...(init ? { body: init.body } : {}) });
      return { status: 200, url, text: fixture("cms-form.html") };
    };
    const result = await checkWokanda("x", "I C 595/25", site, () => new Date(), () => court("CMS_FORM", "https://testowo.sr.gov.pl/srp/e-wokanda/70,e-Wokanda.html", { pole: "pole573" }));
    expect(result).toMatchObject({ state: "FOUND", hearings: [{ data: "2026-11-02", godzina: "09:15", sala: "VII Partyzantów 6A", przewodniczacy: "SSR Jan Testowy" }] });
    const body = new URLSearchParams(asked[1]!.body);
    expect(asked[1]!.url).toBe("https://testowo.sr.gov.pl/srp/e-wokanda/70,e-Wokanda.html");
    expect(body.get("pole573")).toBe("I C 595/25");
    expect(body.get("pid")).toBe("2");
    expect(body.has("archiwum")).toBe(false);
  });

  it("Drupal view, labelled records, label tables and a plain list", async () => {
    const one = async (system: string, url: string, name: string, signature: string) =>
      checkWokanda("x", signature, async (asked) => ({ status: 200, url: asked, text: fixture(name) }), () => new Date(), () => court(system, url));
    expect(await one("DRUPAL_VIEW", "https://e-wokanda.example.gov.pl/wokanda_so", "drupal-view.html", "IV U 1478/24")).toMatchObject({
      state: "FOUND",
      searchUrl: "https://e-wokanda.example.gov.pl/wokanda_so?field_sygnatura_value=IV+U+1478%2F24",
      hearings: [{ data: "2026-11-04", godzina: "09:00", sala: "32", przewodniczacy: "Anna Testowa" }]
    });
    expect(await one("POST_FORM", "https://testowo.sa.gov.pl/e-wokanda", "labeled.html", "I ACa 804/25")).toMatchObject({
      state: "FOUND",
      hearings: [{ sygnatura: "I ACa 804/25", data: "2026-11-03", godzina: "08:30", sala: "Sala II", wydzial: "I Wydział Cywilny" }]
    });
    expect(await one("LIST", "https://testowo.sr.gov.pl/e-wokanda", "vertical.html", "V RC 631/26")).toMatchObject({
      state: "FOUND",
      hearings: [{ data: "2026-11-04", godzina: "08:30", sala: "7", wydzial: "V Wydział Rodzinny i Nieletnich" }]
    });
    const list = await one("LIST", "https://testowo.sr.gov.pl/wokanda_.php", "list.html", "II K 151/26");
    expect(list).toMatchObject({ state: "FOUND", hearings: [{ sygnatura: "K 151/2026", data: "2026-06-30", godzina: "08:00" }] });
    expect(list.state === "FOUND" && list.note).toMatch(/bez wyszukiwarki/u);
  });

  it("the register knows each system of the probed courts", () => {
    const systems = new Set(wokandaRegister().sady.map((item) => item.system).filter(Boolean));
    for (const system of ["MS_PORTAL", "CMS_FORM", "GET_FORM", "POST_FORM", "DRUPAL_VIEW", "LIST"]) expect(systems.has(system as never)).toBe(true);
  });
});
