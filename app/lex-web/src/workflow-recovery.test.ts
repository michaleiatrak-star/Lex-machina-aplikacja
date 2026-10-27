import { describe, expect, it } from "vitest";
import { declinesProcessStart, workflowRecovery } from "./workflow-recovery.js";

describe("workflow recovery in the chat", () => {
  it("offers to start the pleading pipeline instead of a dead error", () => {
    expect(workflowRecovery("PROCESS_PLEADING_STATE_REQUIRED")).toEqual({ kind: "process-start", acceptOnly: false });
    expect(workflowRecovery("PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED")).toEqual({ kind: "process-start", acceptOnly: true });
  });

  it("offers a new stage of a finished workflow", () => {
    expect(workflowRecovery("PROCESS_PLEADING_ALREADY_FINAL")).toMatchObject({ workflow: { kind: "process-pleading" } });
    expect(workflowRecovery("COURT_ANALYSIS_ALREADY_COMPLETE")).toMatchObject({ workflow: { kind: "court-analysis" } });
    expect(workflowRecovery("CONTRACT_ALREADY_COMPLETE")).toMatchObject({ workflow: { kind: "contract-analysis" } });
    expect(workflowRecovery("ORDERED_WORKFLOW_ALREADY_COMPLETE", "EVIDENCE_ANALYSIS_V1")).toMatchObject({
      workflow: { kind: "ordered", workflowId: "EVIDENCE_ANALYSIS_V1" }
    });
  });

  it("leaves other errors to the message", () => {
    expect(workflowRecovery("ORDERED_WORKFLOW_ALREADY_COMPLETE")).toBeNull();
    expect(workflowRecovery("PROCESS_PLEADING_CONFIRMATION_REQUIRED")).toBeNull();
    expect(workflowRecovery("PROVIDER_EXECUTION_FAILED")).toBeNull();
  });

  it("does not restart the pipeline on a declined start", () => {
    for (const text of ["b", "B) Nie — zakończ lub wyjaśnij wątpliwości", "nie", "NIE, mam pytanie"]) {
      expect(declinesProcessStart("PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED", text), text).toBe(true);
    }
    for (const text of ["a", "Tak", "Napisz pozew", "bez zmian"]) {
      expect(declinesProcessStart("PROCESS_PLEADING_START_ACCEPTANCE_REQUIRED", text), text).toBe(false);
    }
    expect(declinesProcessStart("PROCESS_PLEADING_CONFIRMATION_REQUIRED", "b")).toBe(false);
  });
});
