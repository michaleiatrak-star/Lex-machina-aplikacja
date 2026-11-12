import { t } from "./i18n";
import {
  useState
} from "react";
import {
  ApiError,
  changePassword,
  createRecoveryCode,
  type AuthMeResponse,
  type AuthenticatedUser
} from "./api.js";

export function AccountSecurityPanel({
  user,
  onAuthUpdated
}: {
  user: AuthenticatedUser;
  onAuthUpdated: (
    value: AuthMeResponse
  ) => void;
}) {
  const [setupPassword, setSetupPassword] =
    useState("");
  const [currentPassword, setCurrentPassword] =
    useState("");
  const [newPassword, setNewPassword] =
    useState("");
  const [recoveryCode, setRecoveryCode] =
    useState("");
  const [message, setMessage] =
    useState("");
  const [error, setError] =
    useState("");
  const [busy, setBusy] =
    useState(false);

  async function createCode():
    Promise<void> {
    if (!setupPassword || busy) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        await createRecoveryCode(
          setupPassword
        );
      setSetupPassword("");
      setRecoveryCode(
        result.recoveryCode
      );
      setMessage(
        t("Nowy kod odzyskiwania został utworzony. Poprzedni kod odzyskiwania, jeśli istniał, został unieważniony.")
      );
    } catch (failure) {
      setSetupPassword("");
      setError(
        failure instanceof ApiError &&
        failure.code ===
          "INVALID_CREDENTIALS"
          ? t("Bieżące hasło jest nieprawidłowe.")
          : t("Nie udało się utworzyć kodu odzyskiwania.")
      );
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword():
    Promise<void> {
    if (
      !currentPassword ||
      !newPassword ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        await changePassword({
          currentPassword,
          newPassword
        });
      setCurrentPassword("");
      setNewPassword("");
      onAuthUpdated({
        user: result.user,
        session:
          result.session
      });
      if (result.recoveryCode) {
        setRecoveryCode(
          result.recoveryCode
        );
      }
      setMessage(
        user.passwordSetupPending
          ? user.passwordChangeRequired === true
            ? t("Hasło zostało ustawione. Hasło jednorazowe przestało działać, a nowy kod odzyskiwania został wygenerowany: zapisz go.")
            : t("Hasło zostało zmienione. Początkowe hasło admin przestało działać, a nowy kod odzyskiwania został wygenerowany.")
          : t("Hasło zostało zmienione. Pozostałe sesje zostały unieważnione; sprawy zachowały te same klucze danych.")
      );
    } catch (failure) {
      setCurrentPassword("");
      setNewPassword("");
      if (
        failure instanceof ApiError &&
        failure.code ===
          "INVALID_PASSWORD_CHANGE"
      ) {
        setError(
          t("Nowe hasło nie spełnia polityki: co najmniej 10 znaków, maksymalnie 128.")
        );
      } else if (
        failure instanceof ApiError &&
        failure.code ===
          "INVALID_CREDENTIALS"
      ) {
        setError(
          t("Bieżące hasło jest nieprawidłowe.")
        );
      } else {
        setError(
          t("Nie udało się zmienić hasła.")
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-security-panel">
      <div>
        <p className="eyebrow">
          {t("Bezpieczeństwo konta")}
        </p>
        <h3>
          {user.passwordSetupPending
            ? t("Zmień początkowe hasło")
            : t("Hasło i odzyskiwanie")}
        </h3>
        {user.passwordChangeRequired === true && (
          <div className="alert">
            {t("Administrator ustawił hasło jednorazowe. Przed dalszą pracą ustaw własne hasło (co najmniej 10 znaków); w polu poniżej wpisz hasło jednorazowe.")}
          </div>
        )}
        {user.passwordSetupPending && user.passwordChangeRequired !== true && (
          <div className="alert">
            {t("Początkowe dane logowania to admin / admin. Hasło admin jest tymczasowe i znane publicznie: możesz już pracować, ale do czasu jego zmiany u góry okna pozostaje ostrzeżenie. Nowe hasło musi mieć co najmniej 10 znaków.")}
          </div>
        )}
        <p className="field-help">
          {t("Kod odzyskiwania odblokowuje ten sam lokalny klucz użytkownika. Nie przechowuj go razem z komputerem.")}
        </p>
      </div>

      <div className="account-security-grid">
        {!user.passwordSetupPending && (
        <div>
          <h4>{t("Kod odzyskiwania")}</h4>
          <label>
            {t("Potwierdź bieżące hasło")}
            <input
              type="password"
              autoComplete="current-password"
              value={
                setupPassword
              }
              maxLength={128}
              onChange={(event) =>
                setSetupPassword(
                  event.target.value
                )
              }
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={
              busy ||
              !setupPassword
            }
            onClick={() => {
              void createCode();
            }}
          >
            {t("Wygeneruj nowy kod odzyskiwania")}
          </button>

          {recoveryCode && (
            <div className="recovery-code-box">
              <strong>
                {t("Zapisz ten kod teraz")}
              </strong>
              <code>
                {recoveryCode}
              </code>
              <p>
                {t("Kod jest pokazany tylko w pamięci tej sesji UI. Wygenerowanie kolejnego kodu unieważni ten.")}
              </p>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  setRecoveryCode("")
                }
              >
                {t("Ukryj kod")}
              </button>
            </div>
          )}
        </div>
        )}

        <div>
          <h4>
            {user.passwordSetupPending
              ? t("Ustaw hasło")
              : t("Zmiana hasła")}
          </h4>
          <label>
            {user.passwordChangeRequired === true
              ? t("Hasło jednorazowe")
              : user.passwordSetupPending
                ? t("Początkowe hasło")
                : t("Bieżące hasło")}
            <input
              type="password"
              autoComplete="current-password"
              value={
                currentPassword
              }
              maxLength={128}
              onChange={(event) =>
                setCurrentPassword(
                  event.target.value
                )
              }
            />
          </label>
          <label>
            {t("Nowe hasło")}
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              maxLength={128}
              onChange={(event) =>
                setNewPassword(
                  event.target.value
                )
              }
            />
          </label>
          <button
            type="button"
            className="primary-button"
            disabled={
              busy ||
              !currentPassword ||
              !newPassword
            }
            onClick={() => {
              void updatePassword();
            }}
          >
            {t("Zmień hasło")}
          </button>
        </div>
      </div>

      {message && (
        <div className="alert account-security-message">
          {message}
        </div>
      )}
      {error && (
        <div className="alert alert-error">
          {error}
        </div>
      )}
    </section>
  );
}
