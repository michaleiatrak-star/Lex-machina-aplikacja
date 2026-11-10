import { currentLocale, N_, t } from "./i18n";
import { InfoTip } from "./InfoTip";
import { InlineEdit } from "./InlineEdit";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  archiveCase,
  getCaseAccessOverview,
  grantCaseAccess,
  listAdminUsers,
  renameCase,
  revokeCaseAccess,
  unarchiveCase,
  type AuthenticatedUser,
  type CaseAccessOverviewItem,
  type CaseRole
} from "./api.js";

type GrantableRole = Exclude<CaseRole, "OWNER">;

const ROLE_LABELS: Record<CaseRole, string> = {
  OWNER: t("Właściciel"),
  EDITOR: t("Edycja"),
  ANALYST: t("Analiza"),
  VIEWER: t("Podgląd")
};

const GRANTABLE: GrantableRole[] = ["EDITOR", "ANALYST", "VIEWER"];

// Uprawnienia ról jak w runtime (case-access.ts: READ / WRITE / ANALYZE / MANAGE).
const ROLE_HELP: Record<CaseRole, string> = {
  OWNER: t("Właściciel: pełny dostęp i zarządzanie osobami; ma klucz sprawy."),
  EDITOR: t("Edycja: odczyt, dodawanie i zmiana dokumentów, analizy z modelem."),
  ANALYST: t("Analiza: odczyt i analizy z modelem, bez zmian w aktach sprawy."),
  VIEWER: t("Podgląd: tylko odczyt akt i rozmów.")
};

// "2 osoby: Marcin (Edycja), Anna (Podgląd)" — skrót składu sprawy w nagłówku karty.
export function caseMembersText(item: CaseAccessOverviewItem): string {
  const others = item.members.filter((member) => member.role !== "OWNER");
  if (!others.length) return t("tylko właściciel");
  const people = others.map((member) => `${member.displayName} (${ROLE_LABELS[member.role]})`).join(", ");
  const count = others.length;
  const noun = count === 1 ? "osoba" : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? "osoby" : "osób";
  return `${count} ${noun}: ${people}`;
}

function errorText(failure: unknown): string {
  if (!(failure instanceof ApiError)) {
    return failure instanceof Error ? failure.message : String(failure);
  }
  switch (failure.code) {
    case "TARGET_CRYPTO_NOT_READY":
      return t("Użytkownik nie ma jeszcze kluczy do udostępniania (musi zalogować się co najmniej raz).");
    case "TARGET_USER_NOT_FOUND":
      return t("Użytkownik nie istnieje albo jest wyłączony.");
    case "CASE_ACCESS_DENIED":
      return t("Uprawnienia do tej sprawy zmienia jej właściciel.");
    default:
      return failure.code;
  }
}

// Cases the administrator can assign people to: owned (key holder) and not archived.
export function assignableCases(cases: CaseAccessOverviewItem[]): CaseAccessOverviewItem[] {
  return cases
    .filter((item) => item.canManage && !item.archivedAt)
    .sort((a, b) => (a.displayName ?? a.caseId).localeCompare(b.displayName ?? b.caseId, "pl"));
}

export type CaseSort = "name-asc" | "name-desc" | "created-desc" | "created-asc" | "updated-desc" | "updated-asc" | "members-desc";

export const CASE_SORT_LABELS: Record<CaseSort, string> = {
  "name-asc": N_("Nazwa A–Z"),
  "name-desc": N_("Nazwa Z–A"),
  "created-desc": N_("Data utworzenia: najnowsze"),
  "created-asc": N_("Data utworzenia: najstarsze"),
  "updated-desc": N_("Ostatnia zmiana: najnowsze"),
  "updated-asc": N_("Ostatnia zmiana: najstarsze"),
  "members-desc": N_("Liczba osób z dostępem")
};

export type CaseRangePreset = "all" | "7d" | "30d" | "90d" | "year" | "custom";

export const CASE_RANGE_PRESETS: Array<[CaseRangePreset, string]> = [
  ["all", N_("Wszystkie")],
  ["7d", N_("7 dni")],
  ["30d", N_("30 dni")],
  ["90d", N_("90 dni")],
  ["year", N_("Ten rok")],
  ["custom", N_("Własny zakres")]
];

