// Ustawienia > Zużycie: the tokens of every chat turn, per account, month and model (Patron's
// usage page). The tokens come from the turn's own meter (providers/usage-meter.ts); a model
// reached through an account client (CLI) reports no tokens, so its calls are counted as unmetered.
import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelUsage } from "./providers/usage-meter.js";

export type UsageRow = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  modelCalls: number;
  unmeteredCalls: number;
  turns: number;
};

export type UsageFile = { months: Record<string, Record<string, UsageRow>> };

/** The account a running turn belongs to (set by the chat route). */
export const usageOwner = new AsyncLocalStorage<string>();

let directory: string | null = null;
const writes = new Map<string, Promise<void>>();

export function configureUsageLog(dir: string | null): void {
  directory = dir;
}

const empty = (): UsageRow => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, modelCalls: 0, unmeteredCalls: 0, turns: 0 });
const safeId = (userId: string) => (/^[A-Za-z0-9_-]{1,80}$/u.test(userId) ? userId : null);
const monthOf = (date: Date) => date.toISOString().slice(0, 7);

function fileOf(userId: string): string | null {
  const id = safeId(userId);
  return directory && id ? path.join(directory, `${id}.json`) : null;
}

export function readUsage(userId: string): UsageFile {
  const file = fileOf(userId);
  if (!file) return { months: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as UsageFile;
    return parsed && typeof parsed.months === "object" ? parsed : { months: {} };
  } catch {
    return { months: {} };
  }
}

/** Adds one turn's tokens to the account's month and model; writes one after another per account. */
export function recordTurnUsage(provider: string, model: string, usage: ModelUsage, now = new Date()): Promise<void> {
  const owner = usageOwner.getStore();
  const file = owner ? fileOf(owner) : null;
  if (!owner || !file || usage.modelCalls === 0) return Promise.resolve();
  const previous = writes.get(owner) ?? Promise.resolve();
  const next = previous.then(() => {
    const data = readUsage(owner);
    const month = (data.months[monthOf(now)] ??= {});
    const row = (month[`${provider}/${model}`] ??= empty());
    row.inputTokens += usage.inputTokens;
    row.outputTokens += usage.outputTokens;
    row.cacheReadTokens += usage.cacheReadTokens;
    row.cacheWriteTokens += usage.cacheWriteTokens;
    row.modelCalls += usage.modelCalls;
    row.unmeteredCalls += usage.unmeteredCalls;
    row.turns += 1;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(temporary, file);
  }).catch(() => undefined);
  writes.set(owner, next);
  return next;
}

/** The last months of an account, newest first, each with its models and the month's total. */
export function usageSummary(userId: string, months = 6, now = new Date()): Array<{ month: string; total: UsageRow; models: Array<{ model: string } & UsageRow> }> {
  const data = readUsage(userId);
  const result = [];
  for (let back = 0; back < months; back++) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const month = monthOf(date);
    const rows = data.months[month] ?? {};
    const total = empty();
    const models = Object.entries(rows)
      .map(([model, row]) => {
        for (const key of Object.keys(total) as Array<keyof UsageRow>) total[key] += row[key] ?? 0;
        return { model, ...row };
      })
      .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
    result.push({ month, total, models });
  }
  return result;
}
