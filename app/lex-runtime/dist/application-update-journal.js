import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const FAILED = new Set(["REJECTED", "ABORTED_BEFORE_INSTALL", "ROLLED_BACK", "ROLLBACK_FAILED"]);
export function applicationUpdateJournalPath(env = process.env) {
    return env.LOCALAPPDATA
        ? path.join(env.LOCALAPPDATA, "LexMachina", "update-transaction.json")
        : path.join(env.TEMP ?? os.tmpdir(), "LexMachinaUpdate", "update-transaction.json");
}
/** The last failed attempt, or null (none, committed, still running, or unreadable). */
export function lastFailedApplicationUpdate(file = applicationUpdateJournalPath()) {
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
    if (typeof value.state !== "string" || !FAILED.has(value.state) || typeof value.targetVersion !== "string")
        return null;
    const at = [value.rolledBackAt, value.startedAt].find((item) => typeof item === "string") ?? null;
    return {
        state: value.state,
        targetVersion: value.targetVersion,
        lastError: typeof value.lastError === "string" ? value.lastError.slice(0, 400) : "",
        at
    };
}
