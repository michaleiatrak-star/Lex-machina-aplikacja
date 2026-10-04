import { markProcessCheckpointNotApplicable, markProcessCheckpointReady, nextRequiredProcessCheckpoint, validateProcessPleadingState } from "./process-pleading-state.js";
export function requireProcessExecutionPermit(input) {
    if (!input) {
        throw new Error("PROCESS_PLEADING_STATE_REQUIRED");
    }
    const state = validateProcessPleadingState(input);
    if (state.stage === "CG_ACCEPTANCE") {
        throw new Error("PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED");
    }
    if (state.pendingCheckpoint) {
        throw new Error(`PROCESS_PLEADING_CONFIRMATION_REQUIRED:${state.pendingCheckpoint}`);
    }
    if (state.stage === "FINAL") {
        throw new Error("PROCESS_PLEADING_ALREADY_FINAL");
    }
    const checkpoint = nextRequiredProcessCheckpoint(state);
    if (!checkpoint) {
        throw new Error("PROCESS_PLEADING_CHECKPOINT_UNAVAILABLE");
    }
    return {
        revision: state.revision,
        stage: state.stage,
        checkpoint,
        mode: state.mode
    };
}
export function completeProcessExecution(input, permit, 
// A conditional checkpoint the answer found not applicable (with its reason).
notApplicable = null) {
    const state = validateProcessPleadingState(input);
    if (state.revision !==
        permit.revision) {
        throw new Error("PROCESS_PLEADING_STATE_CONFLICT");
    }
    if (state.stage !== permit.stage ||
        state.mode !== permit.mode) {
        throw new Error("PROCESS_PLEADING_STATE_CONFLICT");
    }
    const currentCheckpoint = nextRequiredProcessCheckpoint(state);
    if (currentCheckpoint !==
        permit.checkpoint) {
        throw new Error("PROCESS_PLEADING_CHECKPOINT_CONFLICT");
    }
    if (notApplicable && !MAIN_CHECKPOINTS.has(permit.checkpoint)) {
        return markProcessCheckpointNotApplicable(state, permit.checkpoint, notApplicable);
    }
    return markProcessCheckpointReady(state, permit.checkpoint);
}
// Checkpoints the state machine never allows as N/A (CP-W1, CP-PRE-W2, CP-ATAK, W3).
const MAIN_CHECKPOINTS = new Set(["CP-1a", "CP-W1", "CP-PRE-W2", "CP-ATAK", "CP-PODMIOT", "CP-QUALITY", "CP-AUDYT", "CP-PEER"]);
/** The case's checkpoint register for the model (closed, N/A with reason, open). */
export function processCheckpointRegister(input) {
    const state = validateProcessPleadingState(input);
    return Object.keys(state.checkpoints).map((checkpoint) => {
        const status = state.checkpoints[checkpoint];
        const reason = status === "NA" ? [...state.history].reverse().find((event) => event.type === "CHECKPOINT_NA" && event.checkpoint === checkpoint)?.reason : undefined;
        return { checkpoint, status, ...(reason ? { reason } : {}) };
    });
}
