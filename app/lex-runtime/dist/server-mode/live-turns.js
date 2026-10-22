import { randomBytes } from "node:crypto";
import { EXECUTION_PHASES } from "../execution-steps.js";
const CASE_ID = /^[A-Za-z0-9_-]{1,96}$/;
const SKILL = /^(?:AUTO|[a-z0-9][a-z0-9-]{0,95})$/;
const KEEP_FINISHED_MS = 2 * 60 * 1000;
const MAX_TURNS = 500;
export class LiveTurnRegistry {
    now;
    turns = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    start(input) {
        this.prune();
        const turnId = "turn_" + randomBytes(12).toString("hex");
        this.turns.set(turnId, {
            turnId,
            userId: input.userId,
            loginName: input.loginName,
            caseId: typeof input.caseId === "string" && CASE_ID.test(input.caseId) ? input.caseId : null,
            skill: typeof input.skill === "string" && SKILL.test(input.skill) ? input.skill : null,
            stage: null,
            step: 0,
            totalSteps: EXECUTION_PHASES.length,
            inputTokens: 0,
            outputTokens: 0,
            status: "RUNNING",
            startedAt: new Date(this.now()).toISOString()
        });
        return turnId;
    }
    step(turnId, phase, skill) {
        const turn = this.turns.get(turnId);
        if (!turn || turn.status !== "RUNNING")
            return;
        const index = EXECUTION_PHASES.findIndex((item) => item.key === phase);
        if (index >= 0 && index + 1 >= turn.step) {
            turn.step = index + 1;
            turn.stage = phase;
        }
        if (typeof skill === "string" && SKILL.test(skill))
            turn.skill = skill;
    }
    addTokens(turnId, inputTokens, outputTokens) {
        const turn = this.turns.get(turnId);
        if (!turn)
            return;
        turn.inputTokens += Math.max(0, inputTokens);
        turn.outputTokens += Math.max(0, outputTokens);
    }
    finish(turnId, httpStatus) {
        const turn = this.turns.get(turnId);
        if (!turn || turn.status !== "RUNNING")
            return;
        turn.status = httpStatus < 400 ? "DONE" : "FAILED";
        turn.finishedAtMs = this.now();
        turn.finishedAt = new Date(turn.finishedAtMs).toISOString();
    }
    list() {
        this.prune();
        return [...this.turns.values()]
            .map(({ finishedAtMs: _finished, ...view }) => ({ ...view }))
            .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    }
    prune() {
        const now = this.now();
        for (const [id, turn] of this.turns) {
            if (turn.finishedAtMs !== undefined && now - turn.finishedAtMs > KEEP_FINISHED_MS)
                this.turns.delete(id);
        }
        while (this.turns.size > MAX_TURNS) {
            const oldest = this.turns.keys().next().value;
            if (oldest === undefined)
                break;
            this.turns.delete(oldest);
        }
    }
}
