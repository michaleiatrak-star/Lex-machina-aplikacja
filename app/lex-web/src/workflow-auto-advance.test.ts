import { describe, expect, it } from "vitest";
import type { SessionExecutionResponse } from "./api.js";
import { AUTO_ADVANCE_MAX_STEPS, autoAdvanceDecision, autoAdvanceNote, WAIT_FOR_USER_MARKER } from "./workflow-auto-advance.js";

const contract = (closed: string[], next: string | null, answer = "Moduł B wykonany.", status = "DRAFT_PRESENTABLE") =>
  ({
    status,
    answer,
    contractWorkflow: { caseId: "c", revision: 3, mode: "ANALYSIS", stage: "ANALYSIS", nextCheckpoint: next, closedCheckpoints: closed }
  }) as unknown as SessionExecutionResponse;

describe("automatic next step of a checkpoint workflow", () => {
  it("contract analysis: a closed step sends the next one, named", () => {
    const decision = autoAdvanceDecision(contract(["AU-F0", "AU-GAP", "AU-POV", "AU-ROUTE", "AU-A", "AU-B"], "AU-C"), 5, 3);
    expect(decision).toMatchObject({ advance: true, next: "AU-C", message: "Kontynuuj." });
    expect(decision.advance && decision.meta).toContain("AU-C — Moduł C: zgodność z prawem");
    expect(autoAdvanceNote(contract(["AU-B"], "AU-C"), decision)).toContain("Następny krok: AU-C");
  });

  it("stops when the step asks the user, did not close, was blocked, ended or hit the limit", () => {
    expect(autoAdvanceDecision(contract(["AU-F0"], "AU-GAP", `Podaj datę zawarcia.\n${WAIT_FOR_USER_MARKER}`), 0, 0)).toEqual({ advance: false, reason: "WAITING_FOR_USER" });
    expect(autoAdvanceDecision(contract(["AU-F0"], "AU-GAP"), 1, 1)).toEqual({ advance: false, reason: "NO_PROGRESS" });
    expect(autoAdvanceDecision(contract(["AU-F0"], "AU-GAP", "", "BLOCKED"), 0, 1)).toEqual({ advance: false, reason: "BLOCKED" });
    expect(autoAdvanceDecision(contract(["AU-DISC"], null), 15, 1)).toEqual({ advance: false, reason: "COMPLETE" });
    expect(autoAdvanceDecision(contract(["AU-F0", "AU-GAP"], "AU-POV"), 1, AUTO_ADVANCE_MAX_STEPS)).toEqual({ advance: false, reason: "LIMIT" });
    expect(autoAdvanceDecision({ status: "DRAFT_PRESENTABLE", answer: "x" } as SessionExecutionResponse, null, 0)).toEqual({ advance: false, reason: "NO_WORKFLOW" });
  });

  it("process pleading: only AUTO mode, after the server's batch reached its limit", () => {
    const checkpoints = { "CP-1a": "CLOSED", "CP-1b": "NA", "CP-1c-skan": "OPEN" };
    const pleading = (stopped: string, mode = "AUTO") =>
      ({
        status: "DRAFT_PRESENTABLE",
        answer: "Kroki wykonane.",
        processAuto: { maxSteps: 4, stopped, limitReached: stopped === "LIMIT_REACHED", steps: [] },
        processWorkflow: { caseId: "c", mode, revision: 4, stage: "W1", documentStatus: "DRAFT", pendingCheckpoint: null, checkpoints }
      }) as unknown as SessionExecutionResponse;
    expect(autoAdvanceDecision(pleading("LIMIT_REACHED"), 0, 0)).toMatchObject({ advance: true, next: "CP-1c-skan" });
    expect(autoAdvanceDecision(pleading("WAITING_FOR_USER"), 0, 0)).toEqual({ advance: false, reason: "WAITING_FOR_USER" });
    expect(autoAdvanceDecision(pleading("LIMIT_REACHED", "CHECKPOINT"), 0, 0)).toEqual({ advance: false, reason: "NO_WORKFLOW" });
  });
});
