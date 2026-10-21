import { createHash, randomBytes } from "node:crypto";
import type { LocalAuthService } from "../auth/service.js";
import { AuthError } from "../auth/service.js";
import { decryptUserMasterKey, derivePasswordKey, isValidEmailLogin, normalizeLoginName, validateNewPassword } from "../auth/crypto.js";
import type { AuthenticatedContext, PublicLocalUser, StoredLocalUser } from "../auth/types.js";
import type { ModelCallGuard } from "../providers/gateway.js";
import { isAccountSessionModel } from "../providers/account-session.js";
import type { ProviderId, ProviderStreamResult } from "../providers/types.js";
import { currentAccountScope, type AccountScope } from "./account-scope.js";
import { LiveTurnRegistry } from "./live-turns.js";
import {
  openWithUserMasterKey,
  sealWithUserMasterKey,
  sealedFromJson,
  sealedToJson,
  type ServerSecretBox
} from "./secret-box.js";
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

export type ServerSettingsView = {
  serverMode: boolean;
  forced: boolean;
  publicBaseUrl: string;
  defaultPlanId: string | null;
  smtp: SmtpSettingsView | null;
  mailConfigured: boolean;
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
 * token limits, per-account API keys (BYOK) and the admin's live view of turns.
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
    return {
      serverMode: this.isEnabled(),
      forced: this.forced !== null,
      publicBaseUrl: this.publicBaseUrl(),
      defaultPlanId: this.store.getSetting("default_plan_id"),
      smtp: smtp ? { ...smtp, passwordSet: this.store.getSetting("smtp_password") !== null } : null,
      mailConfigured: this.mailConfigured()
    };
  }

  updateSettings(
    actor: AuthenticatedContext,
    input: {
      publicBaseUrl?: unknown;
      defaultPlanId?: unknown;
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
    input: { name?: unknown; monthlyTokenLimit?: unknown; allowedProviders?: unknown; byokAllowed?: unknown; externalSubscriptionId?: unknown }
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
      !providers.every((item) => typeof item === "string" && (PROVIDERS as string[]).includes(item)) ||
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
      byokAllowed: input.byokAllowed === true,
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
    if (!this.auth.getUser(userId)) throw new ServerModeError("USER_NOT_FOUND", 404);
    if (planId && !this.store.getPlan(planId)) throw new ServerModeError("PLAN_NOT_FOUND", 404);
    this.store.setAccountPlan(userId, planId, new Date(this.now()).toISOString());
  }

  /** The account's plan, else the default plan of new accounts; null: none. */
  effectivePlan(userId: string): PlanRecord | null {
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
    plan: Pick<PlanRecord, "name" | "monthlyTokenLimit" | "allowedProviders" | "byokAllowed"> | null;
    usage: MonthlyUsage;
    month: string;
    byok: Array<{ provider: string; updatedAt: string }>;
  } {
    const plan = this.effectivePlan(actor.user.userId);
    const month = monthOf(this.now());
    return {
      plan: plan ? { name: plan.name, monthlyTokenLimit: plan.monthlyTokenLimit, allowedProviders: plan.allowedProviders, byokAllowed: plan.byokAllowed } : null,
      usage: this.store.getUsage(actor.user.userId, month),
      month,
      // Which providers have a key, never the key.
      byok: this.store.listByokProviders(actor.user.userId)
    };
  }

  // ---- BYOK ----

  private byokAllowed(userId: string): boolean {
    const plan = this.effectivePlan(userId);
    if (plan) return plan.byokAllowed;
    return this.auth.getUser(userId)?.appRole === "ADMIN";
  }

  async setByok(actor: AuthenticatedContext, provider: string, apiKey: unknown): Promise<void> {
    this.requireMode();
    if (!(PROVIDERS as string[]).includes(provider)) throw new ServerModeError("UNKNOWN_PROVIDER", 404);
    if (!this.byokAllowed(actor.user.userId)) throw new ServerModeError("BYOK_NOT_ALLOWED", 403);
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (key.length < 10 || key.length > 8192 || /[\r\n\s]/.test(key)) throw new ServerModeError("INVALID_PROVIDER_API_KEY", 400);
    const userId = actor.user.userId;
    const sealed = await this.auth.withSessionUserMasterKey(actor.session.sessionId, (userMasterKey) =>
      sealWithUserMasterKey(userMasterKey, userId, `byok:${provider}`, key)
    );
    this.store.putByok(userId, provider, sealed, new Date(this.now()).toISOString());
  }

  clearByok(actor: AuthenticatedContext, provider: string): void {
    if (!(PROVIDERS as string[]).includes(provider)) throw new ServerModeError("UNKNOWN_PROVIDER", 404);
    this.store.deleteByok(actor.user.userId, provider);
  }

  /** The account's own key for the provider (scope of a request), else null. */
  async accountApiKey(scope: AccountScope, provider: ProviderId): Promise<string | null> {
    if (!this.isEnabled() || !this.byokAllowed(scope.userId)) return null;
    const sealed = this.store.getByok(scope.userId, provider);
    if (!sealed) return null;
    try {
      return await this.auth.withSessionUserMasterKey(scope.sessionId, (userMasterKey) =>
        openWithUserMasterKey(userMasterKey, scope.userId, `byok:${provider}`, sealed)
      );
    } catch {
      return null;
    }
  }

  // ---- model calls (ModelCallGuard) ----

  /** Throws a reason code when the account may not call a model now. */
  assertModelAllowed(userId: string, providerId: ProviderId | null, model: string): void {
    if (!this.isEnabled()) return;
    if (providerId && model && isAccountSessionModel(providerId, model)) throw new Error("SERVER_MODE_LOCAL_ONLY");
    if (model.startsWith("account/")) throw new Error("SERVER_MODE_LOCAL_ONLY");
    const plan = this.effectivePlan(userId);
    if (!plan) {
      if (this.auth.getUser(userId)?.appRole === "ADMIN") return;
      throw new Error("PLAN_REQUIRED");
    }
    if (providerId && model && !model.startsWith("local/") && !plan.allowedProviders.includes(providerId)) {
      throw new Error("PROVIDER_NOT_IN_PLAN");
    }
    if (plan.monthlyTokenLimit !== null) {
      const usage = this.store.getUsage(userId, monthOf(this.now()));
      if (usage.inputTokens + usage.outputTokens >= plan.monthlyTokenLimit) throw new Error("TOKEN_LIMIT_REACHED");
    }
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
