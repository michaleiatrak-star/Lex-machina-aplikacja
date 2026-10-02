import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAuthStore } from "../src/auth/store.js";
import { LocalAuthService } from "../src/auth/service.js";
import { AuthSessionManager } from "../src/auth/session-manager.js";
import { loadGoogleOAuthConfig } from "../src/google/config.js";
import {
  buildAuthorizationUrl,
  createPkcePair,
  validateIdTokenFromTokenEndpoint
} from "../src/google/oauth.js";
import { GoogleRecoveryController } from "../src/google/recovery-controller.js";
import { createLexHttpApp } from "../src/http/app.js";
import { LexSkillRegistry } from "../src/registry.js";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const roots: string[] = [];

afterEach(() => {
  while (roots.length) {
    fs.rmSync(roots.pop()!, { recursive: true, force: true });
  }
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
}

function claims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-sub-1",
    email: "jan@example.com",
    email_verified: true,
    iat: now,
    exp: now + 3600,
    nonce: "n1",
    ...overrides
  };
}

// Fake Google: token endpoint, Drive app folder and revocation.
function fakeGoogle(options: {
  sub?: string;
  scope?: string;
} = {}) {
  const drive = new Map<string, string>();
  const revoked: string[] = [];
  let nonce = "";
  let fileSeq = 0;
  const fetchImpl = vi.fn(
    async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      if (url.href === "https://oauth2.googleapis.com/token") {
        return Response.json({
          access_token: "access-1",
          id_token: idToken(
            claims({ nonce, sub: options.sub ?? "google-sub-1" })
          ),
          scope:
            options.scope ??
            "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.appdata",
          expires_in: 3599
        });
      }
      if (url.href === "https://oauth2.googleapis.com/revoke") {
        revoked.push(String(init?.body));
        return new Response(null, { status: 200 });
      }
      if (url.pathname === "/upload/drive/v3/files") {
        const body = String(init?.body);
        expect(body).toContain('"parents":["appDataFolder"]');
        const content = body
          .split("\r\n\r\n")[2]!
          .split("\r\n--")[0]!;
        const id = `file-${++fileSeq}`;
        drive.set(id, content);
        return Response.json({ id });
      }
      const match = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (match && init?.method === "DELETE") {
        drive.delete(match[1]!);
        return new Response(null, { status: 204 });
      }
      if (match) {
        const content = drive.get(match[1]!);
        return content
          ? new Response(content)
          : new Response(null, { status: 404 });
      }
      throw new Error(`unexpected ${input}`);
    }
  );
  return {
    drive,
    revoked,
    fetch: fetchImpl,
    setNonceFromUrl(authorizationUrl: string) {
      nonce = new URL(authorizationUrl).searchParams.get("nonce")!;
      return new URL(authorizationUrl).searchParams.get("state")!;
    }
  };
}

async function fixture(google = fakeGoogle()) {
  const root = tempDir("lex-google-");
  const auth = new LocalAuthService(
    new LocalAuthStore({ rootDir: root }),
    {
      sessionManager: new AuthSessionManager({
        scheduleExpiryTimers: false
      }),
      kdf: {
        memoryKiB: 1024,
        iterations: 1,
        parallelism: 1,
        keyLength: 32,
        version: 1
      }
    }
  );
  const owner = await auth.bootstrap({
    loginName: "jan",
    displayName: "Jan",
    password: "Pierwsze-haslo-2026"
  });
  const controller = new GoogleRecoveryController(auth, {
    fetch: google.fetch,
    loadConfig: () => ({ clientId: CLIENT_ID })
  });
  return { auth, owner, controller, google };
}

async function umkDigest(
  auth: LocalAuthService,
  sessionId: string
): Promise<string> {
  return await auth.withSessionUserMasterKey(sessionId, (key) =>
    createHash("sha256").update(key).digest("hex")
  );
}

async function link(current: Awaited<ReturnType<typeof fixture>>) {
  const start = await current.controller.startLink(
    current.owner,
    "Pierwsze-haslo-2026",
    "http://127.0.0.1:4317/oauth/google/callback"
  );
  const state = current.google.setNonceFromUrl(start.authorizationUrl);
  expect(
    await current.controller.handleCallback({ state, code: "c1" })
  ).toBe(true);
  return current.controller.result(start.flowId, start.flowToken);
}

