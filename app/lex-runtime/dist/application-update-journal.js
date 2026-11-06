import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const FAILED = new Set(["REJECTED", "ABORTED_BEFORE_INSTALL", "ROLLED_BACK", "ROLLBACK_FAILED"]);
const IN_PROGRESS = new Set(["PREPARED", "BACKED_UP", "INSTALLING", "VERIFYING", "ROLLING_BACK"]);
// Longer than any install with its backup and health check.
export const UPDATE_STALE_MS = 30 * 60 * 1000;
export function applicationUpdateJournalPath(env = process.env) {
    return env.LOCALAPPDATA
        ? path.join(env.LOCALAPPDATA, "LexMachina", "update-transaction.json")
        : path.join(env.TEMP ?? os.tmpdir(), "LexMachinaUpdate", "update-transaction.json");
}
/** The last failed attempt, or null (none, committed, still running, or unreadable). */
export function lastFailedApplicationUpdate(file = applicationUpdateJournalPath(), now = new Date()) {
    let raw;
    try {
        // PowerShell may write a BOM.
        raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/u, ""));
    }
    catch {
        return null;
    }
    if (!raw || typeof raw !== "object")
        return null;
    const value = raw;
    if (typeof value.state !== "string" || typeof value.targetVersion !== "string")
        return null;
    const at = [value.rolledBackAt, value.startedAt].find((item) => typeof item === "string") ?? null;
    if (IN_PROGRESS.has(value.state)) {
        const started = at ? Date.parse(at) : Number.NaN;
        if (Number.isNaN(started) || now.getTime() - started < UPDATE_STALE_MS)
            return null;
        return {
            state: "INTERRUPTED",
            targetVersion: value.targetVersion,
            lastError: `INTERRUPTED_AT:${value.state}${typeof value.lastError === "string" && value.lastError ? ` ${value.lastError.slice(0, 300)}` : ""}`,
            at
        };
    }
    if (!FAILED.has(value.state))
        return null;
    return {
        state: value.state,
        targetVersion: value.targetVersion,
        lastError: typeof value.lastError === "string" ? value.lastError.slice(0, 400) : "",
        at
    };
}
