import { describe, expect, it } from "vitest";
import { AUTO_ADVANCE_MAX_CHAIN, autoAdvanceDecision, autoAdvanceStopNote } from "./workflow-auto-advance.js";

const ok = "DRAFT_PRESENTABLE" as const;

describe("automatic continuation of a mechanical workflow", () => {
  it("continues a closed checkpoint of court analysis, chronology, contract and ordered workflows", () => {
    expect(autoAdvanceDecision({ status: ok, courtWorkflow: { nextCheckpoint: "PASS_II_SOURCES_VERIFIED" } }, 0)).toEqual({
      advance: true,
      next: "PASS_II_SOURCES_VERIFIED",
      label: "analiza sądowa: krok PASS_II_SOURCES_VERIFIED"
    });
    expect(autoAdvanceDecision({ status: ok, chronologyWorkflow: { nextCheckpoint: "EVENT_EXTRACTION_COMPLETE" } }, 3).advance).toBe(true);
    expect(autoAdvanceDecision({ status: ok, contractWorkflow: { nextCheckpoint: "AU-B" } }, 1).advance).toBe(true);
    expect(autoAdvanceDecision({ status: ok, orderedCaseWorkflow: { status: "ACTIVE", nextCheckpoint: "AD-BLOKG" } }, 0).advance).toBe(true);
  });

  it("stops when the answer asks the user, is blocked, or the workflow is complete", () => {
    expect(autoAdvanceDecision({ status: ok, waitingForUser: true, contractWorkflow: { nextCheckpoint: "AU-GAP" } }, 0)).toEqual({ advance: false, reason: "WAITING_FOR_USER" });
    expect(autoAdvanceDecision({ status: "BLOCKED", contractWorkflow: { nextCheckpoint: "AU-B" } }, 0)).toEqual({ advance: false, reason: "BLOCKED" });
    expect(autoAdvanceDecision({ status: ok, courtWorkflow: { nextCheckpoint: null } }, 0)).toEqual({ advance: false, reason: "COMPLETE" });
    expect(autoAdvanceDecision({ status: ok, orderedCaseWorkflow: { status: "COMPLETE", nextCheckpoint: null } }, 0)).toEqual({ advance: false, reason: "COMPLETE" });
    expect(autoAdvanceDecision({ status: ok }, 0)).toEqual({ advance: false, reason: "NOT_WORKFLOW" });
  });

  it("process pleading: CHECKPOINT mode waits for confirmation; AUTO continues only after its step limit", () => {
    const process = (mode: string, stage = "W1") => ({ mode, stage, pendingCheckpoint: null });
    expect(autoAdvanceDecision({ status: ok, processWorkflow: process("CHECKPOINT") }, 0)).toEqual({ advance: false, reason: "CONFIRMATION" });
    expect(autoAdvanceDecision({ status: ok, processWorkflow: process("AUTO"), processAuto: { stopped: "LIMIT_REACHED" } }, 0).advance).toBe(true);
    expect(autoAdvanceDecision({ status: ok, processWorkflow: process("AUTO"), processAuto: { stopped: "WAITING_FOR_USER" } }, 0).advance).toBe(false);
    expect(autoAdvanceDecision({ status: ok, processWorkflow: process("AUTO", "FINAL"), processAuto: { stopped: "FINAL" } }, 0)).toEqual({ advance: false, reason: "COMPLETE" });
    expect(autoAdvanceDecision({ status: ok, processWorkflow: process("AUTO"), processAuto: { stopped: "NODE_BLOCKED" } }, 0)).toEqual({ advance: false, reason: "BLOCKED" });
  });

  it("the same checkpoint again (not closed) and the chain limit stop the loop, with a note", () => {
    const again = autoAdvanceDecision({ status: ok, contractWorkflow: { nextCheckpoint: "AU-B" } }, 2, "AU-B");
    expect(again).toEqual({ advance: false, reason: "NO_PROGRESS" });
    expect(autoAdvanceStopNote(again as never)).toContain("krok nie został zamknięty");
    const limit = autoAdvanceDecision({ status: ok, contractWorkflow: { nextCheckpoint: "AU-C" } }, AUTO_ADVANCE_MAX_CHAIN, "AU-B");
    expect(limit).toEqual({ advance: false, reason: "LIMIT" });
    expect(autoAdvanceStopNote(limit as never)).toContain(String(AUTO_ADVANCE_MAX_CHAIN));
    expect(autoAdvanceStopNote({ advance: false, reason: "WAITING_FOR_USER" })).toBeNull();
  });
});
