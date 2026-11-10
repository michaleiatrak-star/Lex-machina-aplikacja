import { t } from "./i18n";
import { LEX_MACHINA_BRAND_ICON } from "./brand-icon.js";
import { InfoTip } from "./InfoTip";
import {
  useState
} from "react";
import {
  ApiError,
  recoverAccount,
  type AuthMeResponse
} from "./api.js";

export function RecoveryAuthPanel({
  initialLoginName = "",
  onAuthenticated,
  onCancel
}: {
  initialLoginName?: string;
  onAuthenticated: (
    value: AuthMeResponse
  ) => void;
  onCancel: () => void;
}) {
  const [loginName, setLoginName] =
    useState(
      initialLoginName
    );
  const [recoveryCode, setRecoveryCode] =
    useState("");
  const [newPassword, setNewPassword] =
    useState("");
  const [replacementCode, setReplacementCode] =
    useState("");
  const [pendingAuth, setPendingAuth] =
    useState<AuthMeResponse | null>(
      null
    );
  const [error, setError] =
    useState("");
  const [busy, setBusy] =
    useState(false);

  async function recover():
    Promise<void> {
    if (
      !loginName.trim() ||
      !recoveryCode ||
      !newPassword ||
      busy
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result =
        await recoverAccount({
          loginName,
          recoveryCode,
          newPassword
        });
      setRecoveryCode("");
      setNewPassword("");
      setReplacementCode(
        result.recoveryCode
      );
      setPendingAuth({
        user: result.user,
        session:
          result.session
      });
    } catch (failure) {
      setRecoveryCode("");
      setNewPassword("");
      if (
        failure instanceof ApiError &&
        failure.code ===
          "INVALID_RECOVERY_REQUEST"
      ) {
        setError(
          t("Sprawdź login oraz nowe hasło. Nowe hasło musi mieć co najmniej 10 znaków.")
        );
      } else {
        setError(
          t("Nieprawidłowy login lub kod odzyskiwania.")
        );
      }
    } finally {
      setBusy(false);
    }
  }

  if (
    pendingAuth &&
    replacementCode
  ) {
    return (
      <main className="auth-shell">
        <section className="auth-card recovery-confirm-card">
          <p className="eyebrow">
            {t("Odzyskiwanie konta zakończone")}
          </p>
          <h1>
            {t("Zapisz nowy kod odzyskiwania")}
          </h1>
          <p className="auth-copy">
            {t("Poprzedni kod został unieważniony. Ten kod jest nową drogą odzyskania tego samego lokalnego klucza użytkownika.")}
          </p>
          <div className="recovery-code-box">
            <code>
              {replacementCode}
            </code>
            <p>
              {t("Przechowuj go poza tym komputerem. Po przejściu dalej aplikacja nie będzie mogła ponownie go wyświetlić.")}
            </p>
          </div>
          <button
            type="button"
            className="primary-button auth-submit"
            onClick={() =>
              onAuthenticated(
                pendingAuth
              )
            }
          >
            {t("Zapisałem kod — przejdź do aplikacji")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-brand-lockup">
          <img className="auth-brand-icon" src={LEX_MACHINA_BRAND_ICON} alt="" aria-hidden="true" />
          <div>
            <strong>Lex Machina</strong>
            <span>{t("Lokalny warsztat prawny")}</span>
          </div>
        </div>
        <p className="eyebrow">
          {t("Odzyskiwanie lokalnego konta")}
        </p>
        <h1>
          {t("Użyj kodu odzyskiwania")}
          <InfoTip>{t("Odblokowuje ten sam klucz konta i istniejące sprawy, ustawia nowe hasło i wydaje nowy kod odzyskiwania (stary przestaje działać).")}</InfoTip>
        </h1>

        <label>
          {t("Login")}
          <input
            value={loginName}
            autoComplete="username"
            maxLength={64}
            onChange={(event) =>
              setLoginName(
                event.target.value
              )
            }
          />
        </label>

        <label>
          {t("Kod odzyskiwania")}
          <input
            type="password"
            value={recoveryCode}
            autoComplete="off"
            onChange={(event) =>
              setRecoveryCode(
                event.target.value
              )
            }
          />
        </label>

        <label>
          {t("Nowe hasło")}
          <input
            type="password"
            value={newPassword}
            autoComplete="new-password"
            maxLength={128}
            onChange={(event) =>
              setNewPassword(
                event.target.value
              )
            }
          />
        </label>

        {error && (
          <div className="alert alert-error auth-alert">
            {error}
          </div>
        )}

        <button
          type="button"
          className="primary-button auth-submit"
          disabled={
            busy ||
            !loginName.trim() ||
            !recoveryCode ||
            !newPassword
          }
          onClick={() => {
            void recover();
          }}
        >
          {busy
            ? "Odzyskuję…"
            : "Odzyskaj konto"}
        </button>

        <button
          type="button"
          className="secondary-button auth-change-user"
          disabled={busy}
          onClick={onCancel}
        >
          {t("Wróć do logowania")}
        </button>
      </section>
    </main>
  );
}
