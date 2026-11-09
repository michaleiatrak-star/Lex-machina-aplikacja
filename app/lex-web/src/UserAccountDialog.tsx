import { useEffect, useState } from "react";
import {
  ApiError,
  deleteAdminUser,
  sendAdminPasswordReset,
  setAdminOneTimePassword,
  setAccountKind,
  setAdminUserProfile,
  setAdminUserRole,
  setAdminUserStatus,
  type AccountKind,
  type AuthenticatedUser
} from "./api.js";

const ACCOUNT_KINDS: Array<[AccountKind, string]> = [
  ["PROFESSIONAL", "Kancelaria (sprawy i narzędzia)"],
  ["INDIVIDUAL", "Użytkownik indywidualny (sam czat)"]
];

const APP_ROLES: Array<[AuthenticatedUser["appRole"], string]> = [
  ["USER", "Użytkownik"],
  ["ADMIN", "Administrator"]
];

const MESSAGES: Record<string, string> = {
  USER_DELETE_REQUIRES_DISABLE: "Najpierw zablokuj konto.",
  USER_DELETE_REQUIRES_CASE_CLEANUP: "Konto ma powiązania ze sprawami. Najpierw usuń lub przenieś jego uprawnienia i wykonaj wymagane rotacje kluczy.",
  INVALID_USER_REQUEST: "Sprawdź nazwę i adres e-mail.",
  SELF_ADMIN_MUTATION_DENIED: "Własne uprawnienia, blokadę i usunięcie zmienia inny administrator.",
  LAST_ADMIN_REQUIRED: "Musi zostać co najmniej jeden aktywny administrator.",
  USER_STATUS_CONFLICT: "Najpierw odbierz uprawnienia administratora (zablokowane konto nie może być administratorem).",
  ACCOUNT_EMAIL_MISSING: "Konto nie ma adresu e-mail: wpisz go w polu E-mail i zapisz.",
  PASSWORD_RESET_NOT_AVAILABLE: "Konto nie logowało się od włączenia trybu serwerowego: reset bez utraty danych nie jest jeszcze możliwy. Użytkownik może użyć kodu odzyskiwania.",
  SMTP_NOT_CONFIGURED: "Poczta serwera nie jest skonfigurowana (Ustawienia serwera > SMTP).",
  SERVER_MODE_DISABLED: "Reset hasła linkiem działa w trybie serwerowym."
};

