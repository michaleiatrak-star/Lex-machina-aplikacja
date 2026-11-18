import { useEffect, useMemo, useRef, useState } from "react";
import { CASE_ROLE_LABEL, getCasesOverview, type CaseListItem, type CaseOverviewEntry } from "./api.js";
import { caseListView, visibleSelection, type CaseListFilters, type CaseListPeriod, type CaseListScope, type CaseListSortKey } from "./case-list-view.js";
import { currentLocale, t, N_ } from "./i18n";
import { InlineEdit } from "./InlineEdit";

const SCOPES: Array<[CaseListScope, string]> = [
  ["ACTIVE", N_("Aktywne")],
  ["MINE", N_("Moje")],
  ["SHARED", N_("Udostępnione mi")],
  ["ARCHIVED", N_("Archiwalne")],
  ["ALL", N_("Wszystkie")]
];
const PERIODS: Array<[CaseListPeriod, string]> = [
  ["ANY", N_("Dowolny czas")],
  ["7", N_("Ostatnie 7 dni")],
  ["30", N_("Ostatnie 30 dni")],
  ["365", N_("Ostatni rok")],
  ["CUSTOM", N_("Własny zakres")]
];

const date = (iso: string) => new Date(iso).toLocaleDateString(currentLocale(), { day: "numeric", month: "short", year: "numeric" });

/**
 * All cases of the firm as one table (Patron's case list adapted): filters in one block, sortable
 * columns, selection of the shown cases with archiving in bulk. Deleting a case stays in its files
 * (it asks for the password).
 */
