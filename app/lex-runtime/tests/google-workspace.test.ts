import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedContext } from "../src/auth/types.js";
import { driveFiles, listDrive } from "../src/google/drive.js";
import { gmailThreadFiles, searchGmailThreads } from "../src/google/gmail.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { SecureCaseUploadStore } from "../src/case-secure-store.js";
import { registerGoogleWorkspaceRoutes } from "../src/google/http-routes.js";
import { GoogleRecoveryController } from "../src/google/recovery-controller.js";
import { GoogleWorkspaceController } from "../src/google/workspace-controller.js";
import { createLexHttpApp } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const roots: string[] = [];

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function idToken(nonce: string): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return `${part({ alg: "RS256" })}.${part({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "sub-1",
    email: "jan@example.com",
    email_verified: true,
    iat: now,
    exp: now + 3600,
    nonce
  })}.sig`;
}

const actor = (userId = "user_1", sessionId = "session_1") =>
  ({ user: { userId, loginName: "jan" }, session: { sessionId } }) as unknown as AuthenticatedContext;

const masterKeys = new Map<string, Buffer>([["session_1", Buffer.alloc(32, 7)]]);
const auth = {
  async withSessionUserMasterKey<T>(sessionId: string, callback: (key: Buffer) => T | Promise<T>): Promise<T> {
    const key = masterKeys.get(sessionId);
    if (!key) throw new Error("AUTH_SESSION_LOCKED");
    return await callback(Buffer.from(key));
  }
};

// Fake Google: token endpoint (code and refresh), revocation, Gmail and Drive.
function fakeGoogle(options: { scope?: string; refreshToken?: string | null; refreshFails?: boolean } = {}) {
  let nonce = "";
  const revoked: string[] = [];
  const tokenBodies: URLSearchParams[] = [];
  const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const authHeader = new Headers(init?.headers).get("authorization");
    if (url.href === "https://oauth2.googleapis.com/token") {
      const body = new URLSearchParams(String(init?.body));
      tokenBodies.push(body);
      if (body.get("grant_type") === "refresh_token") {
        if (options.refreshFails) return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ access_token: `access-from-${body.get("refresh_token")}`, expires_in: 3599 });
      }
      return Response.json({
        access_token: "access-1",
        id_token: idToken(nonce),
        ...(options.refreshToken === null ? {} : { refresh_token: options.refreshToken ?? "refresh-1" }),
        scope:
          options.scope ??
          "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly",
        expires_in: 3599
      });
    }
    if (url.href.startsWith("https://oauth2.googleapis.com/revoke")) {
      revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? url.searchParams.get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    if (!authHeader?.startsWith("Bearer ")) return new Response(null, { status: 401 });
    if (url.href.startsWith(`${GMAIL}/threads?`)) {
      expect(url.searchParams.get("q")).toBe("filename:pdf");
      return Response.json({ threads: [{ id: "t1" }] });
    }
    if (url.pathname.endsWith("/threads/t1")) {
      const headers = [
        { name: "Subject", value: "Wezwanie do zapłaty: umowa/2026" },
        { name: "From", value: "Kancelaria <biuro@example.com>" },
        { name: "To", value: "jan@example.com" },
        { name: "Date", value: "Mon, 5 Oct 2026 10:00:00 +0200" }
      ];
      return Response.json({
        id: "t1",
        messages: [
          {
            id: "m1",
            snippet: "W załączeniu wezwanie",
            payload: {
              mimeType: "multipart/mixed",
              headers,
              parts: [
                {
                  mimeType: "multipart/alternative",
                  parts: [
                    { mimeType: "text/plain", body: { data: b64("Szanowni Państwo,\nw załączeniu wezwanie.") } },
                    { mimeType: "text/html", body: { data: b64("<p>inne</p>") } }
                  ]
                },
                { mimeType: "application/pdf", filename: "wezwanie.pdf", body: { attachmentId: "a1", size: 4 } },
                { mimeType: "application/pdf", filename: "duzy.pdf", body: { attachmentId: "a2", size: 30 * 1024 * 1024 } }
              ]
            }
          }
        ]
      });
    }
    if (url.pathname.endsWith("/messages/m1/attachments/a1")) return Response.json({ data: b64("%PDF") });
    if (url.href.startsWith(`${DRIVE}?`)) {
      const q = url.searchParams.get("q") ?? "";
      if (q.startsWith("'folder1' in parents")) {
        return Response.json({ files: [{ id: "doc1", name: "Pozew", mimeType: "application/vnd.google-apps.document" }, { id: "form1", name: "Ankieta", mimeType: "application/vnd.google-apps.form" }] });
      }
      return Response.json({ files: [{ id: "folder1", name: "Sprawa", mimeType: "application/vnd.google-apps.folder" }, { id: "pdf1", name: "skan.pdf", mimeType: "application/pdf", size: "3" }], nextPageToken: "p2" });
    }
    const id = url.pathname.split("/")[4];
    const meta: Record<string, object> = {
      folder1: { name: "Sprawa", mimeType: "application/vnd.google-apps.folder" },
      doc1: { name: "Pozew", mimeType: "application/vnd.google-apps.document" },
      form1: { name: "Ankieta", mimeType: "application/vnd.google-apps.form" },
      pdf1: { name: "skan.pdf", mimeType: "application/pdf", size: "3" }
    };
    if (url.pathname.endsWith("/export")) return new Response(Buffer.from(`docx:${url.searchParams.get("mimeType")}`));
    if (url.searchParams.get("alt") === "media") return new Response(Buffer.from("pdf"));
    if (id && meta[id]) return Response.json(meta[id]);
    return new Response(null, { status: 404 });
  });
  return {
    fetchImpl,
    revoked,
    tokenBodies,
    nonceFrom(authorizationUrl: string) {
      const params = new URL(authorizationUrl).searchParams;
      nonce = params.get("nonce")!;
      return params.get("state")!;
    }
  };
}

