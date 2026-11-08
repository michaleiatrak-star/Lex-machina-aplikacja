import { describe, expect, it } from "vitest";
import { completeContractCheckpoint, contractCheckpointBatch, contractCheckpointsClosedByAnswer, createContractAnalysisState } from "./contract-analysis-state.js";
import { completeContractExecution, requireContractExecutionPermit } from "./contract-analysis-execution-gate.js";
const CASE_ID = "case_" + "1".repeat(32);
describe("contract-analysis execution gate", () => {
    it("issues one permit for the current AU checkpoint", () => {
        const state = createContractAnalysisState(CASE_ID, "ANALYSIS");
        const permit = requireContractExecutionPermit(state);
        expect(permit).toEqual({
            revision: 1,
            mode: "ANALYSIS",
            stage: "INTAKE",
            checkpoint: "AU-F0",
            checkpoints: ["AU-F0", "AU-GAP", "AU-POV", "AU-ROUTE", "AU-A", "AU-B", "AU-C", "AU-D", "AU-F"]
        });
        const next = completeContractExecution(state, permit, [
            "audit://contract/session/AU-F0"
        ]);
        expect(next.revision)
            .toBe(2);
        expect(next.closedCheckpoints).toEqual([
            "AU-F0"
        ]);
    });
    it("rejects a stale permit after another transition", () => {
        const state = createContractAnalysisState(CASE_ID, "DRAFT");
        const permit = requireContractExecutionPermit(state);
        const changed = completeContractCheckpoint(state, "AU-F0", [
            "audit://contract/other/AU-F0"
        ]);
        expect(() => completeContractExecution(changed, permit, [
            "audit://contract/stale/AU-F0"
        ])).toThrow("CONTRACT_STATE_CONFLICT");
    });
});
describe("contract analysis in one turn (contract test 2026-11-07: stage stayed INTAKE)", () => {
    const trace = [
        "| Status | Punkty |",
        "| ✅ | AU-F0, AU-POV (KRS sprawdzony, rozbieżność ⬛), AU-ROUTE (J6, J9), AU-A–AU-D, CAL-GATE |",
        "| ⚠️ POMINIĘTY | AU-F: kwantyfikacja ryzyka |",
        "| — N/A | AU-HYBRID, AU-STRIP, AU-POST |"
    ].join("\n");
    it("closes every checkpoint the trace marks done, up to the first skipped one", () => {
        const state = createContractAnalysisState(CASE_ID, "ANALYSIS");
        const permit = requireContractExecutionPermit(state);
        const closed = contractCheckpointsClosedByAnswer(`# Analiza\n## 0. AU-POV: identyfikacja stron\n${trace}`, permit.checkpoints);
        expect(closed).toEqual(["AU-F0", "AU-GAP", "AU-POV", "AU-ROUTE", "AU-A", "AU-B", "AU-C", "AU-D"]);
        const next = completeContractExecution(state, permit, ["audit://contract/session/batch"], closed);
        expect(next.stage).toBe("ANALYSIS");
        expect(requireContractExecutionPermit(next).checkpoints).toEqual(["AU-F"]);
    });
    it("an answer without a trace closes the first checkpoint; a checkpoint left open stops the run", () => {
        const state = createContractAnalysisState(CASE_ID, "ANALYSIS");
        const batch = contractCheckpointBatch(state);
        expect(contractCheckpointsClosedByAnswer("Analiza umowy bez tabeli śladu.", batch)).toEqual(["AU-F0"]);
        expect(contractCheckpointsClosedByAnswer("| AU-F0 | ✅ |\n| AU-ROUTE | ✅ |\n| AU-A…AU-F | ✅ |", batch)).toEqual(batch);
        expect(contractCheckpointsClosedByAnswer("| AU-F0 | ✅ |\n| AU-GAP | ⬛ Załączniki 1 i 2 |", batch)).toEqual(["AU-F0"]);
        const done = completeContractExecution(state, requireContractExecutionPermit(state), ["audit://contract/session/all"], batch);
        expect(done.stage).toBe("FINALIZATION");
        expect(requireContractExecutionPermit(done).checkpoints).toEqual(["AU-HYBRID"]);
    });
    it("generation and finalization gates stay one per turn", () => {
        let state = createContractAnalysisState(CASE_ID, "DRAFT");
        expect(contractCheckpointBatch(state)).toEqual(["AU-F0", "AU-GAP", "AU-POV", "AU-ROUTE"]);
        state = completeContractExecution(state, requireContractExecutionPermit(state), ["audit://c/1"], contractCheckpointBatch(state));
        expect(contractCheckpointBatch(state)).toEqual(["AU-GENCORE"]);
    });
});
