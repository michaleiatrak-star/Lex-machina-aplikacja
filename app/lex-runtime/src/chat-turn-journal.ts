import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExecutionPhase } from "./execution-steps.js";

/**
 * How long each chat turn took on this computer, by path (local model, API, account session;
 * the executive skill or mode) and by stage (anonymization, routing, skills, model, verification,
 * restore). Never the message or the answer: names, times and an error code only. The benchmark
 * of the chat paths on the user's own machine (developer mode).
 */
export type ChatTurnRecord = {
  at: string;
  modelKind: "local" | "api" | "account";
  provider: string;
  path: string;
  attachments: number;
  totalMs: number;
  phasesMs: Partial<Record<ExecutionPhase, number>>;
  status: "OK" | "BLOCKED" | "ERROR";
  error?: string;
};

export type ChatPathSummary = {
  path: string;
  modelKind: ChatTurnRecord["modelKind"];
  turns: number;
  errors: number;
  blocked: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  // Median of each stage: where the time of this path goes.
  phasesP50Ms: Partial<Record<ExecutionPhase, number>>;
};

const MAX_RECORDS = 500;

export function chatTurnJournalPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA
    ? path.join(env.LOCALAPPDATA, "LexMachina", "chat-turns.jsonl")
    : path.join(os.tmpdir(), "LexMachina-chat-turns.jsonl");
}

export function modelKindOf(provider: string, model: string): ChatTurnRecord["modelKind"] {
  if (model.startsWith("local/")) return "local";
  return /account|session/iu.test(provider) ? "account" : "api";
}

/** Error code only: the part before the first ':' (codes carry no text of the case). */
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split(":")[0] ?? "").replace(/[^A-Z0-9_]/gu, "").slice(0, 80) || "UNKNOWN";
}

/** Stage times from the step reports: each stage lasts until the next one starts. */
export class PhaseClock {
  private current: ExecutionPhase | null = null;
  private since = 0;
  readonly phasesMs: Partial<Record<ExecutionPhase, number>> = {};

  constructor(private readonly now: () => number = () => performance.now()) {}

  mark(phase: ExecutionPhase): void {
    if (phase === this.current) return;
    this.close();
    this.current = phase;
    this.since = this.now();
  }

  close(): void {
    if (this.current) this.phasesMs[this.current] = Math.round((this.phasesMs[this.current] ?? 0) + this.now() - this.since);
    this.current = null;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

export function summarizeChatTurns(records: ChatTurnRecord[]): ChatPathSummary[] {
  const groups = new Map<string, ChatTurnRecord[]>();
  for (const record of records) {
    const key = `${record.modelKind}\u0000${record.path}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return [...groups.values()]
    .map((items) => {
      const totals = items.map((item) => item.totalMs).sort((a, b) => a - b);
      const phases: Partial<Record<ExecutionPhase, number>> = {};
      for (const phase of ["PREPARE", "ROUTING", "SKILLS", "MODEL", "VERIFY", "RESTORE"] as ExecutionPhase[]) {
        const values = items.map((item) => item.phasesMs[phase]).filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
        if (values.length) phases[phase] = percentile(values, 50);
      }
      return {
        path: items[0]!.path,
        modelKind: items[0]!.modelKind,
        turns: items.length,
        errors: items.filter((item) => item.status === "ERROR").length,
        blocked: items.filter((item) => item.status === "BLOCKED").length,
        p50Ms: percentile(totals, 50),
        p95Ms: percentile(totals, 95),
        maxMs: totals.at(-1) ?? 0,
        phasesP50Ms: phases
      };
    })
    .sort((a, b) => b.turns - a.turns);
}

export class ChatTurnJournal {
  constructor(private readonly file: string = chatTurnJournalPath()) {}

  append(record: ChatTurnRecord): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const lines = this.readLines();
      lines.push(JSON.stringify(record));
      fs.writeFileSync(`${this.file}.tmp`, `${lines.slice(-MAX_RECORDS).join("\n")}\n`);
      fs.renameSync(`${this.file}.tmp`, this.file);
    } catch {
      // The journal never fails a turn.
    }
  }

  private readLines(): string[] {
    try {
      return fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  records(): ChatTurnRecord[] {
    return this.readLines().flatMap((line) => {
      try {
        return [JSON.parse(line) as ChatTurnRecord];
      } catch {
        return [];
      }
    });
  }

  summary(): { file: string; turns: number; paths: ChatPathSummary[] } {
    const records = this.records();
    return { file: this.file, turns: records.length, paths: summarizeChatTurns(records) };
  }
}
