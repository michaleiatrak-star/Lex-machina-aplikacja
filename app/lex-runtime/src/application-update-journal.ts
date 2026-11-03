import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The last application update attempt as the Windows update runner left it
// (installer/app-update-transaction.ps1): the reason a rejected or rolled-back update did not
// install, so the next start says why instead of offering the same version in silence.
export type ApplicationUpdateAttempt = {
  // INTERRUPTED: the journal stopped at a step in progress long ago (the runner was ended).
  state: "REJECTED" | "ABORTED_BEFORE_INSTALL" | "ROLLED_BACK" | "ROLLBACK_FAILED" | "INTERRUPTED";
  targetVersion: string;
  lastError: string;
  at: string | null;
};

const FAILED = new Set(["REJECTED", "ABORTED_BEFORE_INSTALL", "ROLLED_BACK", "ROLLBACK_FAILED"]);
const IN_PROGRESS = new Set(["PREPARED", "BACKED_UP", "INSTALLING", "VERIFYING", "ROLLING_BACK"]);
// Longer than any install with its backup and health check.
export const UPDATE_STALE_MS = 30 * 60 * 1000;

export function applicationUpdateJournalPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, "LexMachina", "update-transaction.json")
    : path.join(env.TEMP ?? os.tmpdir(), "LexMachinaUpdate", "update-transaction.json");
}

/** The last failed attempt, or null (none, committed, still running, or unreadable). */
export function lastFailedApplicationUpdate(file = applicationUpdateJournalPath(), now: Date = new Date()): ApplicationUpdateAttempt | null {
  let raw: unknown;
  try {
    // PowerShell may write a BOM.
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/u, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.state !== "string" || typeof value.targetVersion !== "string") return null;
  const at = [value.rolledBackAt, value.startedAt].find((item): item is string => typeof item === "string") ?? null;
  if (IN_PROGRESS.has(value.state)) {
    const started = at ? Date.parse(at) : Number.NaN;
    if (Number.isNaN(started) || now.getTime() - started < UPDATE_STALE_MS) return null;
    return {
      state: "INTERRUPTED",
      targetVersion: value.targetVersion,
      lastError: `INTERRUPTED_AT:${value.state}${typeof value.lastError === "string" && value.lastError ? ` ${value.lastError.slice(0, 300)}` : ""}`,
      at
    };
  }
  if (!FAILED.has(value.state)) return null;
  return {
    state: value.state as ApplicationUpdateAttempt["state"],
    targetVersion: value.targetVersion,
    lastError: typeof value.lastError === "string" ? value.lastError.slice(0, 400) : "",
    at
  };
}
