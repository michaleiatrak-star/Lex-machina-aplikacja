import { t } from "./i18n";
import { listUserGroups, shareCaseWithGroup, type UserGroup } from "./api.js";
import { groupErrorText, groupShareSummary } from "./UserGroupsPanel.js";
import { InfoTip } from "./InfoTip";
import {
  useEffect,
  useState
} from "react";
import {
  grantCaseAccess,
  listCaseAccess,
  listCaseAccessCandidates,
  revokeCaseAccess,
  transferCaseOwnership,
  type AuthenticatedUser,
  type CaseAccessEntry,
  type CaseRole
} from "./api.js";

type SharedRole =
  Exclude<
    CaseRole,
    "OWNER"
  >;

const ROLE_LABELS:
  Record<
    CaseRole,
    string
  > = {
    OWNER: "Właściciel",
    EDITOR: "Edytor",
    ANALYST: "Analityk",
    VIEWER: "Odczyt"
  };

const ROLE_HELP:
  Record<
    SharedRole,
    string
  > = {
    EDITOR:
      "odczyt, dodawanie dokumentów i analiza",
    ANALYST:
      "odczyt i analiza bez modyfikacji akt",
    VIEWER:
      "wyłącznie odczyt akt"
  };

function ParticipantRow({
  entry,
  busy,
  onSave,
  onRevoke
}: {
  entry: CaseAccessEntry;
  busy: boolean;
  onSave: (
    entry: CaseAccessEntry,
    role: SharedRole,
    canReidentify: boolean
  ) => Promise<void>;
  onRevoke: (
    entry: CaseAccessEntry
  ) => Promise<void>;
}) {
  const editable =
    entry.role !== "OWNER";
  const [role, setRole] =
    useState<SharedRole>(
      entry.role === "OWNER"
        ? "VIEWER"
        : entry.role
    );
  const [
    canReidentify,
    setCanReidentify
  ] = useState(
    entry.canReidentify
  );

  useEffect(() => {
    if (
      entry.role !== "OWNER"
    ) {
      setRole(
        entry.role
      );
    }
    setCanReidentify(
      entry.canReidentify
    );
  }, [
    entry.role,
    entry.canReidentify
  ]);

  async function save():
    Promise<void> {
    if (!editable) return;
    await onSave(
      entry,
      role,
      canReidentify
    );
  }

  async function revoke():
    Promise<void> {
    if (!editable) return;
    if (
      !window.confirm(
        `Odebrać @${entry.user.loginName} dostęp do tej sprawy? Klucz sprawy zostanie obrócony dla pozostałych uczestników.`
      )
    ) {
      return;
    }
    await onRevoke(
      entry
    );
  }

  return (
    <article className="case-collaborator-row">
      <div className="case-collaborator-person">
        <strong>
          {entry.user.displayName}
        </strong>
        <span>
          @{entry.user.loginName}
          {" · "}
          {ROLE_LABELS[
            entry.role
          ]}
        </span>
        <small>
          {entry.role ===
          "OWNER"
            ? t("pełna kontrola sprawy")
            : ROLE_HELP[
                entry.role
              ]}
          {entry.canReidentify
            ? " · reidentyfikacja dozwolona"
            : " · bez reidentyfikacji"}
        </small>
      </div>

      {editable && (
        <div className="case-collaborator-controls">
          <select
            aria-label={
              `Rola ${entry.user.loginName}`
            }
            value={role}
            disabled={busy}
            onChange={(event) =>
              setRole(
                event.target
                  .value as
                  SharedRole
              )
            }
          >
            <option value="EDITOR">
              {t("Edytor")}
            </option>
            <option value="ANALYST">
              {t("Analityk")}
            </option>
            <option value="VIEWER">
              {t("Odczyt")}
            </option>
          </select>

          <label className="case-reidentify-toggle">
            <input
              type="checkbox"
              checked={
                canReidentify
              }
              disabled={busy}
              onChange={(event) =>
                setCanReidentify(
                  event.target
                    .checked
                )
              }
            />
            {t("Reidentyfikacja")}
          </label>

          <button
            type="button"
            className="chat-secondary-action"
            disabled={busy}
            onClick={() => {
              void save();
            }}
          >
            {t("Zapisz")}
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => {
              void revoke();
            }}
          >
            {t("Odbierz")}
          </button>
        </div>
      )}
    </article>
  );
}

