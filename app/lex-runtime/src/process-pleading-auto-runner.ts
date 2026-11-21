import {
  completeProcessExecution,
  requireProcessExecutionPermit,
  type ProcessExecutionPermit
} from "./process-pleading-execution-gate.js";
import {
  validateProcessPleadingState,
  type ProcessPleadingState
} from "./process-pleading-state.js";

export const PROCESS_AUTO_MAX_STEPS = 4;
// W1 checkpoints done ahead of the active one in the same answer. Default 0, one checkpoint per
// answer as in a chat: XI P 27/26, 2026-11-21, one ahead 858 s but the reports thinner (theses 10
// against 65, no CN gate); none 1213 s with the reports close to before (1429 s). LEX_PROCESS_AHEAD=1
// trades the detail for speed.
export const PROCESS_AUTO_AHEAD = Math.max(0, Math.min(2, Number(process.env.LEX_PROCESS_AHEAD ?? 0) || 0));

export type ProcessAutoNodeOutcome<T> = {
  result: T;
  commit: boolean;
  // The answer found this conditional checkpoint not applicable (reason).
  notApplicable?: string | null;
  // The checkpoint asked the user (missing facts, a decision): not committed, the loop
  // stops and the user's reply runs the same checkpoint again.
  waitingForUser?: boolean;
};

export type ProcessAutoStep<T> = {
  permit: ProcessExecutionPermit;
  result: T;
  revisionAfter: number;
  stageAfter: ProcessPleadingState["stage"];
};

export type ProcessAutoSequenceResult<T> = {
  state: ProcessPleadingState;
  steps: ProcessAutoStep<T>[];
  stopped:
    | "FINAL"
    | "LIMIT_REACHED"
    | "NODE_BLOCKED"
    | "WAITING_FOR_USER"
    // W2 closed (STOP 2 of pisma-procesowe-v3): the turn ends on the draft, the application
    // makes its file, the chain goes on to W3 (user, 2026-11-17).
    | "STAGE_STOP";
  limitReached: boolean;
  blockedResult?: T;
  waitingResult?: T;
};

function assertSameWorkflow(
  previous: ProcessPleadingState,
  next: ProcessPleadingState
): void {
  if (
    previous.caseId !== next.caseId ||
    previous.workflowId !== next.workflowId ||
    previous.mode !== next.mode
  ) {
    throw new Error(
      "PROCESS_PLEADING_AUTO_STATE_CONFLICT"
    );
  }
}

export async function runBoundedProcessAutoSequence<T>(args: {
  initialState: ProcessPleadingState;
  maxSteps?: number;
  prepareState?: (
    state: ProcessPleadingState
  ) => Promise<ProcessPleadingState>;
  execute: (
    permit: ProcessExecutionPermit,
    state: ProcessPleadingState
  ) => Promise<ProcessAutoNodeOutcome<T>>;
  persist: (
    previous: ProcessPleadingState,
    next: ProcessPleadingState
  ) => Promise<ProcessPleadingState>;
}): Promise<ProcessAutoSequenceResult<T>> {
  const maxSteps =
    args.maxSteps ??
    PROCESS_AUTO_MAX_STEPS;
  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps >
      PROCESS_AUTO_MAX_STEPS
  ) {
    throw new Error(
      "PROCESS_PLEADING_AUTO_STEP_LIMIT_INVALID"
    );
  }

  let state =
    validateProcessPleadingState(
      args.initialState
    );
  if (state.mode !== "AUTO") {
    throw new Error(
      "PROCESS_PLEADING_AUTO_MODE_REQUIRED"
    );
  }

  const steps:
    ProcessAutoStep<T>[] = [];

  for (
    let index = 0;
    index < maxSteps;
    index += 1
  ) {
    if (args.prepareState) {
      const prepared =
        validateProcessPleadingState(
          await args.prepareState(
            state
          )
        );
      assertSameWorkflow(
        state,
        prepared
      );
      if (
        prepared.revision <
        state.revision
      ) {
        throw new Error(
          "PROCESS_PLEADING_AUTO_STATE_CONFLICT"
        );
      }
      state = prepared;
    }

    if (state.stage === "FINAL") {
      return {
        state,
        steps,
        stopped: "FINAL",
        limitReached: false
      };
    }

    const permit =
      requireProcessExecutionPermit(
        state
      );
    if (permit.mode !== "AUTO") {
      throw new Error(
        "PROCESS_PLEADING_AUTO_MODE_REQUIRED"
      );
    }

    const node =
      await args.execute(
        permit,
        state
      );
    if (node.commit && node.waitingForUser) {
      return {
        state,
        steps,
        stopped:
          "WAITING_FOR_USER",
        limitReached: false,
        waitingResult:
          node.result
      };
    }
    if (!node.commit) {
      return {
        state,
        steps,
        stopped:
          "NODE_BLOCKED",
        limitReached: false,
        blockedResult:
          node.result
      };
    }

    const next =
      completeProcessExecution(
        state,
        permit,
        node.notApplicable ?? null
      );
    const persisted =
      validateProcessPleadingState(
        await args.persist(
          state,
          next
        )
      );

    assertSameWorkflow(
      state,
      persisted
    );
    if (
      persisted.revision !==
        next.revision ||
      persisted.stage !==
        next.stage ||
      persisted.pendingCheckpoint !==
        next.pendingCheckpoint
    ) {
      throw new Error(
        "PROCESS_PLEADING_AUTO_STATE_CONFLICT"
      );
    }

    const stagePassed = state.stage;
    state = persisted;
    steps.push({
      permit,
      result: node.result,
      revisionAfter:
        state.revision,
      stageAfter:
        state.stage
    });

    if (state.stage === "FINAL") {
      return {
        state,
        steps,
        stopped: "FINAL",
        limitReached: false
      };
    }
    if (stagePassed === "W2" && state.stage !== "W2") {
      return {
        state,
        steps,
        stopped: "STAGE_STOP",
        limitReached: false
      };
    }
  }

  return {
    state,
    steps,
    stopped:
      "LIMIT_REACHED",
    limitReached: true
  };
}