export function CaseListPage({
  cases,
  currentCaseId,
  onOpenCase,
  onNewCase,
  onRenameCase,
  onArchive
}: {
  cases: readonly CaseListItem[];
  currentCaseId: string;
  onOpenCase: (caseId: string) => void;
  onNewCase: () => void;
  onRenameCase: (caseId: string, displayName: string) => Promise<void>;
  onArchive: (caseIds: string[], archive: boolean) => Promise<void>;
}) {
  const [filters, setFilters] = useState<CaseListFilters>({ query: "", scope: "ACTIVE", period: "ANY", sort: "updated", direction: "desc" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shown = useMemo(() => caseListView(cases, filters), [cases, filters]);
  // Signature and number of files of the shown cases (Patron's columns), read once per case.
  const [overview, setOverview] = useState<Record<string, CaseOverviewEntry>>({});
  const missing = shown.filter((item) => !overview[item.caseId]).slice(0, 100).map((item) => item.caseId);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    getCasesOverview(missingKey.split(","))
      .then((result) => {
        if (cancelled) return;
        setOverview((current) => ({ ...current, ...Object.fromEntries(result.cases.map((entry) => [entry.caseId, entry])) }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [missingKey]);
  // The selection never holds a case the filters hide.
  useEffect(() => setSelected((current) => visibleSelection(current, shown)), [shown]);
  const allBox = useRef<HTMLInputElement>(null);
  const allSelected = shown.length > 0 && selected.size === shown.length;
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = selected.size > 0 && !allSelected;
  }, [selected, allSelected]);

  const set = (patch: Partial<CaseListFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const sortBy = (key: CaseListSortKey) =>
    set({ sort: key, direction: filters.sort === key ? (filters.direction === "asc" ? "desc" : "asc") : key === "name" || key === "role" ? "asc" : "desc" });
  const header = (key: CaseListSortKey, label: string) => (
    <th scope="col" aria-sort={filters.sort === key ? (filters.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="case-list-sort" onClick={() => sortBy(key)}>
        {t(label)}
        <span aria-hidden="true">{filters.sort === key ? (filters.direction === "asc" ? " ▲" : " ▼") : ""}</span>
      </button>
    </th>
  );
  const chosen = shown.filter((item) => selected.has(item.caseId));
  const bulk = async (archive: boolean) => {
    const ids = chosen.filter((item) => item.role === "OWNER" && Boolean(item.archivedAt) !== archive).map((item) => item.caseId);
    if (!ids.length) {
      setError(t("Zaznaczone sprawy nie wymagają zmiany albo nie jesteś ich właścicielem."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onArchive(ids, archive);
      setSelected(new Set());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat-card case-list-page" aria-label={t("Lista spraw")}>
      <div className="case-list-filters">
        <div className="case-list-scopes" role="tablist" aria-label={t("Zakres listy spraw")}>
          {SCOPES.map(([scope, label]) => (
            <button
              key={scope}
              type="button"
              role="tab"
              aria-selected={filters.scope === scope}
              className={filters.scope === scope ? "chat-pipeline-option selected" : "chat-pipeline-option"}
              onClick={() => set({ scope })}
            >
              {t(label)}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={filters.query}
          placeholder={t("Szukaj po nazwie lub ID sprawy")}
          aria-label={t("Szukaj spraw")}
          onChange={(event) => set({ query: event.target.value })}
        />
        <label>
          <span>{t("Ostatnia zmiana")}</span>
          <select value={filters.period} onChange={(event) => set({ period: event.target.value as CaseListPeriod })}>
            {PERIODS.map(([period, label]) => (
              <option key={period} value={period}>
                {t(label)}
              </option>
            ))}
          </select>
        </label>
        {filters.period === "CUSTOM" ? (
          <>
            <label>
              <span>{t("Od")}</span>
              <input type="date" value={filters.from ?? ""} onChange={(event) => set({ from: event.target.value || undefined })} />
            </label>
            <label>
              <span>{t("Do")}</span>
              <input type="date" value={filters.to ?? ""} onChange={(event) => set({ to: event.target.value || undefined })} />
            </label>
          </>
        ) : null}
        <button type="button" className="chat-secondary-action" onClick={onNewCase}>
          {t("+ Nowa sprawa")}
        </button>
      </div>

      <div className="case-list-status">
        <small role="status">{t("Spraw: {count}", { count: String(shown.length) })}</small>
        {chosen.length ? (
          <div className="case-list-bulk">
            <small>{t("Zaznaczone: {count}", { count: String(chosen.length) })}</small>
            {filters.scope === "ARCHIVED" || chosen.every((item) => item.archivedAt) ? (
              <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void bulk(false)}>
                {t("Przywróć z archiwum")}
              </button>
            ) : (
              <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void bulk(true)}>
                {t("Archiwizuj")}
              </button>
            )}
            <button type="button" className="chat-link-button" onClick={() => setSelected(new Set())}>
              {t("Odznacz")}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <p className="chat-inline-error">{error}</p> : null}

      {shown.length === 0 ? (
        <p>{cases.some((item) => item.caseKind === "MATTER") ? t("Żadna sprawa nie pasuje do filtrów.") : t("Brak spraw.")}</p>
      ) : (
        <div className="case-list-scroll">
        <table className="lex-case-table case-list-table">
          <thead>
            <tr>
              <th scope="col" className="case-list-check">
                <input
                  ref={allBox}
                  type="checkbox"
                  aria-label={t("Zaznacz wszystkie widoczne")}
                  checked={allSelected}
                  onChange={(event) => setSelected(event.target.checked ? new Set(shown.map((item) => item.caseId)) : new Set())}
                />
              </th>
              {header("name", N_("Nazwa"))}
              <th scope="col">{t("Sygnatura")}</th>
              <th scope="col">{t("Pliki")}</th>
              {header("role", N_("Rola"))}
              {header("created", N_("Utworzona"))}
              {header("updated", N_("Zmieniona"))}
              <th scope="col">
                <span className="sr-only">{t("Działania")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.caseId} className={item.caseId === currentCaseId ? "lex-case-row case-list-current" : "lex-case-row"}>
                <td className="case-list-check">
                  <input
                    type="checkbox"
                    aria-label={t("Zaznacz sprawę {value}", { value: item.displayName || t("bez nazwy") })}
                    checked={selected.has(item.caseId)}
                    onChange={(event) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.caseId);
                        else next.delete(item.caseId);
                        return next;
                      })
                    }
                  />
                </td>
                <td>
                  {renaming === item.caseId ? (
                    <InlineEdit
                      value={item.displayName ?? ""}
                      label={t("Nowa nazwa sprawy")}
                      onCancel={() => setRenaming(null)}
                      onSave={async (next) => {
                        try {
                          await onRenameCase(item.caseId, next);
                          setRenaming(null);
                          return true;
                        } catch (failure) {
                          setError(failure instanceof Error ? failure.message : String(failure));
                          return false;
                        }
                      }}
                    />
                  ) : (
                    <div className="lex-case-name">
                      <button type="button" className="lex-case-open" onClick={() => onOpenCase(item.caseId)}>
                        {item.displayName || t("Sprawa bez nazwy")}
                      </button>
                      {item.role === "OWNER" ? (
                        <button
                          type="button"
                          className="matter-thread-edit"
                          title={t("Zmień nazwę sprawy")}
                          aria-label={t("Zmień nazwę sprawy {value}", { value: item.displayName || "bez nazwy" })}
                          onClick={() => setRenaming(item.caseId)}
                        >
                          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                            <path d="M11.3 1.9a1.5 1.5 0 0 1 2.1 0l.7.7a1.5 1.5 0 0 1 0 2.1l-8 8-3.3.9.9-3.3 7.6-8.4zM10 4.3l1.7 1.7" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                          </svg>
                        </button>
                      ) : null}
                      {item.archivedAt ? <small className="case-list-archived">{t("archiwalna")}</small> : null}
                    </div>
                  )}
                </td>
                <td title={overview[item.caseId]?.court ?? undefined}>{overview[item.caseId]?.signature ?? "—"}</td>
                <td>{overview[item.caseId]?.files ?? "—"}</td>
                <td>{CASE_ROLE_LABEL[item.role]}</td>
                <td>{date(item.createdAt)}</td>
                <td>{date(item.updatedAt || item.createdAt)}</td>
                <td>
                  <button type="button" className="chat-link-button" onClick={() => onOpenCase(item.caseId)}>
                    {t("Otwórz")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}
