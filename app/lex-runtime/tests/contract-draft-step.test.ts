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
});
