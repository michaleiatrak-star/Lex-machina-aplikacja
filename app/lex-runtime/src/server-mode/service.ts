import { createHash, randomBytes } from "node:crypto";
import type { LocalAuthService } from "../auth/service.js";
import { AuthError } from "../auth/service.js";
import { decryptUserMasterKey, derivePasswordKey, isValidEmailLogin, normalizeLoginName, validateNewPassword } from "../auth/crypto.js";
import type { AuthenticatedContext, PublicLocalUser, StoredLocalUser } from "../auth/types.js";
import type { ModelCallGuard } from "../providers/gateway.js";
import { isAccountSessionModel } from "../providers/account-session.js";
import type { ProviderId, ProviderStreamResult } from "../providers/types.js";
import { currentAccountScope } from "./account-scope.js";
import { LiveTurnRegistry } from "./live-turns.js";
import { sealedFromJson, sealedToJson, type ServerSecretBox } from "./secret-box.js";
import { SmtpMailTransport, validMailAddress, type MailTransport, type SmtpSettings } from "./smtp.js";
import type { MonthlyUsage, PlanRecord, ServerModeStore } from "./store.js";

export class ServerModeError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = "ServerModeError";
  }
}

export const PROVIDERS: ProviderId[] = ["openai", "anthropic", "xai", "google"];

function isProvider(value: string): value is ProviderId {
  return (PROVIDERS as string[]).includes(value);
}

// Reason codes of a refused model call (message of the guard's error, "CODE" or "CODE:REASON").
const POLICY_STATUS: Record<string, number> = {
  TOKEN_LIMIT_REACHED: 429,
  PLAN_REQUIRED: 402,
  PROVIDER_NOT_IN_PLAN: 403,
  SERVER_MODE_LOCAL_ONLY: 403
};

/** HTTP answer to a model call refused by the account policy; TOKEN_LIMIT_REACHED carries reason GLOBAL or PLAN. */
export function accountPolicyResponse(message: string): { status: number; body: { error: string; reason?: string } } {
  const [code = "", reason] = message.split(":", 2);
  const status = POLICY_STATUS[code];
  if (!status) return { status: 403, body: { error: "ACCOUNT_POLICY_DENIED" } };
  return { status, body: reason ? { error: code, reason } : { error: code } };
}
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Per IP and per e-mail address (fixed windows; buckets are hashed, no raw address is stored).
export const EMAIL_RATE_LIMITS = {
  register: { ip: 10, email: 3, windowMs: HOUR_MS },
  reset: { ip: 10, email: 3, windowMs: HOUR_MS },
  token: { ip: 30, windowMs: HOUR_MS },
  verifyPassword: { registration: 5, windowMs: HOUR_MS },
  login: { ip: 30, windowMs: 15 * 60 * 1000 }
} as const;

type AuthDependency = Pick<
  LocalAuthService,
  | "prepareAccount"
  | "insertPreparedAccount"
  | "findUserByLogin"
  | "getUser"
  | "resetPasswordWithUserMasterKey"
  | "withSessionUserMasterKey"
  | "listUsers"
>;

export type SmtpSettingsView = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  passwordSet: boolean;
};

// Dostęp przez przeglądarkę: LOCAL — tylko z tego komputera (127.0.0.1, domyślnie),
// NETWORK — także z sieci, z zabezpieczeniami (tylko w trybie serwerowym).
export type NetworkAccess = "LOCAL" | "NETWORK";
// Strona w przeglądarce: HTTPS (domyślnie) albo HTTP.
export type BrowserProtocol = "HTTPS" | "HTTP";

export type ServerSettingsView = {
  serverMode: boolean;
  forced: boolean;
  networkAccess: NetworkAccess;
  browserProtocol: BrowserProtocol;
  publicBaseUrl: string;
  defaultPlanId: string | null;
  smtp: SmtpSettingsView | null;
  mailConfigured: boolean;
  // Sum over all accounts in the UTC month; null: no global limit.
  globalMonthlyTokenLimit: number | null;
  globalUsage: MonthlyUsage;
  month: string;
};

