import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLexHttpApp, jsonErrorHandler } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { MemoryOverlayCredentialResolver, StaticCredentialResolver } from "../src/providers/credentials.js";
import { ProviderGateway, ProviderGatewayError, ProviderRegistry } from "../src/providers/gateway.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import type { SessionExecutionRequest, SessionExecutionResponse, SessionExecutor } from "../src/session-executor.js";
import { ServerModeStore } from "../src/server-mode/store.js";
import { ServerSecretBox } from "../src/server-mode/secret-box.js";
import { ServerModeService } from "../src/server-mode/service.js";
import { runInAccountScope } from "../src/server-mode/account-scope.js";
import { ServerModeCredentialResolver } from "../src/server-mode/credentials.js";
import { registerServerModeRoutes } from "../src/server-mode/routes.js";
import type { MailMessage } from "../src/server-mode/smtp.js";

const roots: string[] = [];
const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
const ADMIN_PASSWORD = "Admin serwerowe haslo 2026";
const USER_PASSWORD = "Uzytkownik serwerowe haslo 2026";
// The container's environment key and the admin's global key; neither may appear in any response.
const FIRM_KEY = "sk-firm-key-0123456789abcdef";
const GLOBAL_KEY = "sk-global-key-zyxwvutsrqponm987";
const SMTP_PASSWORD = "smtp-tajne-haslo-123";
const sentBodies: string[] = [];

function tempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function registry(): LexSkillRegistry {
  const root = tempDir("lex-server-mode-skills-");
  for (const name of ["prawo-polskie-v2", DR]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\n---\n# test\n`);
  }
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), DR + "\n");
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

function executionResult(input: SessionExecutionRequest): SessionExecutionResponse {
  return {
    sessionId: "session-1",
    status: "DRAFT_PRESENTABLE" as const,
    provider: input.provider,
    model: input.model,
    primarySkill: input.primarySkill,
    answer: "odpowiedz",
    finalization: "PASS" as const,
    blockedReferences: [],
    verification: { records: 0, verified: 0, supported: 0, unverified: 0 },
    evidence: [],
    audit: { result: "PASS" as const, eventCount: 1, closed: true }
  } as SessionExecutionResponse;
}

function fixture(options: { forceEnv?: string; execute?: SessionExecutor["execute"] } = {}) {
  const root = tempDir("lex-server-mode-data-");
  const authStore = new LocalAuthStore({ rootDir: root });
  const auth = new LocalAuthService(authStore, {
    sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
    kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
  });
  const files = new LocalCaseFileStore({ rootDir: root });
  const cases = new LocalCaseAccessService(authStore, auth, files);
  const mails: MailMessage[] = [];
  const clock = { now: Date.parse("2026-10-21T10:00:00Z") };
  const serverMode = new ServerModeService(
    new ServerModeStore(path.join(root, "server")),
    new ServerSecretBox({ keyPath: path.join(root, "server", "secret.key") }),
    auth,
    {
      now: () => clock.now,
      mailTransport: () => ({
        send: async (message) => {
          mails.push(message);
        }
      }),
      forceEnv: options.forceEnv
    }
  );
  const environment = new StaticCredentialResolver({ openai: FIRM_KEY });
  const credentials = new ServerModeCredentialResolver(new MemoryOverlayCredentialResolver(environment), environment, serverMode);
  const executor: SessionExecutor = {
    execute: vi.fn(options.execute ?? (async (input) => executionResult(input)))
  };
  const coreApp = createLexHttpApp({
    registry: registry(),
    modelCatalog: { list: vi.fn(async () => []) },
    authService: auth,
    caseFileStore: files,
    caseAccessService: cases,
    credentialResolver: credentials,
    credentialManager: credentials,
    sessionExecutor: executor,
    accountSessions: {
      statusAll: vi.fn(async () => []),
      login: vi.fn(),
      logout: vi.fn(),
      setAnthropicOAuthToken: vi.fn(),
      clearAnthropicOAuthToken: vi.fn()
    } as never
  });
  const app = express();
  // Every response body of the tests, scanned for the secrets after each test.
  app.use((_req, res, next) => {
    const send = res.send.bind(res);
    res.send = ((body: unknown) => {
      sentBodies.push(typeof body === "string" ? body : Buffer.isBuffer(body) ? body.toString("utf8") : JSON.stringify(body ?? null));
      return send(body as never);
    }) as typeof res.send;
    next();
  });
  app.use(express.json({ limit: "2mb" }));
  registerServerModeRoutes(app, { authService: auth, serverMode });
  app.use(coreApp);
  app.use(jsonErrorHandler);
  return { app, auth, serverMode, mails, clock, credentials, executor, serverModeDir: path.join(root, "server") };
}

type Fixture = ReturnType<typeof fixture>;

async function bootstrapAdmin(current: Fixture): Promise<string> {
  const response = await request(current.app)
    .post("/api/auth/bootstrap")
    .send({ loginName: "admin", displayName: "Admin", password: ADMIN_PASSWORD })
    .expect(201);
  return String(response.body.sessionToken);
}

async function createUser(current: Fixture, adminToken: string, loginName: string): Promise<{ token: string; userId: string }> {
  const created = await request(current.app)
    .post("/api/admin/users")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ loginName, displayName: loginName, password: USER_PASSWORD })
    .expect(201);
  const login = await request(current.app).post("/api/auth/login").send({ loginName, password: USER_PASSWORD }).expect(200);
  return { token: String(login.body.sessionToken), userId: String(created.body.user.userId) };
}

