import { t } from "./i18n";
import { useEffect, useState } from "react";
import {
  ApiError,
  createUserGroup,
  deleteUserGroup,
  listAdminUsers,
  listUserGroups,
  updateUserGroup,
  type AuthenticatedUser,
  type GroupShareResult,
  type UserGroup
} from "./api.js";
import { InfoTip } from "./InfoTip";

const ERRORS: Record<string, string> = {
  USER_GROUP_NAME_TAKEN: "Grupa o tej nazwie już istnieje.",
  USER_GROUP_NAME_INVALID: "Nazwa grupy: od 1 do 80 znaków.",
  USER_GROUP_MEMBERS_INVALID: "Lista członków zawiera nieznanego użytkownika.",
  USER_GROUP_NOT_FOUND: "Grupa już nie istnieje.",
  AUTHORIZATION_DENIED: "Grupami zarządza administrator."
};

export function groupErrorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error);
  return ERRORS[code] ?? code;
}

const SKIP_REASONS: Record<string, string> = {
  ALREADY_HAS_ACCESS: "ma już dostęp",
  TARGET_CRYPTO_NOT_READY: "nie zalogował się jeszcze ani razu (brak kluczy szyfrowania)",
  TARGET_USER_NOT_FOUND: "konto nieaktywne"
};

/** "Dodano 3 osoby; pominięto: @jan (ma już dostęp)". */
export function groupShareSummary(result: GroupShareResult, names: Map<string, string>): string {
  const name = (userId: string) => names.get(userId) ?? userId;
  const added = result.granted.length ? `Dodano do sprawy: ${result.granted.map(name).join(", ")}.` : "Nikt nowy nie został dodany.";
  const skipped = result.skipped.map((item) => `${name(item.userId)} (${SKIP_REASONS[item.reason] ?? item.reason})`);
  return skipped.length ? `${added} Pominięto: ${skipped.join(", ")}.` : added;
}

/** Ustawienia -> Użytkownicy (administrator): grupy do udostępniania spraw jednym kliknięciem. */
export function UserGroupsPanel() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [users, setUsers] = useState<AuthenticatedUser[]>([]);
  const [editing, setEditing] = useState<{ groupId?: string; name: string; members: Set<string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh(): Promise<void> {
    const [groupList, userList] = await Promise.all([listUserGroups(), listAdminUsers()]);
    setGroups(groupList.groups);
    setUsers(userList.users.filter((user) => user.status === "ACTIVE"));
  }

  useEffect(() => {
    void refresh().catch((error) => setMessage(groupErrorText(error)));
  }, []);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setMessage(groupErrorText(error));
    } finally {
      setBusy(false);
    }
  }

  const label = (userId: string) => {
    const user = users.find((item) => item.userId === userId);
    return user ? `${user.displayName} (@${user.loginName})` : userId;
  };

  return (
    <article className="chat-card user-groups-panel">
      <p className="eyebrow">{t("Grupy")}</p>
      <h2>
        {t("Grupy użytkowników")}
        <InfoTip>
          {t("Zespół, dział lub pełnomocnicy jednej sprawy: przy sprawie „Udostępnij grupie” nadaje dostęp każdemu członkowi osobno, z jego własną kopią klucza sprawy. Osoba dopisana do grupy później dostaje dostęp przy kolejnym udostępnieniu grupie.")}
        </InfoTip>
      </h2>
      <ul className="user-groups-list">
        {groups.map((group) => (
          <li key={group.groupId}>
            <strong>{group.name}</strong> · {group.memberUserIds.length} os.
            <small>{group.memberUserIds.map(label).join(", ")}</small>
            <span>
              <button type="button" className="chat-link-button" disabled={busy} onClick={() => setEditing({ groupId: group.groupId, name: group.name, members: new Set(group.memberUserIds) })}>
                {t("Edytuj")}
              </button>
              <button
                type="button"
                className="chat-link-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Usunąć grupę „${group.name}”? Dostęp do spraw już nadany zostaje.`)) void run(() => deleteUserGroup(group.groupId));
                }}
              >
                {t("Usuń")}
              </button>
            </span>
          </li>
        ))}
        {!groups.length ? <li>{t("Brak grup.")}</li> : null}
      </ul>
      {editing ? (
        <form
          className="user-groups-form"
          onSubmit={(event) => {
            event.preventDefault();
            const input = { name: editing.name, memberUserIds: [...editing.members] };
            void run(async () => {
              if (editing.groupId) await updateUserGroup(editing.groupId, input);
              else await createUserGroup(input);
              setEditing(null);
            });
          }}
        >
          <label>
            {t("Nazwa")}
            <input value={editing.name} maxLength={80} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          </label>
          <fieldset>
            <legend>{t("Członkowie")}</legend>
            {users.map((user) => (
              <label key={user.userId}>
                <input
                  type="checkbox"
                  checked={editing.members.has(user.userId)}
                  onChange={(event) => {
                    const members = new Set(editing.members);
                    if (event.target.checked) members.add(user.userId);
                    else members.delete(user.userId);
                    setEditing({ ...editing, members });
                  }}
                />
                {user.displayName} (@{user.loginName})
              </label>
            ))}
          </fieldset>
          <div className="google-import-actions">
            <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => setEditing(null)}>
              {t("Anuluj")}
            </button>
            <button type="submit" className="chat-primary-action" disabled={busy || !editing.name.trim()}>
              {t("Zapisz grupę")}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => setEditing({ name: "", members: new Set() })}>
          {t("Nowa grupa")}
        </button>
      )}
      {message ? <p role="alert">{message}</p> : null}
    </article>
  );
}