/** Whether the admin set a key for the provider; the key itself never leaves the server. */
export type ProviderKeyView = {
  provider: ProviderId;
  configured: boolean;
  updatedAt: string | null;
};

export type AccountView = PublicLocalUser & {
  emailVerified: boolean;
  planId: string | null;
  planName: string | null;
  usage: MonthlyUsage;
  monthlyTokenLimit: number | null;
};

type StoredSmtp = Omit<SmtpSettingsView, "passwordSet">;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function totalTokens(usage: MonthlyUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

function bucket(...parts: string[]): string {
  return sha256(parts.join("\u0000")).toString("hex");
}

export function monthOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 7);
}

function requireAdmin(actor: AuthenticatedContext): void {
  if (actor.user.appRole !== "ADMIN") throw new ServerModeError("AUTHORIZATION_DENIED", 403);
}

function forcedMode(value: string | undefined): boolean | null {
  const raw = value?.trim().toLowerCase() ?? "";
  if (/^(on|1|true)$/.test(raw)) return true;
  if (/^(off|0|false)$/.test(raw)) return false;
  return null;
}

/**
 * Server mode (one runtime per firm, accounts registered by e-mail): the
 * switch, SMTP, registration and password reset by e-mail, plans with monthly
 * token limits, a global monthly limit, the admin's global provider API keys
 * and the admin's live view of turns.
 * With the mode off nothing here changes how the runtime behaves.
 */
export class ServerModeService implements ModelCallGuard {
  readonly liveTurns: LiveTurnRegistry;
  private readonly forced: boolean | null;

