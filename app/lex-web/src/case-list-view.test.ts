import { describe, expect, it } from "vitest";
import { caseListView, visibleSelection, type CaseListFilters } from "./case-list-view.js";
import type { CaseListItem } from "./api.js";

const item = (caseId: string, displayName: string, role: CaseListItem["role"], updatedAt: string, archivedAt?: string): CaseListItem =>
  ({ caseId, displayName, role, caseKind: "MATTER", createdAt: "2026-01-01T00:00:00Z", updatedAt, createdByUserId: "u", keyVersion: 1, canReidentify: true, ...(archivedAt ? { archivedAt } : {}) }) as CaseListItem;
const cases = [
  item("a", "XI P 27/26", "OWNER", "2026-11-17T10:00:00Z"),
  item("b", "Łódź – najem", "EDITOR", "2026-10-01T10:00:00Z"),
  item("c", "RD 121/26", "OWNER", "2026-11-10T10:00:00Z", "2026-11-12T00:00:00Z")
];
const base: CaseListFilters = { query: "", scope: "ACTIVE", period: "ANY", sort: "updated", direction: "desc" };
const now = new Date("2026-11-18T00:00:00Z");

describe("the Sprawy page list", () => {
  it("scopes: active, mine, shared, archived", () => {
    expect(caseListView(cases, base, now).map((c) => c.caseId)).toEqual(["a", "b"]);
    expect(caseListView(cases, { ...base, scope: "MINE" }, now).map((c) => c.caseId)).toEqual(["a"]);
    expect(caseListView(cases, { ...base, scope: "SHARED" }, now).map((c) => c.caseId)).toEqual(["b"]);
    expect(caseListView(cases, { ...base, scope: "ARCHIVED" }, now).map((c) => c.caseId)).toEqual(["c"]);
  });
  it("search ignores Polish marks; period by last change, presets and custom", () => {
    expect(caseListView(cases, { ...base, query: "lodz" }, now).map((c) => c.caseId)).toEqual(["b"]);
    expect(caseListView(cases, { ...base, period: "30" }, now).map((c) => c.caseId)).toEqual(["a"]);
    expect(caseListView(cases, { ...base, scope: "ALL", period: "CUSTOM", from: "2026-11-01", to: "2026-11-15" }, now).map((c) => c.caseId)).toEqual(["c"]);
  });
  it("sorts by the clicked column either way", () => {
    expect(caseListView(cases, { ...base, scope: "ALL", sort: "name", direction: "asc" }, now).map((c) => c.caseId)).toEqual(["b", "c", "a"]);
    expect(caseListView(cases, { ...base, scope: "ALL", sort: "updated", direction: "asc" }, now)[0]!.caseId).toBe("b");
  });
  it("the selection keeps only shown cases", () => {
    expect([...visibleSelection(new Set(["a", "c"]), caseListView(cases, base, now))]).toEqual(["a"]);
  });
});
