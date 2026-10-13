// Mechanical workflows run one checkpoint per answer. When a checkpoint closed and the
// next one needs nothing from the user, the chat continues by itself with the same
// message the user would type, so routing and module triggers stay as they are.

export const AUTO_ADVANCE_MESSAGE = "Kontynuuj.";
// Automatic continuations after one message of the user; then the user decides.
export const AUTO_ADVANCE_MAX_CHAIN = 12;

type WorkflowView = { nextCheckpoint: string | null } | undefined;

export type AutoAdvanceInput = {
  status: "DRAFT_PRESENTABLE" | "BLOCKED";
  waitingForUser?: boolean;
  processAuto?: { stopped: string };
  processWorkflow?: { mode: string; stage: string; pendingCheckpoint: string | null };
  courtWorkflow?: WorkflowView;
  chronologyWorkflow?: WorkflowView;
  contractWorkflow?: WorkflowView;
  orderedCaseWorkflow?: { status: string; nextCheckpoint: string | null };
};

export type AutoAdvanceDecision =
  | { advance: true; next: string; label: string }
  | { advance: false; reason: "BLOCKED" | "WAITING_FOR_USER" | "CONFIRMATION" | "COMPLETE" | "NOT_WORKFLOW" | "NO_PROGRESS" | "LIMIT" };

const WORKFLOW_LABELS: Array<[keyof AutoAdvanceInput, string]> = [
  ["courtWorkflow", "analiza sądowa"],
  ["chronologyWorkflow", "chronologia"],
  ["contractWorkflow", "analiza umowy"]
];

/**
 * `previousNext`: the checkpoint the last automatic continuation was sent for. The same
 * checkpoint again means the answer did not close it; the chat stops instead of looping.
 */
export function autoAdvanceDecision(result: AutoAdvanceInput, chain: number, previousNext: string | null = null): AutoAdvanceDecision {
  if (result.status !== "DRAFT_PRESENTABLE") return { advance: false, reason: "BLOCKED" };
  if (result.waitingForUser) return { advance: false, reason: "WAITING_FOR_USER" };
  let next: string | null = null;
  let label = "";
  if (result.processWorkflow) {
    // CHECKPOINT mode: the user confirms every step; AUTO runs a bounded loop on the
    // server and continues only after its step limit.
    if (result.processWorkflow.mode !== "AUTO") return { advance: false, reason: "CONFIRMATION" };
    if (result.processWorkflow.stage === "FINAL") return { advance: false, reason: "COMPLETE" };
    if (result.processAuto?.stopped !== "LIMIT_REACHED") {
      return { advance: false, reason: result.processAuto?.stopped === "FINAL" ? "COMPLETE" : "BLOCKED" };
    }
    next = `pismo procesowe, etap ${result.processWorkflow.stage}`;
    label = `pismo procesowe: kolejne kroki etapu ${result.processWorkflow.stage}`;
  } else if (result.orderedCaseWorkflow) {
    if (result.orderedCaseWorkflow.status !== "ACTIVE" || !result.orderedCaseWorkflow.nextCheckpoint) return { advance: false, reason: "COMPLETE" };
    next = result.orderedCaseWorkflow.nextCheckpoint;
    label = `krok ${next}`;
  } else {
    const found = WORKFLOW_LABELS.find(([key]) => result[key]);
    if (!found) return { advance: false, reason: "NOT_WORKFLOW" };
    const view = result[found[0]] as WorkflowView;
    if (!view?.nextCheckpoint) return { advance: false, reason: "COMPLETE" };
    next = view.nextCheckpoint;
    label = `${found[1]}: krok ${next}`;
  }
  if (previousNext !== null && next === previousNext && !result.processWorkflow) return { advance: false, reason: "NO_PROGRESS" };
  if (chain >= AUTO_ADVANCE_MAX_CHAIN) return { advance: false, reason: "LIMIT" };
  return { advance: true, next, label };
}

export function autoAdvanceNote(label: string): string {
  return `Automatyczne przejście do następnego kroku (${label}). Możesz je wstrzymać przyciskiem pod polem wiadomości.`;
}

export function autoAdvanceStopNote(reason: AutoAdvanceDecision & { advance: false }): string | null {
  switch (reason.reason) {
    case "NO_PROGRESS":
      return "Automatyczne przejście zatrzymane: krok nie został zamknięty. Sprawdź odpowiedź i napisz, jak kontynuować.";
    case "LIMIT":
      return `Automatyczne przejście zatrzymane po ${AUTO_ADVANCE_MAX_CHAIN} krokach. Napisz „Kontynuuj.”, aby przejść dalej.`;
    default:
      return null;
  }
}