function setup(options: Parameters<typeof fakeGoogle>[0] = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-google-ws-"));
  roots.push(root);
  const google = fakeGoogle(options);
  let now = Date.now();
  const controller = new GoogleWorkspaceController(auth, root, {
    fetch: google.fetchImpl,
    now: () => now,
    loadConfig: () => ({ clientId: CLIENT_ID })
  });
  return { root, google, controller, advance: (ms: number) => (now += ms) };
}

async function connect(current: ReturnType<typeof setup>) {
  const start = current.controller.startConnect(actor(), "http://127.0.0.1:4000/oauth/google/callback");
  const state = current.google.nonceFrom(start.authorizationUrl);
  return { start, ok: await current.controller.handleCallback({ state, code: "c1" }) };
}

describe("Google: connected account (Gmail, Drive) read-only", () => {
  it("asks only read scopes with offline access and keeps the refresh token encrypted", async () => {
    const current = setup();
    const { start, ok } = await connect(current);
    const url = new URL(start.authorizationUrl);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).toContain("drive.readonly");
    expect(url.searchParams.get("scope")).not.toMatch(/gmail\.send|gmail\.modify|auth\/drive(?!\.readonly)/u);
    expect(ok).toBe(true);
    const file = fs.readFileSync(path.join(current.root, "google-workspace", "user_1.json"), "utf8");
    expect(file).not.toContain("refresh-1");
    expect(JSON.parse(file).email).toBe("jan@example.com");
    expect(current.controller.result(start.flowId, start.flowToken)).toMatchObject({ status: "DONE", result: { connected: true, gmail: true, drive: true } });
    expect(await current.controller.status(actor())).toMatchObject({ connected: true, email: "jan@example.com" });
  });

  it("refreshes the access token from the stored refresh token after it expires", async () => {
    const current = setup();
    await connect(current);
    expect(await current.controller.accessToken(actor())).toBe("access-1");
    current.advance(2 * 3600 * 1000);
    expect(await current.controller.accessToken(actor())).toBe("access-from-refresh-1");
  });

  it("a state it did not issue is left to the recovery flow", async () => {
    const current = setup();
    expect(await current.controller.handleCallback({ state: "obcy", code: "x" })).toBeNull();
  });

  it("fails without a refresh token or with neither Gmail nor Drive granted, and revokes", async () => {
    const noRefresh = setup({ refreshToken: null });
    expect((await connect(noRefresh)).ok).toBe(false);
    expect(noRefresh.google.revoked).toContain("access-1");

    const noScope = setup({ scope: "openid https://www.googleapis.com/auth/userinfo.email" });
    const { start, ok } = await connect(noScope);
    expect(ok).toBe(false);
    expect(noScope.controller.result(start.flowId, start.flowToken)).toEqual({ status: "FAILED", error: "GOOGLE_SCOPE_DENIED" });
  });

  it("only Gmail granted: status says so", async () => {
    const current = setup({ scope: "openid https://www.googleapis.com/auth/gmail.readonly" });
    await connect(current);
    expect(await current.controller.status(actor())).toMatchObject({ connected: true, gmail: true, drive: false });
  });

  it("a revoked grant asks to reconnect; disconnect revokes and removes the file", async () => {
    const current = setup({ refreshFails: true });
    await connect(current);
    current.advance(2 * 3600 * 1000);
    await expect(current.controller.accessToken(actor())).rejects.toMatchObject({ code: "GOOGLE_RECONNECT_REQUIRED" });
    expect(await current.controller.disconnect(actor())).toMatchObject({ connected: false });
    expect(current.google.revoked).toContain("refresh-1");
    expect(fs.existsSync(path.join(current.root, "google-workspace", "user_1.json"))).toBe(false);
    await expect(current.controller.accessToken(actor())).rejects.toMatchObject({ code: "GOOGLE_NOT_CONNECTED" });
  });

  it("another user's session cannot read the account", async () => {
    const current = setup();
    await connect(current);
    expect(await current.controller.status(actor("user_2", "session_1"))).toMatchObject({ connected: false });
  });
});

