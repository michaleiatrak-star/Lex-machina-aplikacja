import { describe, expect, it } from "vitest";
import type { SessionExecutionResponse } from "./api.js";
import { autoAdvanceDecision, autoAdvanceNote, pleadingDecision } from "./workflow-auto-advance.js";

const ORDER = ["CP-1a", "CP-1b", "CP-1c-skan", "CP-PD", "CP-FSL-D", "CP-1c-macierz", "CP-1c-lancuch", "CP-1d-anomalie", "CP-1d", "CP-W1", "CP-PRE-W2", "CP-ATAK", "CP-PODMIOT", "CP-QUALITY", "CP-AUDYT", "CP-PEER"];

function waitingAt(pending: string, closed: string[]): SessionExecutionResponse {
  return {
    status: "DRAFT_PRESENTABLE",
    answer: "Do decyzji: czy zatwierdza Pan strukturę?\n\n[CZEKAM NA ODPOWIEDŹ]",
    waitingForUser: true,
    processWorkflow: { mode: "AUTO", stage: "W1", documentStatus: "DRAFT", pendingCheckpoint: pending, checkpoints: Object.fromEntries(ORDER.map((cp) => [cp, closed.includes(cp) ? "CLOSED" : "OPEN"])) },
    processAuto: { stopped: "WAITING_FOR_USER", limitReached: false }
  } as unknown as SessionExecutionResponse;
}

describe("court pleading waiting for the user's decision (2026-11-25)", () => {
  it("names the step and the steps left to the file", () => {
    expect(pleadingDecision(waitingAt("CP-1b", ["CP-1a"]))).toEqual({ checkpoint: "CP-1b", closed: 1, remaining: 15, total: 16 });
  });

  it("tells the lawyer what to do, without step codes", () => {
    const result = waitingAt("CP-1b", ["CP-1a"]);
    const note = autoAdvanceNote(result, autoAdvanceDecision(result, 0, 1), true);
    expect(note).toContain("potrzebna Twoja decyzja — Wybór strategii");
    expect(note).toContain("„Zatwierdzam, przygotuj pismo”");
    expect(note).toContain("Do pliku .docx zostało 15 z 16 kroków.");
    expect(note).not.toContain("CP-1b");
  });

  it("offers nothing once the pleading is final", () => {
    const result = waitingAt("CP-PEER", ORDER);
    (result.processWorkflow as { stage: string }).stage = "FINAL";
    expect(pleadingDecision(result)).toBeNull();
  });
});