  constructor(
    private readonly store: ServerModeStore,
    private readonly box: ServerSecretBox,
    private readonly auth: AuthDependency,
    private readonly options: {
      now?: () => number;
      // Tests: a transport instead of SMTP.
      mailTransport?: (settings: SmtpSettings) => MailTransport;
      forceEnv?: string | undefined;
    } = {}
  ) {
    this.forced = forcedMode(options.forceEnv);
    this.liveTurns = new LiveTurnRegistry(() => this.now());
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  isEnabled(): boolean {
    return this.forced ?? this.store.getSetting("server_mode") === "1";
  }

  setEnabled(actor: AuthenticatedContext, enabled: boolean): ServerSettingsView {
    requireAdmin(actor);
    if (this.forced !== null) throw new ServerModeError("SERVER_MODE_FORCED", 409);
    this.store.setSetting("server_mode", enabled ? "1" : "0");
    // Bez trybu serwerowego dostęp z sieci się zamyka.
    if (!enabled) this.store.setSetting("network_access", "LOCAL");
    return this.settings(actor);
  }

  networkAccess(): NetworkAccess {
    return this.isEnabled() && this.store.getSetting("network_access") === "NETWORK" ? "NETWORK" : "LOCAL";
  }

  browserProtocol(): BrowserProtocol {
    return this.store.getSetting("browser_protocol") === "HTTP" ? "HTTP" : "HTTPS";
  }

  setBrowserProtocol(actor: AuthenticatedContext, protocol: BrowserProtocol): ServerSettingsView {
    requireAdmin(actor);
    this.store.setSetting("browser_protocol", protocol);
    return this.settings(actor);
  }

  setNetworkAccess(actor: AuthenticatedContext, mode: NetworkAccess): ServerSettingsView {
    requireAdmin(actor);
    if (mode === "NETWORK" && !this.isEnabled()) throw new ServerModeError("SERVER_MODE_REQUIRED", 409);
    this.store.setSetting("network_access", mode);
    return this.settings(actor);
  }

  // ---- settings and SMTP ----

  private storedSmtp(): StoredSmtp | null {
    const raw = this.store.getSetting("smtp");
    return raw ? (JSON.parse(raw) as StoredSmtp) : null;
  }

  private publicBaseUrl(): string {
    return this.store.getSetting("public_base_url") ?? process.env.LEX_PUBLIC_BASE_URL?.trim() ?? "";
  }

  mailConfigured(): boolean {
    const smtp = this.storedSmtp();
    return Boolean(smtp?.host && smtp.from && this.publicBaseUrl());
  }

  settings(actor: AuthenticatedContext): ServerSettingsView {
    requireAdmin(actor);
    const smtp = this.storedSmtp();
    const month = monthOf(this.now());
    return {
      serverMode: this.isEnabled(),
      forced: this.forced !== null,
      networkAccess: this.networkAccess(),
      browserProtocol: this.browserProtocol(),
      publicBaseUrl: this.publicBaseUrl(),
      defaultPlanId: this.store.getSetting("default_plan_id"),
      smtp: smtp ? { ...smtp, passwordSet: this.store.getSetting("smtp_password") !== null } : null,
      mailConfigured: this.mailConfigured(),
      globalMonthlyTokenLimit: this.globalMonthlyTokenLimit(),
      globalUsage: this.store.getTotalUsage(month),
      month
    };
  }

  updateSettings(
    actor: AuthenticatedContext,
    input: {
      publicBaseUrl?: unknown;
      defaultPlanId?: unknown;
      globalMonthlyTokenLimit?: unknown;
      smtp?: { host?: unknown; port?: unknown; secure?: unknown; user?: unknown; from?: unknown; password?: unknown; clearPassword?: unknown };
    }
  ): ServerSettingsView {
    requireAdmin(actor);
    if (input.publicBaseUrl !== undefined) {
      const value = typeof input.publicBaseUrl === "string" ? input.publicBaseUrl.trim().replace(/\/+$/, "") : "";
      if (value) {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          throw new ServerModeError("INVALID_PUBLIC_BASE_URL", 400);
        }
        if (url.protocol !== "https:" && url.protocol !== "http:") throw new ServerModeError("INVALID_PUBLIC_BASE_URL", 400);
      }
      this.store.setSetting("public_base_url", value || null);
    }
    if (input.defaultPlanId !== undefined) {
      const planId = typeof input.defaultPlanId === "string" && input.defaultPlanId ? input.defaultPlanId : null;
      if (planId && !this.store.getPlan(planId)) throw new ServerModeError("PLAN_NOT_FOUND", 404);
      this.store.setSetting("default_plan_id", planId);
    }
    if (input.globalMonthlyTokenLimit !== undefined) {
      // 0, empty or null: no global limit.
      const raw = input.globalMonthlyTokenLimit;
      const limit = raw === null || raw === "" ? 0 : Number(raw);
      if (!Number.isSafeInteger(limit) || limit < 0) throw new ServerModeError("INVALID_GLOBAL_TOKEN_LIMIT", 400);
      this.store.setSetting("global_monthly_token_limit", limit > 0 ? String(limit) : null);
    }
    if (input.smtp) {
      const smtp = input.smtp;
      const host = typeof smtp.host === "string" ? smtp.host.trim() : "";
      const port = Number(smtp.port);
      const user = typeof smtp.user === "string" ? smtp.user.trim() : "";
      const from = typeof smtp.from === "string" ? smtp.from.trim() : "";
      if (
        !/^[A-Za-z0-9.-]{1,253}$|^\[?[0-9a-fA-F:.]+\]?$/.test(host) ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        !validMailAddress(from) ||
        user.length > 256 ||
        /[\r\n]/.test(user)
      ) {
        throw new ServerModeError("INVALID_SMTP_SETTINGS", 400);
      }
      this.store.setSetting("smtp", JSON.stringify({ host, port, secure: smtp.secure === true, user, from } satisfies StoredSmtp));
      if (smtp.clearPassword === true) {
        this.store.setSetting("smtp_password", null);
      } else if (typeof smtp.password === "string" && smtp.password) {
        if (smtp.password.length > 1024 || /[\r\n]/.test(smtp.password)) throw new ServerModeError("INVALID_SMTP_SETTINGS", 400);
        this.store.setSetting("smtp_password", sealedToJson(this.box.seal("smtp-password", "smtp", smtp.password)));
      }
    }
    return this.settings(actor);
  }

  private globalMonthlyTokenLimit(): number | null {
    const raw = this.store.getSetting("global_monthly_token_limit");
    const limit = raw === null ? 0 : Number(raw);
    return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
  }

  // ---- global provider API keys (admin) ----