async function enable(current: Fixture, adminToken: string): Promise<void> {
  await request(current.app).put("/api/server-mode/enabled").set("Authorization", `Bearer ${adminToken}`).send({ enabled: true }).expect(200);
}

async function configureMail(current: Fixture, adminToken: string): Promise<void> {
  await request(current.app)
    .put("/api/server-mode/settings")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      publicBaseUrl: "https://kancelaria.example.pl/",
      smtp: { host: "smtp.example.pl", port: 587, secure: false, user: "lex", from: "lex@example.pl", password: SMTP_PASSWORD }
    })
    .expect(200);
}

function tokenFrom(mail: MailMessage | undefined, kind: "weryfikacja" | "reset-hasla"): string {
  const match = new RegExp(`#${kind}=([A-Za-z0-9_-]+)`).exec(mail?.text ?? "");
  if (!match) throw new Error("no link in mail");
  return match[1]!;
}

const execBody = (model = "gpt-test") => ({ query: "Pytanie o umowę najmu lokalu", provider: "openai", model, primarySkill: DR, mode: "PRAWNIK" });

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
  const bodies = sentBodies.splice(0).join("\n");
  for (const secret of [GLOBAL_KEY, FIRM_KEY, SMTP_PASSWORD]) expect(bodies).not.toContain(secret);
});

describe("server mode switch", () => {
  it("is off by default and only an admin can change it", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "uzytkownik");

    await request(current.app).get("/api/server-mode/status").expect(200, { serverMode: false, registration: false });
    await request(current.app).put("/api/server-mode/enabled").send({ enabled: true }).expect(401);
    await request(current.app).put("/api/server-mode/enabled").set("Authorization", `Bearer ${user.token}`).send({ enabled: true }).expect(403);
    expect(current.serverMode.isEnabled()).toBe(false);

    const enabled = await request(current.app).put("/api/server-mode/enabled").set("Authorization", `Bearer ${adminToken}`).send({ enabled: true }).expect(200);
    expect(enabled.body.serverMode).toBe(true);
    await request(current.app).get("/api/server-mode/status").expect(200, { serverMode: true, registration: false });
  });

  it("LEX_SERVER_MODE_FORCE fixes the mode", async () => {
    const current = fixture({ forceEnv: "on" });
    const adminToken = await bootstrapAdmin(current);
    expect(current.serverMode.isEnabled()).toBe(true);
    await request(current.app).put("/api/server-mode/enabled").set("Authorization", `Bearer ${adminToken}`).send({ enabled: false }).expect(409, { error: "SERVER_MODE_FORCED" });
  });
});

describe("public origin", () => {
  it("accepts only the origins named in LEX_ALLOWED_ORIGINS besides loopback", async () => {
    const current = fixture();
    await request(current.app).get("/health").set("Origin", "https://kancelaria.example.pl").expect(403, { error: "ORIGIN_NOT_ALLOWED" });
    process.env.LEX_ALLOWED_ORIGINS = "https://kancelaria.example.pl";
    try {
      await request(current.app).get("/health").set("Origin", "https://kancelaria.example.pl").expect(200);
      await request(current.app).get("/health").set("Origin", "https://obca.example.pl").expect(403);
    } finally {
      delete process.env.LEX_ALLOWED_ORIGINS;
    }
  });
});

describe("local-only features", () => {
  it("work with the mode off and are refused with it on", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const auth = { Authorization: `Bearer ${adminToken}` };

    await request(current.app).get("/api/provider-accounts").set(auth).expect(200);
    await request(current.app).post("/api/server-mode/register").send({ email: "a@example.pl", password: USER_PASSWORD }).expect(404, { error: "SERVER_MODE_DISABLED" });

    await enable(current, adminToken);
    for (const [method, url, body] of [
      ["get", "/api/provider-accounts", {}],
      ["post", "/api/provider-accounts/openai/login", {}],
      ["post", "/api/admin/provider-accounts/anthropic/oauth-token", {}],
      ["get", "/api/update/status", {}],
      ["post", "/api/downloads/save", {}],
      ["post", "/api/cases/case_x/workspace/items/item_x/open", {}],
      ["post", "/api/admin/mcp-connectors/saos/install", { desktop: true }]
    ] as const) {
      await request(current.app)[method](url).set(auth).send(body).expect(403, { error: "SERVER_MODE_LOCAL_ONLY" });
    }
    // An account-session (CLI) model is refused before the executor.
    await request(current.app).post("/api/sessions/execute").set(auth).send(execBody("account/openai")).expect(403, { error: "SERVER_MODE_LOCAL_ONLY" });
    expect(current.executor.execute).not.toHaveBeenCalled();
  });
});

describe("the server's local model", () => {
  it("is reachable in server mode; stopping it (shared by all accounts) is the admin's", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    await enable(current, adminToken);
    const user = await createUser(current, adminToken, "uzytkownik");
    const listed = await request(current.app).get("/api/local-models").set({ Authorization: `Bearer ${user.token}` });
    expect(listed.body?.error).not.toBe("SERVER_MODE_LOCAL_ONLY");
    await request(current.app).post("/api/local-models/stop").set({ Authorization: `Bearer ${user.token}` }).send({}).expect(403, { error: "AUTHORIZATION_DENIED" });
    const stopped = await request(current.app).post("/api/local-models/stop").set({ Authorization: `Bearer ${adminToken}` }).send({});
    expect(stopped.status).not.toBe(403);
  });
});

