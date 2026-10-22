import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import express, { type Request, type Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLexHttpApp, jsonErrorHandler } from "../src/http/app.js";
import { BrowserAccess, isLoopbackAddress, registerWebApp } from "../src/http/browser-access.js";
import { ensureCertificate } from "../src/http/tls-certificate.js";
import { LexSkillRegistry } from "../src/registry.js";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { LocalCaseFileStore } from "../src/case-file-store.js";
import { LocalCaseAccessService } from "../src/case-access.js";
import { MemoryOverlayCredentialResolver, StaticCredentialResolver } from "../src/providers/credentials.js";
import { ServerModeStore } from "../src/server-mode/store.js";
import { ServerSecretBox } from "../src/server-mode/secret-box.js";
import { ServerModeService } from "../src/server-mode/service.js";
import { ServerModeCredentialResolver } from "../src/server-mode/credentials.js";
import { localOnlyRoute, registerServerModeRoutes } from "../src/server-mode/routes.js";

const roots: string[] = [];
const accesses: BrowserAccess[] = [];
const ADMIN_PASSWORD = "Admin serwerowe haslo 2026";

afterEach(async () => {
  for (const access of accesses.splice(0)) await access.stop();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function registry(): LexSkillRegistry {
  const root = tempDir("lex-browser-skills-");
  fs.mkdirSync(path.join(root, "prawo-polskie-v2"), { recursive: true });
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "SKILL.md"), "---\nname: prawo-polskie-v2\n---\n# test\n");
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

async function fixture() {
  const root = tempDir("lex-browser-data-");
  const auth = new LocalAuthService(new LocalAuthStore({ rootDir: root }), {
    sessionManager: new AuthSessionManager({ scheduleExpiryTimers: false }),
    kdf: { memoryKiB: 1024, iterations: 1, parallelism: 1, keyLength: 32, version: 1 }
  });
  const files = new LocalCaseFileStore({ rootDir: root });
  const serverMode = new ServerModeService(
    new ServerModeStore(path.join(root, "server")),
    new ServerSecretBox({ keyPath: path.join(root, "server", "secret.key") }),
    auth
  );
  const environment = new StaticCredentialResolver({});
  const credentials = new ServerModeCredentialResolver(new MemoryOverlayCredentialResolver(environment), environment, serverMode);
  const coreApp = createLexHttpApp({
    registry: registry(),
    modelCatalog: { list: vi.fn(async () => []) },
    authService: auth,
    caseFileStore: files,
    caseAccessService: new LocalCaseAccessService(new LocalAuthStore({ rootDir: root }), auth, files),
    credentialResolver: credentials,
    credentialManager: credentials
  } as never);
  const web = tempDir("lex-browser-web-");
  fs.writeFileSync(path.join(web, "index.html"), "<!doctype html><html><head><title>Lex</title></head><body></body></html>");
  fs.writeFileSync(path.join(web, "app.js"), "console.log('lex')");

  const app = express();
  const access = new BrowserAccess(app, 0);
  accesses.push(access);
  app.use(access.guard(localOnlyRoute));
  app.use(express.json());
  registerServerModeRoutes(app, { authService: auth, serverMode, browserAccess: access });
  registerWebApp(app, web);
  app.use(coreApp);
  app.use(jsonErrorHandler);
  await access.start();
  return { access, serverMode };
}

function call(
  port: number,
  pathname: string,
  options: { method?: string; host?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        agent: false,
        path: pathname,
        method: options.method ?? "GET",
        headers: {
          host: options.host ?? `127.0.0.1:${port}`,
          ...(payload ? { "content-type": "application/json" } : {}),
          ...options.headers
        }
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function adminToken(port: number): Promise<string> {
  const response = await call(port, "/api/auth/bootstrap", {
    method: "POST",
    body: { loginName: "admin", displayName: "Admin", password: ADMIN_PASSWORD }
  });
  expect(response.status).toBe(201);
  return String(JSON.parse(response.body).sessionToken);
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !check(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20));
  expect(check()).toBe(true);
}

describe("aplikacja w przeglądarce", () => {
  it("podaje stronę aplikacji z adresem API tej samej strony, a /api zostaje API", async () => {
    const { access } = await fixture();
    const page = await call(access.listeningPort, "/sprawy/123");
    expect(page.status).toBe(200);
    expect(page.body).toContain('<meta name="lex-api-base" content="same-origin" />');
    expect(String(page.headers["content-security-policy"])).not.toContain("upgrade-insecure-requests");
    expect((await call(access.listeningPort, "/app.js")).body).toContain("console.log");
    expect((await call(access.listeningPort, "/api/nie-ma-takiej-sciezki")).body).not.toContain("<html");
  });

  it("w trybie lokalnym (domyślnym) odrzuca obce nazwy hostów i adresy IP z sieci", async () => {
    const { access } = await fixture();
    expect(access.networkAccess).toBe("LOCAL");
    expect(access.addresses()).toEqual([`http://127.0.0.1:${access.listeningPort}`]);
    for (const host of ["zly.example:80", `10.9.8.7:${access.listeningPort}`]) {
      const response = await call(access.listeningPort, "/", { host });
      expect(response.status).toBe(403);
      expect(JSON.parse(response.body).error).toBe("HOST_NOT_ALLOWED");
    }
    const managed = await call(access.listeningPort, "/api/auth/bootstrap-managed", { method: "POST", body: {} });
    expect(JSON.parse(managed.body).error).toBe("NOT_AVAILABLE_IN_BROWSER");
  });

  it("dostęp z sieci: tylko w trybie serwerowym, zmiana tylko z tego komputera, powrót do lokalnego po wyłączeniu", async () => {
    const { access } = await fixture();
    const port = access.listeningPort;
    const token = await adminToken(port);
    const auth = { authorization: `Bearer ${token}` };

    const withoutServerMode = await call(port, "/api/server-mode/network", { method: "PUT", headers: auth, body: { mode: "NETWORK" } });
    expect(JSON.parse(withoutServerMode.body).error).toBe("SERVER_MODE_REQUIRED");

    expect((await call(port, "/api/server-mode/enabled", { method: "PUT", headers: auth, body: { enabled: true } })).status).toBe(200);
    const proxied = await call(port, "/api/server-mode/network", {
      method: "PUT",
      headers: { ...auth, "x-forwarded-for": "203.0.113.5" },
      body: { mode: "NETWORK" }
    });
    expect(JSON.parse(proxied.body).error).toBe("NETWORK_CHANGE_LOCAL_ONLY");

    const opened = await call(port, "/api/server-mode/network", { method: "PUT", headers: auth, body: { mode: "NETWORK" } });
    expect(opened.status).toBe(200);
    expect(JSON.parse(opened.body).networkAccess).toBe("NETWORK");
    await until(() => access.networkAccess === "NETWORK" && access.state === "LISTENING");
    expect(access.listeningPort).toBe(port);

    // Adres IP w sieci i ta sama strona (Origin = Host) przechodzą.
    const lanHost = `10.9.8.7:${port}`;
    expect((await call(port, "/", { host: lanHost })).status).toBe(200);
    // Kontrola pochodzenia aplikacji (ta sama co w serwerze) przed trasami spraw.
    const sameOrigin = await call(port, "/api/cases", {
      method: "POST",
      host: lanHost,
      headers: { ...auth, origin: `http://${lanHost}` },
      body: {}
    });
    expect(sameOrigin.body).not.toContain("ORIGIN_NOT_ALLOWED");
    const foreign = await call(port, "/api/cases", {
      method: "POST",
      host: lanHost,
      headers: { ...auth, origin: "http://zly.example" },
      body: {}
    });
    expect(JSON.parse(foreign.body).error).toBe("ORIGIN_NOT_ALLOWED");
    expect((await call(port, "/", { host: "zly.example" })).status).toBe(403);

    const settings = JSON.parse((await call(port, "/api/server-mode/settings", { headers: auth })).body);
    expect(settings.browser).toMatchObject({ state: "LISTENING", networkAccess: "NETWORK", port });

    expect((await call(port, "/api/server-mode/enabled", { method: "PUT", headers: auth, body: { enabled: false } })).status).toBe(200);
    await until(() => access.networkAccess === "LOCAL");
    expect((await call(port, "/", { host: lanHost })).status).toBe(403);
  });

  it("połączenia z sieci: bez dostępu z sieci odrzucone, z dostępem bez funkcji komputera serwera", async () => {
    const access = new BrowserAccess(express(), 0);
    accesses.push(access);
    await access.start();
    const guard = access.guard(localOnlyRoute);
    const socket = { remoteAddress: "192.168.1.20" };
    // Gniazdo spoza nasłuchu nie podlega tej kontroli; tu sprawdzamy decyzję dla gniazda strony.
    vi.spyOn(access, "isBrowserSocket").mockReturnValue(true);
    const run = (pathname: string, method = "GET") => {
      const req = { socket, path: pathname, method, body: {}, get: (name: string) => (name === "host" ? "192.168.1.5:4317" : undefined) } as unknown as Request;
      let status = 0;
      let body: unknown;
      const res = { status: (code: number) => ({ json: (value: unknown) => ((status = code), (body = value)) }) } as unknown as Response;
      let passed = false;
      guard(req, res, () => (passed = true));
      return { status, body, passed };
    };
    expect(run("/api/cases").body).toEqual({ error: "NETWORK_ACCESS_DISABLED" });
    await access.setMode("NETWORK");
    expect(run("/api/cases").passed).toBe(true);
    expect(run("/api/provider-accounts/status").body).toEqual({ error: "NOT_AVAILABLE_IN_BROWSER" });
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.20")).toBe(false);
  });
});

describe("HTTPS strony aplikacji", () => {
  function get(url: string, ca?: string): Promise<{ status: number; body: string; location?: string }> {
    return new Promise((resolve, reject) => {
      const target = new URL(url);
      const client = target.protocol === "https:" ? https : http;
      const req = client.request(
        { host: target.hostname, port: target.port, path: target.pathname, method: "GET", agent: false, ...(ca ? { ca } : {}) },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body, ...(res.headers.location ? { location: res.headers.location } : {}) }));
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  it("certyfikat aplikacji obejmuje localhost, 127.0.0.1 i nazwy od administratora; ponownie użyty, nowy przy nowej nazwie", () => {
    const dir = tempDir("lex-tls-");
    const first = ensureCertificate(dir, ["localhost", "127.0.0.1", "::1"]);
    const certificate = new crypto.X509Certificate(first.cert);
    expect(certificate.verify(certificate.publicKey)).toBe(true);
    expect(certificate.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(certificate.checkHost("localhost")).toBe("localhost");
    expect(first.custom).toBe(false);
    expect(ensureCertificate(dir, ["localhost", "127.0.0.1"]).fingerprint256).toBe(first.fingerprint256);
    const renamed = ensureCertificate(dir, ["localhost", "127.0.0.1", "serwer.kancelaria"]);
    expect(renamed.fingerprint256).not.toBe(first.fingerprint256);
    expect(new crypto.X509Certificate(renamed.cert).checkHost("serwer.kancelaria")).toBe("serwer.kancelaria");
  });

  it("HTTPS na tym samym porcie: strona przez https://, http:// przechodzi na https://, API lokalnie także po HTTP", async () => {
    const dir = tempDir("lex-tls-");
    const material = ensureCertificate(dir, ["localhost", "127.0.0.1"]);
    const app = express();
    app.get("/health", (_req, res) => res.json({ status: "ok" }));
    app.get("/", (_req, res) => res.send("strona"));
    const access = new BrowserAccess(app, 0, () => "", "127.0.0.1", () => material);
    accesses.push(access);
    await access.start();
    const port = access.listeningPort;
    expect(access.protocol).toBe("https");
    expect(access.addresses()).toEqual([`https://127.0.0.1:${port}`]);
    expect(await get(`https://127.0.0.1:${port}/`, material.cert)).toMatchObject({ status: 200, body: "strona" });
    expect(await get(`http://127.0.0.1:${port}/`)).toMatchObject({ status: 308, location: `https://127.0.0.1:${port}/` });
    expect((await get(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    await expect(get(`https://127.0.0.1:${port}/`)).rejects.toThrow(/self[- ]signed|certificate/i);
    expect(access.certificate()).not.toHaveProperty("key");
  });
});