  providerKeys(actor: AuthenticatedContext): ProviderKeyView[] {
    requireAdmin(actor);
    const stored = new Map(this.store.listProviderKeys().map((item) => [item.provider, item.updatedAt]));
    return PROVIDERS.map((provider) => ({ provider, configured: stored.has(provider), updatedAt: stored.get(provider) ?? null }));
  }

  setProviderKey(actor: AuthenticatedContext, provider: string, apiKey: unknown): ProviderKeyView[] {
    requireAdmin(actor);
    if (!isProvider(provider)) throw new ServerModeError("UNKNOWN_PROVIDER", 404);
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (key.length < 10 || key.length > 8192 || /\s/.test(key)) throw new ServerModeError("INVALID_PROVIDER_API_KEY", 400);
    this.store.putProviderKey(provider, this.box.seal("provider-api-key", provider, key), new Date(this.now()).toISOString());
    return this.providerKeys(actor);
  }

  clearProviderKey(actor: AuthenticatedContext, provider: string): ProviderKeyView[] {
    requireAdmin(actor);
    if (!isProvider(provider)) throw new ServerModeError("UNKNOWN_PROVIDER", 404);
    this.store.deleteProviderKey(provider);
    return this.providerKeys(actor);
  }

  /** The admin's key for the provider, used by every account in server mode; null: not set. */
  globalApiKey(provider: ProviderId): string | null {
    const sealed = this.store.getProviderKey(provider);
    if (!sealed) return null;
    try {
      return this.box.open("provider-api-key", provider, sealed).toString("utf8");
    } catch {
      process.stderr.write(`SERVER_MODE_PROVIDER_KEY_UNREADABLE:${provider}\n`);
      return null;
    }
  }

  private transport(): MailTransport {
    const smtp = this.storedSmtp();
    if (!smtp || !this.mailConfigured()) throw new ServerModeError("MAIL_NOT_CONFIGURED", 503);
    const sealedPassword = this.store.getSetting("smtp_password");
    const settings: SmtpSettings = {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      user: smtp.user || undefined,
      password: sealedPassword ? this.box.open("smtp-password", "smtp", sealedFromJson(sealedPassword)).toString("utf8") : undefined,
      from: smtp.from
    };
    return this.options.mailTransport?.(settings) ?? new SmtpMailTransport(settings);
  }

  async sendTestMail(actor: AuthenticatedContext, to: string): Promise<void> {
    requireAdmin(actor);
    if (!validMailAddress(to)) throw new ServerModeError("INVALID_EMAIL", 400);
    await this.deliver(this.transport(), {
      to,
      subject: "Lex Machina: test poczty",
      text: "To jest wiadomość testowa z Lex Machina. Ustawienia SMTP działają."
    });
  }

  private async deliver(transport: MailTransport, message: { to: string; subject: string; text: string }): Promise<void> {
    try {
      await transport.send(message);
    } catch (error) {
      process.stderr.write(`SERVER_MODE_MAIL_FAILED:${error instanceof Error ? error.message.split(":", 1)[0] : "UNKNOWN"}\n`);
      throw new ServerModeError("MAIL_DELIVERY_FAILED", 502);
    }
  }

  // ---- rate limits ----

  private limit(action: string, key: string, limit: number, windowMs: number): void {
    const result = this.store.hit(bucket(action, key), limit, windowMs, this.now());
    if (!result.allowed) throw new ServerModeError("RATE_LIMITED", 429, Math.max(1, Math.ceil(result.retryAfterMs / 1000)));
  }

  limitLogin(ip: string): void {
    this.limit("login:ip", ip, EMAIL_RATE_LIMITS.login.ip, EMAIL_RATE_LIMITS.login.windowMs);
  }

  private requireMode(): void {
    if (!this.isEnabled()) throw new ServerModeError("SERVER_MODE_DISABLED", 404);
  }

  private issueToken(purpose: "VERIFY" | "RESET", subject: string, ttlMs: number): string {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    this.store.purgeExpiredTokens(now);
    this.store.invalidateTokens(purpose, subject, now);
    this.store.putToken(sha256(token), purpose, subject, now + ttlMs, now);
    return token;
  }

  private link(kind: "weryfikacja" | "reset-hasla", token: string): string {
    return `${this.publicBaseUrl()}/#${kind}=${token}`;
  }