export function CaseCollaborationPanel({
  caseId,
  caseRole,
  onOwnershipTransferred
}: {
  caseId: string;
  caseRole:
    | CaseRole
    | undefined;
  onOwnershipTransferred?:
    () => Promise<void> | void;
}) {
  const [access, setAccess] =
    useState<CaseAccessEntry[]>(
      []
    );
  const [
    candidates,
    setCandidates
  ] = useState<
    AuthenticatedUser[]
  >([]);
  const [
    selectedUserId,
    setSelectedUserId
  ] = useState("");
  const [role, setRole] =
    useState<SharedRole>(
      "EDITOR"
    );
  const [
    canReidentify,
    setCanReidentify
  ] = useState(false);
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
    useState("");
  const [
    transferUserId,
    setTransferUserId
  ] = useState("");
  const [
    transferPassword,
    setTransferPassword
  ] = useState("");



  const canManage =
    caseRole === "OWNER";

  async function refresh():
    Promise<void> {
    if (
      !caseId ||
      !canManage
    ) {
      setAccess([]);
      setCandidates([]);
      return;
    }
    const [
      currentAccess,
      available
    ] = await Promise.all([
      listCaseAccess(caseId),
      listCaseAccessCandidates(
        caseId
      )
    ]);
    setAccess(
      currentAccess.access
    );
    setCandidates(
      available.users
    );
    setSelectedUserId(
      (current) =>
        available.users.some(
          (user) =>
            user.userId ===
              current
        )
          ? current
          : (
              available.users[0]
                ?.userId ?? ""
            )
    );
    const transferTargets = [
      ...currentAccess.access
        .filter(
          (entry) =>
            entry.role !==
              "OWNER" &&
            entry.user.status ===
              "ACTIVE"
        )
        .map(
          (entry) =>
            entry.user
        ),
      ...available.users
    ];
    setTransferUserId(
      (current) =>
        transferTargets.some(
          (user) =>
            user.userId ===
              current
        )
          ? current
          : (
              transferTargets[0]
                ?.userId ?? ""
            )
    );
  }

  useEffect(() => {
    setError("");
    setMessage("");
    void refresh().catch(
      (failure) => {
        setError(
          failure instanceof Error
            ? failure.message
            : String(failure)
        );
      }
    );
  }, [
    caseId,
    canManage
  ]);

  async function runChange(
    action:
      () => Promise<void>
  ): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : String(failure)
      );
    } finally {
      setBusy(false);
    }
  }

  async function transferOwner():
    Promise<void> {
    if (
      !transferUserId ||
      !transferPassword
    ) {
      return;
    }
    if (
      !window.confirm(
        t("Przekazać własność tej sprawy? Twoja rola zostanie zmieniona na EDITOR.")
      )
    ) {
      return;
    }
    await transferCaseOwnership(
      caseId,
      transferUserId,
      transferPassword
    );
    setTransferPassword("");
    setMessage(
      t("Własność sprawy została przekazana. Dotychczasowy właściciel pozostaje jako EDITOR.")
    );
    await onOwnershipTransferred?.();
  }

  // Groups (Ustawienia -> Użytkownicy): each member gets the case like one added by hand.
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  useEffect(() => {
    let alive = true;
    listUserGroups().then(
      (result) => {
        if (!alive) return;
        setGroups(result.groups);
        setGroupId((current) => current || result.groups[0]?.groupId || "");
      },
      () => undefined
    );
    return () => {
      alive = false;
    };
  }, []);

  async function addGroup(): Promise<void> {
    if (!groupId) return;
    try {
      const result = await shareCaseWithGroup(caseId, { groupId, role, canReidentify });
      const names = new Map<string, string>([
        ...candidates.map((user) => [user.userId, `@${user.loginName}`] as [string, string]),
        ...access.map((entry) => [entry.user.userId, `@${entry.user.loginName}`] as [string, string])
      ]);
      setCanReidentify(false);
      await refresh();
      setMessage(groupShareSummary(result, names));
    } catch (failure) {
      throw new Error(groupErrorText(failure));
    }
  }

  async function add():
    Promise<void> {
    if (!selectedUserId) {
      return;
    }
    await grantCaseAccess(
      caseId,
      {
        userId:
          selectedUserId,
        role,
        canReidentify
      }
    );
    setCanReidentify(false);
    await refresh();
    setMessage(
      t("Użytkownik otrzymał szyfrowany dostęp do sprawy.")
    );
  }

  if (
    !caseId ||
    !canManage
  ) {
    return null;
  }

  return (
    <section className="case-collaboration-panel">
      <div className="case-collaboration-head">
        <div>
          <p className="eyebrow">
            {t("Zespół sprawy")}
          </p>
          <h3>
            {t("Uczestnicy i dostęp do akt")}
            <InfoTip>{t("Każdy uczestnik ma własną kopię klucza sprawy. Odebranie dostępu zmienia klucz i odcina osobę od zaszyfrowanych dokumentów.")}</InfoTip>
          </h3>
        </div>
        <span className="security-pill">
          {t("Dostępem zarządza właściciel")}
        </span>
      </div>

      <div className="case-collaboration-add">
        <label>
          {t("Użytkownik")}
          <select
            value={
              selectedUserId
            }
            disabled={
              busy ||
              candidates.length ===
                0
            }
            onChange={(event) =>
              setSelectedUserId(
                event.target.value
              )
            }
          >
            {candidates.length ===
              0 && (
              <option value="">
                {t("Brak kolejnych aktywnych użytkowników")}
              </option>
            )}
            {candidates.map(
              (user) => (
                <option
                  key={
                    user.userId
                  }
                  value={
                    user.userId
                  }
                >
                  {user.displayName} · @{user.loginName}
                </option>
              )
            )}
          </select>
        </label>

        <label>
          {t("Rola")}
          <select
            value={role}
            disabled={busy}
            onChange={(event) =>
              setRole(
                event.target
                  .value as
                  SharedRole
              )
            }
          >
            <option value="EDITOR">
              {t("Edytor")}
            </option>
            <option value="ANALYST">
              {t("Analityk")}
            </option>
            <option value="VIEWER">
              {t("Odczyt")}
            </option>
          </select>
        </label>

        <label className="case-reidentify-toggle">
          <input
            type="checkbox"
            checked={
              canReidentify
            }
            disabled={busy}
            onChange={(event) =>
              setCanReidentify(
                event.target
                  .checked
              )
            }
          />
          {t("Może reidentyfikować")}
        </label>

        <button
          type="button"
          className="primary-button"
          disabled={
            busy ||
            !selectedUserId
          }
          onClick={() => {
            void runChange(
              add
            );
          }}
        >
          {t("Dodaj do sprawy")}
        </button>
      </div>

      {groups.length ? (
        <div className="case-collaboration-add">
          <label>
            {t("Grupa")}
            <select value={groupId} disabled={busy} onChange={(event) => setGroupId(event.target.value)}>
              {groups.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.name} ({group.memberUserIds.length} os.)
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !groupId}
            title={t("Rola i reidentyfikacja jak wyżej, dla każdego członka grupy")}
            onClick={() => {
              void runChange(addGroup);
            }}
          >
            {t("Udostępnij grupie")}
          </button>
        </div>
      ) : null}

      <div className="case-role-legend">
        <span>
          <strong>EDITOR</strong> {t("— dokumenty + analiza")}
        </span>
        <span>
          <strong>ANALYST</strong> {t("— odczyt + analiza")}
        </span>
        <span>
          <strong>VIEWER</strong> {t("— odczyt")}
        </span>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}
      {message && (
        <div className="alert">
          {message}
        </div>
      )}

      <details className="case-owner-transfer">
        <summary>
          {t("Przekaż własność sprawy")}
        </summary>
        <p className="field-help">
          {t("Wymaga hasła. Nowy właściciel zarządza uczestnikami, a Ty zostajesz z rolą EDITOR.")}
        </p>
        <div className="case-owner-transfer-grid">
          <label>
            {t("Nowy właściciel")}
            <select
              value={
                transferUserId
              }
              disabled={busy}
              onChange={(event) =>
                setTransferUserId(
                  event.target
                    .value
                )
              }
            >
              {[...access
                .filter(
                  (entry) =>
                    entry.role !==
                      "OWNER" &&
                    entry.user.status ===
                      "ACTIVE"
                )
                .map(
                  (entry) =>
                    entry.user
                ),
                ...candidates
              ].map((user) => (
                <option
                  key={
                    user.userId
                  }
                  value={
                    user.userId
                  }
                >
                  {user.displayName} · @{user.loginName}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Hasło właściciela")}
            <input
              type="password"
              autoComplete="current-password"
              value={
                transferPassword
              }
              disabled={busy}
              onChange={(event) =>
                setTransferPassword(
                  event.target
                    .value
                )
              }
            />
          </label>
          <button
            type="button"
            disabled={
              busy ||
              !transferUserId ||
              !transferPassword
            }
            onClick={() => {
              void runChange(
                transferOwner
              );
            }}
          >
            {t("Przekaż własność")}
          </button>
        </div>
      </details>

      <div className="case-collaborator-list">
        {access.map(
          (entry) => (
            <ParticipantRow
              key={
                entry.user.userId
              }
              entry={entry}
              busy={busy}
              onSave={async (
                current,
                nextRole,
                nextCanReidentify
              ) => {
                await runChange(
                  async () => {
                    await grantCaseAccess(
                      caseId,
                      {
                        userId:
                          current.user
                            .userId,
                        role:
                          nextRole,
                        canReidentify:
                          nextCanReidentify
                      }
                    );
                    await refresh();
                    setMessage(
                      `Zaktualizowano dostęp @${current.user.loginName}.`
                    );
                  }
                );
              }}
              onRevoke={async (
                current
              ) => {
                await runChange(
                  async () => {
                    await revokeCaseAccess(
                      caseId,
                      current.user
                        .userId
                    );
                    await refresh();
                    setMessage(
                      `Odebrano dostęp @${current.user.loginName} i obrócono klucz sprawy.`
                    );
                  }
                );
              }}
            />
          )
        )}
      </div>
    </section>
  );
}
