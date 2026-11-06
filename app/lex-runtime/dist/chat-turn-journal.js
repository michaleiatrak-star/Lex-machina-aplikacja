import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const MAX_RECORDS = 500;
export function chatTurnJournalPath(env = process.env) {
    return env.LOCALAPPDATA
        ? path.join(env.LOCALAPPDATA, "LexMachina", "chat-turns.jsonl")
        : path.join(os.tmpdir(), "LexMachina-chat-turns.jsonl");
}
export function modelKindOf(provider, model) {
    if (model.startsWith("local/"))
        return "local";
    return /account|session/iu.test(provider) ? "account" : "api";
}
/** Error code only: the part before the first ':' (codes carry no text of the case). */
export function errorCode(error) {
    const message = error instanceof Error ? error.message : String(error);
    return (message.split(":")[0] ?? "").replace(/[^A-Z0-9_]/gu, "").slice(0, 80) || "UNKNOWN";
}
/** Stage times from the step reports: each stage lasts until the next one starts. */
export class PhaseClock {
    now;
    current = null;
    since = 0;
    phasesMs = {};
    constructor(now = () => performance.now()) {
        this.now = now;
    }
    mark(phase) {
        if (phase === this.current)
            return;
        this.close();
        this.current = phase;
        this.since = this.now();
    }
    close() {
        if (this.current)
            this.phasesMs[this.current] = Math.round((this.phasesMs[this.current] ?? 0) + this.now() - this.since);
        this.current = null;
    }
}
function percentile(sorted, p) {
    if (sorted.length === 0)
        return 0;
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
export function summarizeChatTurns(records) {
    const groups = new Map();
    for (const record of records) {
        const key = `${record.modelKind}\u0000${record.path}`;
        groups.set(key, [...(groups.get(key) ?? []), record]);
    }
    return [...groups.values()]
        .map((items) => {
        const totals = items.map((item) => item.totalMs).sort((a, b) => a - b);
        const phases = {};
        for (const phase of ["PREPARE", "ROUTING", "SKILLS", "MODEL", "VERIFY", "RESTORE"]) {
            const values = items.map((item) => item.phasesMs[phase]).filter((value) => typeof value === "number").sort((a, b) => a - b);
            if (values.length)
                phases[phase] = percentile(values, 50);
        }
        return {
            path: items[0].path,
            modelKind: items[0].modelKind,
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
    file;
    constructor(file = chatTurnJournalPath()) {
        this.file = file;
    }
    append(record) {
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const lines = this.readLines();
            lines.push(JSON.stringify(record));
            fs.writeFileSync(`${this.file}.tmp`, `${lines.slice(-MAX_RECORDS).join("\n")}\n`);
            fs.renameSync(`${this.file}.tmp`, this.file);
        }
        catch {
            // The journal never fails a turn.
        }
    }
    readLines() {
        try {
            return fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
        }
        catch {
            return [];
        }
    }
    records() {
        return this.readLines().flatMap((line) => {
            try {
                return [JSON.parse(line)];
            }
            catch {
                return [];
            }
        });
    }
    summary() {
        const records = this.records();
        return { file: this.file, turns: records.length, paths: summarizeChatTurns(records) };
    }
}
