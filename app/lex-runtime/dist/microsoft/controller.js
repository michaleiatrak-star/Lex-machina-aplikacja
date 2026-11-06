import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPkcePair, randomUrlToken } from "../google/oauth.js";
import { loadMicrosoftOAuthConfig } from "./config.js";
import { buildMicrosoftAuthorizationUrl, exchangeMicrosoftCode, MicrosoftIntegrationError, refreshMicrosoftToken, validateMicrosoftIdToken } from "./oauth.js";
// A user's Microsoft 365 account connected for reading: OneDrive and SharePoint files the
// user picks go into a case. Read-only scopes; the app never changes a file. The refresh
// token is encrypted with a key derived from the user's master key (it exists only while
// the user is signed in), never kept in clear on the disk.
const FORMAT = "lex-machina-microsoft-v1";
const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_FLOWS = 8;
function sameToken(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}
function accountKey(userMasterKey, userId) {
    return Buffer.from(hkdfSync("sha256", userMasterKey, Buffer.from(userId, "utf8"), Buffer.from(FORMAT, "utf8"), 32));
}
export class MicrosoftController {
    auth;
    rootDir;
    flows = new Map();
    accessTokens = new Map();
    fetch;
    now;
    loadConfig;
    constructor(auth, rootDir, options = {}) {
        this.auth = auth;
        this.rootDir = rootDir;
        this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
        this.now = options.now ?? (() => Date.now());
        this.loadConfig = options.loadConfig ?? (() => loadMicrosoftOAuthConfig());
    }
    config() {
        let config = null;
        try {
            config = this.loadConfig();
        }
        catch {
            config = null;
        }
        if (!config)
            throw new MicrosoftIntegrationError("MICROSOFT_NOT_CONFIGURED", 503);
        return config;
    }
    isConfigured() {
        try {
            return this.loadConfig() !== null;
        }
        catch {
            return false;
        }
    }
    file(userId) {
        if (!/^[A-Za-z0-9_-]{1,80}$/u.test(userId))
            throw new MicrosoftIntegrationError("MICROSOFT_USER_INVALID", 400);
        return path.join(this.rootDir, "microsoft", `${userId}.json`);
    }
    async stored(userId) {
        try {
            const parsed = JSON.parse(await readFile(this.file(userId), "utf8"));
            return parsed.format === FORMAT && parsed.userId === userId ? parsed : null;
        }
        catch {
            return null;
        }
    }
    view(account) {
        return {
            configured: this.isConfigured(),
            connected: Boolean(account),
            sharepoint: Boolean(account?.scopes.some((scope) => /Sites\.Read\.All$/iu.test(scope))),
            ...(account ? { email: account.email, connectedAt: account.connectedAt } : {})
        };
    }
    async status(actor) {
        return this.view(await this.stored(actor.user.userId));
    }
    purgeExpired() {
        const now = this.now();
        for (const [id, flow] of this.flows)
            if (flow.expiresAt <= now)
                this.flows.delete(id);
    }
    startConnect(actor, redirectUri) {
        const config = this.config();
        this.purgeExpired();
        if ([...this.flows.values()].filter((flow) => flow.status === "PENDING").length >= MAX_PENDING_FLOWS) {
            throw new MicrosoftIntegrationError("MICROSOFT_TOO_MANY_PENDING_FLOWS", 429);
        }
        const pkce = createPkcePair();
        const flow = {
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
            authorizationUrl: buildMicrosoftAuthorizationUrl({ config, redirectUri, state: flow.state, nonce: flow.nonce, codeChallenge: pkce.challenge })
        };
    }
    async seal(sessionId, userId, refreshToken) {
        return await this.auth.withSessionUserMasterKey(sessionId, (userMasterKey) => {
            const key = accountKey(userMasterKey, userId);
            try {
                const nonce = randomBytes(12);
                const cipher = createCipheriv("aes-256-gcm", key, nonce);
                cipher.setAAD(Buffer.from(`${FORMAT}:${userId}`, "utf8"));
                const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
                return { nonce: nonce.toString("base64"), ciphertext: ciphertext.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
            }
            finally {
                key.fill(0);
            }
        });
    }
    async save(account) {
        const file = this.file(account.userId);
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(file, JSON.stringify(account), { mode: 0o600 });
    }
    /** The browser's return from Microsoft: true/false for its page, null when the state is not ours. */
    async handleCallback(query) {
        this.purgeExpired();
        const state = typeof query.state === "string" ? query.state : "";
        const flow = [...this.flows.values()].find((item) => item.status === "PENDING" && state.length > 0 && sameToken(item.state, state));
        if (!flow)
            return null;
        const fail = (code) => {
            flow.status = "FAILED";
            flow.error = code;
            return false;
        };
        if (typeof query.code !== "string" || query.error)
            return fail("MICROSOFT_CONSENT_DENIED");
        try {
            const config = this.config();
            const tokens = await exchangeMicrosoftCode({ fetch: this.fetch, config, code: query.code, codeVerifier: flow.codeVerifier, redirectUri: flow.redirectUri });
            if (!tokens.idToken)
                return fail("MICROSOFT_ID_TOKEN_INVALID");
            const identity = validateMicrosoftIdToken({ idToken: tokens.idToken, clientId: config.clientId, nonce: flow.nonce, nowMs: this.now() });
            if (!tokens.refreshToken)
                return fail("MICROSOFT_REFRESH_TOKEN_MISSING");
            if (!tokens.scopes.some((scope) => /Files\.Read\.All$/iu.test(scope)))
                return fail("MICROSOFT_SCOPE_DENIED");
            const account = {
                format: FORMAT,
                userId: flow.userId,
                email: identity.email,
                sub: identity.sub,
                tenantId: identity.tenantId,
                scopes: tokens.scopes.slice(0, 50),
                connectedAt: new Date(this.now()).toISOString(),
                ...(await this.seal(flow.sessionId, flow.userId, tokens.refreshToken))
            };
            await this.save(account);
            this.accessTokens.set(flow.userId, { token: tokens.accessToken, expiresAt: this.now() + Math.max(0, tokens.expiresIn - 60) * 1000 });
            flow.result = this.view(account);
            flow.status = "DONE";
            return true;
        }
        catch (error) {
            return fail(error instanceof MicrosoftIntegrationError ? error.code : "MICROSOFT_FLOW_FAILED");
        }
    }
    result(flowId, flowToken) {
        this.purgeExpired();
        const flow = this.flows.get(flowId);
        if (!flow || !sameToken(flow.flowToken, flowToken))
            throw new MicrosoftIntegrationError("MICROSOFT_FLOW_NOT_FOUND", 404);
        if (flow.status === "PENDING")
            return { status: "PENDING" };
        this.flows.delete(flowId);
        if (flow.status === "FAILED" || !flow.result)
            return { status: "FAILED", error: flow.error ?? "MICROSOFT_FLOW_FAILED" };
        return { status: "DONE", result: flow.result };
    }
    async refreshToken(actor, account) {
        return await this.auth.withSessionUserMasterKey(actor.session.sessionId, (userMasterKey) => {
            const key = accountKey(userMasterKey, account.userId);
            try {
                const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(account.nonce, "base64"));
                decipher.setAAD(Buffer.from(`${FORMAT}:${account.userId}`, "utf8"));
                decipher.setAuthTag(Buffer.from(account.tag, "base64"));
                return Buffer.concat([decipher.update(Buffer.from(account.ciphertext, "base64")), decipher.final()]).toString("utf8");
            }
            catch {
                throw new MicrosoftIntegrationError("MICROSOFT_ACCOUNT_UNREADABLE", 409);
            }
            finally {
                key.fill(0);
            }
        });
    }
    /** A current access token (refreshed when expired; Microsoft rotates the refresh token, kept sealed). */
    async accessToken(actor) {
        const userId = actor.user.userId;
        const cached = this.accessTokens.get(userId);
        if (cached && cached.expiresAt > this.now())
            return cached.token;
        const account = await this.stored(userId);
        if (!account)
            throw new MicrosoftIntegrationError("MICROSOFT_NOT_CONNECTED", 409);
        const tokens = await refreshMicrosoftToken(this.fetch, this.config(), await this.refreshToken(actor, account));
        if (tokens.refreshToken) {
            await this.save({ ...account, ...(await this.seal(actor.session.sessionId, userId, tokens.refreshToken)) });
        }
        this.accessTokens.set(userId, { token: tokens.accessToken, expiresAt: this.now() + Math.max(0, tokens.expiresIn - 60) * 1000 });
        return tokens.accessToken;
    }
    /** Forgets the account here (Microsoft has no per-app token revocation; the user can remove the app at myapps.microsoft.com). */
    async disconnect(actor) {
        await rm(this.file(actor.user.userId), { force: true });
        this.accessTokens.delete(actor.user.userId);
        return this.view(null);
    }
}
