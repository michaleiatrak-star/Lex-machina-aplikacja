import {
  useEffect,
  useState
} from "react";
import { UserAccountDialog } from "./UserAccountDialog.js";
import {
  ApiError,
  createAdminUser,
  listAdminUsers,
  type AccountKind,
  type AuthenticatedUser
} from "./api.js";

function errorMessage(
  failure: unknown
): string {
  if (!(failure instanceof ApiError)) {
    return failure instanceof Error
      ? failure.message
      : String(failure);
  }
  if (
    failure.code ===
      "USER_DELETE_REQUIRES_DISABLE"
  ) {
    return "Najpierw dezaktywuj konto.";
  }
  if (
    failure.code ===
      "USER_DELETE_REQUIRES_CASE_CLEANUP"
  ) {
    return "Konto ma powiązania ze sprawami. Najpierw usuń lub przenieś jego uprawnienia i wykonaj wymagane rotacje kluczy.";
  }
  if (
    failure.code ===
      "ACCOUNT_LOGIN_EXISTS"
  ) {
    return "Taki login już istnieje.";
  }
  if (
    failure.code ===
      "INVALID_USER_REQUEST"
  ) {
    return "Sprawdź login, nazwę i hasło. Hasło musi spełniać politykę bezpieczeństwa.";
  }
  if (
    failure.code ===
      "SELF_ADMIN_MUTATION_DENIED"
  ) {
    return "Nie można wyłączyć ani usunąć własnego konta administracyjnego.";
  }
  if (failure.code === "LAST_ADMIN_REQUIRED") {
    return "Musi zostać co najmniej jeden aktywny administrator.";
  }
  return failure.code;
}

const ACCOUNT_KINDS: Array<[AccountKind, string]> = [
  ["PROFESSIONAL", "Kancelaria (sprawy i narzędzia)"],
  ["INDIVIDUAL", "Użytkownik indywidualny (sam czat)"]
];

function accountKindLabel(kind: AccountKind | undefined): string {
  return kind === "INDIVIDUAL" ? "indywidualny" : "kancelaria";
}

export function AdminUsersPanel({
  currentUserId,
  serverMode = false
}: {
  currentUserId: string;
  serverMode?: boolean;
}) {
  // Account dialog opened by clicking the user's name.
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [users, setUsers] =
    useState<AuthenticatedUser[]>([]);
  const [loginName, setLoginName] =
    useState("");
  const [displayName, setDisplayName] =
    useState("");
  const [password, setPassword] =
    useState("");
  // Account kind, set by the administrator: a firm's account or an individual user's chat.
  const [accountKind, setNewAccountKind] =
    useState<AccountKind>("PROFESSIONAL");
  const [busy, setBusy] =
    useState(false);
  const [error, setError] =
    useState("");
  const [message, setMessage] =
    useState("");

  const openUser = users.find((user) => user.userId === openUserId) ?? null;

  async function refresh():
    Promise<void> {
    const result =
      await listAdminUsers();
    setUsers(result.users);
  }

  useEffect(() => {
    void refresh()
      .catch((failure) => {
        setError(
          errorMessage(failure)
        );
      });
  }, []);

  async function createUser():
    Promise<void> {
    if (
      !loginName.trim() ||
      !displayName.trim() ||
      !password
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createAdminUser({
        loginName,
        displayName,
        password,
        accountKind
      });
      setLoginName("");
      setDisplayName("");
      setPassword("");
      await refresh();
      setMessage(
        "Użytkownik został utworzony."
      );
    } catch (failure) {
      setError(
        errorMessage(failure)
      );
    } finally {
      setBusy(false);
    }
  }





  return (
    <section className="admin-users-panel">
      <div>
        <p className="eyebrow">
          Administracja
        </p>
        <h3>Użytkownicy</h3>
        <p className="field-help">
          Dezaktywacja natychmiast unieważnia sesje. Trwałe usunięcie jest dozwolone dopiero po dezaktywacji i tylko bez powiązań ze sprawami.
        </p>
      </div>

      <div className="admin-user-create">
        <label>
          Login
          <input
            value={loginName}
            maxLength={64}
            autoComplete="off"
            onChange={(event) =>
              setLoginName(
                event.target.value
              )
            }
          />
        </label>
        <label>
          Nazwa użytkownika
          <input
            value={displayName}
            maxLength={160}
            autoComplete="off"
            onChange={(event) =>
              setDisplayName(
                event.target.value
              )
            }
          />
        </label>
        <label>
          Hasło początkowe
          <input
            type="password"
            value={password}
            maxLength={128}
            autoComplete="new-password"
            onChange={(event) =>
              setPassword(
                event.target.value
              )
            }
          />
        </label>
        <label>
          Typ konta
          <select
            value={accountKind}
            onChange={(event) => setNewAccountKind(event.target.value as AccountKind)}
          >
            {ACCOUNT_KINDS.map(([kind, label]) => (
              <option key={kind} value={kind}>{label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={
            busy ||
            !loginName.trim() ||
            !displayName.trim() ||
            !password
          }
          onClick={() => {
            void createUser();
          }}
        >
          Dodaj użytkownika
        </button>
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

      <div className="admin-users-list">
        {users.map((user) => (
          <article
            key={user.userId}
            className="admin-user-row"
          >
            <div>
              <button
                type="button"
                className="admin-user-name"
                title="Ustawienia konta: dane, typ, uprawnienia, hasło, blokada, usunięcie"
                onClick={() => setOpenUserId(user.userId)}
              >
                {user.displayName}
              </button>
              <span>
                @{user.loginName}{user.email ? ` · ${user.email}` : ""} · {user.appRole === "ADMIN" ? "administrator" : "użytkownik"} · {accountKindLabel(user.accountKind)} · {user.status === "ACTIVE" ? "aktywne" : "zablokowane"}
              </span>
            </div>
            <button type="button" className="chat-secondary-action" onClick={() => setOpenUserId(user.userId)}>
              Ustawienia konta
            </button>
          </article>
        ))}
      </div>
      {openUser && (
        <UserAccountDialog
          user={openUser}
          currentUserId={currentUserId}
          serverMode={serverMode}
          onClose={() => setOpenUserId(null)}
          onChanged={(text, removed) => {
            setError("");
            setMessage(text);
            if (removed) setOpenUserId(null);
            void refresh().catch((failure) => setError(errorMessage(failure)));
          }}
        />
      )}
    </section>
  );
}