async function recover(
  current: Awaited<ReturnType<typeof fixture>>,
  loginName = "jan"
) {
  const start = current.controller.startRecovery(
    loginName,
    "Nowe-haslo-po-odzyskaniu",
    "http://127.0.0.1:4317/oauth/google/callback"
  );
  const state = current.google.setNonceFromUrl(start.authorizationUrl);
  await current.controller.handleCallback({ state, code: "c2" });
  return current.controller.result(start.flowId, start.flowToken);
}

describe("Google OAuth config", () => {
  it("is off when nothing is configured", () => {
    expect(
      loadGoogleOAuthConfig(
        {},
        path.join(tempDir("lex-gcfg-"), "none.json"),
        "/nonexistent/bundled.json"
      )
    ).toBeNull();
  });

  it("reads the client JSON downloaded from Google Cloud", () => {
    const file = path.join(tempDir("lex-gcfg-"), "client.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        installed: { client_id: CLIENT_ID, client_secret: "s" }
      })
    );
    expect(loadGoogleOAuthConfig({}, file)).toEqual({
      clientId: CLIENT_ID,
      clientSecret: "s"
    });
  });

  it("falls back to the client bundled with the app", () => {
    const bundled = path.join(tempDir("lex-gcfg-"), "bundled.json");
    fs.writeFileSync(
      bundled,
      JSON.stringify({ installed: { client_id: "publisher-id" } })
    );
    expect(
      loadGoogleOAuthConfig({}, "/nonexistent/override.json", bundled)
    ).toEqual({ clientId: "publisher-id" });
  });

  it("prefers environment variables", () => {
    expect(
      loadGoogleOAuthConfig(
        { LEX_GOOGLE_OAUTH_CLIENT_ID: "env-id" },
        "/nonexistent"
      )
    ).toEqual({ clientId: "env-id" });
  });
});

describe("Google OAuth primitives", () => {
  it("builds a PKCE S256 request without merging earlier grants", () => {
    const pkce = createPkcePair();
    expect(pkce.challenge).toBe(
      createHash("sha256").update(pkce.verifier).digest("base64url")
    );
    const url = new URL(
      buildAuthorizationUrl({
        config: { clientId: CLIENT_ID },
        redirectUri: "http://127.0.0.1:1/cb",
        scopes: ["openid", "email"],
        state: "s",
        nonce: "n",
        codeChallenge: pkce.challenge
      })
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("scope")).toBe("openid email");
  });

  it.each([
    ["wrong audience", { aud: "other" }],
    ["wrong nonce", { nonce: "x" }],
    ["wrong issuer", { iss: "https://evil.example" }],
    ["expired", { exp: 1000 }],
    ["unverified email", { email_verified: false }]
  ])("rejects an ID token with %s", (_label, override) => {
    expect(() =>
      validateIdTokenFromTokenEndpoint({
        idToken: idToken(claims(override)),
        clientId: CLIENT_ID,
        nonce: "n1",
        nowMs: Date.now()
      })
    ).toThrow("GOOGLE_ID_TOKEN_INVALID");
  });

  it("accepts a valid ID token", () => {
    expect(
      validateIdTokenFromTokenEndpoint({
        idToken: idToken(claims()),
        clientId: CLIENT_ID,
        nonce: "n1",
        nowMs: Date.now()
      })
    ).toEqual({ sub: "google-sub-1", email: "jan@example.com" });
  });
});

