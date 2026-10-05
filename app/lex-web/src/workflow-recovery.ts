import type { ResettableWorkflow } from "./api.js";

// What the chat offers when a case workflow stops a message before the model:
// start the pleading pipeline, or begin a new stage of a finished workflow.
// The message waits and is sent again after the user's click.
export type WorkflowRecovery =
  | { kind: "process-start"; acceptOnly: boolean }
  | { kind: "reset"; workflow: ResettableWorkflow; title: string };

const ORDERED_TITLES: Record<string, string> = {
  EVIDENCE_ANALYSIS_V1: "Analiza dowodów w tej sprawie jest zakończona",
  WITNESS_QUESTIONING_V1: "Przygotowanie przesłuchania w tej sprawie jest zakończone"
};

export function workflowRecovery(code: string, reason?: string): WorkflowRecovery | null {
  if (code === "PROCESS_PLEADING_STATE_REQUIRED") return { kind: "process-start", acceptOnly: false };
  if (code === "PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED") return { kind: "process-start", acceptOnly: true };
  if (code === "PROCESS_PLEADING_ALREADY_FINAL") {
    return { kind: "reset", workflow: { kind: "process-pleading" }, title: "Pismo procesowe w tej sprawie ma status FINAL" };
  }
  if (code === "COURT_ANALYSIS_ALREADY_COMPLETE") {
    return { kind: "reset", workflow: { kind: "court-analysis" }, title: "Analiza sądowa w tej sprawie jest zakończona" };
  }
  if (code === "CONTRACT_ALREADY_COMPLETE") {
    return { kind: "reset", workflow: { kind: "contract-analysis" }, title: "Analiza umowy w tej sprawie jest zakończona" };
  }
  if (code === "ORDERED_WORKFLOW_ALREADY_COMPLETE" && reason && ORDERED_TITLES[reason]) {
    return { kind: "reset", workflow: { kind: "ordered", workflowId: reason }, title: ORDERED_TITLES[reason]! };
  }
  return null;
}