  // ---- registration ----

  /** Always the same answer whether or not the address has an account. */
  async register(input: { email?: unknown; displayName?: unknown; password?: unknown }, ip: string): Promise<void> {
    this.requireMode();
    const email = typeof input.email === "string" ? normalizeLoginName(input.email.slice(0, 256)) : "";
    const displayName = typeof input.displayName === "string" && input.displayName.trim() ? input.displayName : email.split("@")[0] ?? "";
    const password = typeof input.password === "string" ? input.password : "";
    if (!isValidEmailLogin(email) || !validMailAddress(email)) throw new ServerModeError("INVALID_EMAIL", 400);
    try {
      validateNewPassword(password);
    } catch (error) {
      throw new ServerModeError(error instanceof Error && error.message === "PASSWORD_POLICY_COMMON" ? "PASSWORD_TOO_COMMON" : "PASSWORD_TOO_SHORT", 400);
    }
    const transport = this.transport();
    this.limit("register:ip", ip, EMAIL_RATE_LIMITS.register.ip, EMAIL_RATE_LIMITS.register.windowMs);
    this.limit("register:email", email, EMAIL_RATE_LIMITS.register.email, EMAIL_RATE_LIMITS.register.windowMs);

    // The password KDF runs for a taken address too (no timing difference).
    let prepared: { user: StoredLocalUser; extra: string };
    try {
      prepared = await this.auth.prepareAccount({ loginName: email, displayName, password }, (userId, userMasterKey) =>
        sealedToJson(this.box.seal("umk-escrow", userId, userMasterKey))
      );
    } catch (error) {
      if (error instanceof AuthError) throw new ServerModeError("INVALID_REGISTRATION", 400);
      throw error;
    }
    if (this.auth.findUserByLogin(email)) {
      await this.deliver(transport, {
        to: email,
        subject: "Lex Machina: konto już istnieje",
        text:
          "Ktoś (być może Ty) próbował założyć konto Lex Machina na ten adres, ale konto już istnieje.\n\n" +
          `Jeśli nie pamiętasz hasła, użyj opcji „Nie pamiętam hasła” na stronie ${this.publicBaseUrl()}.\n` +
          "Jeśli to nie Ty, zignoruj tę wiadomość."
      });
      return;
    }
    const pendingId = "pending_" + randomBytes(16).toString("hex");
    this.store.putPending({
      pendingId,
      normalizedEmail: email,
      userJson: serializeUser(prepared.user),
      escrow: sealedFromJson(prepared.extra),
      createdAt: new Date(this.now()).toISOString()
    });
    const token = this.issueToken("VERIFY", pendingId, VERIFY_TTL_MS);
    await this.deliver(transport, {
      to: email,
      subject: "Lex Machina: potwierdź adres e-mail",
      text:
        "Aby aktywować konto Lex Machina, otwórz link (ważny 24 godziny, jednorazowy):\n\n" +
        `${this.link("weryfikacja", token)}\n\n` +
        "Jeśli to nie Ty zakładałeś konto, zignoruj tę wiadomość."
    });
  }

