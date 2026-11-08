export const CONTRACT_CHECKPOINTS = [
    "AU-F0",
    "AU-GAP",
    "AU-POV",
    "AU-ROUTE",
    "AU-A",
    "AU-B",
    "AU-C",
    "AU-D",
    "AU-F",
    "AU-GENCORE",
    "AU-GENBUILD",
    "AU-GENSHARED",
    "AU-HYBRID",
    "AU-STRIP",
    "AU-POST",
    "AU-DISC"
];
const CASE_ID = /^case_[a-f0-9]{32}$/;
const AUDIT_REF = /^[A-Za-z0-9._:/-]{3,240}$/;
const REASON_CONTROL = /[\x00-\x1f\x7f]/g;
const HISTORY_MAX = 128;
const COMMON_SEQUENCE = [
    "AU-F0",
    "AU-GAP",
    "AU-POV",
    "AU-ROUTE"
];
const ANALYSIS_SEQUENCE = [
    "AU-A",
    "AU-B",
    "AU-C",
    "AU-D",
    "AU-F"
];
const GENERATION_SEQUENCE = [
    "AU-GENCORE",
    "AU-GENBUILD",
    "AU-GENSHARED"
];
const FINALIZATION_SEQUENCE = [
    "AU-HYBRID",
    "AU-STRIP",
    "AU-POST",
    "AU-DISC"
];
const OBJECTIVE_NA = new Set([
    "AU-GAP",
    "AU-POV"
]);
function validIso(value) {
    return (typeof value === "string" &&
        value.length > 0 &&
        value.length <= 64 &&
        !Number.isNaN(Date.parse(value)));
}
function sequenceForMode(mode) {
    return [
        ...COMMON_SEQUENCE,
        ...(mode === "ANALYSIS"
            ? ANALYSIS_SEQUENCE
            : GENERATION_SEQUENCE),
        ...FINALIZATION_SEQUENCE
    ];
}
function stageForCheckpoint(checkpoint) {
    if (!checkpoint) {
        return "COMPLETE";
    }
    if (COMMON_SEQUENCE.includes(checkpoint)) {
        return "INTAKE";
    }
    if (ANALYSIS_SEQUENCE.includes(checkpoint)) {
        return "ANALYSIS";
    }
    if (GENERATION_SEQUENCE.includes(checkpoint)) {
        return "GENERATION";
    }
    return "FINALIZATION";
}
function sanitizeAuditRefs(values) {
    const refs = [
        ...new Set(values.map((value) => value.trim()))
    ];
    if (refs.length < 1 ||
        refs.length > 64 ||
        refs.some((value) => !AUDIT_REF.test(value))) {
        throw new Error("CONTRACT_AUDIT_REFS_INVALID");
    }
    return refs;
}
function sanitizeReason(value) {
    const reason = value
        .normalize("NFKC")
        .replace(REASON_CONTROL, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (reason.length < 3 ||
        reason.length > 500) {
        throw new Error("CONTRACT_NA_REASON_INVALID");
    }
    return reason;
}
function clone(state) {
    return {
        ...state,
        closedCheckpoints: [
            ...state.closedCheckpoints
        ],
        history: state.history.map((event) => ({
            ...event,
            auditRefs: [
                ...event.auditRefs
            ]
        }))
    };
}
export function createContractAnalysisState(caseId, mode, at = new Date().toISOString()) {
    if (!CASE_ID.test(caseId) ||
        ![
            "ANALYSIS",
            "REDACTION",
            "DRAFT",
            "SUPPLEMENT"
        ].includes(mode) ||
        !validIso(at)) {
        throw new Error("CONTRACT_INITIAL_STATE_INVALID");
    }
    return {
        schemaVersion: 1,
        workflowId: "CONTRACT_ANALYSIS_V1",
        caseId,
        revision: 1,
        mode,
        stage: "INTAKE",
        closedCheckpoints: [],
        history: [],
        createdAt: at,
        updatedAt: at
    };
}
export function nextContractCheckpoint(input) {
    const state = validateContractAnalysisState(input);
    const sequence = sequenceForMode(state.mode);
    return (sequence[state.closedCheckpoints
        .length] ?? null);
}
export function validateContractAnalysisState(input) {
    if (input.schemaVersion !== 1 ||
        input.workflowId !==
            "CONTRACT_ANALYSIS_V1" ||
        !CASE_ID.test(input.caseId) ||
        !Number.isSafeInteger(input.revision) ||
        input.revision < 1 ||
        ![
            "ANALYSIS",
            "REDACTION",
            "DRAFT",
            "SUPPLEMENT"
        ].includes(input.mode) ||
        ![
            "INTAKE",
            "ANALYSIS",
            "GENERATION",
            "FINALIZATION",
            "COMPLETE"
        ].includes(input.stage) ||
        !Array.isArray(input.closedCheckpoints) ||
        !Array.isArray(input.history) ||
        input.history.length >
            HISTORY_MAX ||
        !validIso(input.createdAt) ||
        !validIso(input.updatedAt)) {
        throw new Error("CONTRACT_STATE_INVALID");
    }
    const sequence = sequenceForMode(input.mode);
    if (input.closedCheckpoints
        .length >
        sequence.length ||
        input.closedCheckpoints.some((checkpoint, index) => checkpoint !==
            sequence[index])) {
        throw new Error("CONTRACT_CHECKPOINT_PREFIX_INVALID");
    }
    const expectedStage = stageForCheckpoint(sequence[input.closedCheckpoints
        .length] ?? null);
    if (input.stage !==
        expectedStage) {
        throw new Error("CONTRACT_STAGE_INVALID");
    }
    if (input.history.length !==
        input.closedCheckpoints
            .length) {
        throw new Error("CONTRACT_HISTORY_INVALID");
    }
    let previousSequence = 0;
    for (let index = 0; index <
        input.history.length; index += 1) {
        const event = input.history[index];
        const checkpoint = input.closedCheckpoints[index];
        if (event.sequence <=
            previousSequence ||
            !Number.isSafeInteger(event.sequence) ||
            !validIso(event.at) ||
            event.checkpoint !==
                checkpoint ||
            ![
                "DONE",
                "NA"
            ].includes(event.outcome) ||
            ![
                "INTAKE",
                "ANALYSIS",
                "GENERATION",
                "FINALIZATION",
                "COMPLETE"
            ].includes(event.fromStage) ||
            ![
                "INTAKE",
                "ANALYSIS",
                "GENERATION",
                "FINALIZATION",
                "COMPLETE"
            ].includes(event.toStage)) {
            throw new Error("CONTRACT_HISTORY_INVALID");
        }
        sanitizeAuditRefs(event.auditRefs);
        if (event.outcome === "NA") {
            if (!OBJECTIVE_NA.has(event.checkpoint) ||
                typeof event.reason !==
                    "string") {
                throw new Error("CONTRACT_NA_STATE_INVALID");
            }
            sanitizeReason(event.reason);
        }
        else if (event.reason !==
            undefined) {
            throw new Error("CONTRACT_HISTORY_INVALID");
        }
        previousSequence =
            event.sequence;
    }
    return clone(input);
}
function closeCheckpoint(input, checkpoint, outcome, auditRefs, at, reason) {
    const state = validateContractAnalysisState(input);
    if (!validIso(at)) {
        throw new Error("CONTRACT_TIMESTAMP_INVALID");
    }
    const expected = nextContractCheckpoint(state);
    if (expected !== checkpoint) {
        throw new Error(`CONTRACT_CHECKPOINT_OUT_OF_ORDER:expected=${expected ?? "NONE"}:actual=${checkpoint}`);
    }
    const refs = sanitizeAuditRefs(auditRefs);
    const fromStage = state.stage;
    const sequence = sequenceForMode(state.mode);
    const nextIndex = state.closedCheckpoints
        .length + 1;
    const next = sequence[nextIndex] ??
        null;
    const toStage = stageForCheckpoint(next);
    state.closedCheckpoints.push(checkpoint);
    state.stage = toStage;
    state.revision += 1;
    state.updatedAt = at;
    state.history.push({
        sequence: (state.history.at(-1)
            ?.sequence ?? 0) + 1,
        at,
        checkpoint,
        outcome,
        fromStage,
        toStage,
        auditRefs: refs,
        ...(reason
            ? { reason }
            : {})
    });
    state.history =
        state.history.slice(-HISTORY_MAX);
    return validateContractAnalysisState(state);
}
export function completeContractCheckpoint(input, checkpoint, auditRefs, at = new Date().toISOString()) {
    return closeCheckpoint(input, checkpoint, "DONE", auditRefs, at);
}
export function markContractCheckpointNotApplicable(input, checkpoint, reason, auditRefs, at = new Date().toISOString()) {
    if (!OBJECTIVE_NA.has(checkpoint)) {
        throw new Error("CONTRACT_NA_NOT_ALLOWED");
    }
    return closeCheckpoint(input, checkpoint, "NA", auditRefs, at, sanitizeReason(reason));
}
export function contractWorkflowSequence(mode) {
    return sequenceForMode(mode);
}
/**
 * The checkpoints one turn runs: from the next open one through the end of the analysis
 * (intake, routing and modules A-F in ANALYSIS mode; intake and routing in the other modes).
 * Generation and finalization gates stay one per turn. Before (contract test 2026-11-07) a
 * turn was given one checkpoint, the model wrote the whole analysis, the state closed one
 * checkpoint and stayed at INTAKE: sixteen turns to finish.
 */
export function contractCheckpointBatch(input) {
    const state = validateContractAnalysisState(input);
    const sequence = sequenceForMode(state.mode);
    const open = sequence.slice(state.closedCheckpoints.length);
    const first = open[0];
    if (!first)
        return [];
    const batchable = new Set([...COMMON_SEQUENCE, ...(state.mode === "ANALYSIS" ? ANALYSIS_SEQUENCE : [])]);
    if (!batchable.has(first))
        return [first];
    const batch = [];
    for (const checkpoint of open) {
        if (!batchable.has(checkpoint))
            break;
        batch.push(checkpoint);
    }
    return batch;
}
const NOT_CLOSED_MARK = /⚠️|⬛|POMINI[ĘE]T|NIE\s+WYKONAN|nie\s+wykona(?:łem|no)|DO\s+UZUPEŁNIENIA|OCZEKUJE|BLOCKED|FAIL/iu;
const CLOSED_MARK = /✅|\bDONE\b|\bPASS\b|wykonan[oy]|— N\/A|\bN\/A\b/iu;
function checkpointsOnLine(line, batch) {
    const found = new Set();
    const order = CONTRACT_CHECKPOINTS;
    // "AU-A–AU-D", "AU-A…AU-F", "AU-A do AU-F": every checkpoint of the range.
    for (const range of line.matchAll(/\b(AU-[A-Z0-9]+)\s*(?:–|—|-|…|\.\.\.?|do)\s*(AU-[A-Z0-9]+)\b/gu)) {
        const from = order.indexOf(range[1]);
        const to = order.indexOf(range[2]);
        if (from >= 0 && to >= from)
            for (const item of order.slice(from, to + 1))
                found.add(item);
    }
    for (const single of line.matchAll(/\bAU-[A-Z0-9]+\b/gu)) {
        if (order.includes(single[0]))
            found.add(single[0]);
    }
    return [...found].filter((item) => batch.includes(item));
}
/**
 * Which checkpoints of the batch the answer closes, in order: the answer's trace (a line with
 * the checkpoint and its mark) decides; the first one marked as skipped, missing or waiting
 * stops the run, so the next turn starts there. A line's first mark is its status ("| ✅ |
 * AU-F0, AU-POV (rozbieżność ⬛)" closes both). Without a trace only the first checkpoint
 * closes (the turn passed its gates; what else it covered is not shown).
 */
// AU-GAP and AU-POV are often left out of a trace when there was nothing to do (no gap, no
// firm): closed when a later checkpoint of the trace is done.
function impliedDone(checkpoint, status) {
    if (!OBJECTIVE_NA.has(checkpoint))
        return false;
    const order = CONTRACT_CHECKPOINTS;
    return [...status].some(([item, done]) => done && order.indexOf(item) > order.indexOf(checkpoint));
}
export function contractCheckpointsClosedByAnswer(answer, batch) {
    if (batch.length <= 1)
        return [...batch];
    const status = new Map();
    for (const line of answer.split(/\r?\n/u)) {
        const items = checkpointsOnLine(line, batch);
        if (!items.length)
            continue;
        const open = NOT_CLOSED_MARK.exec(line);
        const closed = CLOSED_MARK.exec(line);
        if (!open && !closed)
            continue;
        const isClosed = Boolean(closed && (!open || closed.index < open.index));
        // A later trace line wins over an earlier mention ("AU-POV ⬛" in the text, "✅" in the trace).
        for (const item of items)
            status.set(item, isClosed);
    }
    if (!status.size)
        return batch.slice(0, 1);
    const result = [];
    for (const checkpoint of batch) {
        // Not in the trace: a checkpoint the answer did not report (N/A ones are written as such).
        if (status.get(checkpoint) === false || (!status.has(checkpoint) && checkpoint !== batch[0] && !impliedDone(checkpoint, status)))
            break;
        result.push(checkpoint);
    }
    return result;
}
