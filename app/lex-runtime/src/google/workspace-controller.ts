import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuthenticatedContext } from "../auth/types.js";
import { GOOGLE_SCOPES, GOOGLE_TOKEN_ENDPOINT, loadGoogleOAuthConfig, type GoogleOAuthClientConfig } from "./config.js";
import {
  buildAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  GoogleOAuthError,
  randomUrlToken,
  revokeGoogleToken,
  validateIdTokenFromTokenEndpoint,
  type FetchLike
} from "./oauth.js";
import { GoogleIntegrationError, type GoogleFlowResult, type GoogleFlowStart } from "./recovery-controller.js";

// A user's Google account connected for reading: the Gmail threads and the Drive files the
// user picks go into a case as files. Read-only scopes only; the app never sends mail or
// changes a file. The refresh token is kept encrypted with a key derived from the user's
// master key (it exists only while the user is signed in), never in clear on the disk.

export const WORKSPACE_SCOPES = [...GOOGLE_SCOPES.identity, ...GOOGLE_SCOPES.gmailRead, ...GOOGLE_SCOPES.driveRead];
const FORMAT = "lex-machina-google-workspace-v1";
const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_FLOWS = 8;

export type GoogleWorkspaceStatus = {
  configured: boolean;
  connected: boolean;
  email?: string;
  gmail: boolean;
  drive: boolean;
  connectedAt?: string;
};

export type GoogleWorkspaceAuth = {
  withSessionUserMasterKey<T>(sessionId: string, callback: (userMasterKey: Buffer) => T | Promise<T>): Promise<T>;
};

type Flow = {
  flowId: string;
  flowToken: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
  status: "PENDING" | "DONE" | "FAILED";
  error?: string;
  result?: GoogleWorkspaceStatus;
};

type StoredAccount = {
  format: typeof FORMAT;
  userId: string;
  email: string;
  sub: string;
  scopes: string[];
  connectedAt: string;
  nonce: string;
  ciphertext: string;
  tag: string;
};

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

// A key of its own for this purpose: the master key itself never encrypts integration data.
function accountKey(userMasterKey: Buffer, userId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", userMasterKey, Buffer.from(userId, "utf8"), Buffer.from(FORMAT, "utf8"), 32));
}

export class GoogleWorkspaceController {
  private readonly flows = new Map<string, Flow>();
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly loadConfig: () => GoogleOAuthClientConfig | null;

  constructor(
    private readonly auth: GoogleWorkspaceAuth,
    private readonly rootDir: string,
    options: { fetch?: FetchLike; now?: () => number; loadConfig?: () => GoogleOAuthClientConfig | null } = {}
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? (() => Date.now());
    this.loadConfig = options.loadConfig ?? (() => loadGoogleOAuthConfig());
  }

  get fetch(): FetchLike {
    return this.fetchImpl;
  }

  private config(): GoogleOAuthClientConfig {
    let config: GoogleOAuthClientConfig | null = null;
    try {
      config = this.loadConfig();
    } catch {
      config = null;
    }
    if (!config) throw new GoogleIntegrationError("GOOGLE_NOT_CONFIGURED", 503);
    return config;
  }

  isConfigured(): boolean {
    try {
      return this.loadConfig() !== null;
    } catch {
      return false;
    }
  }

  private file(userId: string): string {
    if (!/^[A-Za-z0-9_-]{1,80}$/u.test(userId)) throw new GoogleIntegrationError("GOOGLE_USER_INVALID", 400);
    return path.join(this.rootDir, "google-workspace", `${userId}.json`);
  }

  private async stored(userId: string): Promise<StoredAccount | null> {
    try {
      const parsed = JSON.parse(await readFile(this.file(userId), "utf8")) as StoredAccount;
      return parsed.format === FORMAT && parsed.userId === userId ? parsed : null;
    } catch {
      return null;
    }
  }

  private view(account: StoredAccount | null): GoogleWorkspaceStatus {
    return {
      configured: this.isConfigured(),
      connected: Boolean(account),
      gmail: Boolean(account?.scopes.some((scope) => (GOOGLE_SCOPES.gmailRead as readonly string[]).includes(scope))),
      drive: Boolean(account?.scopes.some((scope) => (GOOGLE_SCOPES.driveRead as readonly string[]).includes(scope))),
      ...(account ? { email: account.email, connectedAt: account.connectedAt } : {})
    };
  }