/** The days a preset covers, ending today (custom keeps the fields as they are). */
export function rangeForPreset(preset: CaseRangePreset, today: Date, current: CaseDateRange): CaseDateRange {
  const field = current.field ?? "created";
  if (preset === "custom") return current;
  if (preset === "all") return { from: "", to: "", field };
  const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (preset === "year") return { from: `${today.getFullYear()}-01-01`, to: day(today), field };
  const days = preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  return { from: day(start), to: day(today), field };
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pl");

/** Cases matching the search (name, case id, a member's name or login), in the chosen order. */
// Which date the range applies to: when the case was created, or its last change.
export type CaseDateRange = { from: string; to: string; field?: "created" | "updated" };

// The day of an ISO time on this computer (yyyy-mm-dd), as the date fields show it.
function localDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function searchAndSortCases(
  cases: readonly CaseAccessOverviewItem[],
  query: string,
  sort: CaseSort,
  // Cases created between these days (inclusive); an empty end is open.
  range: CaseDateRange = { from: "", to: "" }
): CaseAccessOverviewItem[] {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  const name = (item: CaseAccessOverviewItem) => item.displayName || item.caseId;
  const matches = cases.filter((item) => {
    if (range.from || range.to) {
      const when = range.field === "updated" ? item.updatedAt : item.createdAt;
      const day = when ? localDay(when) : "";
      if (!day || (range.from && day < range.from) || (range.to && day > range.to)) return false;
    }
    if (!words.length) return true;
    const haystack = fold([name(item), item.caseId, ...item.members.flatMap((member) => [member.displayName, member.loginName])].join(" "));
    return words.every((word) => haystack.includes(word));
  });
  const created = (item: CaseAccessOverviewItem) => item.createdAt ?? "";
  const updated = (item: CaseAccessOverviewItem) => item.updatedAt ?? "";
  const people = (item: CaseAccessOverviewItem) => item.members.filter((member) => member.role !== "OWNER").length;
  return matches.sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return name(a).localeCompare(name(b), "pl", { sensitivity: "base", numeric: true });
      case "name-desc":
        return name(b).localeCompare(name(a), "pl", { sensitivity: "base", numeric: true });
      case "created-asc":
        return created(a).localeCompare(created(b)) || name(a).localeCompare(name(b), "pl");
      case "created-desc":
        return created(b).localeCompare(created(a)) || name(a).localeCompare(name(b), "pl");
      case "updated-asc":
        return updated(a).localeCompare(updated(b)) || name(a).localeCompare(name(b), "pl");
      case "updated-desc":
        return updated(b).localeCompare(updated(a)) || name(a).localeCompare(name(b), "pl");
      case "members-desc":
        return people(b) - people(a) || name(a).localeCompare(name(b), "pl", { sensitivity: "base", numeric: true });
    }
  });
}

/** The quick assignment's case list: the search and order above it; the chosen case stays listed. */
export function quickCaseOptions(cases: CaseAccessOverviewItem[], query: string, sort: CaseSort, selected: string, range?: CaseDateRange): CaseAccessOverviewItem[] {
  const options = searchAndSortCases(assignableCases(cases), query, sort, range);
  const chosen = selected && !options.some((item) => item.caseId === selected) ? cases.find((item) => item.caseId === selected) : undefined;
  return chosen ? [chosen, ...options] : options;
}

export type BulkAccessAction = { kind: "grant"; role: GrantableRole; canReidentify: boolean } | { kind: "revoke" };

/**
 * Bulk change of case access (user request 2026-11-09): which of the selected cases the change
 * applies to, and which are skipped and why. Only a case's owner holds its key, so a case the
 * administrator does not own is skipped; the owner's own access is never changed.
 */