describe("registration and password reset by e-mail", () => {
  it("returns 503 MAIL_NOT_CONFIGURED without SMTP and never pretends to send", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    await enable(current, adminToken);
    await request(current.app).post("/api/server-mode/register").send({ email: "nowy@example.pl", password: USER_PASSWORD }).expect(503, { error: "MAIL_NOT_CONFIGURED" });
    await request(current.app).post("/api/server-mode/password-reset/request").send({ email: "nowy@example.pl" }).expect(503, { error: "MAIL_NOT_CONFIGURED" });
    expect(current.mails).toHaveLength(0);
  });

  it("verifies the address once, within 24 hours, and blocks the login until then", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    await enable(current, adminToken);
    await configureMail(current, adminToken);
    await request(current.app).get("/api/server-mode/status").expect(200, { serverMode: true, registration: true });

    const registered = await request(current.app).post("/api/server-mode/register").send({ email: "Nowy@Example.pl", displayName: "Nowy", password: USER_PASSWORD }).expect(202);
    expect(registered.body).toEqual({ status: "CHECK_EMAIL" });
    expect(current.mails).toHaveLength(1);
    expect(current.mails[0]!.to).toBe("nowy@example.pl");
    expect(current.mails[0]!.text).toContain("https://kancelaria.example.pl/#weryfikacja=");
    const token = tokenFrom(current.mails[0], "weryfikacja");

    await request(current.app).post("/api/auth/login").send({ loginName: "nowy@example.pl", password: USER_PASSWORD }).expect(401, { error: "INVALID_CREDENTIALS" });
    await request(current.app).post("/api/server-mode/verify-email").send({ token: "x" + token.slice(1), password: USER_PASSWORD }).expect(400, { error: "INVALID_OR_EXPIRED_TOKEN" });
    await request(current.app).post("/api/server-mode/verify-email").send({ token, password: USER_PASSWORD }).expect(200, { status: "VERIFIED" });
    await request(current.app).post("/api/server-mode/verify-email").send({ token, password: USER_PASSWORD }).expect(400, { error: "INVALID_OR_EXPIRED_TOKEN" });
    const login = await request(current.app).post("/api/auth/login").send({ loginName: "nowy@example.pl", password: USER_PASSWORD }).expect(200);
    expect(login.body.user.appRole).toBe("USER");

    // The link alone does not activate: someone who registered another person's address
    // with their own password cannot be activated by the owner's click, and a wrong password
    // leaves the link usable.
    await request(current.app).post("/api/server-mode/register").send({ email: "ofiara@example.pl", password: "Haslo napastnika 2026 xyz" }).expect(202);
    const planted = tokenFrom(current.mails.at(-1), "weryfikacja");
    await request(current.app).post("/api/server-mode/verify-email").send({ token: planted, password: USER_PASSWORD }).expect(400, { error: "INVALID_PASSWORD" });
    await request(current.app).post("/api/server-mode/verify-email").send({ token: planted }).expect(400, { error: "INVALID_PASSWORD" });
    await request(current.app).post("/api/auth/login").send({ loginName: "ofiara@example.pl", password: "Haslo napastnika 2026 xyz" }).expect(401);
    await request(current.app).post("/api/server-mode/verify-email").send({ token: planted, password: "Haslo napastnika 2026 xyz" }).expect(200, { status: "VERIFIED" });

    // Expired link (24 h).
    await request(current.app).post("/api/server-mode/register").send({ email: "pozny@example.pl", password: USER_PASSWORD }).expect(202);
    const late = tokenFrom(current.mails.at(-1), "weryfikacja");
    current.clock.now += 24 * 60 * 60 * 1000 + 1;
    await request(current.app).post("/api/server-mode/verify-email").send({ token: late, password: USER_PASSWORD }).expect(400, { error: "INVALID_OR_EXPIRED_TOKEN" });
    await request(current.app).post("/api/auth/login").send({ loginName: "pozny@example.pl", password: USER_PASSWORD }).expect(401);
  });

  it("answers the same for a taken, a free and an unknown address", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    await enable(current, adminToken);
    await configureMail(current, adminToken);
    await request(current.app).post("/api/server-mode/register").send({ email: "jest@example.pl", password: USER_PASSWORD }).expect(202);
    await request(current.app).post("/api/server-mode/verify-email").send({ token: tokenFrom(current.mails.at(-1), "weryfikacja"), password: USER_PASSWORD }).expect(200);

    const taken = await request(current.app).post("/api/server-mode/register").send({ email: "jest@example.pl", password: USER_PASSWORD });
    const free = await request(current.app).post("/api/server-mode/register").send({ email: "wolny@example.pl", password: USER_PASSWORD });
    expect([taken.status, taken.body]).toEqual([free.status, free.body]);
    // The owner of the taken address is told, without a verification link.
    const notice = current.mails.find((mail) => mail.to === "jest@example.pl" && mail.subject.includes("już istnieje"));
    expect(notice?.text).not.toContain("#weryfikacja=");

    const before = current.mails.length;
    const unknown = await request(current.app).post("/api/server-mode/password-reset/request").send({ email: "nikt@example.pl" });
    const known = await request(current.app).post("/api/server-mode/password-reset/request").send({ email: "jest@example.pl" });
    expect([unknown.status, unknown.body]).toEqual([known.status, known.body]);
    expect(current.mails.length).toBe(before + 1);
    expect(current.mails.at(-1)!.to).toBe("jest@example.pl");
  });

  it("resets the password once within 1 hour and ends the sessions", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    await enable(current, adminToken);
    await configureMail(current, adminToken);

    await request(current.app).post("/api/server-mode/register").send({ email: "klient@example.pl", password: USER_PASSWORD }).expect(202);
    await request(current.app).post("/api/server-mode/verify-email").send({ token: tokenFrom(current.mails.at(-1), "weryfikacja"), password: USER_PASSWORD }).expect(200);
    const login = await request(current.app).post("/api/auth/login").send({ loginName: "klient@example.pl", password: USER_PASSWORD }).expect(200);
    const oldToken = String(login.body.sessionToken);

    await request(current.app).post("/api/server-mode/password-reset/request").send({ email: "klient@example.pl" }).expect(202);
    const token = tokenFrom(current.mails.at(-1), "reset-hasla");
    const newPassword = "Nowe serwerowe haslo 2026!";
    // A refused password does not use up the link.
    await request(current.app).post("/api/server-mode/password-reset/confirm").send({ token, newPassword: "krotkie" }).expect(400, { error: "PASSWORD_TOO_SHORT" });
    await request(current.app).post("/api/server-mode/password-reset/confirm").send({ token, newPassword }).expect(200, { status: "PASSWORD_RESET" });
    await request(current.app).post("/api/server-mode/password-reset/confirm").send({ token, newPassword }).expect(400, { error: "INVALID_OR_EXPIRED_TOKEN" });

    await request(current.app).get("/api/auth/me").set("Authorization", `Bearer ${oldToken}`).expect(401);
    await request(current.app).post("/api/auth/login").send({ loginName: "klient@example.pl", password: USER_PASSWORD }).expect(401);
    await request(current.app).post("/api/auth/login").send({ loginName: "klient@example.pl", password: newPassword }).expect(200);

    // Expired link (1 h).
    await request(current.app).post("/api/server-mode/password-reset/request").send({ email: "klient@example.pl" }).expect(202);
    const late = tokenFrom(current.mails.at(-1), "reset-hasla");
    current.clock.now += 60 * 60 * 1000 + 1;
    await request(current.app).post("/api/server-mode/password-reset/confirm").send({ token: late, newPassword: "Inne serwerowe haslo 2026!" }).expect(400, { error: "INVALID_OR_EXPIRED_TOKEN" });
  });

  it("limits registration per e-mail and reset requests per IP", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    await enable(current, adminToken);
    await configureMail(current, adminToken);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(current.app).post("/api/server-mode/register").send({ email: "spam@example.pl", password: USER_PASSWORD }).expect(202);
    }
    const limited = await request(current.app).post("/api/server-mode/register").send({ email: "spam@example.pl", password: USER_PASSWORD }).expect(429, { error: "RATE_LIMITED" });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(current.app).post("/api/server-mode/password-reset/request").send({ email: `x${attempt}@example.pl` }).expect(202);
    }
    await request(current.app).post("/api/server-mode/password-reset/request").send({ email: "inny@example.pl" }).expect(429, { error: "RATE_LIMITED" });
    // The window passes.
    current.clock.now += 60 * 60 * 1000;
    await request(current.app).post("/api/server-mode/password-reset/request").send({ email: "inny@example.pl" }).expect(202);
  });
});