  // The link alone does not activate the account: the password chosen at registration is
  // asked again. Someone who registers another person's address cannot click the link, and
  // the owner who clicks it cannot finish a registration made with someone else's password.
  async verifyEmail(input: { token?: unknown; password?: unknown }, ip: string): Promise<void> {
    this.requireMode();
    this.limit("token:ip", ip, EMAIL_RATE_LIMITS.token.ip, EMAIL_RATE_LIMITS.token.windowMs);
    const token = typeof input.token === "string" ? input.token.slice(0, 128) : "";
    const password = typeof input.password === "string" ? input.password : "";
    const tokenHash = token ? sha256(token) : null;
    const peeked = tokenHash ? this.store.peekToken(tokenHash, "VERIFY", this.now()) : null;
    const candidate = peeked ? this.store.getPending(peeked) : null;
    if (!candidate || !tokenHash) throw new ServerModeError("INVALID_OR_EXPIRED_TOKEN", 400);
    const user = deserializeUser(candidate.userJson);
    this.limit("verify:password", candidate.pendingId, EMAIL_RATE_LIMITS.verifyPassword.registration, EMAIL_RATE_LIMITS.verifyPassword.windowMs);
    try {
      decryptUserMasterKey(await derivePasswordKey(password, user.kdfSalt, user.kdf), user).fill(0);
    } catch {
      throw new ServerModeError("INVALID_PASSWORD", 400);
    }
    const pendingId = this.store.consumeToken(tokenHash, "VERIFY", this.now());
    const pending = pendingId === candidate.pendingId ? this.store.getPending(pendingId) : null;
    if (!pending) throw new ServerModeError("INVALID_OR_EXPIRED_TOKEN", 400);
    try {
      this.auth.insertPreparedAccount(user);
    } catch (error) {
      this.store.deletePending(pending.pendingId);
      if (error instanceof AuthError) throw new ServerModeError("INVALID_OR_EXPIRED_TOKEN", 400);
      throw error;
    }
    const now = new Date(this.now()).toISOString();
    this.store.putEscrow(user.userId, pending.escrow, now);
    this.store.setSetting(`verified:${user.userId}`, now);
    this.store.deletePending(pending.pendingId);
  }

  // ---- password reset ----

  async requestPasswordReset(input: { email?: unknown }, ip: string): Promise<void> {
    this.requireMode();
    const email = typeof input.email === "string" ? normalizeLoginName(input.email.slice(0, 256)) : "";
    if (!validMailAddress(email)) throw new ServerModeError("INVALID_EMAIL", 400);
    const transport = this.transport();
    this.limit("reset:ip", ip, EMAIL_RATE_LIMITS.reset.ip, EMAIL_RATE_LIMITS.reset.windowMs);
    this.limit("reset:email", email, EMAIL_RATE_LIMITS.reset.email, EMAIL_RATE_LIMITS.reset.windowMs);
    const user = this.auth.findUserByLogin(email);
    // No account, or a disabled one: the same answer and no e-mail.
    if (!user || user.status !== "ACTIVE") return;
    if (!this.store.getEscrow(user.userId)) {
      await this.deliver(transport, {
        to: email,
        subject: "Lex Machina: reset hasła",
        text:
          "Otrzymaliśmy prośbę o reset hasła. Dla tego konta reset przez e-mail nie jest jeszcze dostępny " +
          "(konto nie logowało się od włączenia trybu serwerowego). Użyj kodu odzyskiwania albo poproś administratora o pomoc."
      });
      return;
    }
    const token = this.issueToken("RESET", user.userId, RESET_TTL_MS);
    await this.deliver(transport, {
      to: email,
      subject: "Lex Machina: reset hasła",
      text:
        "Aby ustawić nowe hasło, otwórz link (ważny 1 godzinę, jednorazowy):\n\n" +
        `${this.link("reset-hasla", token)}\n\n` +
        "Po zmianie hasła wszystkie sesje konta zostaną wylogowane. Jeśli to nie Ty prosiłeś o reset, zignoruj tę wiadomość."
    });
  }

  async confirmPasswordReset(input: { token?: unknown; newPassword?: unknown }, ip: string): Promise<void> {
    this.requireMode();
    this.limit("token:ip", ip, EMAIL_RATE_LIMITS.token.ip, EMAIL_RATE_LIMITS.token.windowMs);
    const password = typeof input.newPassword === "string" ? input.newPassword : "";
    try {
      validateNewPassword(password);
    } catch (error) {
      throw new ServerModeError(error instanceof Error && error.message === "PASSWORD_POLICY_COMMON" ? "PASSWORD_TOO_COMMON" : "PASSWORD_TOO_SHORT", 400);
    }
    const token = typeof input.token === "string" ? input.token.slice(0, 128) : "";
    const userId = token ? this.store.consumeToken(sha256(token), "RESET", this.now()) : null;
    const escrow = userId ? this.store.getEscrow(userId) : null;
    if (!userId || !escrow) throw new ServerModeError("INVALID_OR_EXPIRED_TOKEN", 400);
    const userMasterKey = this.box.open("umk-escrow", userId, escrow);
    try {
      await this.auth.resetPasswordWithUserMasterKey(userId, password, userMasterKey);
    } catch (error) {
      if (error instanceof AuthError) throw new ServerModeError("INVALID_OR_EXPIRED_TOKEN", 400);
      throw error;
    } finally {
      userMasterKey.fill(0);
    }
    this.store.invalidateTokens("RESET", userId, this.now());
  }