export function bulkAccessPlan(
  cases: CaseAccessOverviewItem[],
  selected: ReadonlySet<string>,
  userId: string,
  action: BulkAccessAction
): { apply: string[]; skipped: Array<{ caseId: string; reason: string }> } {
  const apply: string[] = [];
  const skipped: Array<{ caseId: string; reason: string }> = [];
  for (const item of cases) {
    if (!selected.has(item.caseId)) continue;
    const member = item.members.find((entry) => entry.userId === userId);
    if (!item.canManage) skipped.push({ caseId: item.caseId, reason: t("nie jesteś właścicielem") });
    else if (member?.role === "OWNER") skipped.push({ caseId: item.caseId, reason: t("osoba jest właścicielem") });
    else if (action.kind === "revoke" && !member) skipped.push({ caseId: item.caseId, reason: t("bez dostępu") });
    else if (action.kind === "grant" && member && member.role === action.role && member.canReidentify === action.canReidentify) {
      skipped.push({ caseId: item.caseId, reason: "bez zmian" });
    } else apply.push(item.caseId);
  }
  return { apply, skipped };
}

export function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M11.3 1.7a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L5.6 13.4 2 14l.6-3.6 8.7-8.7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Cases the given user can open, and cases where they have no access.
export function splitCasesForUser(
  cases: CaseAccessOverviewItem[],
  userId: string
): { member: CaseAccessOverviewItem[]; other: CaseAccessOverviewItem[] } {
  const member: CaseAccessOverviewItem[] = [];
  const other: CaseAccessOverviewItem[] = [];
  for (const item of cases) {
    (item.members.some((m) => m.userId === userId) ? member : other).push(item);
  }
  return { member, other };
}

