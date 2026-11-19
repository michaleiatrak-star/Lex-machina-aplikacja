import { t } from "./i18n";
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
    return t("Konto ma powiązania ze sprawami. Najpierw usuń lub przenieś jego uprawnienia i wykonaj wymagane rotacje kluczy.");
  }
  if (
    failure.code ===
      "ACCOUNT_LOGIN_EXISTS"
  ) {
    return t("Taki login już istnieje.");
  }
  if (
    failure.code ===
      "INVALID_USER_REQUEST"
  ) {
    return t("Sprawdź login, nazwę i hasło. Hasło musi spełniać politykę bezpieczeństwa.");
  }
  if (
    failure.code ===
      "SELF_ADMIN_MUTATION_DENIED"
  ) {
    return t("Nie można wyłączyć ani usunąć własnego konta administracyjnego.");
  }
  if (failure.code === "LAST_ADMIN_REQUIRED") {
    return t("Musi zostać co najmniej jeden aktywny administrator.");
  }
  return failure.code;
}

const ACCOUNT_KINDS: Array<[AccountKind, string]> = [
  ["PROFESSIONAL", t("Kancelaria (sprawy i narzędzia)")],
  ["INDIVIDUAL", t("Użytkownik indywidualny (sam czat)")]
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
  const [query, setQuery] = useState("");
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
        t("Użytkownik został utworzony.")
      );
    } catch (failure) {
      setError(
        errorMessage(failure)
      );
    } finally {
      setBusy(false);
    }
  }





  const words = query.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/\s+/u).filter(Boolean);
  const shownUsers = users
    .filter((user) => {
      const text = `${user.displayName} ${user.loginName} ${user.email ?? ""}`.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "pl"));

  return (
    <section className="admin-users-panel">
      <div>
        <p className="eyebrow">
          {t("Administracja")}
        </p>
        <h3>{t("Użytkownicy")}</h3>
        <p className="field-help">
          {t("Dezaktywacja natychmiast unieważnia sesje. Trwałe usunięcie jest dozwolone dopiero po dezaktywacji i tylko bez powiązań ze sprawami.")}
        </p>
      </div>

      <fieldset className="admin-user-create">
        <legend>{t("Nowe konto")}</legend>
        <label>
          {t("Login")}
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
          {t("Imię i nazwisko")}
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
          {t("Hasło początkowe")}
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
          {t("Typ konta")}
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
          className="primary-button"
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
          {t("Dodaj użytkownika")}
        </button>
        <small className="admin-user-create-help">
          {!loginName.trim() || !displayName.trim() || !password
            ? t("Uzupełnij login, nazwę i hasło początkowe. Hasło przekaż osobie — po zalogowaniu ustawi własne.")
            : t("Hasło przekaż osobie — po zalogowaniu ustawi własne.")}
        </small>
      </fieldset>

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

      <div className="case-list-filters admin-users-filters">
        <input
          type="search"
          value={query}
          placeholder={t("Imię i nazwisko, login lub e-mail")}
          aria-label={t("Szukaj użytkownika")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="case-list-status">
        <small role="status">{t("Użytkowników: {count}", { count: String(shownUsers.length) })}</small>
      </div>
      <div className="case-list-scroll">
        <table className="lex-case-table admin-users-table">
          <thead>
            <tr>
              <th scope="col">{t("Imię i nazwisko")}</th>
              <th scope="col">{t("Login")}</th>
              <th scope="col" className="admin-users-col-role">{t("Rola")}</th>
              <th scope="col" className="admin-users-col-kind">{t("Typ konta")}</th>
              <th scope="col">{t("Stan")}</th>
              <th scope="col">
                <span className="sr-only">{t("Działania")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shownUsers.map((user) => (
              <tr key={user.userId} className="lex-case-row">
                <td>
                  <button
                    type="button"
                    className="lex-case-open"
                    title={t("Ustawienia konta: dane, typ, uprawnienia, hasło, blokada, usunięcie")}
                    onClick={() => setOpenUserId(user.userId)}
                  >
                    {user.displayName}
                  </button>
                </td>
                <td title={user.email || undefined}>@{user.loginName}</td>
                <td className="admin-users-col-role">{user.appRole === "ADMIN" ? t("administrator") : t("użytkownik")}</td>
                <td className="admin-users-col-kind">{accountKindLabel(user.accountKind)}</td>
                <td>{user.status === "ACTIVE" ? t("aktywne") : t("zablokowane")}</td>
                <td>
                  <button type="button" className="chat-link-button" onClick={() => setOpenUserId(user.userId)}>
                    {t("Ustawienia konta")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