describe("Google account recovery", () => {
  it("links, then recovers with a new password and the same master key", async () => {
    const current = await fixture();
    const before = await umkDigest(
      current.auth,
      current.owner.session.sessionId
    );

    const linked = await link(current);
    expect(linked).toMatchObject({
      status: "DONE",
      result: { googleEmail: "jan@example.com" }
    });
    expect(current.google.drive.size).toBe(1);
    expect(current.google.revoked.length).toBe(1);
    expect(current.controller.status(current.owner).recovery)
      .toMatchObject({ googleEmail: "jan@example.com" });

    const recovered = await recover(current);
    expect(recovered.status).toBe("DONE");
    const session = (recovered as any).result;
    expect(await umkDigest(current.auth, session.session.sessionId))
      .toBe(before);

    await expect(
      current.auth.login({
        loginName: "jan",
        password: "Pierwsze-haslo-2026"
      })
    ).rejects.toThrow();
    await expect(
      current.auth.login({
        loginName: "jan",
        password: "Nowe-haslo-po-odzyskaniu"
      })
    ).resolves.toBeTruthy();
  });

  it("rejects a different Google account", async () => {
    const current = await fixture();
    await link(current);
    const other = await fixture(fakeGoogle({ sub: "google-sub-2" }));
    // Same auth store, different Google identity.
    const controller = new GoogleRecoveryController(current.auth, {
      fetch: other.google.fetch,
      loadConfig: () => ({ clientId: CLIENT_ID })
    });
    const result = await recover({ ...current, controller, google: other.google });
    expect(result).toEqual({
      status: "FAILED",
      error: "INVALID_RECOVERY_CREDENTIALS"
    });
  });

  it("fails when the Drive app folder scope was not granted", async () => {
    const current = await fixture(
      fakeGoogle({ scope: "openid email" })
    );
    const start = await current.controller.startLink(
      current.owner,
      "Pierwsze-haslo-2026",
      "http://127.0.0.1:1/cb"
    );
    const state = current.google.setNonceFromUrl(start.authorizationUrl);
    expect(await current.controller.handleCallback({ state, code: "c" }))
      .toBe(false);
    expect(current.controller.result(start.flowId, start.flowToken))
      .toEqual({ status: "FAILED", error: "GOOGLE_SCOPE_DENIED" });
    expect(current.google.drive.size).toBe(0);
    expect(current.controller.status(current.owner).recovery).toBeNull();
  });

  it("stops working after unlink", async () => {
    const current = await fixture();
    await link(current);
    await current.controller.unlink(current.owner, "Pierwsze-haslo-2026");
    expect((await recover(current)).status).toBe("FAILED");
  });

  it("does not reveal unknown logins at start and fails at the end", async () => {
    const current = await fixture();
    await link(current);
    expect((await recover(current, "nikt")).status).toBe("FAILED");
  });

  it("returns a finished flow once and only with its token", async () => {
    const current = await fixture();
    const start = current.controller.startRecovery(
      "jan",
      "Nowe-haslo-po-odzyskaniu",
      "http://127.0.0.1:1/cb"
    );
    expect(() => current.controller.result(start.flowId, "zly"))
      .toThrow("GOOGLE_FLOW_NOT_FOUND");
    expect(current.controller.result(start.flowId, start.flowToken))
      .toEqual({ status: "PENDING" });
    expect(await current.controller.handleCallback({ state: "obcy", code: "x" }))
      .toBe(false);
  });

  it("is reported as not configured without a client", async () => {
    const current = await fixture();
    const controller = new GoogleRecoveryController(current.auth, {
      loadConfig: () => null
    });
    expect(() =>
      controller.startRecovery("jan", "Nowe-haslo-po-odzyskaniu", "x")
    ).toThrow("GOOGLE_NOT_CONFIGURED");
  });
});

describe("Google recovery HTTP routes", () => {
  it("serves the callback and recovery start without a session", async () => {
    const current = await fixture();
    const skills = tempDir("lex-google-skills-");
    const registry = new LexSkillRegistry(skills);
    registry.scan();
    const app = createLexHttpApp({
      registry,
      modelCatalog: { list: vi.fn(async () => []) },
      authService: current.auth,
      googleRecovery: current.controller
    });

    expect(
      (await request(app).get("/api/auth/google-recovery/available").expect(200))
        .body
    ).toEqual({ configured: true });

    const start = await request(app)
      .post("/api/auth/google-recovery/start")
      .send({ loginName: "jan", newPassword: "Nowe-haslo-po-odzyskaniu" })
      .expect(201);
    const redirect = new URL(start.body.authorizationUrl).searchParams.get(
      "redirect_uri"
    )!;
    expect(redirect).toMatch(
      /^http:\/\/(127\.0\.0\.1|\[::1\]):\d+\/oauth\/google\/callback$/
    );

    await request(app)
      .get("/oauth/google/callback?state=nieznany&code=x")
      .expect(400);
    await request(app).get("/api/google/status").expect(401);
  });
});