// Settings → Użytkownicy: who can open which case, and changing it where the
// administrator owns the case. A case is encrypted with its own key, so only
// its OWNER can grant or revoke access; other cases are shown read-only.
export function CaseAccessAdminPanel({ currentUserId }: { currentUserId: string }) {
  const [cases, setCases] = useState<CaseAccessOverviewItem[]>([]);
  const [users, setUsers] = useState<AuthenticatedUser[]>([]);
  const [userFilter, setUserFilter] = useState("");
  const [caseQuery, setCaseQuery] = useState("");
  const [caseSort, setCaseSort] = useState<CaseSort>("name-asc");
  const [caseRange, setCaseRange] = useState<CaseDateRange>({ from: "", to: "", field: "created" });
  const [rangePreset, setRangePreset] = useState<CaseRangePreset>("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<
    Record<string, { userId: string; role: GrantableRole; canReidentify: boolean }>
  >({});
  const [quick, setQuick] = useState<{ userId: string; caseId: string; role: GrantableRole; canReidentify: boolean }>({
    userId: "",
    caseId: "",
    role: "EDITOR",
    canReidentify: false
  });
  const [renaming, setRenaming] = useState<{ caseId: string; name: string } | null>(null);
  // Rozwinięte karty spraw (zwinięta karta to jeden wiersz z nazwą i składem).
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Bulk change: the ticked cases and what to do with one person's access in all of them.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ userId: string; kind: "grant" | "revoke"; role: GrantableRole; canReidentify: boolean }>({
    userId: "",
    kind: "grant",
    role: "VIEWER",
    canReidentify: false
  });

  const reload = useCallback(async () => {
    const [overview, accounts] = await Promise.all([getCaseAccessOverview(), listAdminUsers()]);
    setCases(overview.cases.filter((item) => item.caseKind === "MATTER"));
    setUsers(accounts.users.filter((user) => user.status === "ACTIVE"));
  }, []);

  useEffect(() => {
    void reload().catch((failure) => setError(errorText(failure)));
  }, [reload]);

  const shown = useMemo(() => searchAndSortCases(cases, caseQuery, caseSort, caseRange), [cases, caseQuery, caseSort, caseRange]);
  const visible = useMemo(() => {
    if (!userFilter) return { member: shown, other: [] as CaseAccessOverviewItem[] };
    return splitCasesForUser(shown, userFilter);
  }, [shown, userFilter]);

  const listed = userFilter ? [...visible.member, ...visible.other] : shown;
  const manageable = listed.filter((item) => item.canManage && !item.archivedAt);
  const selectedVisible = manageable.filter((item) => bulkSelected.has(item.caseId)).length;
  // A bulk change applies only to cases in view: narrowing the search or range drops the others.
  const manageableKey = manageable.map((item) => item.caseId).join("|");
  useEffect(() => {
    const inView = new Set(manageableKey ? manageableKey.split("|") : []);
    setBulkSelected((current) => {
      const next = new Set([...current].filter((caseId) => inView.has(caseId)));
      return next.size === current.size ? current : next;
    });
  }, [manageableKey]);

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      await reload();
      setMessage(done);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy("");
    }
  }

  function draftFor(caseId: string) {
    return drafts[caseId] ?? { userId: userFilter || "", role: "VIEWER" as GrantableRole, canReidentify: false };
  }

  function renderCase(item: CaseAccessOverviewItem, highlightMissing: boolean) {
    const owner = item.members.find((member) => member.role === "OWNER");
    const others = item.members.filter((member) => member.role !== "OWNER");
    const draft = draftFor(item.caseId);
    const candidates = users.filter(
      (user) => !item.members.some((member) => member.userId === user.userId)
    );
    const name = item.displayName || item.caseId;
    const ownerOnly = item.canManage ? undefined : t("Zmienia właściciel sprawy.");
    const grant = (userId: string, role: GrantableRole, canReidentify: boolean, done: string) =>
      void run(`${item.caseId}:${userId}`, () => grantCaseAccess(item.caseId, { userId, role, canReidentify }), done);
    return (
      <details
        key={item.caseId}
        className="case-access-admin-case"
        open={open.has(item.caseId)}
        onToggle={(event) => {
          const isOpen = (event.currentTarget as HTMLDetailsElement).open;
          setOpen((current) => {
            const next = new Set(current);
            if (isOpen) next.add(item.caseId);
            else next.delete(item.caseId);
            return next;
          });
        }}
      >
        <summary>
          <span className="case-access-admin-title">
            <input
              type="checkbox"
              className="case-access-bulk-check"
              aria-label={t("Zaznacz sprawę „{name}” do zmiany zbiorczej", { name: name })}
              title={item.canManage ? t("Zaznacz do zmiany zbiorczej") : t("Zmienia właściciel sprawy.")}
              disabled={!item.canManage || Boolean(busy)}
              checked={bulkSelected.has(item.caseId)}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const on = event.target.checked;
                setBulkSelected((current) => {
                  const next = new Set(current);
                  if (on) next.add(item.caseId);
                  else next.delete(item.caseId);
                  return next;
                });
              }}
            />
            <strong>{name}</strong>
            {item.archivedAt ? <span className="security-pill">{t("archiwum")}</span> : null}
          </span>
          <span className="case-access-admin-meta">
            {t("Właściciel:")} {owner ? owner.displayName : "—"}
            {item.canManage ? " (Ty)" : ""} · {caseMembersText(item)}
          </span>
        </summary>

        <div className="case-access-admin-body">
          <div className="case-access-admin-toolbar">
            {renaming?.caseId === item.caseId ? (
              <InlineEdit
                className="case-access-admin-rename"
                value={item.displayName ?? ""}
                label={t("Nowa nazwa sprawy")}
                onCancel={() => setRenaming(null)}
                onSave={async (next) => {
                  await run(
                    `rename:${item.caseId}`,
                    async () => {
                      await renameCase(item.caseId, next);
                      setRenaming(null);
                    },
                    "Nazwa sprawy zmieniona."
                  );
                  return true;
                }}
              />
            ) : (
              <button
                type="button"
                title={ownerOnly ?? t("Zmień nazwę sprawy")}
                aria-label={t("Zmień nazwę sprawy „{name}”", { name: name })}
                disabled={Boolean(busy) || !item.canManage}
                onClick={() => setRenaming({ caseId: item.caseId, name: item.displayName ?? "" })}
              >
                <PencilIcon /> {t("Zmień nazwę")}
              </button>
            )}
            <button
              type="button"
              title={ownerOnly}
              disabled={Boolean(busy) || !item.canManage}
              onClick={() => {
                if (item.archivedAt) {
                  void run(`archive:${item.caseId}`, () => unarchiveCase(item.caseId), t("Sprawa przywrócona z archiwum."));
                } else if (window.confirm(t("Przenieść sprawę „{name}” do archiwum? Można ją potem przywrócić.", { name: name }))) {
                  void run(`archive:${item.caseId}`, () => archiveCase(item.caseId), t("Sprawa przeniesiona do archiwum."));
                }
              }}
            >
              {item.archivedAt ? t("Przywróć z archiwum") : t("Archiwizuj")}
            </button>
          </div>

          {highlightMissing ? (
            <p className="field-help">{t("Wybrany użytkownik nie ma dostępu do tej sprawy.")}</p>
          ) : null}

          <table className="case-access-admin-table">
            <caption>{t("Osoby z dostępem")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("Osoba")}</th>
                <th scope="col">{t("Rola")}</th>
                <th scope="col">{t("Deanonimizacja")}</th>
                {item.canManage ? <th scope="col"><span className="visually-hidden">{t("Działania")}</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {owner ? (
                <tr>
                  <td>
                    {owner.displayName} <small>({owner.loginName})</small>
                  </td>
                  <td>
                    <span className="security-pill">{ROLE_LABELS.OWNER}</span>
                  </td>
                  <td>{t("tak")}</td>
                  {item.canManage ? <td /> : null}
                </tr>
              ) : null}
              {others.map((member) => (
                <tr key={member.userId}>
                  <td>
                    {member.displayName} <small>({member.loginName})</small>
                  </td>
                  <td>
                    {item.canManage ? (
                      <select
                        value={member.role}
                        disabled={Boolean(busy)}
                        aria-label={`Rola: ${member.displayName}`}
                        onChange={(event) =>
                          grant(member.userId, event.target.value as GrantableRole, member.canReidentify, "Rola zmieniona.")
                        }
                      >
                        {GRANTABLE.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROLE_LABELS[member.role]
                    )}
                  </td>
                  <td>
                    {item.canManage ? (
                      <input
                        type="checkbox"
                        checked={member.canReidentify}
                        disabled={Boolean(busy)}
                        aria-label={`Deanonimizacja: ${member.displayName}`}
                        onChange={(event) =>
                          grant(
                            member.userId,
                            member.role as GrantableRole,
                            event.target.checked,
                            t("Uprawnienie do deanonimizacji zmienione.")
                          )
                        }
                      />
                    ) : member.canReidentify ? (
                      "tak"
                    ) : (
                      "nie"
                    )}
                  </td>
                  {item.canManage ? (
                    <td>
                      <button
                        type="button"
                        className="danger-button"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (
                            window.confirm(
                              t("Odebrać {displayName} dostęp do sprawy „{name}”? Klucz sprawy zostanie zmieniony.", { displayName: member.displayName, name: name })
                            )
                          ) {
                            void run(
                              `${item.caseId}:${member.userId}`,
                              () => revokeCaseAccess(item.caseId, member.userId),
                              t("Dostęp odebrany, klucz sprawy zmieniony.")
                            );
                          }
                        }}
                      >
                        {t("Odbierz dostęp")}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>

          {item.canManage ? (
            candidates.length ? (
              <fieldset className="case-access-admin-add">
                <legend>{t("Dodaj osobę do sprawy")}</legend>
                <label>
                  {t("Osoba")}
                  <select
                    value={draft.userId}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [item.caseId]: { ...draft, userId: event.target.value }
                      }))
                    }
                  >
                    <option value="">{t("— wybierz —")}</option>
                    {candidates.map((user) => (
                      <option key={user.userId} value={user.userId}>
                        {user.displayName} ({user.loginName})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("Rola")}
                  <select
                    value={draft.role}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [item.caseId]: { ...draft, role: event.target.value as GrantableRole }
                      }))
                    }
                  >
                    {GRANTABLE.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="case-reidentify-toggle">
                  <input
                    type="checkbox"
                    checked={draft.canReidentify}
                    disabled={Boolean(busy)}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [item.caseId]: { ...draft, canReidentify: event.target.checked }
                      }))
                    }
                  />
                  {t("może deanonimizować")}
                </label>
                <button
                  type="button"
                  className="primary-button"
                  disabled={Boolean(busy) || !candidates.some((user) => user.userId === draft.userId)}
                  onClick={() =>
                    void run(
                      item.caseId,
                      async () => {
                        await grantCaseAccess(item.caseId, draft);
                        setDrafts((current) => {
                          const next = { ...current };
                          delete next[item.caseId];
                          return next;
                        });
                      },
                      t("Dostęp nadany.")
                    )
                  }
                >
                  {t("Nadaj dostęp")}
                </button>
                <small className="field-help">{ROLE_HELP[draft.role]}</small>
              </fieldset>
            ) : (
              <p className="field-help">{t("Wszyscy aktywni użytkownicy mają już dostęp do tej sprawy.")}</p>
            )
          ) : (
            <p className="field-help">
              {t("Uprawnienia zmienia właściciel (")}{owner ? owner.displayName : "—"}).
              <InfoTip>{t("Sprawa jest zaszyfrowana kluczem, który mają tylko jej członkowie.")}</InfoTip>
            </p>
          )}
        </div>
      </details>
    );
  }

  return (
    <section className="case-access-admin-panel">
      <p className="eyebrow">
        {t("Uprawnienia do spraw")}
        <InfoTip>
          {t("Dostęp zmieniasz tylko w sprawach, których jesteś właścicielem; pozostałe są do wglądu.")}
          {(Object.keys(ROLE_HELP) as CaseRole[]).map((role) => ` ${ROLE_HELP[role]}`).join("")}
        </InfoTip>
      </p>
      <div className="case-access-filters" role="search">
        <div className="case-access-filters-row">
          <label className="case-access-filter-search">
            {t("Szukaj sprawy")}
            <input
              type="search"
              value={caseQuery}
              placeholder={t("Nazwa sprawy, osoba lub login")}
              onChange={(event) => setCaseQuery(event.target.value)}
            />
          </label>
          <label>
            {t("Osoba")}
            <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
              <option value="">{t("Wszystkie sprawy")}</option>
              {users.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.displayName} ({user.loginName}){user.userId === currentUserId ? ` — ${t("Ty")}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Sortowanie")}
            <select value={caseSort} onChange={(event) => setCaseSort(event.target.value as CaseSort)}>
              {(Object.keys(CASE_SORT_LABELS) as CaseSort[]).map((key) => (
                <option key={key} value={key}>
                  {t(CASE_SORT_LABELS[key])}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="case-access-filters-row case-access-range">
          <span className="case-access-filter-label">{t("Zakres")}</span>
          <select
            aria-label={t("Data, której dotyczy zakres")}
            value={caseRange.field ?? "created"}
            onChange={(event) => setCaseRange({ ...caseRange, field: event.target.value as "created" | "updated" })}
          >
            <option value="created">{t("data utworzenia")}</option>
            <option value="updated">{t("ostatnia zmiana")}</option>
          </select>
          <div className="case-access-chips" role="group" aria-label={t("Zakres dat")}>
            {CASE_RANGE_PRESETS.map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                className={rangePreset === preset ? "case-access-chip active" : "case-access-chip"}
                aria-pressed={rangePreset === preset}
                onClick={() => {
                  setRangePreset(preset);
                  setCaseRange(rangeForPreset(preset, new Date(), caseRange));
                }}
              >
                {t(label)}
              </button>
            ))}
          </div>
          {rangePreset === "custom" ? (
            <span className="case-access-dates">
              <label>
                {t("od")}
                <input type="date" value={caseRange.from} max={caseRange.to || undefined} onChange={(event) => setCaseRange({ ...caseRange, from: event.target.value })} />
              </label>
              <label>
                {t("do")}
                <input type="date" value={caseRange.to} min={caseRange.from || undefined} onChange={(event) => setCaseRange({ ...caseRange, to: event.target.value })} />
              </label>
            </span>
          ) : null}
        </div>
        <div className="case-access-results">
          <span>
            {t("Wyświetlono {shown} z {all} spraw", { shown: listed.length, all: cases.length })}
            {caseRange.from || caseRange.to
              ? t(" · {value} – {value2}", { value: caseRange.from ? new Date(caseRange.from).toLocaleDateString(currentLocale()) : "…", value2: caseRange.to ? new Date(caseRange.to).toLocaleDateString(currentLocale()) : "…" })
              : ""}
          </span>
          {caseQuery || userFilter || caseRange.from || caseRange.to || caseSort !== "name-asc" ? (
            <button
              type="button"
              className="case-access-link"
              onClick={() => {
                setCaseQuery("");
                setUserFilter("");
                setCaseSort("name-asc");
                setRangePreset("all");
                setCaseRange({ from: "", to: "", field: caseRange.field ?? "created" });
              }}
            >
              {t("Wyczyść filtry")}
            </button>
          ) : null}
        </div>
      </div>
      <details className="case-access-quick-card">
        <summary>{t("Przypisz osobę do jednej sprawy")}</summary>
        <fieldset className="case-access-admin-quick">
        <legend>
          {t("Przypisz osobę do sprawy")}
          <InfoTip>
            {t("Tylko sprawy, których jesteś właścicielem (tylko on ma klucz sprawy). Przypisanie osoby z dostępem zmienia jej rolę.")}
          </InfoTip>
        </legend>
        <select
          value={quick.userId}
          aria-label={t("Osoba")}
          disabled={Boolean(busy)}
          onChange={(event) => setQuick({ ...quick, userId: event.target.value })}
        >
          <option value="">{t("Osoba…")}</option>
          {users
            .filter((user) => user.userId !== currentUserId)
            .map((user) => (
              <option key={user.userId} value={user.userId}>
                {user.displayName} ({user.loginName})
              </option>
            ))}
        </select>
        <select
          value={quick.caseId}
          aria-label={t("Sprawa")}
          disabled={Boolean(busy)}
          onChange={(event) => setQuick({ ...quick, caseId: event.target.value })}
        >
          <option value="">{t("Sprawa…")}</option>
          {quickCaseOptions(cases, caseQuery, caseSort, quick.caseId, caseRange).map((item) => {
            const member = item.members.find((m) => m.userId === quick.userId);
            return (
              <option key={item.caseId} value={item.caseId}>
                {item.displayName || item.caseId}
                {member ? t(" (ma dostęp: {value})", { value: ROLE_LABELS[member.role] }) : ""}
              </option>
            );
          })}
        </select>
        <select
          value={quick.role}
          aria-label={t("Rola")}
          disabled={Boolean(busy)}
          onChange={(event) => setQuick({ ...quick, role: event.target.value as GrantableRole })}
        >
          {GRANTABLE.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <label className="case-reidentify-toggle">
          <input
            type="checkbox"
            checked={quick.canReidentify}
            disabled={Boolean(busy)}
            onChange={(event) => setQuick({ ...quick, canReidentify: event.target.checked })}
          />
          {t("deanonimizacja")}
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={Boolean(busy) || !quick.userId || !quick.caseId}
          onClick={() =>
            void run(
              "quick",
              async () => {
                await grantCaseAccess(quick.caseId, {
                  userId: quick.userId,
                  role: quick.role,
                  canReidentify: quick.canReidentify
                });
                setQuick({ ...quick, caseId: "" });
              },
              t("Osoba przypisana do sprawy.")
            )
          }
        >
          {busy === "quick" ? "Przypisywanie…" : t("Przypisz")}
        </button>
      </fieldset>
      </details>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert">{message}</div> : null}
      <div className={bulkSelected.size ? "case-access-list-head has-selection" : "case-access-list-head"}>
        <label className="case-access-select-all">
          <input
            type="checkbox"
            ref={(element) => {
              if (element) element.indeterminate = selectedVisible > 0 && selectedVisible < manageable.length;
            }}
            checked={manageable.length > 0 && selectedVisible === manageable.length}
            disabled={Boolean(busy) || manageable.length === 0}
            onChange={(event) => {
              const on = event.target.checked;
              setBulkSelected((current) => {
                const next = new Set(current);
                for (const item of manageable) {
                  if (on) next.add(item.caseId);
                  else next.delete(item.caseId);
                }
                return next;
              });
            }}
          />
          {bulkSelected.size
            ? t("Zaznaczono {count}", { count: bulkSelected.size })
            : t("Zaznacz wszystkie widoczne ({count})", { count: manageable.length })}
          <InfoTip>
            {t("Zaznaczać można sprawy, których jesteś właścicielem (tylko on ma klucz sprawy). Właściciel sprawy zachowuje swoją rolę.")}
          </InfoTip>
        </label>
        {bulkSelected.size ? (
          <button type="button" className="case-access-link" disabled={Boolean(busy)} onClick={() => setBulkSelected(new Set())}>
            {t("Odznacz")}
          </button>
        ) : null}
      </div>
      {bulkSelected.size ? (
        <div className="case-access-bulk-bar" aria-label={t("Zmiana zbiorcza")}>
          <div className="case-access-admin-bulk-row">
          <select
            value={bulk.userId}
            aria-label={t("Osoba (zmiana zbiorcza)")}
            disabled={Boolean(busy)}
            onChange={(event) => setBulk({ ...bulk, userId: event.target.value })}
          >
            <option value="">{t("Osoba…")}</option>
            {users
              .filter((user) => user.userId !== currentUserId)
              .map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.displayName} ({user.loginName})
                </option>
              ))}
          </select>
          <select
            value={bulk.kind === "revoke" ? "revoke" : bulk.role}
            aria-label={t("Działanie (zmiana zbiorcza)")}
            disabled={Boolean(busy)}
            onChange={(event) =>
              setBulk(
                event.target.value === "revoke"
                  ? { ...bulk, kind: "revoke" }
                  : { ...bulk, kind: "grant", role: event.target.value as GrantableRole }
              )
            }
          >
            {GRANTABLE.map((role) => (
              <option key={role} value={role}>
                {t("Nadaj lub zmień rolę:")} {ROLE_LABELS[role]}
              </option>
            ))}
            <option value="revoke">{t("Odbierz dostęp")}</option>
          </select>
          {bulk.kind === "grant" ? (
            <label className="case-reidentify-toggle">
              <input
                type="checkbox"
                checked={bulk.canReidentify}
                disabled={Boolean(busy)}
                onChange={(event) => setBulk({ ...bulk, canReidentify: event.target.checked })}
              />
              {t("deanonimizacja")}
            </label>
          ) : null}
          <button
            type="button"
            className="primary-button"
            disabled={Boolean(busy) || !bulk.userId || bulkSelected.size === 0}
            onClick={() => {
              const action: BulkAccessAction =
                bulk.kind === "revoke" ? { kind: "revoke" } : { kind: "grant", role: bulk.role, canReidentify: bulk.canReidentify };
              const plan = bulkAccessPlan(cases, bulkSelected, bulk.userId, action);
              const person = users.find((user) => user.userId === bulk.userId)?.displayName ?? "osoby";
              if (
                bulk.kind === "revoke" &&
                plan.apply.length > 0 &&
                !window.confirm(t("Odebrać dostęp {person} w {count} sprawach?", { person: person, count: plan.apply.length }))
              ) {
                return;
              }
              const failed: string[] = [];
              void run(
                "bulk",
                async () => {
                  for (const caseId of plan.apply) {
                    try {
                      if (action.kind === "revoke") await revokeCaseAccess(caseId, bulk.userId);
                      else await grantCaseAccess(caseId, { userId: bulk.userId, role: action.role, canReidentify: action.canReidentify });
                    } catch (failure) {
                      const name = cases.find((item) => item.caseId === caseId)?.displayName || caseId;
                      failed.push(`${name}: ${errorText(failure)}`);
                    }
                  }
                  if (failed.length) throw new Error(`Nie udało się w ${failed.length} sprawach — ${failed.slice(0, 5).join("; ")}`);
                  setBulkSelected(new Set());
                },
                t("Zmieniono w {count} sprawach{value}.", { count: plan.apply.length, value: plan.skipped.length ? `; pominięto ${plan.skipped.length} (${[...new Set(plan.skipped.map((item) => item.reason))].join(", ")})` : "" })
              );
            }}
          >
            {busy === "bulk" ? "Zmieniam…" : t("Zastosuj do {count} spraw", { count: bulkSelected.size })}
          </button>
        </div>
        </div>
      ) : null}
      {userFilter ? (
        <>
          <h3>{t("Sprawy z dostępem (")}{visible.member.length})</h3>
          {visible.member.length ? visible.member.map((item) => renderCase(item, false)) : (
            <p className="field-help">{t("Brak spraw.")}</p>
          )}
          <h3>{t("Pozostałe sprawy (")}{visible.other.length})</h3>
          {visible.other.map((item) => renderCase(item, true))}
        </>
      ) : shown.length ? (
        shown.map((item) => renderCase(item, false))
      ) : (
        <p className="field-help">{cases.length ? t("Brak spraw pasujących do wyszukiwania lub zakresu dat.") : "Brak spraw."}</p>
      )}
    </section>
  );
}