  /**
   * After a login in server mode: the UMK escrow that makes a later password
   * reset by e-mail possible (accounts created before the mode was on).
   */
  async escrowFromSession(userId: string, sessionId: string): Promise<void> {
    if (!this.isEnabled() || this.store.getEscrow(userId)) return;
    const sealed = await this.auth.withSessionUserMasterKey(sessionId, (userMasterKey) => this.box.seal("umk-escrow", userId, userMasterKey));
    this.store.putEscrow(userId, sealed, new Date(this.now()).toISOString());
  }

  // ---- plans ----

  listPlans(actor: AuthenticatedContext): PlanRecord[] {
    requireAdmin(actor);
    return this.store.listPlans();
  }

  savePlan(
    actor: AuthenticatedContext,
    planId: string | null,
    input: { name?: unknown; monthlyTokenLimit?: unknown; allowedProviders?: unknown; externalSubscriptionId?: unknown }
  ): PlanRecord {
    requireAdmin(actor);
    const existing = planId ? this.store.getPlan(planId) : null;
    if (planId && !existing) throw new ServerModeError("PLAN_NOT_FOUND", 404);
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const limit = input.monthlyTokenLimit === null || input.monthlyTokenLimit === undefined || input.monthlyTokenLimit === "" ? null : Number(input.monthlyTokenLimit);
    const providers = Array.isArray(input.allowedProviders) ? input.allowedProviders : [];
    const external = typeof input.externalSubscriptionId === "string" && input.externalSubscriptionId.trim() ? input.externalSubscriptionId.trim() : null;
    if (
      !name ||
      name.length > 80 ||
      (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) ||
      !providers.every((item) => typeof item === "string" && isProvider(item)) ||
      (external !== null && external.length > 200)
    ) {
      throw new ServerModeError("INVALID_PLAN", 400);
    }
    const now = new Date(this.now()).toISOString();
    const plan: PlanRecord = {
      planId: existing?.planId ?? "plan_" + randomBytes(12).toString("hex"),
      name,
      monthlyTokenLimit: limit,
      allowedProviders: [...new Set(providers as string[])],
      externalSubscriptionId: external,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    try {
      this.store.putPlan(plan);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) throw new ServerModeError("PLAN_NAME_EXISTS", 409);
      throw error;
    }
    return plan;
  }

  deletePlan(actor: AuthenticatedContext, planId: string): void {
    requireAdmin(actor);
    if (this.store.planInUse(planId) || this.store.getSetting("default_plan_id") === planId) throw new ServerModeError("PLAN_IN_USE", 409);
    if (!this.store.deletePlan(planId)) throw new ServerModeError("PLAN_NOT_FOUND", 404);
  }

  assignPlan(actor: AuthenticatedContext, userId: string, planId: string | null): void {
    requireAdmin(actor);
    const user = this.auth.getUser(userId);
    if (!user) throw new ServerModeError("USER_NOT_FOUND", 404);
    // Administrator nie podlega planom.
    if (user.appRole === "ADMIN" && planId) throw new ServerModeError("ADMIN_HAS_NO_PLAN", 409);
    if (planId && !this.store.getPlan(planId)) throw new ServerModeError("PLAN_NOT_FOUND", 404);
    this.store.setAccountPlan(userId, planId, new Date(this.now()).toISOString());
  }

  /** The account's plan, else the default plan of new accounts; null: none (always for the admin). */
  effectivePlan(userId: string): PlanRecord | null {
    if (this.auth.getUser(userId)?.appRole === "ADMIN") return null;
    const assigned = this.store.getAccountPlanId(userId);
    const planId = assigned ?? this.store.getSetting("default_plan_id");
    return planId ? this.store.getPlan(planId) : null;
  }