describe("Gmail and Drive: picked threads and files as case files", () => {
  it("a thread: messages in one text file, attachments as files, too large ones skipped", async () => {
    const { google } = setup();
    const found = await searchGmailThreads(google.fetchImpl, "t", "filename:pdf");
    expect(found.threads).toEqual([
      expect.objectContaining({ id: "t1", subject: "Wezwanie do zapłaty: umowa/2026", messages: 1 })
    ]);
    const files = await gmailThreadFiles(google.fetchImpl, "t", "t1");
    expect(files.map((file) => file.filename)).toEqual(["Wezwanie do zapłaty umowa 2026 (wątek Gmail).txt", "wezwanie.pdf"]);
    const text = Buffer.from(files[0]!.data).toString("utf8");
    expect(text).toContain("Od: Kancelaria <biuro@example.com>");
    expect(text).toContain("w załączeniu wezwanie.");
    expect(text).not.toContain("inne");
    expect(Buffer.from(files[1]!.data).toString()).toBe("%PDF");
  });

  it("Drive: a folder brings its files, Google documents exported to .docx, forms left out", async () => {
    const { google } = setup();
    const page = await listDrive(google.fetchImpl, "t", {});
    expect(page.items.map((item) => [item.name, item.folder])).toEqual([["Sprawa", true], ["skan.pdf", false]]);
    expect(page.nextPageToken).toBe("p2");
    const files = await driveFiles(google.fetchImpl, "t", "folder1");
    expect(files).toHaveLength(1);
    expect(files[0]!.filename).toBe("Sprawa - Pozew.docx");
    expect(files[0]!.mediaType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect((await driveFiles(google.fetchImpl, "t", "pdf1"))[0]).toMatchObject({ filename: "skan.pdf", mediaType: "application/pdf" });
    await expect(driveFiles(google.fetchImpl, "t", "../x")).rejects.toMatchObject({ code: "GOOGLE_DRIVE_ID_INVALID" });
  });

  it("HTTP: connect, search, import into the case; nothing connected is a clear error", async () => {
    const current = setup();
    const saved: Array<{ caseId: string; names: string[] }> = [];
    const app = express();
    app.use(express.json());
    app.use((_req, res, next) => {
      res.locals.actor = actor();
      next();
    });
    registerGoogleWorkspaceRoutes(app, current.controller, (res) => res.locals.actor as AuthenticatedContext, async (_context, caseId, files) => {
      saved.push({ caseId, names: files.map((file) => file.filename) });
      return files.map((file) => ({ filename: file.filename }));
    });

    expect((await request(app).get("/api/google/gmail/threads?q=filename:pdf")).body).toEqual({ error: "GOOGLE_NOT_CONNECTED" });
    const start = await request(app).post("/api/google/workspace/connect").send({});
    expect(start.status).toBe(201);
    await current.controller.handleCallback({ state: current.google.nonceFrom(start.body.authorizationUrl), code: "c1" });
    expect((await request(app).post("/api/google/workspace/connect/result").send({ flowId: start.body.flowId, flowToken: start.body.flowToken })).body).toMatchObject({ status: "DONE" });

    const threads = await request(app).get("/api/google/gmail/threads").query({ q: "filename:pdf" });
    expect(threads.body.threads[0].id).toBe("t1");
    const imported = await request(app).post("/api/cases/case_1/google/import").send({ gmailThreadIds: ["t1"], driveFileIds: ["pdf1"] });
    expect(imported.status).toBe(201);
    expect(saved).toEqual([{ caseId: "case_1", names: ["Wezwanie do zapłaty umowa 2026 (wątek Gmail).txt", "wezwanie.pdf", "skan.pdf"] }]);
    expect((await request(app).post("/api/cases/case_1/google/import").send({ gmailThreadIds: [] })).body).toEqual({ error: "GOOGLE_IMPORT_EMPTY" });
  });
});

describe("Google import end to end: signed-in user, encrypted case files", () => {
  it("connects through the browser callback, imports a thread and a file, lists them in the case", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-google-e2e-"));
    roots.push(root);
    const skills = fs.mkdtempSync(path.join(os.tmpdir(), "lex-google-e2e-skills-"));
    roots.push(skills);
    const store = new LocalAuthStore({ rootDir: root });
    const authService = new LocalAuthService(store, {
      sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
      kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
    });
    const files = new LocalCaseFileStore({ rootDir: root });
    const google = fakeGoogle();
    const loadConfig = () => ({ clientId: CLIENT_ID });
    const app = createLexHttpApp({
      registry: new LexSkillRegistry(skills),
      modelCatalog: { list: vi.fn(async () => []) },
      authService,
      caseFileStore: files,
      secureCaseUploadStore: new SecureCaseUploadStore({ rootDir: root }),
      caseAccessService: new LocalCaseAccessService(store, authService, files),
      googleRecovery: new GoogleRecoveryController(authService, { fetch: google.fetchImpl, loadConfig }),
      googleWorkspace: new GoogleWorkspaceController(authService, root, { fetch: google.fetchImpl, loadConfig })
    } as never);

    const bootstrap = await request(app)
      .post("/api/auth/bootstrap")
      .send({ loginName: "google-owner", displayName: "Google Owner", password: "Google import strong password 2026" })
      .expect(201);
    const authorization = `Bearer ${String(bootstrap.body.sessionToken)}`;
    const caseId = String((await request(app).post("/api/cases").set("Authorization", authorization).send({ displayName: "Import" }).expect(201)).body.caseId);

    expect((await request(app).get("/api/google/workspace/status")).status).toBe(401);
    expect((await request(app).get("/api/google/workspace/status").set("Authorization", authorization)).body).toMatchObject({ configured: true, connected: false });

    const start = await request(app).post("/api/google/workspace/connect").set("Authorization", authorization).send({}).expect(201);
    const state = google.nonceFrom(start.body.authorizationUrl);
    expect(new URL(start.body.authorizationUrl).searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/google\/callback$/u);
    // The browser comes back without a session.
    const callback = await request(app).get("/oauth/google/callback").query({ state, code: "c1" });
    expect(callback.status).toBe(200);
    expect(callback.text).toContain("Połączono z kontem Google");
    const result = await request(app)
      .post("/api/google/workspace/connect/result")
      .set("Authorization", authorization)
      .send({ flowId: start.body.flowId, flowToken: start.body.flowToken });
    expect(result.body).toMatchObject({ status: "DONE", result: { connected: true, email: "jan@example.com" } });

    const imported = await request(app)
      .post(`/api/cases/${caseId}/google/import`)
      .set("Authorization", authorization)
      .send({ gmailThreadIds: ["t1"], driveFileIds: ["pdf1"] });
    expect(imported.status).toBe(201);
    expect(imported.body.files).toHaveLength(3);
    expect(imported.body.files[0].uploadId).toEqual(expect.any(String));

    const listed = await request(app).get(`/api/cases/${caseId}/files`).set("Authorization", authorization).expect(200);
    const names = JSON.stringify(listed.body);
    for (const name of ["(wątek Gmail).txt", "wezwanie.pdf", "skan.pdf"]) expect(names).toContain(name);
    // Stored encrypted: no clear text of the mail on the disk.
    const onDisk = fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
    for (const entry of onDisk) {
      expect(fs.readFileSync(path.join(entry.parentPath, entry.name)).includes("w załączeniu wezwanie")).toBe(false);
    }

    const otherCase = await request(app)
      .post("/api/cases/case_00000000000000000000000000000000/google/import")
      .set("Authorization", authorization)
      .send({ gmailThreadIds: ["t1"] });
    expect(otherCase.status).toBeGreaterThanOrEqual(400);
    expect(otherCase.status).toBeLessThan(500);
  });
});
