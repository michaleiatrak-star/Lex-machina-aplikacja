import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The last application update attempt as the Windows update runner left it
// (installer/app-update-transaction.ps1): the reason a rejected or rolled-back update did not
// install, so the next start says why instead of offering the same version in silence.
export type ApplicationUpdateAttempt = {
  state: "REJECTED" | "ABORTED_BEFORE_INSTALL" | "ROLLED_BACK" | "ROLLBACK_FAILED";
  targetVersion: string;
  lastError: string;
  at: string | null;
};

const FAILED = new Set(["REJECTED", "ABORTED_BEFORE_INSTALL", "ROLLED_BACK", "ROLLBACK_FAILED"]);

export function applicationUpdateJournalPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, "LexMachina", "update-transaction.json")
    : path.join(env.TEMP ?? os.tmpdir(), "LexMachinaUpdate", "update-transaction.json");
}

/** The last failed attempt, or null (none, committed, still running, or unreadable). */
export function lastFailedApplicationUpdate(file = applicationUpdateJournalPath()): ApplicationUpdateAttempt | null {
  let raw: unknown;
  try {
    // PowerShell may write a BOM.
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/u, ""));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.state !== "string" || !FAILED.has(value.state) || typeof value.targetVersion !== "string") return null;
  const at = [value.rolledBackAt, value.startedAt].find((item): item is string => typeof item === "string") ?? null;
  return {
    state: value.state as ApplicationUpdateAttempt["state"],
    targetVersion: value.targetVersion,
    lastError: typeof value.lastError === "string" ? value.lastError.slice(0, 400) : "",
    at
  };
}
