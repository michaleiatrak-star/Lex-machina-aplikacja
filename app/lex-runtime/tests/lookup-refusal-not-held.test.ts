import { describe, expect, it } from "vitest";
import { blockedAuditSteps } from "../src/http/app.js";
import { SESSION_EXECUTION_INTERNAL } from "../src/session-executor.js";

const result = (targets: string[]) =>
  ({ [SESSION_EXECUTION_INTERNAL]: { auditEvents: targets.map((target) => ({ status: "BLOCKED", target })) } }) as never;

describe("a refused lookup does not hold the workflow step (Bielik, user report 2026-11-06)", () => {
  it("verify_legal_reference refused: the answer marks the provision ⚠️, the step closes", () => {
    expect(blockedAuditSteps(result(["verify_legal_reference", "verify_legal_reference"]))).toEqual([]);
  });
  it("a refused resource read still holds it", () => {
    expect(blockedAuditSteps(result(["read_legal_resource:analizator-umow-v1/references/brak.md", "verify_legal_reference"]))).toEqual([
      "read_legal_resource:analizator-umow-v1/references/brak.md"
    ]);
  });
});
