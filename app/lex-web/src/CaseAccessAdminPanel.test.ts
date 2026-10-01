import { describe, expect, it } from "vitest";
import { splitCasesForUser } from "./CaseAccessAdminPanel.js";
import type { CaseAccessOverviewItem } from "./api.js";

function item(caseId: string, members: string[]): CaseAccessOverviewItem {
  return {
    caseId,
    caseKind: "MATTER",
    updatedAt: "2026-10-01T00:00:00.000Z",
    canManage: false,
    members: members.map((userId, index) => ({
      userId,
      loginName: userId,
      displayName: userId,
      status: "ACTIVE",
      role: index === 0 ? "OWNER" : "VIEWER",
      canReidentify: false,
      grantedAt: "2026-10-01T00:00:00.000Z"
    }))
  };
}

describe("uprawnienia do spraw: widok użytkownika", () => {
  it("dzieli sprawy na te z dostępem użytkownika i pozostałe", () => {
    const cases = [item("case_a", ["admin", "anna"]), item("case_b", ["jan"]), item("case_c", ["anna"])];
    const split = splitCasesForUser(cases, "anna");
    expect(split.member.map((c) => c.caseId)).toEqual(["case_a", "case_c"]);
    expect(split.other.map((c) => c.caseId)).toEqual(["case_b"]);
  });
});
