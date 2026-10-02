import fs from "node:fs";
import path from "node:path";
import type { AuditEvent } from "./audit-trail.js";
import {
  SESSION_EXECUTION_INTERNAL,
  type SessionExecutionRequest,
  type SessionExecutionResponse,
  type SessionExecutor
} from "./session-executor.js";

// Dziennik nieprawidłowości: kody, narzędzia, ścieżki w korpusie skilli,
// dostawca i model. Bez treści pytań, odpowiedzi, dokumentów i danych sprawy.

export type AnomalySeverity = "WARN" | "ERROR";

export type AnomalyArea =
  | "SKILL_PATH"
  | "CORPUS"
  | "GATE"
  | "SESSION"
  | "EXECUTION";

export type AnomalyEntry = {
  at: string;
  severity: AnomalySeverity;
  area: AnomalyArea;
  code: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  target?: string;
  detail?: Record<string, string | number | boolean | string[]>;
};

export type AnomalySummaryRow = {
  severity: AnomalySeverity;
  area: AnomalyArea;
  code: string;
  target: string | null;
  count: number;
  lastAt: string;
  providers: string[];
};

const MAX_TARGET = 200;
const MAX_LIST = 12;
const CODE = /^[A-Z][A-Z0-9_]{2,80}/;

function safeTarget(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  // Pseudonimizowane dane osobowe nie trafiają do dziennika nawet jako token.
  if (/\[PII:/.test(value)) return "[PII]";
  return value.trim().slice(0, MAX_TARGET);
}

function errorCode(value: unknown): string | null {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return CODE.exec(text.trim())?.[0] ?? null;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => safeTarget(item)!)
    .filter(Boolean)
    .slice(0, MAX_LIST);
  return list.length ? list : undefined;
}

/** Nieprawidłowości z zdarzeń audytu jednej sesji. */
export function anomaliesFromAudit(
  events: AuditEvent[],
  base: Pick<AnomalyEntry, "provider" | "model" | "sessionId">,
  at = new Date().toISOString()
): AnomalyEntry[] {
  const entries: AnomalyEntry[] = [];
  for (const event of events) {
    const detail = event.detail ?? {};
    const target = safeTarget(event.target);
    const corpus = event.type === "resource_read" || detail.tool === "Read" || detail.tool === "read_legal_resource";
    if (event.status === "OK" && typeof detail.resolvedFrom === "string") {
      entries.push({
        at, ...base, severity: "WARN", area: "SKILL_PATH", code: "RESOURCE_PATH_CORRECTED",
        ...(target ? { target } : {}),
        detail: { requested: safeTarget(detail.resolvedFrom) ?? "" }
      });
      continue;
    }
    if (event.status === "OK") continue;
    const code = errorCode(detail.error) ?? errorCode(detail.reason) ?? `${event.type.toUpperCase()}_${event.status}`;
    const candidates = stringList(detail.candidates) ?? stringList(detail.skillCandidates);
    entries.push({
      at, ...base,
      severity: event.status === "BLOCKED" ? "ERROR" : "WARN",
      area: corpus ? (/NOT_FOUND/.test(code) ? "SKILL_PATH" : "CORPUS") : "GATE",
      code,
      ...(target ? { target } : {}),
      detail: {
        eventType: event.type,
        ...(detail.native === true ? { native: true } : {}),
        ...(candidates ? { candidates } : {})
      }
    });
  }
  return entries;
}

/** Nieprawidłowości z wyniku sesji (status, bramki, finalizacja). */
export function anomaliesFromResponse(
  response: SessionExecutionResponse,
  at = new Date().toISOString()
): AnomalyEntry[] {
  const base = { provider: response.provider, model: response.model, sessionId: response.sessionId };
  const internal = response[SESSION_EXECUTION_INTERNAL];
  const entries = internal ? anomaliesFromAudit(internal.auditEvents, base, at) : [];
  if (response.status === "BLOCKED") {
    const detail: Record<string, string[] | string> = {};
    const missing = stringList(response.audit.missing);
    const violations = stringList(response.audit.violations);
    const workflowMissing = stringList(response.workflow?.missingResources);
    if (missing) detail.auditMissing = missing;
    if (violations) detail.auditViolations = violations;
    if (workflowMissing) detail.workflowMissing = workflowMissing;
    if (response.workflow?.result === "BLOCKED") detail.workflow = response.workflow.id;
    entries.push({ at, ...base, severity: "ERROR", area: "SESSION", code: "SESSION_BLOCKED", detail });
  } else if (response.finalization === "DEGRADED") {
    entries.push({
      at, ...base, severity: "WARN", area: "SESSION", code: "FINALIZATION_DEGRADED",
      detail: { unverified: response.verification.unverified, blockedReferences: response.blockedReferences.length }
    });
  }
  return entries;
}

