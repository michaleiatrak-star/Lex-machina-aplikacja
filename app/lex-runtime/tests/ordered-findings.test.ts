import { describe, expect, it } from "vitest";
import { completeOrderedCaseExecution, createOrderedCaseWorkflowState, orderedFindingsPrompt, requireOrderedCaseExecutionPermit, validateOrderedCaseWorkflowState, withOrderedFinding } from "../src/ordered-case-workflow-state.js";

const CASE = `case_${"c".repeat(32)}`;

describe("findings of the evidence and witness steps (task 03.4)", () => {
  it("keeps each closed step's answer and gives the earlier ones to the next step", () => {
    let state = createOrderedCaseWorkflowState("WITNESS_QUESTIONING_V1", CASE);
    const answers = ["Weryfikacja SD: 3 dokumenty, 1 sprzeczność dat.\n\n---\n⚖️ Zastrzeżenie", "Rejestr zeznań: świadek A, B."];
    for (const answer of answers) {
      const permit = requireOrderedCaseExecutionPermit(state);
      state = withOrderedFinding(completeOrderedCaseExecution(state, permit, ["audit_1"]), permit.checkpoint, answer);
    }
    expect(validateOrderedCaseWorkflowState(state).findings).toBeDefined();
    const [first, second, third] = ["PRE-W1a-SD-VER", "PRE-W1a.4-RZ-SHOW", "KROK-PRE-W1-INTELLIGENCE"];
    expect(state.findings?.[first!]?.text).toBe("Weryfikacja SD: 3 dokumenty, 1 sprzeczność dat.");
    const prompt = orderedFindingsPrompt(state, third!, 40_000)!;
    expect(prompt.indexOf(`## ${first}`)).toBeLessThan(prompt.indexOf(`## ${second}`));
    expect(prompt).toContain("Rejestr zeznań: świadek A, B.");
    // The first step has nothing before it; a local model's budget shortens each finding.
    expect(orderedFindingsPrompt(state, first!, 40_000)).toBeNull();
    const long = withOrderedFinding(state, second!, "x".repeat(5_000));
    expect(orderedFindingsPrompt(long, third!, 1_000)).toContain("[… skrócono:");
  });
});
