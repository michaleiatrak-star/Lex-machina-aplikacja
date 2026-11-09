import { describe, expect, it } from "vitest";
import { assignableCases, bulkAccessPlan, caseMembersText, quickCaseOptions, searchAndSortCases, splitCasesForUser } from "./CaseAccessAdminPanel.js";
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

describe("uprawnienia do spraw: wyszukiwanie i sortowanie", () => {
  const named = (caseId: string, displayName: string, createdAt: string, members = ["admin", "marcin.nowak"]) => ({
    ...item(caseId, members),
    displayName,
    createdAt,
    canManage: true
  });
  const cases = [
    named("c1", "Żukowski przeciwko ZUS", "2026-03-01T00:00:00.000Z"),
    named("c2", "Apelacja Kowalski", "2026-05-01T00:00:00.000Z", ["admin"]),
    named("c3", "sprawa 10", "2026-01-01T00:00:00.000Z"),
    named("c4", "Sprawa 9", "2026-04-01T00:00:00.000Z")
  ];
  const names = (list: CaseAccessOverviewItem[]) => list.map((entry) => entry.displayName);

  it("sortuje po nazwie rosnąco i malejąco (polski alfabet, liczby naturalnie) oraz po dacie utworzenia", () => {
    expect(names(searchAndSortCases(cases, "", "name-asc"))).toEqual(["Apelacja Kowalski", "Sprawa 9", "sprawa 10", "Żukowski przeciwko ZUS"]);
    expect(names(searchAndSortCases(cases, "", "name-desc"))).toEqual(["Żukowski przeciwko ZUS", "sprawa 10", "Sprawa 9", "Apelacja Kowalski"]);
    expect(names(searchAndSortCases(cases, "", "created-desc"))).toEqual(["Apelacja Kowalski", "Sprawa 9", "Żukowski przeciwko ZUS", "sprawa 10"]);
    expect(names(searchAndSortCases(cases, "", "created-asc"))).toEqual(["sprawa 10", "Żukowski przeciwko ZUS", "Sprawa 9", "Apelacja Kowalski"]);
  });

  it("szuka po nazwie bez polskich znaków i wielkości liter, po osobie i loginie", () => {
    expect(names(searchAndSortCases(cases, "zukowski", "name-asc"))).toEqual(["Żukowski przeciwko ZUS"]);
    expect(names(searchAndSortCases(cases, "SPRAWA", "name-asc"))).toEqual(["Sprawa 9", "sprawa 10"]);
    expect(names(searchAndSortCases(cases, "marcin", "name-asc"))).toHaveLength(3);
    expect(searchAndSortCases(cases, "nic takiego", "name-asc")).toEqual([]);
  });

  it("zawęża do spraw utworzonych w zakresie dat (włącznie, dowolny koniec otwarty)", () => {
    expect(names(searchAndSortCases(cases, "", "created-asc", { from: "2026-03-01", to: "2026-04-30" }))).toEqual(["Żukowski przeciwko ZUS", "Sprawa 9"]);
    expect(names(searchAndSortCases(cases, "", "created-asc", { from: "2026-04-01", to: "" }))).toEqual(["Sprawa 9", "Apelacja Kowalski"]);
    expect(names(searchAndSortCases(cases, "", "created-asc", { from: "", to: "2026-01-31" }))).toEqual(["sprawa 10"]);
    expect(names(searchAndSortCases(cases, "sprawa", "name-asc", { from: "2026-02-01", to: "" }))).toEqual(["Sprawa 9"]);
  });

  it("wybrana sprawa zostaje na liście przypisania, choć wyszukiwanie jej nie obejmuje", () => {
    expect(quickCaseOptions(cases, "apelacja", "name-asc", "c1").map((entry) => entry.caseId)).toEqual(["c1", "c2"]);
    expect(quickCaseOptions(cases, "apelacja", "name-asc", "").map((entry) => entry.caseId)).toEqual(["c2"]);
  });
});

describe("zmiana zbiorcza uprawnień", () => {
  const own = (caseId: string, members: string[]) => ({ ...item(caseId, members), canManage: true });
  const cases = [
    own("case_a", ["admin"]),
    own("case_b", ["admin", "anna"]),
    item("case_c", ["jan", "anna"]),
    own("case_d", ["anna"])
  ];
  const all = new Set(["case_a", "case_b", "case_c", "case_d"]);

  it("nadanie roli: zmienia i dodaje; pomija cudze sprawy, właściciela i brak zmiany", () => {
    const plan = bulkAccessPlan(cases, all, "anna", { kind: "grant", role: "EDITOR", canReidentify: false });
    expect(plan.apply).toEqual(["case_a", "case_b"]);
    expect(plan.skipped).toEqual([
      { caseId: "case_c", reason: "nie jesteś właścicielem" },
      { caseId: "case_d", reason: "osoba jest właścicielem" }
    ]);
    expect(bulkAccessPlan(cases, new Set(["case_b"]), "anna", { kind: "grant", role: "VIEWER", canReidentify: false }).skipped[0]?.reason).toBe("bez zmian");
  });

  it("odebranie dostępu: tylko tam, gdzie osoba go ma", () => {
    const plan = bulkAccessPlan(cases, all, "anna", { kind: "revoke" });
    expect(plan.apply).toEqual(["case_b"]);
    expect(plan.skipped.map((entry) => entry.reason)).toEqual(["bez dostępu", "nie jesteś właścicielem", "osoba jest właścicielem"]);
  });
});
