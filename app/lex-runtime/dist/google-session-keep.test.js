import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearLawSourceSession, configureLawSourceSessionStore, keepLawSourceSession, LAW_SOURCES_WITH_CHECK, lawSourceSessionHeaders, setLawSourceSession } from "./eli/law-source-sessions.js";
import { configureWebSearchSettings, googleSessionStore, setGoogleSession, setGoogleSessionKeep, webSearchSettings } from "./web-search-settings.js";
const GOOGLE = "www.google.com";
const COOKIE = "NID=511=abc; GOOGLE_ABUSE_EXEMPTION=ID=1:TM=2";
const UA = "Mozilla/5.0 (Lex test)";
let dir = "";
/** A restart: the in-memory session is gone, the store reads the file again. */
function restart() {
    clearMemory();
    configureLawSourceSessionStore(googleSessionStore);
}
function clearMemory() {
    configureLawSourceSessionStore(null);
    for (const source of LAW_SOURCES_WITH_CHECK)
        clearLawSourceSession(source.host);
}
beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-google-keep-"));
    configureWebSearchSettings(dir);
    configureLawSourceSessionStore(googleSessionStore);
});
afterEach(() => {
    clearMemory();
    configureWebSearchSettings(null);
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
});
describe("Google session kept across restarts (opt-in)", () => {
    it("is off by default: the session lives in memory only", () => {
        expect(webSearchSettings()).toMatchObject({ googleSession: true, googleSessionKeep: false, googleSessionSaved: false });
        setLawSourceSession(GOOGLE, COOKIE, UA);
        expect(lawSourceSessionHeaders(GOOGLE)).toEqual({ cookie: COOKIE, "user-agent": UA });
        restart();
        expect(lawSourceSessionHeaders(GOOGLE)).toBeNull();
    });
    it("kept: survives a restart, sealed (no cookie in the file)", () => {
        setGoogleSessionKeep(true);
        setLawSourceSession(GOOGLE, COOKIE, UA);
        const file = fs.readFileSync(path.join(dir, "web-search.json"), "utf8");
        expect(file).not.toContain("NID=");
        expect(file).not.toContain("Lex test");
        expect(webSearchSettings().googleSessionSaved).toBe(true);
        restart();
        expect(lawSourceSessionHeaders(GOOGLE)).toEqual({ cookie: COOKIE, "user-agent": UA });
    });
    it("turning keep on saves the live session; turning it off removes the saved one", () => {
        setLawSourceSession(GOOGLE, COOKIE, UA);
        setGoogleSessionKeep(true);
        keepLawSourceSession(GOOGLE);
        expect(webSearchSettings().googleSessionSaved).toBe(true);
        setGoogleSessionKeep(false);
        expect(webSearchSettings().googleSessionSaved).toBe(false);
        expect(fs.readFileSync(path.join(dir, "web-search.json"), "utf8")).not.toContain("googleCookies");
        restart();
        expect(lawSourceSessionHeaders(GOOGLE)).toBeNull();
    });
    it("a captcha (session cleared) removes the saved session too", () => {
        setGoogleSessionKeep(true);
        setLawSourceSession(GOOGLE, COOKIE, UA);
        clearLawSourceSession(GOOGLE);
        expect(webSearchSettings().googleSessionSaved).toBe(false);
        restart();
        expect(lawSourceSessionHeaders(GOOGLE)).toBeNull();
    });
    it("Google turned off drops the saved session and the keep choice", () => {
        setGoogleSessionKeep(true);
        setLawSourceSession(GOOGLE, COOKIE, UA);
        setGoogleSession(false);
        expect(webSearchSettings()).toMatchObject({ googleSession: false, googleSessionKeep: false, googleSessionSaved: false });
    });
    it("a kept session expires after 30 days, a memory one after 6 hours", () => {
        vi.useFakeTimers({ now: new Date("2026-11-11T08:00:00Z") });
        setGoogleSessionKeep(true);
        setLawSourceSession(GOOGLE, COOKIE, UA);
        vi.setSystemTime(new Date("2026-11-20T08:00:00Z"));
        restart();
        expect(lawSourceSessionHeaders(GOOGLE)).not.toBeNull();
        vi.setSystemTime(new Date("2026-12-12T08:00:00Z"));
        expect(lawSourceSessionHeaders(GOOGLE)).toBeNull();
    });
    it("keeps only Google, never another law source", () => {
        setGoogleSessionKeep(true);
        setLawSourceSession("www.nysenate.gov", "cf_clearance=x", UA);
        restart();
        expect(lawSourceSessionHeaders("www.nysenate.gov")).toBeNull();
    });
});
