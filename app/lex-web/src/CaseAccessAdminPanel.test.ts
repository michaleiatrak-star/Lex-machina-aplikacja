import { describe, expect, it } from "vitest";
import { assignableCases, caseMembersText, splitCasesForUser } from "./CaseAccessAdminPanel.js";
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
  it("skraca skład sprawy w nagłówku karty", () => {
    expect(caseMembersText(item("case_a", ["admin"]))).toBe("tylko właściciel");
    expect(caseMembersText(item("case_a", ["admin", "marcin"]))).toBe("1 osoba: marcin (Podgląd)");
    expect(caseMembersText(item("case_a", ["admin", "a", "b"]))).toBe("2 osoby: a (Podgląd), b (Podgląd)");
    expect(caseMembersText(item("case_a", ["admin", "a", "b", "c", "d", "e"]))).toMatch(/^5 osób:/);
  });

  it("dzieli sprawy na te z dostępem użytkownika i pozostałe", () => {
    const cases = [item("case_a", ["admin", "anna"]), item("case_b", ["jan"]), item("case_c", ["anna"])];
    const split = splitCasesForUser(cases, "anna");
    expect(split.member.map((c) => c.caseId)).toEqual(["case_a", "case_c"]);
    expect(split.other.map((c) => c.caseId)).toEqual(["case_b"]);
  });

  it("szybkie przypisanie: tylko sprawy właściciela, bez archiwalnych, alfabetycznie", () => {
    const base = { caseKind: "MATTER" as const, updatedAt: "2026-10-01T00:00:00Z", members: [] };
    const list = assignableCases([
      { ...base, caseId: "c1", displayName: "Zeta", canManage: true },
      { ...base, caseId: "c2", displayName: "Alfa", canManage: true },
      { ...base, caseId: "c3", displayName: "Beta", canManage: false },
      { ...base, caseId: "c4", displayName: "Gamma", canManage: true, archivedAt: "2026-09-01T00:00:00Z" }
    ]);
    expect(list.map((item) => item.caseId)).toEqual(["c2", "c1"]);
  });
});