  async status(actor: AuthenticatedContext): Promise<GoogleWorkspaceStatus> {
    return this.view(await this.stored(actor.user.userId));
  }

  private purgeExpired(): void {
    const now = this.now();
    for (const [id, flow] of this.flows) if (flow.expiresAt <= now) this.flows.delete(id);
  }

  startConnect(actor: AuthenticatedContext, redirectUri: string): GoogleFlowStart {
    const config = this.config();
    this.purgeExpired();
    if ([...this.flows.values()].filter((flow) => flow.status === "PENDING").length >= MAX_PENDING_FLOWS) {
      throw new GoogleIntegrationError("GOOGLE_TOO_MANY_PENDING_FLOWS", 429);
    }
    const pkce = createPkcePair();
    const flow: Flow = {
      flowId: randomUrlToken(16),
      flowToken: randomUrlToken(),
      state: randomUrlToken(),
      nonce: randomUrlToken(),
      codeVerifier: pkce.verifier,
      redirectUri,
      userId: actor.user.userId,
      sessionId: actor.session.sessionId,
      expiresAt: this.now() + FLOW_TTL_MS,
      status: "PENDING"
    };
    this.flows.set(flow.flowId, flow);
    return {
      flowId: flow.flowId,
      flowToken: flow.flowToken,
      authorizationUrl: buildAuthorizationUrl({
        config,
        redirectUri,
        scopes: WORKSPACE_SCOPES,
        state: flow.state,
        nonce: flow.nonce,
        codeChallenge: pkce.challenge,
        offline: true
      })
    };
  }

