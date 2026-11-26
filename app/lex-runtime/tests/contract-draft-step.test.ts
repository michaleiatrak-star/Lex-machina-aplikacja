import { describe, expect, it } from "vitest";
import { contractDraftStepDone } from "../src/http/app.js";

// The gate I result of the contract test 2026-11-08 (run 7): 17 citations marked unverified,
// 3 verified wordings checked more than 7 days ago; nothing else failed.
const run7 = {
  finalization: "DEGRADED",
  gateI: { checks: [
    { id: "ROUTER_FIRST", result: "PASS" },
    { id: "TEMPORAL_FRESHNESS", result: "BLOCKED" },
    { id: "CITATION_LEDGER", result: "BLOCKED" },
    { id: "LEGAL_CITATIONS", result: "BLOCKED" },
    { id: "FINALIZATION", result: "BLOCKED" }
  ] },
  blockedReferences: Array.from({ length: 17 }, () => ({ status: "UNVERIFIED_MARKED" }))
};
const analysis = ["AU-F0", "AU-GAP", "AU-POV", "AU-ROUTE", "AU-A", "AU-B", "AU-C", "AU-D", "AU-F"];

describe("contract analysis checkpoints over a marked draft", () => {
  it("close when only marked citations and stale checks hold the turn", () => {
    expect(contractDraftStepDone(run7, analysis)).toBe(true);
  });

  it("stay open for an unmarked unverified claim, another failed check or a finalization gate", () => {
    expect(contractDraftStepDone({ ...run7, blockedReferences: [{ status: "UNVERIFIED" }] }, analysis)).toBe(false);
    expect(contractDraftStepDone({ ...run7, gateI: { checks: [...run7.gateI.checks, { id: "SOURCE_PROVENANCE", result: "BLOCKED" }] } }, analysis)).toBe(false);
    expect(contractDraftStepDone(run7, ["AU-HYBRID"])).toBe(false);
    expect(contractDraftStepDone({ ...run7, finalization: "BLOCKED" }, analysis)).toBe(false);
  });

  it("close when the workflow stopped only on marked citations, also with one provision marked twice differently (2026-11-26)", () => {
    const mixed = { ...run7, blockedReferences: [...run7.blockedReferences, { status: "STATUS_CONTRADICTS_LEDGER" }] };
    expect(contractDraftStepDone(mixed, analysis)).toBe(false);
    expect(contractDraftStepDone({ ...mixed, workflow: { markedDraftOnly: true } }, analysis)).toBe(true);
    expect(contractDraftStepDone({ ...mixed, workflow: { markedDraftOnly: true }, gateI: { checks: [...run7.gateI.checks, { id: "SOURCE_PROVENANCE", result: "BLOCKED" }] } }, analysis)).toBe(false);
  });
});

describe("a contract step taken as a marked draft is not held by its own red workflow gates", () => {
  it("drops the G39H/G39I gates only when the draft rule passed", async () => {
    const { contractStepBlocks } = (await import("../src/http/app.js")) as unknown as { contractStepBlocks: (r: unknown, d: boolean) => string[] };
    const { SESSION_EXECUTION_INTERNAL } = await import("../src/session-executor.js");
    const events = ["G39I_WORKFLOW_CONTRACT", "G39I_TURN_STATE", "G39H_WORKFLOW_FINALIZATION", "fetch_auxiliary_legal_source"].map((target) => ({ status: "BLOCKED", target }));
    const result = { [SESSION_EXECUTION_INTERNAL]: { auditEvents: events } };
    expect(contractStepBlocks(result, true)).toEqual(["fetch_auxiliary_legal_source"]);
    expect(contractStepBlocks(result, false)).toHaveLength(4);
  });
});