function errorMessage(failure: unknown): string {
  if (failure instanceof ApiError) return MESSAGES[failure.code] ?? failure.code;
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Account settings opened by clicking the user's name: name and e-mail, account kind, rights,
 * password reset, block and removal. The server enforces every rule; the dialog only explains them.
 */
export function UserAccountDialog({
  user,
  currentUserId,
  serverMode,
  onClose,
  onChanged
}: {
  user: AuthenticatedUser;
  currentUserId: string;
  serverMode: boolean;
  onClose: () => void;
  onChanged: (message: string, removed?: boolean) => void;
}) {
  const self = user.userId === currentUserId;
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Shown once, in this dialog only; the user must replace it at the next login.
  const [oneTimePassword, setOneTimePassword] = useState("");

  useEffect(() => {
    setDisplayName(user.displayName);
    setEmail(user.email ?? "");
  }, [user.userId, user.displayName, user.email]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run(action: () => Promise<unknown>, message: string, removed = false): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await action();
      if (message) onChanged(message, removed);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const profileChanged = displayName.trim() !== user.displayName || email.trim() !== (user.email ?? "");
  const relogin = self ? "Zmiana zadziała po ponownym zalogowaniu." : "Użytkownik zobaczy zmianę po ponownym zalogowaniu.";

  return (
    <div className="privacy-preview-overlay" role="dialog" aria-modal="true" aria-labelledby="user-account-dialog-title" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="chat-card user-account-dialog">
        <div className="user-account-dialog-head">
          <div>
            <p className="eyebrow">Ustawienia konta</p>
            <h3 id="user-account-dialog-title">{user.displayName}</h3>
            <p className="field-help">
              @{user.loginName} · {user.status === "ACTIVE" ? "aktywne" : "zablokowane"}
              {user.lastLoginAt ? ` · ostatnie logowanie ${new Date(user.lastLoginAt).toLocaleString("pl-PL")}` : ""}
            </p>
          </div>
          <button type="button" className="chat-secondary-action" onClick={onClose} aria-label="Zamknij">Zamknij</button>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <fieldset disabled={busy}>
          <legend>Dane</legend>
          <label>
            Imię i nazwisko
            <input value={displayName} maxLength={160} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            E-mail
            <input type="email" value={email} maxLength={254} placeholder="adres do kontaktu i resetu hasła" onChange={(event) => setEmail(event.target.value)} />
          </label>
          <button
            type="button"
            className="primary-button user-account-save"
            disabled={!profileChanged || !displayName.trim()}
            onClick={() => void run(() => setAdminUserProfile(user.userId, { displayName: displayName.trim(), email: email.trim() }), "Dane konta zapisane.")}
          >
            Zapisz dane
          </button>
        </fieldset>

        <fieldset disabled={busy}>
          <legend>Typ konta i uprawnienia</legend>
          <label>
            Typ konta
            <select
              value={user.accountKind ?? "PROFESSIONAL"}
              onChange={(event) => void run(() => setAccountKind(user.userId, event.target.value as AccountKind), `Typ konta zmieniony. ${relogin}`)}
            >
              {ACCOUNT_KINDS.map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select>
          </label>
          <label>
            Uprawnienia
            <select
              value={user.appRole}
              disabled={self}
              onChange={(event) => {
                const role = event.target.value as AuthenticatedUser["appRole"];
                void run(
                  () => setAdminUserRole(user.userId, role),
                  `${role === "ADMIN" ? "Nadano uprawnienia administratora" : "Odebrano uprawnienia administratora"}. Sesje konta zakończone: zmiana działa od następnego logowania.`
                );
              }}
            >
              {APP_ROLES.map(([role, label]) => (
                <option key={role} value={role} disabled={role === "ADMIN" && user.status !== "ACTIVE"}>{label}</option>
              ))}
            </select>
          </label>
          {self && <p className="field-help">Własne uprawnienia zmienia inny administrator.</p>}
        </fieldset>

        <fieldset disabled={busy}>
          <legend>Hasło</legend>
          {serverMode && !self ? (
            <>
              <p className="field-help">
                Hasło jednorazowe: pokazane tylko tutaj, raz. Sesje konta kończą się, a po zalogowaniu użytkownik musi od razu ustawić własne hasło; do tego czasu aplikacja nie pozwala na nic innego. Dane konta zostają.
              </p>
              <div className="admin-user-actions">
                <button
                  type="button"
                  className="chat-secondary-action"
                  onClick={() => {
                    if (!window.confirm(`Ustawić hasło jednorazowe dla @${user.loginName}? Obecne hasło przestanie działać.`)) return;
                    void run(async () => {
                      const result = await setAdminOneTimePassword(user.userId);
                      setOneTimePassword(result.oneTimePassword);
                    }, "Ustawiono hasło jednorazowe. Przekaż je użytkownikowi bezpiecznym kanałem.");
                  }}
                >
                  Ustaw hasło jednorazowe
                </button>
                <button
                  type="button"
                  className="chat-secondary-action"
                  onClick={() => void run(async () => {
                    const sent = await sendAdminPasswordReset(user.userId);
                    onChanged(`Link resetu hasła wysłany na ${sent.sentTo}.`);
                  }, "")}
                >
                  Wyślij link resetu na e-mail
                </button>
              </div>
              {oneTimePassword && (
                <div className="recovery-code-box">
                  <strong>Hasło jednorazowe</strong>
                  <code>{oneTimePassword}</code>
                  <p>Po zamknięciu okna nie będzie można go ponownie wyświetlić.</p>
                </div>
              )}
            </>
          ) : self ? (
            <p className="field-help">Własne hasło zmieniasz w Ustawienia &gt; Bezpieczeństwo.</p>
          ) : (
            <p className="field-help">
              Dane konta są zaszyfrowane kluczem z hasła użytkownika, więc w aplikacji na komputerze administrator nie może nadać nowego hasła bez utraty tych danych. Użytkownik zmienia hasło sam (Ustawienia &gt; Bezpieczeństwo) albo odzyskuje dostęp kodem odzyskiwania. Hasło jednorazowe i link resetu działają w trybie serwerowym, gdzie serwer przechowuje zabezpieczoną kopię klucza konta.
            </p>
          )}
        </fieldset>

        <fieldset disabled={busy || self}>
          <legend>Blokada i usunięcie</legend>
          {self ? (
            <p className="field-help">Własne konto blokuje lub usuwa inny administrator.</p>
          ) : user.appRole !== "USER" ? (
            <p className="field-help">Konto administratora: najpierw zmień uprawnienia na „Użytkownik”.</p>
          ) : (
            <div className="admin-user-actions">
              <button
                type="button"
                className="chat-secondary-action"
                onClick={() => void run(
                  () => setAdminUserStatus(user.userId, user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"),
                  user.status === "ACTIVE" ? "Konto zablokowane, a jego sesje unieważnione." : "Konto odblokowane."
                )}
              >
                {user.status === "ACTIVE" ? "Zablokuj konto" : "Odblokuj konto"}
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={user.status !== "DISABLED"}
                title={user.status !== "DISABLED" ? "Usunąć można tylko zablokowane konto." : undefined}
                onClick={() => {
                  if (!window.confirm(`Trwale usunąć konto @${user.loginName}? Operacja jest możliwa tylko dla zablokowanego konta bez powiązań ze sprawami.`)) return;
                  void run(() => deleteAdminUser(user.userId), "Konto zostało trwale usunięte.", true);
                }}
              >
                Usuń konto
              </button>
            </div>
          )}
        </fieldset>
      </section>
    </div>
  );
}
