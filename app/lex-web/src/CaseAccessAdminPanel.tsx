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
  OWNER: "Właściciel",
  EDITOR: "Edycja",
  ANALYST: "Analiza",
  VIEWER: "Podgląd"
};

const GRANTABLE: GrantableRole[] = ["EDITOR", "ANALYST", "VIEWER"];

// Uprawnienia ról jak w runtime (case-access.ts: READ / WRITE / ANALYZE / MANAGE).
const ROLE_HELP: Record<CaseRole, string> = {
  OWNER: "Właściciel: pełny dostęp i zarządzanie osobami; ma klucz sprawy.",
  EDITOR: "Edycja: odczyt, dodawanie i zmiana dokumentów, analizy z modelem.",
  ANALYST: "Analiza: odczyt i analizy z modelem, bez zmian w aktach sprawy.",
  VIEWER: "Podgląd: tylko odczyt akt i rozmów."
};

// "2 osoby: Marcin (Edycja), Anna (Podgląd)" — skrót składu sprawy w nagłówku karty.
export function caseMembersText(item: CaseAccessOverviewItem): string {
  const others = item.members.filter((member) => member.role !== "OWNER");
  if (!others.length) return "tylko właściciel";
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
      return "Użytkownik nie ma jeszcze kluczy do udostępniania (musi zalogować się co najmniej raz).";
    case "TARGET_USER_NOT_FOUND":
      return "Użytkownik nie istnieje albo jest wyłączony.";
    case "CASE_ACCESS_DENIED":
      return "Uprawnienia do tej sprawy zmienia jej właściciel.";
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

function PencilIcon() {
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

  const reload = useCallback(async () => {
    const [overview, accounts] = await Promise.all([getCaseAccessOverview(), listAdminUsers()]);
    setCases(overview.cases.filter((item) => item.caseKind === "MATTER"));
    setUsers(accounts.users.filter((user) => user.status === "ACTIVE"));
  }, []);

  useEffect(() => {
    void reload().catch((failure) => setError(errorText(failure)));
  }, [reload]);

  const visible = useMemo(() => {
    if (!userFilter) return { member: cases, other: [] as CaseAccessOverviewItem[] };
    return splitCasesForUser(cases, userFilter);
  }, [cases, userFilter]);

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
    const ownerOnly = item.canManage ? undefined : "Zmienia właściciel sprawy.";
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
            <strong>{name}</strong>
            {item.archivedAt ? <span className="security-pill">archiwum</span> : null}
          </span>
          <span className="case-access-admin-meta">
            Właściciel: {owner ? owner.displayName : "—"}
            {item.canManage ? " (Ty)" : ""} · {caseMembersText(item)}
          </span>
        </summary>

        <div className="case-access-admin-body">
          <div className="case-access-admin-toolbar">
            {renaming?.caseId === item.caseId ? (
              <form
                className="case-access-admin-rename"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = renaming.name.trim();
                  if (!next || next === item.displayName) {
                    setRenaming(null);
                    return;
                  }
                  void run(
                    `rename:${item.caseId}`,
                    async () => {
                      await renameCase(item.caseId, next);
                      setRenaming(null);
                    },
                    "Nazwa sprawy zmieniona."
                  );
                }}
              >
                <input
                  value={renaming.name}
                  maxLength={160}
                  aria-label="Nowa nazwa sprawy"
                  autoFocus
                  disabled={Boolean(busy)}
                  onChange={(event) => setRenaming({ caseId: item.caseId, name: event.target.value })}
                />
                <button type="submit" className="primary-button" disabled={Boolean(busy) || !renaming.name.trim()}>
                  Zapisz
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => setRenaming(null)}>
                  Anuluj
                </button>
              </form>
            ) : (
              <button
                type="button"
                title={ownerOnly ?? "Zmień nazwę sprawy"}
                aria-label={`Zmień nazwę sprawy „${name}”`}
                disabled={Boolean(busy) || !item.canManage}
                onClick={() => setRenaming({ caseId: item.caseId, name: item.displayName ?? "" })}
              >
                <PencilIcon /> Zmień nazwę
              </button>
            )}
            <button
              type="button"
              title={ownerOnly}
              disabled={Boolean(busy) || !item.canManage}
              onClick={() => {
                if (item.archivedAt) {
                  void run(`archive:${item.caseId}`, () => unarchiveCase(item.caseId), "Sprawa przywrócona z archiwum.");
                } else if (window.confirm(`Przenieść sprawę „${name}” do archiwum? Można ją potem przywrócić.`)) {
                  void run(`archive:${item.caseId}`, () => archiveCase(item.caseId), "Sprawa przeniesiona do archiwum.");
                }
              }}
            >
              {item.archivedAt ? "Przywróć z archiwum" : "Archiwizuj"}
            </button>
          </div>

          {highlightMissing ? (
            <p className="field-help">Wybrany użytkownik nie ma dostępu do tej sprawy.</p>
          ) : null}

          <table className="case-access-admin-table">
            <caption>Osoby z dostępem</caption>
            <thead>
              <tr>
                <th scope="col">Osoba</th>
                <th scope="col">Rola</th>
                <th scope="col">Deanonimizacja</th>
                {item.canManage ? <th scope="col"><span className="visually-hidden">Działania</span></th> : null}
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
                  <td>tak</td>
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
                            "Uprawnienie do deanonimizacji zmienione."
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
                              `Odebrać ${member.displayName} dostęp do sprawy „${name}”? Klucz sprawy zostanie zmieniony.`
                            )
                          ) {
                            void run(
                              `${item.caseId}:${member.userId}`,
                              () => revokeCaseAccess(item.caseId, member.userId),
                              "Dostęp odebrany, klucz sprawy zmieniony."
                            );
                          }
                        }}
                      >
                        Odbierz dostęp
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
                <legend>Dodaj osobę do sprawy</legend>
                <label>
                  Osoba
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
                    <option value="">— wybierz —</option>
                    {candidates.map((user) => (
                      <option key={user.userId} value={user.userId}>
                        {user.displayName} ({user.loginName})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Rola
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
                  może deanonimizować
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
                      "Dostęp nadany."
                    )
                  }
                >
                  Nadaj dostęp
                </button>
                <small className="field-help">{ROLE_HELP[draft.role]}</small>
              </fieldset>
            ) : (
              <p className="field-help">Wszyscy aktywni użytkownicy mają już dostęp do tej sprawy.</p>
            )
          ) : (
            <p className="field-help">
              Sprawa jest zaszyfrowana kluczem, który mają tylko jej członkowie. Uprawnienia zmienia
              właściciel ({owner ? owner.displayName : "—"}).
            </p>
          )}
        </div>
      </details>
    );
  }

  return (
    <section className="case-access-admin-panel">
      <p className="eyebrow">Uprawnienia do spraw</p>
      <p className="field-help">
        Kto ma dostęp do której sprawy i z jaką rolą. Nadawać, zmieniać i odbierać dostęp możesz w
        sprawach, których jesteś właścicielem; pozostałe są widoczne do wglądu.
      </p>
      <ul className="case-access-admin-roles">
        {(Object.keys(ROLE_HELP) as CaseRole[]).map((role) => (
          <li key={role}>{ROLE_HELP[role]}</li>
        ))}
      </ul>
      <fieldset className="case-access-admin-quick">
        <legend>Przypisz osobę do sprawy</legend>
        <select
          value={quick.userId}
          aria-label="Osoba"
          disabled={Boolean(busy)}
          onChange={(event) => setQuick({ ...quick, userId: event.target.value })}
        >
          <option value="">Osoba…</option>
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
          aria-label="Sprawa"
          disabled={Boolean(busy)}
          onChange={(event) => setQuick({ ...quick, caseId: event.target.value })}
        >
          <option value="">Sprawa…</option>
          {assignableCases(cases).map((item) => {
            const member = item.members.find((m) => m.userId === quick.userId);
            return (
              <option key={item.caseId} value={item.caseId}>
                {item.displayName || item.caseId}
                {member ? ` (ma dostęp: ${ROLE_LABELS[member.role]})` : ""}
              </option>
            );
          })}
        </select>
        <select
          value={quick.role}
          aria-label="Rola"
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
          deanonimizacja
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
              "Osoba przypisana do sprawy."
            )
          }
        >
          {busy === "quick" ? "Przypisywanie…" : "Przypisz"}
        </button>
        <p className="field-help">
          Lista obejmuje sprawy, których jesteś właścicielem (tylko właściciel ma klucz sprawy i może go
          udostępnić). Przypisanie osoby, która ma już dostęp, zmienia jej rolę.
        </p>
      </fieldset>
      <label>
        Użytkownik
        <select value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
          <option value="">Wszystkie sprawy</option>
          {users.map((user) => (
            <option key={user.userId} value={user.userId}>
              {user.displayName} ({user.loginName}){user.userId === currentUserId ? " — Ty" : ""}
            </option>
          ))}
        </select>
      </label>
      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert">{message}</div> : null}
      {userFilter ? (
        <>
          <h3>Sprawy z dostępem ({visible.member.length})</h3>
          {visible.member.length ? visible.member.map((item) => renderCase(item, false)) : (
            <p className="field-help">Brak spraw.</p>
          )}
          <h3>Pozostałe sprawy ({visible.other.length})</h3>
          {visible.other.map((item) => renderCase(item, true))}
        </>
      ) : cases.length ? (
        cases.map((item) => renderCase(item, false))
      ) : (
        <p className="field-help">Brak spraw.</p>
      )}
    </section>
  );
}