export class AnomalyJournal {
  readonly file: string;
  private entries: AnomalyEntry[] | null = null;

  constructor(
    rootDir: string,
    private readonly maxEntries = 5_000
  ) {
    this.file = path.join(rootDir, "diagnostics", "anomalies.jsonl");
  }

  private load(): AnomalyEntry[] {
    if (this.entries) return this.entries;
    const entries: AnomalyEntry[] = [];
    try {
      for (const line of fs.readFileSync(this.file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as AnomalyEntry);
        } catch {
          // Uszkodzona linia (przerwany zapis) - pomijana.
        }
      }
    } catch {
      // Brak pliku: pusty dziennik.
    }
    this.entries = entries.slice(-this.maxEntries);
    return this.entries;
  }

  record(entries: AnomalyEntry[]): void {
    if (!entries.length) return;
    const all = this.load();
    all.push(...entries);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (all.length > this.maxEntries) {
        this.entries = all.slice(-this.maxEntries);
        const temp = `${this.file}.tmp`;
        fs.writeFileSync(temp, this.entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
        fs.renameSync(temp, this.file);
      } else {
        fs.appendFileSync(this.file, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      }
    } catch (error) {
      process.stderr.write(`LEX_ANOMALY_JOURNAL_WRITE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  list(filter: { limit?: number; severity?: AnomalySeverity; area?: AnomalyArea; since?: string } = {}): AnomalyEntry[] {
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 2_000);
    return this.load()
      .filter((entry) =>
        (!filter.severity || entry.severity === filter.severity) &&
        (!filter.area || entry.area === filter.area) &&
        (!filter.since || entry.at >= filter.since)
      )
      .slice(-limit)
      .reverse();
  }

  /** Powtarzające się nieprawidłowości: ten sam kod i cel, najczęstsze najpierw. */
  summary(since?: string): AnomalySummaryRow[] {
    const rows = new Map<string, AnomalySummaryRow>();
    for (const entry of this.load()) {
      if (since && entry.at < since) continue;
      const key = `${entry.severity}|${entry.area}|${entry.code}|${entry.target ?? ""}`;
      const row = rows.get(key) ?? {
        severity: entry.severity, area: entry.area, code: entry.code,
        target: entry.target ?? null, count: 0, lastAt: entry.at, providers: []
      };
      row.count += 1;
      if (entry.at > row.lastAt) row.lastAt = entry.at;
      const who = [entry.provider, entry.model].filter(Boolean).join("/");
      if (who && !row.providers.includes(who) && row.providers.length < MAX_LIST) row.providers.push(who);
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "ERROR" ? -1 : 1) || b.count - a.count || b.lastAt.localeCompare(a.lastAt)
    );
  }

  exportJsonl(): string {
    return this.load().map((entry) => JSON.stringify(entry)).join("\n") + (this.load().length ? "\n" : "");
  }

  clear(): void {
    this.entries = [];
    fs.rmSync(this.file, { force: true });
  }
}

/** Zapisuje nieprawidłowości każdej sesji, niezależnie od miejsca wywołania. */
export function withAnomalyJournal(
  inner: SessionExecutor,
  journal: AnomalyJournal
): SessionExecutor {
  const execute = async (request: SessionExecutionRequest): Promise<SessionExecutionResponse> => {
    let response: SessionExecutionResponse;
    try {
      response = await inner.execute(request);
    } catch (error) {
      journal.record([{
        at: new Date().toISOString(),
        severity: "ERROR",
        area: "EXECUTION",
        code: errorCode(error) ?? "SESSION_EXECUTION_FAILED",
        provider: request.provider,
        model: request.model,
        ...(error instanceof Error && !errorCode(error) ? { detail: { errorName: error.name } } : {})
      }]);
      throw error;
    }
    try {
      journal.record(anomaliesFromResponse(response));
    } catch (error) {
      process.stderr.write(`LEX_ANOMALY_JOURNAL_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
    }
    return response;
  };
  return inner.resolveAutoRouting
    ? { execute, resolveAutoRouting: (request) => inner.resolveAutoRouting!(request) }
    : { execute };
}