describe("plans and token limits", () => {
  it("refuses a model call over the monthly limit, without a plan or outside the plan's providers", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "prawnik");
    await enable(current, adminToken);
    const auth = { Authorization: `Bearer ${user.token}` };

    await request(current.app).post("/api/sessions/execute").set(auth).send(execBody()).expect(402, { error: "PLAN_REQUIRED" });
    const plan = await request(current.app).post("/api/server-mode/plans").set("Authorization", `Bearer ${adminToken}`).send({ name: "Mały", monthlyTokenLimit: 100, allowedProviders: ["openai"] }).expect(201);
    await request(current.app).put(`/api/server-mode/accounts/${user.userId}/plan`).set("Authorization", `Bearer ${adminToken}`).send({ planId: plan.body.plan.planId }).expect(204);

    await request(current.app).post("/api/sessions/execute").set(auth).send({ ...execBody(), provider: "anthropic", model: "claude-test" }).expect(403, { error: "PROVIDER_NOT_IN_PLAN" });
    await request(current.app).post("/api/sessions/execute").set(auth).send(execBody()).expect(200);
    expect(current.executor.execute).toHaveBeenCalledTimes(1);

    // Usage of the month reaches the limit: the next turn is refused before the model.
    runInAccountScope({ userId: user.userId, sessionId: "s" }, () => current.serverMode.afterCall("openai", "gpt-test", { inputTokens: 70, outputTokens: 30 }));
    await request(current.app).post("/api/sessions/execute").set(auth).send(execBody()).expect(429, { error: "TOKEN_LIMIT_REACHED", reason: "PLAN" });
    expect(current.executor.execute).toHaveBeenCalledTimes(1);

    const accounts = await request(current.app).get("/api/server-mode/accounts").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(accounts.body.accounts.find((item: { userId: string }) => item.userId === user.userId)).toMatchObject({
      planName: "Mały",
      monthlyTokenLimit: 100,
      usage: { inputTokens: 70, outputTokens: 30, modelCalls: 1 }
    });

    // A new month starts from zero.
    current.clock.now = Date.parse("2026-11-01T00:00:01Z");
    await request(current.app).post("/api/sessions/execute").set(auth).send(execBody()).expect(200);
  });

  it("checks the limit at every model call and records the tokens (gateway)", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "prawnik");
    await enable(current, adminToken);
    const plan = current.serverMode.savePlan(current.auth.authenticateAuthorization(`Bearer ${adminToken}`), null, { name: "Limit", monthlyTokenLimit: 50, allowedProviders: ["openai"] });
    current.serverMode.assignPlan(current.auth.authenticateAuthorization(`Bearer ${adminToken}`), user.userId, plan.planId);
    const adapter: ProviderAdapter = {
      id: "openai",
      label: "fake",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      stream: vi.fn(async () => ({ text: "ok", toolCalls: [], usage: { inputTokens: 40, outputTokens: 20 } }))
    } as unknown as ProviderAdapter;
    const providers = new ProviderRegistry();
    providers.register(adapter);
    const gateway = new ProviderGateway(providers, current.serverMode);
    const params = { model: "gpt-test", systemPrompt: "s", messages: [{ role: "user" as const, content: "q" }] };

    await runInAccountScope({ userId: user.userId, sessionId: "s" }, () => gateway.stream("openai", params as never));
    const refused = await runInAccountScope({ userId: user.userId, sessionId: "s" }, () => gateway.stream("openai", params as never)).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ProviderGatewayError);
    expect((refused as ProviderGatewayError).code).toBe("ACCOUNT_POLICY");
    expect((refused as ProviderGatewayError).message).toBe("TOKEN_LIMIT_REACHED:PLAN");
    expect(adapter.stream).toHaveBeenCalledTimes(1);
    // Outside an account scope (background work, desktop) nothing is checked.
    await gateway.stream("openai", params as never);
    expect(adapter.stream).toHaveBeenCalledTimes(2);
  });

  it("enforces the global monthly limit over all accounts, before the plan's and for the admin too", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const first = await createUser(current, adminToken, "pierwszy");
    const second = await createUser(current, adminToken, "drugi");
    await enable(current, adminToken);
    const admin = { Authorization: `Bearer ${adminToken}` };
    const plan = await request(current.app).post("/api/server-mode/plans").set(admin).send({ name: "Duży", monthlyTokenLimit: 1000, allowedProviders: ["openai"] }).expect(201);
    await request(current.app).put("/api/server-mode/settings").set(admin).send({ defaultPlanId: plan.body.plan.planId }).expect(200);

    await request(current.app).put("/api/server-mode/settings").set(admin).send({ globalMonthlyTokenLimit: -1 }).expect(400, { error: "INVALID_GLOBAL_TOKEN_LIMIT" });
    await request(current.app).put("/api/server-mode/settings").set(admin).send({ globalMonthlyTokenLimit: "abc" }).expect(400, { error: "INVALID_GLOBAL_TOKEN_LIMIT" });
    const saved = await request(current.app).put("/api/server-mode/settings").set(admin).send({ globalMonthlyTokenLimit: 100 }).expect(200);
    expect(saved.body).toMatchObject({ globalMonthlyTokenLimit: 100, month: "2026-10", globalUsage: { inputTokens: 0, outputTokens: 0 } });

    // Each account is far below its plan; together they reach the global limit.
    runInAccountScope({ userId: first.userId, sessionId: "s" }, () => current.serverMode.afterCall("openai", "gpt-test", { inputTokens: 40, outputTokens: 20 }));
    await request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${second.token}`).send(execBody()).expect(200);
    runInAccountScope({ userId: second.userId, sessionId: "s" }, () => current.serverMode.afterCall("openai", "gpt-test", { inputTokens: 30, outputTokens: 10 }));
    for (const token of [first.token, second.token, adminToken]) {
      await request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${token}`).send(execBody()).expect(429, { error: "TOKEN_LIMIT_REACHED", reason: "GLOBAL" });
    }
    expect(current.executor.execute).toHaveBeenCalledTimes(1);
    const settings = await request(current.app).get("/api/server-mode/settings").set(admin).expect(200);
    expect(settings.body).toMatchObject({ globalMonthlyTokenLimit: 100, globalUsage: { inputTokens: 70, outputTokens: 30, modelCalls: 2 } });
    const me = await request(current.app).get("/api/server-mode/me").set("Authorization", `Bearer ${first.token}`).expect(200);
    expect(me.body).toEqual({ plan: { name: "Duży", monthlyTokenLimit: 1000 }, usage: expect.objectContaining({ inputTokens: 40, outputTokens: 20 }), month: "2026-10" });

    // At every model call (gateway), with the reason.
    const adapter = { id: "openai", label: "fake", capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false }, stream: vi.fn() } as unknown as ProviderAdapter;
    const providers = new ProviderRegistry();
    providers.register(adapter);
    const gateway = new ProviderGateway(providers, current.serverMode);
    const refused = await runInAccountScope({ userId: first.userId, sessionId: "s" }, () =>
      gateway.stream("openai", { model: "gpt-test", systemPrompt: "s", messages: [{ role: "user" as const, content: "q" }] } as never)
    ).catch((error: unknown) => error);
    expect((refused as ProviderGatewayError).message).toBe("TOKEN_LIMIT_REACHED:GLOBAL");
    expect(adapter.stream).not.toHaveBeenCalled();

    // 0: no global limit.
    await request(current.app).put("/api/server-mode/settings").set(admin).send({ globalMonthlyTokenLimit: 0 }).expect(200).expect((response) => expect(response.body.globalMonthlyTokenLimit).toBeNull());
    await request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${first.token}`).send(execBody()).expect(200);

    // The next UTC month starts from zero.
    await request(current.app).put("/api/server-mode/settings").set(admin).send({ globalMonthlyTokenLimit: 100 }).expect(200);
    current.clock.now = Date.parse("2026-11-01T00:00:01Z");
    await request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${second.token}`).send(execBody()).expect(200);
  });

  it("answers a refusal raised inside the turn with the reason", async () => {
    const current = fixture({
      execute: async () => {
        throw new ProviderGatewayError("ACCOUNT_POLICY", "TOKEN_LIMIT_REACHED:GLOBAL", "openai");
      }
    });
    const adminToken = await bootstrapAdmin(current);
    await enable(current, adminToken);
    await request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${adminToken}`).send(execBody()).expect(429, { error: "TOKEN_LIMIT_REACHED", reason: "GLOBAL" });
  });

  it("keeps plans without per-account keys", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "prawnik");
    await enable(current, adminToken);
    const plan = await request(current.app).post("/api/server-mode/plans").set("Authorization", `Bearer ${adminToken}`).send({ name: "P", monthlyTokenLimit: 10, allowedProviders: ["openai"], byokAllowed: true }).expect(201);
    expect(plan.body.plan).not.toHaveProperty("byokAllowed");
    const auth = { Authorization: `Bearer ${user.token}` };
    await request(current.app).put("/api/server-mode/me/keys/openai").set(auth).send({ apiKey: GLOBAL_KEY }).expect(404);
    await request(current.app).delete("/api/server-mode/me/keys/openai").set(auth).expect(404);
    const me = await request(current.app).get("/api/server-mode/me").set(auth).expect(200);
    expect(Object.keys(me.body).sort()).toEqual(["month", "plan", "usage"]);
  });
});

describe("global provider API keys", () => {
  it("are set by the admin only, used by every account and never returned", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const first = await createUser(current, adminToken, "pierwszy");
    const second = await createUser(current, adminToken, "drugi");
    const admin = { Authorization: `Bearer ${adminToken}` };
    const asUser = { Authorization: `Bearer ${first.token}` };

    // The admin may set the keys before turning the mode on.
    await request(current.app).put("/api/server-mode/provider-keys/openai").set(admin).send({ apiKey: "krotki" }).expect(400, { error: "INVALID_PROVIDER_API_KEY" });
    await request(current.app).put("/api/server-mode/provider-keys/openai").set(admin).send({ apiKey: "sk-z spacja-0123456789" }).expect(400, { error: "INVALID_PROVIDER_API_KEY" });
    await request(current.app).put("/api/server-mode/provider-keys/mistral").set(admin).send({ apiKey: GLOBAL_KEY }).expect(404, { error: "UNKNOWN_PROVIDER" });
    const saved = await request(current.app).put("/api/server-mode/provider-keys/openai").set(admin).send({ apiKey: GLOBAL_KEY }).expect(200);
    expect(saved.body.providerKeys).toEqual([
      { provider: "openai", configured: true, updatedAt: "2026-10-21T10:00:00.000Z" },
      { provider: "anthropic", configured: false, updatedAt: null },
      { provider: "xai", configured: false, updatedAt: null },
      { provider: "google", configured: false, updatedAt: null }
    ]);

    // Mode off: the firm's resolver answers as before.
    expect(await current.credentials.getApiKey("openai")).toBe(FIRM_KEY);

    await enable(current, adminToken);
    const firstSession = current.auth.authenticateAuthorization(`Bearer ${first.token}`);
    const secondSession = current.auth.authenticateAuthorization(`Bearer ${second.token}`);
    expect(await runInAccountScope({ userId: first.userId, sessionId: firstSession.session.sessionId }, () => current.credentials.getApiKey("openai"))).toBe(GLOBAL_KEY);
    expect(await runInAccountScope({ userId: second.userId, sessionId: secondSession.session.sessionId }, () => current.credentials.getApiKey("openai"))).toBe(GLOBAL_KEY);
    expect(await current.credentials.getApiKey("openai")).toBe(GLOBAL_KEY);
    expect(await current.credentials.getApiKey("anthropic")).toBeNull();

    // Sealed with the server key: the plaintext is in none of the server-mode files.
    for (const name of fs.readdirSync(current.serverModeDir)) {
      expect(fs.readFileSync(path.join(current.serverModeDir, name)).includes(GLOBAL_KEY)).toBe(false);
    }

    // Reads of every kind: status only.
    await configureMail(current, adminToken);
    for (const [url, auth] of [
      ["/api/server-mode/provider-keys", admin],
      ["/api/server-mode/settings", admin],
      ["/api/server-mode/accounts", admin],
      ["/api/server-mode/plans", admin],
      ["/api/server-mode/me", asUser],
      ["/api/providers", asUser],
      ["/api/providers", admin],
      ["/api/auth/me", asUser]
    ] as const) {
      await request(current.app).get(url).set(auth).expect(200);
    }
    const providers = await request(current.app).get("/api/providers").set(asUser).expect(200);
    expect(providers.body.providers).toContainEqual({ provider: "openai", configured: true });

    // Deleted: back to the container's environment key.
    const cleared = await request(current.app).delete("/api/server-mode/provider-keys/openai").set(admin).expect(200);
    expect(cleared.body.providerKeys[0]).toEqual({ provider: "openai", configured: false, updatedAt: null });
    expect(await current.credentials.getApiKey("openai")).toBe(FIRM_KEY);
  });

  it("cannot be read or changed by a user, nor through the desktop key routes in server mode", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "zwykly");
    const admin = { Authorization: `Bearer ${adminToken}` };
    const asUser = { Authorization: `Bearer ${user.token}` };

    // Mode off: the desktop routes as before (admin only).
    await request(current.app).put("/api/admin/providers/openai/credential").set(asUser).send({ apiKey: GLOBAL_KEY }).expect(403);
    await request(current.app).put("/api/admin/providers/anthropic/credential").set(admin).send({ apiKey: GLOBAL_KEY }).expect(200);
    expect(await current.credentials.getApiKey("anthropic")).toBe(GLOBAL_KEY);
    await request(current.app).delete("/api/admin/providers/anthropic/credential").set(admin).expect(200);

    await enable(current, adminToken);
    for (const auth of [asUser, admin]) {
      await request(current.app).put("/api/admin/providers/openai/credential").set(auth).send({ apiKey: GLOBAL_KEY }).expect(403, { error: "SERVER_MODE_LOCAL_ONLY" });
      await request(current.app).delete("/api/admin/providers/openai/credential").set(auth).expect(403, { error: "SERVER_MODE_LOCAL_ONLY" });
    }
    await request(current.app).get("/api/server-mode/provider-keys").set(asUser).expect(403, { error: "AUTHORIZATION_DENIED" });
    await request(current.app).put("/api/server-mode/provider-keys/openai").set(asUser).send({ apiKey: GLOBAL_KEY }).expect(403, { error: "AUTHORIZATION_DENIED" });
    await request(current.app).delete("/api/server-mode/provider-keys/openai").set(asUser).expect(403, { error: "AUTHORIZATION_DENIED" });
    expect(await current.credentials.getApiKey("openai")).toBe(FIRM_KEY);
    const keys = await request(current.app).get("/api/server-mode/provider-keys").set(admin).expect(200);
    expect(keys.body.providerKeys.every((item: { configured: boolean }) => !item.configured)).toBe(true);

    // SMTP password: "set", never the value (the response scan checks it).
    await configureMail(current, adminToken);
    const settings = await request(current.app).get("/api/server-mode/settings").set(admin).expect(200);
    expect(settings.body.smtp.passwordSet).toBe(true);
  });
});

describe("server mode store", () => {
  it("drops the per-account keys and the plans' BYOK flag of an older database", () => {
    const dir = tempDir("lex-server-mode-old-");
    const old = new DatabaseSync(path.join(dir, "server-mode.sqlite"));
    old.exec(`
      CREATE TABLE plans (plan_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, monthly_token_limit INTEGER, allowed_providers TEXT NOT NULL,
        byok_allowed INTEGER NOT NULL CHECK (byok_allowed IN (0,1)), external_subscription_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL) STRICT;
      INSERT INTO plans VALUES ('plan_a', 'Stary', 10, '["openai"]', 1, NULL, '2026-01-01', '2026-01-01');
      CREATE TABLE byok_keys (user_id TEXT NOT NULL, provider TEXT NOT NULL, nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, tag BLOB NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY (user_id, provider)) STRICT;
    `);
    old.close();
    const store = new ServerModeStore(dir);
    try {
      expect(store.listPlans()).toEqual([expect.objectContaining({ planId: "plan_a", name: "Stary", monthlyTokenLimit: 10 })]);
      expect(store.listPlans()[0]).not.toHaveProperty("byokAllowed");
      store.putPlan({ ...store.listPlans()[0]!, name: "Nowy" });
      expect(store.getPlan("plan_a")?.name).toBe("Nowy");
    } finally {
      store.close();
    }
    const check = new DatabaseSync(path.join(dir, "server-mode.sqlite"));
    expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'byok_keys'").get()).toBeUndefined();
    check.close();
  });
});

describe("admin authorization and case ownership", () => {
  it("refuses every admin route to a user", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "zwykly");
    await enable(current, adminToken);
    const auth = { Authorization: `Bearer ${user.token}` };
    for (const [method, url] of [
      ["get", "/api/server-mode/settings"],
      ["put", "/api/server-mode/settings"],
      ["put", "/api/server-mode/enabled"],
      ["post", "/api/server-mode/smtp/test"],
      ["get", "/api/server-mode/plans"],
      ["post", "/api/server-mode/plans"],
      ["put", "/api/server-mode/plans/plan_x"],
      ["delete", "/api/server-mode/plans/plan_x"],
      ["get", "/api/server-mode/accounts"],
      ["put", `/api/server-mode/accounts/${user.userId}/plan`],
      ["put", `/api/server-mode/accounts/${user.userId}/status`],
      ["get", "/api/server-mode/turns"],
      ["get", "/api/server-mode/provider-keys"],
      ["put", "/api/server-mode/provider-keys/openai"],
      ["delete", "/api/server-mode/provider-keys/openai"]
    ] as const) {
      await request(current.app)[method](url).set(auth).send({ enabled: false, status: "DISABLED" }).expect(403);
      await request(current.app)[method](url).send({}).expect(401);
    }
  });

  it("lets the admin disable and enable an account", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "wylaczany");
    await enable(current, adminToken);
    await request(current.app).put(`/api/server-mode/accounts/${user.userId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "DISABLED" }).expect(200);
    await request(current.app).get("/api/auth/me").set("Authorization", `Bearer ${user.token}`).expect(401);
    await request(current.app).post("/api/auth/login").send({ loginName: "wylaczany", password: USER_PASSWORD }).expect(401);
    await request(current.app).put(`/api/server-mode/accounts/${user.userId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "ACTIVE" }).expect(200);
    await request(current.app).post("/api/auth/login").send({ loginName: "wylaczany", password: USER_PASSWORD }).expect(200);
  });

  it("does not let user B read or change user A's case", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const a = await createUser(current, adminToken, "uzytkownika");
    const b = await createUser(current, adminToken, "uzytkownikb");
    await enable(current, adminToken);
    const created = await request(current.app).post("/api/cases").set("Authorization", `Bearer ${a.token}`).send({ displayName: "Sprawa A" }).expect(201);
    const caseId = String(created.body.caseId);
    const asB = { Authorization: `Bearer ${b.token}` };

    const read = await request(current.app).get(`/api/cases/${caseId}`).set(asB);
    expect([403, 404]).toContain(read.status);
    expect(JSON.stringify(read.body)).not.toContain("Sprawa A");
    const list = await request(current.app).get("/api/cases").set(asB).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(caseId);
    const rename = await request(current.app).patch(`/api/cases/${caseId}`).set(asB).send({ displayName: "Przejęta" });
    expect([403, 404]).toContain(rename.status);
    const memory = await request(current.app).get(`/api/cases/${caseId}/memory`).set(asB);
    expect([403, 404, 503]).toContain(memory.status);
    await request(current.app).get(`/api/cases/${caseId}`).set("Authorization", `Bearer ${a.token}`).expect(200);
  });
});

describe("live view of turns", () => {
  it("shows the admin metadata of a running turn and never its content", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const current = fixture({
      execute: async (input) => {
        input.onStep?.("MODEL", "Jan Kowalski, ul. Tajna 5");
        started();
        await gate;
        return executionResult(input);
      }
    });
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "prawnik");
    await enable(current, adminToken);
    const plan = await request(current.app).post("/api/server-mode/plans").set("Authorization", `Bearer ${adminToken}`).send({ name: "P", monthlyTokenLimit: null, allowedProviders: ["openai"] }).expect(201);
    await request(current.app).put(`/api/server-mode/accounts/${user.userId}/plan`).set("Authorization", `Bearer ${adminToken}`).send({ planId: plan.body.plan.planId }).expect(204);

    const turn = request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${user.token}`).send({ ...execBody(), query: "Jan Kowalski PESEL 85010112345 pozew" }).then((response) => response);
    await running;
    const live = await request(current.app).get("/api/server-mode/turns").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(live.body.turns).toEqual([
      expect.objectContaining({ userId: user.userId, loginName: "prawnik", skill: DR, stage: "MODEL", status: "RUNNING", caseId: null })
    ]);
    const serialized = JSON.stringify(live.body);
    for (const secret of ["Kowalski", "85010112345", "Tajna", "pozew"]) expect(serialized).not.toContain(secret);
    await request(current.app).get("/api/server-mode/turns").set("Authorization", `Bearer ${user.token}`).expect(403);

    release();
    expect((await turn).status).toBe(200);
    const done = await request(current.app).get("/api/server-mode/turns").set("Authorization", `Bearer ${adminToken}`).expect(200);
    expect(done.body.turns[0].status).toBe("DONE");
  });

  it("keeps the mode off exactly as before: no plan, no global limit or key, no turns recorded", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "prawnik");
    const admin = { Authorization: `Bearer ${adminToken}` };
    await request(current.app).put("/api/server-mode/settings").set(admin).send({ globalMonthlyTokenLimit: 1 }).expect(200);
    await request(current.app).put("/api/server-mode/provider-keys/openai").set(admin).send({ apiKey: GLOBAL_KEY }).expect(200);
    runInAccountScope({ userId: user.userId, sessionId: "s" }, () => current.serverMode.afterCall("openai", "gpt-test", { inputTokens: 5, outputTokens: 5 }));
    await request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${user.token}`).send(execBody()).expect(200);
    await request(current.app).post("/api/sessions/execute").set("Authorization", `Bearer ${user.token}`).send(execBody()).expect(200);
    expect(current.serverMode.liveTurns.list()).toEqual([]);
    expect(await current.credentials.getApiKey("openai")).toBe(FIRM_KEY);
    const settings = await request(current.app).get("/api/server-mode/settings").set(admin).expect(200);
    expect(settings.body.globalUsage.modelCalls).toBe(0);
  });
  it("administrator nie podlega planom (także planowi domyślnemu), tylko limitowi globalnemu", async () => {
    const current = fixture();
    const adminToken = await bootstrapAdmin(current);
    const user = await createUser(current, adminToken, "pracownik");
    await enable(current, adminToken);
    const admin = { Authorization: `Bearer ${adminToken}` };
    const plan = await request(current.app).post("/api/server-mode/plans").set(admin).send({ name: "Mały", monthlyTokenLimit: 10, allowedProviders: ["google"] }).expect(201);
    await request(current.app).put("/api/server-mode/settings").set(admin).send({ defaultPlanId: plan.body.plan.planId }).expect(200);
    const adminId = current.auth.authenticateAuthorization(`Bearer ${adminToken}`).user.userId;

    expect(() => current.serverMode.assertModelAllowed(user.userId, "openai", "gpt-test")).toThrow("PROVIDER_NOT_IN_PLAN");
    runInAccountScope({ userId: adminId, sessionId: "s" }, () => current.serverMode.afterCall("openai", "gpt-test", { inputTokens: 40, outputTokens: 20 }));
    expect(() => current.serverMode.assertModelAllowed(adminId, "openai", "gpt-test")).not.toThrow();
    await request(current.app).put(`/api/server-mode/accounts/${adminId}/plan`).set(admin).send({ planId: plan.body.plan.planId }).expect(409, { error: "ADMIN_HAS_NO_PLAN" });
    const accounts = await request(current.app).get("/api/server-mode/accounts").set(admin).expect(200);
    expect(accounts.body.accounts.find((item: { userId: string }) => item.userId === adminId)).toMatchObject({ planName: null, monthlyTokenLimit: null });
    const me = await request(current.app).get("/api/server-mode/me").set(admin).expect(200);
    expect(me.body.plan).toBeNull();

    await request(current.app).put("/api/server-mode/settings").set(admin).send({ globalMonthlyTokenLimit: 50 }).expect(200);
    expect(() => current.serverMode.assertModelAllowed(adminId, "openai", "gpt-test")).toThrow("TOKEN_LIMIT_REACHED:GLOBAL");
  });
});
