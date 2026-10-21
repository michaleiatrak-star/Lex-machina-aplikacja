import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SealedSecret } from "./secret-box.js";

export type PlanRecord = {
  planId: string;
  name: string;
  // null: no monthly limit.
  monthlyTokenLimit: number | null;
  allowedProviders: string[];
  byokAllowed: boolean;
  // Placeholder for a future payment provider; nothing reads it.
  externalSubscriptionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MonthlyUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  modelCalls: number;
};

export type EmailTokenPurpose = "VERIFY" | "RESET";

export type PendingRegistration = {
  pendingId: string;
  normalizedEmail: string;
  userJson: string;
  escrow: SealedSecret;
  createdAt: string;
};

function sealed(row: Record<string, unknown>, prefix = ""): SealedSecret {
  return {
    nonce: Buffer.from(row[`${prefix}nonce`] as Uint8Array),
    ciphertext: Buffer.from(row[`${prefix}ciphertext`] as Uint8Array),
    tag: Buffer.from(row[`${prefix}tag`] as Uint8Array)
  };
}

function num(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : 0;
}

/** SQLite of the server mode: settings, plans, BYOK keys, e-mail tokens, usage. */
export class ServerModeStore {
  private readonly db: DatabaseSync;

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const dbPath = path.join(dir, "server-mode.sqlite");
    this.db = new DatabaseSync(dbPath, { timeout: 5_000 });
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      // Best effort on platforms without POSIX modes.
    }
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS plans (
        plan_id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        monthly_token_limit INTEGER,
        allowed_providers TEXT NOT NULL,
        byok_allowed INTEGER NOT NULL CHECK (byok_allowed IN (0,1)),
        external_subscription_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS account_plans (
        user_id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES plans(plan_id),
        assigned_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS byok_keys (
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        tag BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, provider)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS umk_escrow (
        user_id TEXT PRIMARY KEY,
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        tag BLOB NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS pending_registrations (
        pending_id TEXT PRIMARY KEY,
        normalized_email TEXT NOT NULL UNIQUE,
        user_json TEXT NOT NULL,
        nonce BLOB NOT NULL,
        ciphertext BLOB NOT NULL,
        tag BLOB NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS email_tokens (
        token_hash BLOB PRIMARY KEY,
        purpose TEXT NOT NULL CHECK (purpose IN ('VERIFY','RESET')),
        subject TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        used_at INTEGER,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_email_tokens_subject ON email_tokens(purpose, subject);
      CREATE TABLE IF NOT EXISTS usage_monthly (
        user_id TEXT NOT NULL,
        month TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_write_tokens INTEGER NOT NULL,
        model_calls INTEGER NOT NULL,
        PRIMARY KEY (user_id, month)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL
      ) STRICT;
    `);
  }

  close(): void {
    this.db.close();
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value?: string } | undefined;
    return typeof row?.value === "string" ? row.value : null;
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
    else this.db.prepare("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  private mapPlan(row: Record<string, unknown>): PlanRecord {
    return {
      planId: String(row.plan_id),
      name: String(row.name),
      monthlyTokenLimit: row.monthly_token_limit === null ? null : num(row.monthly_token_limit),
      allowedProviders: JSON.parse(String(row.allowed_providers)) as string[],
      byokAllowed: num(row.byok_allowed) === 1,
      externalSubscriptionId: typeof row.external_subscription_id === "string" ? row.external_subscription_id : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  listPlans(): PlanRecord[] {
    return (this.db.prepare("SELECT * FROM plans ORDER BY name").all() as Record<string, unknown>[]).map((row) => this.mapPlan(row));
  }

  getPlan(planId: string): PlanRecord | null {
    const row = this.db.prepare("SELECT * FROM plans WHERE plan_id = ?").get(planId) as Record<string, unknown> | undefined;
    return row ? this.mapPlan(row) : null;
  }

  putPlan(plan: PlanRecord): void {
    this.db.prepare(`
      INSERT INTO plans(plan_id, name, monthly_token_limit, allowed_providers, byok_allowed, external_subscription_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_id) DO UPDATE SET
        name = excluded.name,
        monthly_token_limit = excluded.monthly_token_limit,
        allowed_providers = excluded.allowed_providers,
        byok_allowed = excluded.byok_allowed,
        external_subscription_id = excluded.external_subscription_id,
        updated_at = excluded.updated_at
    `).run(
      plan.planId,
      plan.name,
      plan.monthlyTokenLimit,
      JSON.stringify(plan.allowedProviders),
      plan.byokAllowed ? 1 : 0,
      plan.externalSubscriptionId,
      plan.createdAt,
      plan.updatedAt
    );
  }

  planInUse(planId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM account_plans WHERE plan_id = ? LIMIT 1").get(planId));
  }

  deletePlan(planId: string): boolean {
    return Number(this.db.prepare("DELETE FROM plans WHERE plan_id = ?").run(planId).changes) > 0;
  }

  getAccountPlanId(userId: string): string | null {
    const row = this.db.prepare("SELECT plan_id FROM account_plans WHERE user_id = ?").get(userId) as { plan_id?: string } | undefined;
    return row?.plan_id ?? null;
  }

  setAccountPlan(userId: string, planId: string | null, now: string): void {
    if (planId === null) this.db.prepare("DELETE FROM account_plans WHERE user_id = ?").run(userId);
    else this.db.prepare("INSERT INTO account_plans(user_id, plan_id, assigned_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, assigned_at = excluded.assigned_at").run(userId, planId, now);
  }

  getByok(userId: string, provider: string): SealedSecret | null {
    const row = this.db.prepare("SELECT nonce, ciphertext, tag FROM byok_keys WHERE user_id = ? AND provider = ?").get(userId, provider) as Record<string, unknown> | undefined;
    return row ? sealed(row) : null;
  }

  listByokProviders(userId: string): Array<{ provider: string; updatedAt: string }> {
    return (this.db.prepare("SELECT provider, updated_at FROM byok_keys WHERE user_id = ? ORDER BY provider").all(userId) as Record<string, unknown>[]).map((row) => ({
      provider: String(row.provider),
      updatedAt: String(row.updated_at)
    }));
  }

  putByok(userId: string, provider: string, secret: SealedSecret, now: string): void {
    this.db.prepare(`
      INSERT INTO byok_keys(user_id, provider, nonce, ciphertext, tag, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET nonce = excluded.nonce, ciphertext = excluded.ciphertext, tag = excluded.tag, updated_at = excluded.updated_at
    `).run(userId, provider, secret.nonce, secret.ciphertext, secret.tag, now);
  }

  deleteByok(userId: string, provider: string): void {
    this.db.prepare("DELETE FROM byok_keys WHERE user_id = ? AND provider = ?").run(userId, provider);
  }

  getEscrow(userId: string): SealedSecret | null {
    const row = this.db.prepare("SELECT nonce, ciphertext, tag FROM umk_escrow WHERE user_id = ?").get(userId) as Record<string, unknown> | undefined;
    return row ? sealed(row) : null;
  }

  putEscrow(userId: string, secret: SealedSecret, now: string): void {
    this.db.prepare(`
      INSERT INTO umk_escrow(user_id, nonce, ciphertext, tag, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET nonce = excluded.nonce, ciphertext = excluded.ciphertext, tag = excluded.tag, updated_at = excluded.updated_at
    `).run(userId, secret.nonce, secret.ciphertext, secret.tag, now);
  }

  putPending(pending: PendingRegistration): void {
    this.db.prepare(`
      INSERT INTO pending_registrations(pending_id, normalized_email, user_json, nonce, ciphertext, tag, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(normalized_email) DO UPDATE SET pending_id = excluded.pending_id, user_json = excluded.user_json,
        nonce = excluded.nonce, ciphertext = excluded.ciphertext, tag = excluded.tag, created_at = excluded.created_at
    `).run(pending.pendingId, pending.normalizedEmail, pending.userJson, pending.escrow.nonce, pending.escrow.ciphertext, pending.escrow.tag, pending.createdAt);
  }

  getPending(pendingId: string): PendingRegistration | null {
    const row = this.db.prepare("SELECT * FROM pending_registrations WHERE pending_id = ?").get(pendingId) as Record<string, unknown> | undefined;
    return row
      ? {
          pendingId: String(row.pending_id),
          normalizedEmail: String(row.normalized_email),
          userJson: String(row.user_json),
          escrow: sealed(row),
          createdAt: String(row.created_at)
        }
      : null;
  }

  deletePending(pendingId: string): void {
    this.db.prepare("DELETE FROM pending_registrations WHERE pending_id = ?").run(pendingId);
  }

  putToken(tokenHash: Buffer, purpose: EmailTokenPurpose, subject: string, expiresAt: number, now: number): void {
    this.db.prepare("INSERT INTO email_tokens(token_hash, purpose, subject, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(tokenHash, purpose, subject, expiresAt, now);
  }

  /** Marks the token used when it is valid; one winner even for concurrent requests. */
  consumeToken(tokenHash: Buffer, purpose: EmailTokenPurpose, now: number): string | null {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT subject, expires_at, used_at FROM email_tokens WHERE token_hash = ? AND purpose = ?").get(tokenHash, purpose) as Record<string, unknown> | undefined;
      if (!row || row.used_at !== null || num(row.expires_at) <= now) {
        this.db.exec("COMMIT");
        return null;
      }
      this.db.prepare("UPDATE email_tokens SET used_at = ? WHERE token_hash = ?").run(now, tokenHash);
      this.db.exec("COMMIT");
      return String(row.subject);
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** The subject of a valid, unused token, without using it. */
  peekToken(tokenHash: Buffer, purpose: EmailTokenPurpose, now: number): string | null {
    const row = this.db.prepare("SELECT subject, expires_at, used_at FROM email_tokens WHERE token_hash = ? AND purpose = ?").get(tokenHash, purpose) as Record<string, unknown> | undefined;
    return row && row.used_at === null && num(row.expires_at) > now ? String(row.subject) : null;
  }

  /** Ends every unused token of the subject (a new link replaces the old ones). */
  invalidateTokens(purpose: EmailTokenPurpose, subject: string, now: number): void {
    this.db.prepare("UPDATE email_tokens SET used_at = ? WHERE purpose = ? AND subject = ? AND used_at IS NULL").run(now, purpose, subject);
  }

  purgeExpiredTokens(now: number): void {
    this.db.prepare("DELETE FROM email_tokens WHERE expires_at < ?").run(now - 7 * 24 * 60 * 60 * 1000);
  }

  addUsage(userId: string, month: string, usage: MonthlyUsage): void {
    this.db.prepare(`
      INSERT INTO usage_monthly(user_id, month, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, model_calls) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, month) DO UPDATE SET
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
        cache_write_tokens = cache_write_tokens + excluded.cache_write_tokens,
        model_calls = model_calls + excluded.model_calls
    `).run(userId, month, usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens, usage.modelCalls);
  }

  getUsage(userId: string, month: string): MonthlyUsage {
    const row = this.db.prepare("SELECT * FROM usage_monthly WHERE user_id = ? AND month = ?").get(userId, month) as Record<string, unknown> | undefined;
    return {
      inputTokens: num(row?.input_tokens),
      outputTokens: num(row?.output_tokens),
      cacheReadTokens: num(row?.cache_read_tokens),
      cacheWriteTokens: num(row?.cache_write_tokens),
      modelCalls: num(row?.model_calls)
    };
  }

  /** Fixed-window counter; true while the bucket is within its limit. */
  hit(bucket: string, limit: number, windowMs: number, now: number): { allowed: boolean; retryAfterMs: number } {
    const row = this.db.prepare("SELECT window_start, count FROM rate_limits WHERE bucket = ?").get(bucket) as Record<string, unknown> | undefined;
    const start = row ? num(row.window_start) : 0;
    if (!row || now - start >= windowMs) {
      this.db.prepare("INSERT INTO rate_limits(bucket, window_start, count) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET window_start = excluded.window_start, count = 1").run(bucket, now);
      return { allowed: true, retryAfterMs: 0 };
    }
    const count = num(row.count);
    if (count >= limit) return { allowed: false, retryAfterMs: start + windowMs - now };
    this.db.prepare("UPDATE rate_limits SET count = count + 1 WHERE bucket = ?").run(bucket);
    return { allowed: true, retryAfterMs: 0 };
  }
}
