import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { EncryptedCaseWorkspaceStore } from "../src/case-workspace-store.js";
import { createLexHttpApp } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";

const FIXTURES = path.resolve(__dirname, "fixtures/wokanda");
const SEARCH = fs.readFileSync(path.join(FIXTURES, "portal-search.html"), "utf8");
const DETAILS = fs.readFileSync(path.join(FIXTURES, "portal-details.html"), "utf8");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("case court and wokanda over HTTP", () => {
  it("the user sets the court and signature; the wokanda check reads the hearing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-wokanda-"));
    roots.push(root);
    const authStore = new LocalAuthStore({ rootDir: root });
    const auth = new LocalAuthService(authStore, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const files = new LocalCaseFileStore({ rootDir: root });
    const cases = new LocalCaseAccessService(authStore, auth, files);
    const asked: string[] = [];
    const app = express();
    app.use(express.json());
    app.use(
      createLexHttpApp({
        registry: new LexSkillRegistry(path.join(root, "corpus")),
        modelCatalog: { list: async () => [] },
        authService: auth,
        caseFileStore: files,
        caseAccessService: cases,
        caseMemoryStore: new EncryptedCaseWorkspaceStore({ rootDir: root }),
        wokandaFetch: async (url: string) => {
          asked.push(url);
          return { status: 200, url, text: url.includes("index.php") ? SEARCH : DETAILS };
        }
      } as never)
    );
    const boot = await request(app).post("/api/auth/bootstrap").send({ loginName: "wokanda", displayName: "Owner", password: "Wokanda strong password 2026" });
    const authorization = `Bearer ${boot.body.sessionToken as string}`;
    const caseId = (await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Rozwód" })).body.caseId as string;

    expect((await request(app).post(`/api/cases/${caseId}/wokanda`).set("Authorization", authorization)).body.error).toBe("CASE_COURT_MISSING");
    expect((await request(app).patch(`/api/cases/${caseId}/court`).set("Authorization", authorization).send({ nazwa: "Sąd Księżycowy" })).body.error).toBe("CASE_COURT_UNKNOWN");
    expect((await request(app).patch(`/api/cases/${caseId}/court`).set("Authorization", authorization).send({ nazwa: "Sąd Okręgowy w Krakowie", sygnatura: "abc" })).body.error).toBe("CASE_SIGNATURE_INVALID");

    const saved = await request(app).patch(`/api/cases/${caseId}/court`).set("Authorization", authorization).send({ nazwa: "Sąd Okręgowy w Krakowie", wydzial: "XI Wydział Cywilny Rodzinny", sygnatura: "XI C 1768/26" });
    expect(saved.status).toBe(200);
    expect(saved.body.court).toMatchObject({ nazwa: "Sąd Okręgowy w Krakowie", sygnatura: "XI C 1768/26", zrodlo: "UZYTKOWNIK" });
    expect(saved.body.wokanda).toMatchObject({ status: "PORTAL" });
    expect((await request(app).get(`/api/cases/${caseId}/court`).set("Authorization", authorization)).body.court.sygnatura).toBe("XI C 1768/26");

    const checked = await request(app).post(`/api/cases/${caseId}/wokanda`).set("Authorization", authorization);
    expect(checked.status).toBe(200);
    expect(checked.body).toMatchObject({ state: "FOUND", hearings: [{ data: "2026-11-05", godzina: "08:00", sala: "A-17", miejsce: "ul. Przy Rondzie 7" }] });
    expect(asked).toHaveLength(2);

    // Cleared: no court, no check.
    await request(app).patch(`/api/cases/${caseId}/court`).set("Authorization", authorization).send({}).expect(200);
    expect((await request(app).post(`/api/cases/${caseId}/wokanda`).set("Authorization", authorization)).body.error).toBe("CASE_COURT_MISSING");
  }, 60_000);
});
