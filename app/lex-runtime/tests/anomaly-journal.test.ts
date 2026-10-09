import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AnomalyJournal,
  anomaliesFromAudit,
  anomaliesFromResponse,
  withAnomalyJournal
} from "../src/anomaly-journal.js";
import { reportNativeReads } from "../src/providers/account-session.js";
import {
  SESSION_EXECUTION_INTERNAL,
  type SessionExecutionRequest,
  type SessionExecutionResponse
} from "../src/session-executor.js";
import type { AuditEvent } from "../src/audit-trail.js";

const roots: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-anomaly-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

const event = (partial: Partial<AuditEvent>): AuditEvent => ({
  sequence: 1, timestamp: "", type: "resource_read", target: "", status: "OK", ...partial
});
const base = { provider: "openai", model: "gpt", sessionId: "s1" };

describe("anomaly journal", () => {
  it("reports corrected and missing skill paths, blocked gates, nothing for clean reads", () => {
    const entries = anomaliesFromAudit([
      event({ target: "dr-02/SKILL.md" }),
      event({ target: "dr-03/modules/mod-KK-kwalifikator-karnomaterialny.md", detail: { tool: "read_legal_resource", resolvedFrom: "dr-03/modules/mod-KK-kwalifikator-v2.md" } }),
      event({ target: "dr-02/modules/mod-KC.md", status: "DEGRADED", detail: { tool: "read_legal_resource", error: "LEGAL_RESOURCE_NOT_FOUND", candidates: ["modules/mod-KC-a.md"] } }),
      event({ target: "dr-02/x.md", status: "DEGRADED", detail: { tool: "Read", native: true, error: "LEGAL_RESOURCE_NOT_FOUND" } }),
      event({ type: "gate", target: "G36", status: "BLOCKED", detail: { reason: "G36_MISSING_RESOURCE: x" } }),
      event({ type: "verification", target: "Jan [PII:PERSON:0001]", status: "BLOCKED" })
    ], base, "2026-10-02T10:00:00.000Z");
    expect(entries.map((entry) => [entry.severity, entry.area, entry.code])).toEqual([
      ["WARN", "SKILL_PATH", "RESOURCE_PATH_CORRECTED"],
      ["WARN", "SKILL_PATH", "LEGAL_RESOURCE_NOT_FOUND"],
      ["WARN", "SKILL_PATH", "LEGAL_RESOURCE_NOT_FOUND"],
      ["ERROR", "GATE", "G36_MISSING_RESOURCE"],
      ["ERROR", "GATE", "VERIFICATION_BLOCKED"]
    ]);
    expect(entries[0]!.detail).toEqual({ requested: "dr-03/modules/mod-KK-kwalifikator-v2.md" });
    expect(entries[1]!.detail?.candidates).toEqual(["modules/mod-KC-a.md"]);
    expect(entries[2]!.detail?.native).toBe(true);
    expect(entries[4]!.target).toBe("[PII]");
  });

  it("reports a blocked session with its missing resources", () => {
    const response = {
      sessionId: "s1", status: "BLOCKED", provider: "openai", model: "gpt", primarySkill: "AUTO",
      finalization: "BLOCKED", blockedReferences: [],
      verification: { records: 0, verified: 0, supported: 0, unverified: 0 }, evidence: [],
      audit: { result: "BLOCKED", eventCount: 3, closed: true, missing: ["prawny-router-v3/SKILL.md"] },
      [SESSION_EXECUTION_INTERNAL]: { verificationRecords: [], auditEvents: [] }
    } as unknown as SessionExecutionResponse;
    expect(anomaliesFromResponse(response)).toMatchObject([
      { severity: "ERROR", area: "SESSION", code: "SESSION_BLOCKED", detail: { auditMissing: ["prawny-router-v3/SKILL.md"] } }
    ]);
  });

  it("persists, summarizes repeats, rotates and clears", () => {
    const dir = tempDir();
    const journal = new AnomalyJournal(dir, 4);
    const entry = (code: string, at: string, target = "dr-02/a.md") =>
      ({ at, severity: "WARN" as const, area: "SKILL_PATH" as const, code, target, ...base });
    journal.record([entry("A", "2026-10-01T00:00:00Z"), entry("A", "2026-10-02T00:00:00Z"), entry("B", "2026-10-02T01:00:00Z")]);
    const reopened = new AnomalyJournal(dir, 4);
    expect(reopened.summary()[0]).toMatchObject({ code: "A", count: 2, lastAt: "2026-10-02T00:00:00Z", providers: ["openai/gpt"] });
    expect(reopened.list({ since: "2026-10-02T00:00:00Z" }).map((item) => item.code)).toEqual(["B", "A"]);
    reopened.record([entry("C", "2026-10-03T00:00:00Z"), entry("D", "2026-10-03T00:00:01Z")]);
    expect(new AnomalyJournal(dir, 4).list().map((item) => item.code)).toEqual(["D", "C", "B", "A"]);
    expect(reopened.exportJsonl().trim().split("\n")).toHaveLength(4);
    reopened.clear();
    expect(new AnomalyJournal(dir, 4).list()).toEqual([]);
  });

  it("records a failed execution and rethrows it", async () => {
    const journal = new AnomalyJournal(tempDir());
    const executor = withAnomalyJournal({
      execute: async () => { throw new Error("PROVIDER_UNCODED_FAILURE: Rate limited"); }
    }, journal);
    await expect(executor.execute({ provider: "xai", model: "grok" } as SessionExecutionRequest)).rejects.toThrow("PROVIDER_UNCODED_FAILURE");
    expect(journal.list()).toMatchObject([{ severity: "ERROR", area: "EXECUTION", code: "PROVIDER_UNCODED_FAILURE", provider: "xai" }]);
    expect(executor.resolveAutoRouting).toBeUndefined();
  });

  it("passes the router's executive skill through (AUTO workflow preview needs it)", () => {
    const executor = withAnomalyJournal({
      execute: async () => { throw new Error("unused"); },
      executiveSkillFor: (message) => (message.includes("umowę") ? "analizator-umow-v1" : null)
    }, new AnomalyJournal(tempDir()));
    expect(executor.executiveSkillFor?.("Przeanalizuj umowę")).toBe("analizator-umow-v1");
    expect(executor.executiveSkillFor?.("Ile trwa wypowiedzenie?")).toBeNull();
  });

  it("does not count a failed native Read as read", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "dr-02"));
    fs.writeFileSync(path.join(root, "dr-02", "SKILL.md"), "# dr\n");
    const read: string[] = [];
    const missing: string[] = [];
    const stdout = JSON.stringify({
      type: "assistant",
      message: { content: [
        { type: "tool_use", name: "Read", input: { file_path: path.join(root, "dr-02", "SKILL.md") } },
        { type: "tool_use", name: "Read", input: { file_path: path.join(root, "dr-02", "modules", "mod-v2.md") } }
      ] }
    });
    reportNativeReads({ root, onRead: (file) => read.push(file), onMissing: (file) => missing.push(file) }, stdout);
    expect(read).toEqual(["dr-02/SKILL.md"]);
    expect(missing).toEqual(["dr-02/modules/mod-v2.md"]);
  });
});
