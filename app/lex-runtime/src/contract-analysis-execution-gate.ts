import {
  completeContractCheckpoint,
  contractCheckpointBatch,
  nextContractCheckpoint,
  validateContractAnalysisState,
  type ContractAnalysisState,
  type ContractCheckpoint,
  type ContractStage,
  type ContractWorkflowMode
} from "./contract-analysis-state.js";

export type ContractExecutionPermit = {
  revision: number;
  mode: ContractWorkflowMode;
  stage: Exclude<
    ContractStage,
    "COMPLETE"
  >;
  checkpoint:
    ContractCheckpoint;
  // The checkpoints this turn runs, the first being `checkpoint` (contractCheckpointBatch).
  checkpoints: ContractCheckpoint[];
};

export function requireContractExecutionPermit(
  input:
    ContractAnalysisState | null
): ContractExecutionPermit {
  if (!input) {
    throw new Error(
      "CONTRACT_STATE_REQUIRED"
    );
  }
  const state =
    validateContractAnalysisState(
      input
    );
  if (
    state.stage ===
      "COMPLETE"
  ) {
    throw new Error(
      "CONTRACT_ALREADY_COMPLETE"
    );
  }
  const checkpoint =
    nextContractCheckpoint(
      state
    );
  if (!checkpoint) {
    throw new Error(
      "CONTRACT_CHECKPOINT_UNAVAILABLE"
    );
  }

  return {
    revision:
      state.revision,
    mode:
      state.mode,
    stage:
      state.stage,
    checkpoint,
    checkpoints: contractCheckpointBatch(state)
  };
}

export function completeContractExecution(
  input:
    ContractAnalysisState,
  permit:
    ContractExecutionPermit,
  auditRefs:
    readonly string[],
  closed?: readonly ContractCheckpoint[]
): ContractAnalysisState {
  const state =
    validateContractAnalysisState(
      input
    );
  if (
    state.revision !==
      permit.revision ||
    state.mode !==
      permit.mode ||
    state.stage !==
      permit.stage
  ) {
    throw new Error(
      "CONTRACT_STATE_CONFLICT"
    );
  }
  if (
    nextContractCheckpoint(
      state
    ) !==
      permit.checkpoint
  ) {
    throw new Error(
      "CONTRACT_CHECKPOINT_CONFLICT"
    );
  }

  // The checkpoints the answer closed, in the order of the batch; the first one at least
  // (the turn passed every gate).
  const batch = permit.checkpoints?.length ? permit.checkpoints : [permit.checkpoint];
  const wanted = new Set(closed ?? [permit.checkpoint]);
  let next = state;
  for (const [index, checkpoint] of batch.entries()) {
    if (index > 0 && !wanted.has(checkpoint)) break;
    next = completeContractCheckpoint(next, checkpoint, auditRefs);
  }
  return next;
}
