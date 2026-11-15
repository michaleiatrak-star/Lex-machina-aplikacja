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
  /** The longest steps inside the stages (model call, a tool, a correction round), by step name. */
  stepsMs?: Record<string, number>;
  status: "OK" | "BLOCKED" | "ERROR";
  error?: string;
};

/** A long turn with its longest steps: one slow turn is lost in the medians of its path. */
export type SlowChatTurn = { at: string; path: string; modelKind: ChatTurnRecord["modelKind"]; totalMs: number; status: ChatTurnRecord["status"]; steps: Array<{ step: string; ms: number }> };

const SLOW_TURN_MS = 120_000;
const MAX_STEPS = 12;

/**
 * The name of a step without data of the case: the part before ':' (after it come signatures,
 * counts, file names), digits replaced, at most 60 characters; reading the skill files is one step.
 */
export function stepName(phase: ExecutionPhase, detail?: string): string {
  if (!detail) return phase;
  const head = (detail.split(":")[0] ?? "").trim();
  if (/[\\/]|\.md$/u.test(head) || /^skill\b/u.test(head)) return `${phase} · wczytanie skilli`;
  return `${phase} · ${head.replace(/\d+/gu, "#").replace(/\s+/gu, " ").slice(0, 60)}`;
}

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

/** Stage and step times from the step reports: each lasts until the next one starts. */
export class PhaseClock {
  private current: ExecutionPhase | null = null;
  private since = 0;
  private step: string | null = null;
  private stepSince = 0;
  readonly phasesMs: Partial<Record<ExecutionPhase, number>> = {};
  private readonly steps = new Map<string, number>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  mark(phase: ExecutionPhase, detail?: string): void {
    const step = stepName(phase, detail);
    if (step !== this.step) {
      this.closeStep();
      this.step = step;
      this.stepSince = this.now();
    }
    if (phase === this.current) return;
    this.closePhase();
    this.current = phase;
    this.since = this.now();
  }

  private closePhase(): void {
    if (this.current) this.phasesMs[this.current] = Math.round((this.phasesMs[this.current] ?? 0) + this.now() - this.since);
    this.current = null;
  }

  private closeStep(): void {
    if (this.step) this.steps.set(this.step, (this.steps.get(this.step) ?? 0) + this.now() - this.stepSince);
    this.step = null;
  }

  close(): void {
    this.closeStep();
    this.closePhase();
  }

  /** The longest steps, at most 12, rounded to milliseconds. */
  get stepsMs(): Record<string, number> {
    return Object.fromEntries(
      [...this.steps]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_STEPS)
        .map(([step, ms]) => [step, Math.round(ms)])
    );
  }
}

/** The latest turns over two minutes, newest first, each with its four longest steps. */
export function slowChatTurns(records: ChatTurnRecord[], limit = 5): SlowChatTurn[] {
  return records
    .filter((record) => record.totalMs >= SLOW_TURN_MS)
    .slice(-limit)
    .reverse()
    .map((record) => ({
      at: record.at,
      path: record.path,
      modelKind: record.modelKind,
      totalMs: record.totalMs,
      status: record.status,
      steps: Object.entries(record.stepsMs ?? {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([step, ms]) => ({ step, ms }))
    }));
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

  summary(): { file: string; turns: number; paths: ChatPathSummary[]; slow: SlowChatTurn[] } {
    const records = this.records();
    return { file: this.file, turns: records.length, paths: summarizeChatTurns(records), slow: slowChatTurns(records) };
  }
}