  accounts(actor: AuthenticatedContext): AccountView[] {
    requireAdmin(actor);
    const month = monthOf(this.now());
    return this.auth.listUsers(actor).map((user) => {
      const plan = this.effectivePlan(user.userId);
      return {
        ...user,
        // Accounts registered by e-mail; those created by the admin are not "verified".
        emailVerified: this.store.getSetting(`verified:${user.userId}`) !== null,
        planId: this.store.getAccountPlanId(user.userId),
        planName: plan?.name ?? null,
        usage: this.store.getUsage(user.userId, month),
        monthlyTokenLimit: plan?.monthlyTokenLimit ?? null
      };
    });
  }

  myAccount(actor: AuthenticatedContext): {
    plan: Pick<PlanRecord, "name" | "monthlyTokenLimit"> | null;
    usage: MonthlyUsage;
    month: string;
  } {
    const plan = this.effectivePlan(actor.user.userId);
    const month = monthOf(this.now());
    return {
      plan: plan ? { name: plan.name, monthlyTokenLimit: plan.monthlyTokenLimit } : null,
      usage: this.store.getUsage(actor.user.userId, month),
      month
    };
  }

  // ---- model calls (ModelCallGuard) ----

  /** Throws a reason code when the account may not call a model now. */
  assertModelAllowed(userId: string, providerId: ProviderId | null, model: string): void {
    if (!this.isEnabled()) return;
    if (providerId && model && isAccountSessionModel(providerId, model)) throw new Error("SERVER_MODE_LOCAL_ONLY");
    if (model.startsWith("account/")) throw new Error("SERVER_MODE_LOCAL_ONLY");
    // Without a plan only the admin may call a model; the admin has no plan (still within the global limit).
    const plan = this.effectivePlan(userId);
    if (!plan && this.auth.getUser(userId)?.appRole !== "ADMIN") throw new Error("PLAN_REQUIRED");
    if (plan && providerId && model && !model.startsWith("local/") && !plan.allowedProviders.includes(providerId)) {
      throw new Error("PROVIDER_NOT_IN_PLAN");
    }
    const month = monthOf(this.now());
    if (plan && plan.monthlyTokenLimit !== null && totalTokens(this.store.getUsage(userId, month)) >= plan.monthlyTokenLimit) {
      throw new Error("TOKEN_LIMIT_REACHED:PLAN");
    }
    const globalLimit = this.globalMonthlyTokenLimit();
    if (globalLimit !== null && totalTokens(this.store.getTotalUsage(month)) >= globalLimit) throw new Error("TOKEN_LIMIT_REACHED:GLOBAL");
  }

  beforeCall(providerId: ProviderId, model: string): void {
    const scope = currentAccountScope();
    if (!scope) return;
    this.assertModelAllowed(scope.userId, providerId, model);
  }

  afterCall(_providerId: ProviderId, _model: string, usage: ProviderStreamResult["usage"] | null): void {
    const scope = currentAccountScope();
    if (!scope || !this.isEnabled()) return;
    try {
      this.store.addUsage(scope.userId, monthOf(this.now()), {
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
        cacheReadTokens: usage?.cacheReadTokens ?? 0,
        cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
        modelCalls: 1
      });
      if (scope.turnId) this.liveTurns.addTokens(scope.turnId, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0);
    } catch (error) {
      process.stderr.write(`SERVER_MODE_USAGE_RECORD_FAILED:${error instanceof Error ? error.message : "UNKNOWN"}\n`);
    }
  }

  close(): void {
    this.store.close();
    this.box.close();
  }
}

function serializeUser(user: StoredLocalUser): string {
  return JSON.stringify(user, (_key, value: unknown) =>
    value && typeof value === "object" && (value as { type?: unknown }).type === "Buffer" && Array.isArray((value as { data?: unknown }).data)
      ? { $b64: Buffer.from((value as { data: number[] }).data).toString("base64") }
      : value
  );
}

function deserializeUser(json: string): StoredLocalUser {
  return JSON.parse(json, (_key, value: unknown) =>
    value && typeof value === "object" && typeof (value as { $b64?: unknown }).$b64 === "string" ? Buffer.from((value as { $b64: string }).$b64, "base64") : value
  ) as StoredLocalUser;
}
