import type { CaseListItem } from "./api.js";

// The "Sprawy" page (Patron's case list adapted): one block of filters, sortable columns.
export type CaseListScope = "ACTIVE" | "MINE" | "SHARED" | "ARCHIVED" | "ALL";
export type CaseListSortKey = "name" | "role" | "created" | "updated";
export type CaseListPeriod = "ANY" | "7" | "30" | "365" | "CUSTOM";

export type CaseListFilters = {
  query: string;
  scope: CaseListScope;
  period: CaseListPeriod;
  // CUSTOM: last change between these days (YYYY-MM-DD), both ends included.
  from?: string;
  to?: string;
  sort: CaseListSortKey;
  direction: "asc" | "desc";
};

const folded = (value: string) => value.toLocaleLowerCase("pl").replace(/ł/gu, "l").normalize("NFD").replace(/\p{M}/gu, "");
const day = (iso: string) => iso.slice(0, 10);
const ROLE_ORDER = ["OWNER", "EDITOR", "ANALYST", "VIEWER"];

/** The matters the filters let through, in the chosen order (ties by name). */
export function caseListView(cases: readonly CaseListItem[], filters: CaseListFilters, now = new Date()): CaseListItem[] {
  const words = folded(filters.query).split(/\s+/u).filter(Boolean);
  const since =
    filters.period === "ANY" || filters.period === "CUSTOM"
      ? null
      : new Date(now.getTime() - Number(filters.period) * 86_400_000).toISOString();
  const changed = (item: CaseListItem) => item.updatedAt || item.createdAt;
  const shown = cases.filter((item) => {
    if (item.caseKind !== "MATTER") return false;
    const scope =
      filters.scope === "ALL" ||
      (filters.scope === "ARCHIVED" ? Boolean(item.archivedAt) : !item.archivedAt) &&
        (filters.scope !== "MINE" || item.role === "OWNER") &&
        (filters.scope !== "SHARED" || item.role !== "OWNER");
    if (!scope) return false;
    const name = folded(`${item.displayName ?? ""} ${item.caseId}`);
    if (!words.every((word) => name.includes(word))) return false;
    if (since && changed(item) < since) return false;
    if (filters.period === "CUSTOM") {
      if (filters.from && day(changed(item)) < filters.from) return false;
      if (filters.to && day(changed(item)) > filters.to) return false;
    }
    return true;
  });
  const byName = (a: CaseListItem, b: CaseListItem) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "pl", { numeric: true });
  const sign = filters.direction === "asc" ? 1 : -1;
  return shown.sort((a, b) => {
    const order =
      filters.sort === "name"
        ? byName(a, b)
        : filters.sort === "role"
          ? ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role)
          : filters.sort === "created"
            ? a.createdAt.localeCompare(b.createdAt)
            : changed(a).localeCompare(changed(b));
    return sign * order || byName(a, b);
  });
}

/** Selection limited to what is shown: hidden cases drop out of it. */
export function visibleSelection(selected: ReadonlySet<string>, shown: readonly CaseListItem[]): Set<string> {
  return new Set(shown.filter((item) => selected.has(item.caseId)).map((item) => item.caseId));
}