  /** The browser's return from Google: true/false for its page, null when the state is not ours. */
  async handleCallback(query: { state?: unknown; code?: unknown; error?: unknown }): Promise<boolean | null> {
    this.purgeExpired();
    const state = typeof query.state === "string" ? query.state : "";
    const flow = [...this.flows.values()].find((item) => item.status === "PENDING" && state.length > 0 && sameToken(item.state, state));
    if (!flow) return null;
    const fail = (code: string): false => {
      flow.status = "FAILED";
      flow.error = code;
      return false;
    };
    if (typeof query.code !== "string" || query.error) return fail("GOOGLE_CONSENT_DENIED");
    try {
      const config = this.config();
      const tokens = await exchangeAuthorizationCode({
        fetch: this.fetchImpl,
        config,
        code: query.code,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri
      });
      if (!tokens.idToken) return fail("GOOGLE_ID_TOKEN_INVALID");
      const identity = validateIdTokenFromTokenEndpoint({ idToken: tokens.idToken, clientId: config.clientId, nonce: flow.nonce, nowMs: this.now() });
      if (!tokens.refreshToken) {
        await revokeGoogleToken(this.fetchImpl, tokens.accessToken);
        return fail("GOOGLE_REFRESH_TOKEN_MISSING");
      }
      // Granular consent: the user may untick Gmail or Drive; one of them is enough.
      const granted = tokens.scopes.filter((scope) => (WORKSPACE_SCOPES as readonly string[]).includes(scope));
      if (!granted.some((scope) => scope.includes("gmail") || scope.includes("drive"))) {
        await revokeGoogleToken(this.fetchImpl, tokens.refreshToken);
        return fail("GOOGLE_SCOPE_DENIED");
      }
      const refreshToken = tokens.refreshToken;
      const account = await this.auth.withSessionUserMasterKey(flow.sessionId, (userMasterKey) => {
        const key = accountKey(userMasterKey, flow.userId);
        try {
          const nonce = randomBytes(12);
          const cipher = createCipheriv("aes-256-gcm", key, nonce);
          cipher.setAAD(Buffer.from(`${FORMAT}:${flow.userId}`, "utf8"));
          const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
          return {
            format: FORMAT,
            userId: flow.userId,
            email: identity.email,
            sub: identity.sub,
            scopes: granted,
            connectedAt: new Date(this.now()).toISOString(),
            nonce: nonce.toString("base64"),
            ciphertext: ciphertext.toString("base64"),
            tag: cipher.getAuthTag().toString("base64")
          } satisfies StoredAccount;
        } finally {
          key.fill(0);
        }
      });
      const file = this.file(flow.userId);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, JSON.stringify(account), { mode: 0o600 });
      this.accessTokens.set(flow.userId, { token: tokens.accessToken, expiresAt: this.now() + Math.max(0, tokens.expiresIn - 60) * 1000 });
      flow.result = this.view(account);
      flow.status = "DONE";
      return true;
    } catch (error) {
      return fail(error instanceof GoogleOAuthError || error instanceof GoogleIntegrationError ? error.code : "GOOGLE_FLOW_FAILED");
    }
  }

  result(flowId: string, flowToken: string): GoogleFlowResult<GoogleWorkspaceStatus> {
    this.purgeExpired();
    const flow = this.flows.get(flowId);
    if (!flow || !sameToken(flow.flowToken, flowToken)) throw new GoogleIntegrationError("GOOGLE_FLOW_NOT_FOUND", 404);
    if (flow.status === "PENDING") return { status: "PENDING" };
    this.flows.delete(flowId);
    if (flow.status === "FAILED" || !flow.result) return { status: "FAILED", error: flow.error ?? "GOOGLE_FLOW_FAILED" };
    return { status: "DONE", result: flow.result };
  }

  private async refreshToken(actor: AuthenticatedContext, account: StoredAccount): Promise<string> {
    return await this.auth.withSessionUserMasterKey(actor.session.sessionId, (userMasterKey) => {
      const key = accountKey(userMasterKey, account.userId);
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(account.nonce, "base64"));
        decipher.setAAD(Buffer.from(`${FORMAT}:${account.userId}`, "utf8"));
        decipher.setAuthTag(Buffer.from(account.tag, "base64"));
        return Buffer.concat([decipher.update(Buffer.from(account.ciphertext, "base64")), decipher.final()]).toString("utf8");
      } catch {
        throw new GoogleIntegrationError("GOOGLE_ACCOUNT_UNREADABLE", 409);
      } finally {
        key.fill(0);
      }
    });
  }

  /** A current access token of the user's connected account (refreshed when it expired). */
  async accessToken(actor: AuthenticatedContext): Promise<string> {
    const userId = actor.user.userId;
    const cached = this.accessTokens.get(userId);
    if (cached && cached.expiresAt > this.now()) return cached.token;
    const account = await this.stored(userId);
    if (!account) throw new GoogleIntegrationError("GOOGLE_NOT_CONNECTED", 409);
    const config = this.config();
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: await this.refreshToken(actor, account), client_id: config.clientId });
    if (config.clientSecret) body.set("client_secret", config.clientSecret);
    let response: Response;
    try {
      response = await this.fetchImpl(GOOGLE_TOKEN_ENDPOINT, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
    } catch {
      throw new GoogleIntegrationError("GOOGLE_NETWORK_ERROR", 502);
    }
    // invalid_grant: the user revoked the access or the test app's week ran out.
    if (!response.ok) throw new GoogleIntegrationError("GOOGLE_RECONNECT_REQUIRED", 409);
    const json = (await response.json()) as Record<string, unknown>;
    if (typeof json.access_token !== "string") throw new GoogleIntegrationError("GOOGLE_RECONNECT_REQUIRED", 409);
    const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 3600;
    this.accessTokens.set(userId, { token: json.access_token, expiresAt: this.now() + Math.max(0, expiresIn - 60) * 1000 });
    return json.access_token;
  }

  async disconnect(actor: AuthenticatedContext): Promise<GoogleWorkspaceStatus> {
    const userId = actor.user.userId;
    const account = await this.stored(userId);
    if (account) {
      try {
        await revokeGoogleToken(this.fetchImpl, await this.refreshToken(actor, account));
      } catch {
        // The file goes anyway: the user wants the account gone from this app.
      }
      await rm(this.file(userId), { force: true });
    }
    this.accessTokens.delete(userId);
    return this.view(null);
  }
}
