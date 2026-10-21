import { useEffect, useState, type ReactNode } from "react";
import { ApiError, confirmPasswordReset, registerAccount, requestPasswordReset, verifyEmail } from "./api.js";

// Ekrany trybu serwerowego: rejestracja e-mailem, potwierdzenie adresu, reset hasła.

export type EmailLinkAction = { kind: "verify" | "reset"; token: string };

/** Link z wiadomości: #weryfikacja=<token> albo #reset-hasla=<token>. */
export function emailLinkFromHash(hash: string): EmailLinkAction | null {
  const match = /^#(weryfikacja|reset-hasla)=([A-Za-z0-9_-]{20,128})$/.exec(hash);
  if (!match) return null;
  return { kind: match[1] === "weryfikacja" ? "verify" : "reset", token: match[2]! };
}

export function clearEmailLinkHash(): void {
  if (typeof window !== "undefined" && window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

function errorText(failure: unknown): string {
  if (!(failure instanceof ApiError)) return "Brak połączenia z serwerem. Spróbuj ponownie.";
  switch (failure.code) {
    case "MAIL_NOT_CONFIGURED":
      return "Wysyłka poczty nie jest skonfigurowana. Skontaktuj się z administratorem.";
    case "RATE_LIMITED":
      return "Zbyt wiele prób. Spróbuj ponownie później.";
    case "INVALID_EMAIL":
      return "Podaj poprawny adres e-mail.";
    case "PASSWORD_TOO_SHORT":
      return "Hasło musi mieć co najmniej 10 znaków.";
    case "PASSWORD_TOO_COMMON":
      return "To hasło jest zbyt popularne. Wybierz inne.";
    case "INVALID_OR_EXPIRED_TOKEN":
      return "Link jest nieprawidłowy, wygasł albo został już użyty.";
    case "INVALID_PASSWORD":
      return "To nie jest hasło podane przy zakładaniu konta.";
    case "MAIL_DELIVERY_FAILED":
      return "Nie udało się wysłać wiadomości. Spróbuj ponownie później.";
    default:
      return "Operacja nie powiodła się.";
  }
}

function Shell({ title, children, onBack }: { title: string; children: ReactNode; onBack: () => void }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Lex Machina</p>
        <h1>{title}</h1>
        {children}
        <button type="button" className="secondary-button auth-change-user" onClick={onBack}>
          Wróć do logowania
        </button>
      </section>
    </main>
  );
}

export function RegisterPanel({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (password !== repeat) {
      setError("Hasła nie są takie same.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await registerAccount({ email: email.trim(), displayName: displayName.trim(), password });
      setSent(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPassword("");
      setRepeat("");
      setBusy(false);
    }
  }

  return (
    <Shell title="Załóż konto" onBack={onBack}>
      {sent ? (
        <div className="auth-onboarding-note" role="status">
          <strong>Sprawdź skrzynkę</strong>
          <span>
            Jeśli adres może zostać użyty, wysłaliśmy na niego wiadomość z linkiem aktywacyjnym (ważny 24 godziny). Logowanie będzie możliwe po
            potwierdzeniu adresu.
          </span>
        </div>
      ) : (
        <>
          <label>
            Adres e-mail
            <input type="email" value={email} autoComplete="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label>
            Imię i nazwisko (opcjonalnie)
            <input value={displayName} autoComplete="name" maxLength={120} onChange={(event) => setDisplayName(event.target.value)} />
          </label>
          <label>
            Hasło (co najmniej 10 znaków)
            <input type="password" value={password} autoComplete="new-password" maxLength={128} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>
            Powtórz hasło
            <input type="password" value={repeat} autoComplete="new-password" maxLength={128} onChange={(event) => setRepeat(event.target.value)} />
          </label>
          {error && <div className="alert alert-error auth-alert">{error}</div>}
          <button
            type="button"
            className="primary-button auth-submit"
            disabled={busy || !email.trim() || !password || !repeat}
            onClick={() => void submit()}
          >
            {busy ? "Wysyłanie…" : "Załóż konto"}
          </button>
        </>
      )}
    </Shell>
  );
}

export function VerifyEmailPanel({ token, onBack }: { token: string; onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"input" | "done">("input");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    clearEmailLinkHash();
  }, [token]);

  async function submit(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await verifyEmail(token, password);
      setState("done");
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Potwierdzenie adresu e-mail" onBack={onBack}>
      {state === "done" ? (
        <div className="auth-onboarding-note" role="status">
          <strong>Adres potwierdzony</strong>
          <span>Konto jest aktywne. Zaloguj się adresem e-mail i hasłem.</span>
        </div>
      ) : (
        <>
          <p className="auth-copy">Aby aktywować konto, podaj hasło ustawione przy jego zakładaniu.</p>
          <label>
            Hasło
            <input type="password" value={password} autoComplete="current-password" maxLength={128} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error && <div className="alert alert-error auth-alert">{error}</div>}
          <button type="button" className="primary-button auth-submit" disabled={busy || !password} onClick={() => void submit()}>
            {busy ? "Sprawdzanie…" : "Aktywuj konto"}
          </button>
        </>
      )}
    </Shell>
  );
}

export function ForgotPasswordPanel({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Nie pamiętam hasła" onBack={onBack}>
      {sent ? (
        <div className="auth-onboarding-note" role="status">
          <strong>Sprawdź skrzynkę</strong>
          <span>Jeśli konto o tym adresie istnieje, wysłaliśmy link do ustawienia nowego hasła (ważny 1 godzinę).</span>
        </div>
      ) : (
        <>
          <label>
            Adres e-mail konta
            <input type="email" value={email} autoComplete="email" maxLength={254} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {error && <div className="alert alert-error auth-alert">{error}</div>}
          <button type="button" className="primary-button auth-submit" disabled={busy || !email.trim()} onClick={() => void submit()}>
            {busy ? "Wysyłanie…" : "Wyślij link"}
          </button>
        </>
      )}
    </Shell>
  );
}

export function ResetPasswordPanel({ token, onBack }: { token: string; onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    clearEmailLinkHash();
  }, []);

  async function submit(): Promise<void> {
    if (password !== repeat) {
      setError("Hasła nie są takie same.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPassword("");
      setRepeat("");
      setBusy(false);
    }
  }

  return (
    <Shell title="Ustaw nowe hasło" onBack={onBack}>
      {done ? (
        <div className="auth-onboarding-note" role="status">
          <strong>Hasło zmienione</strong>
          <span>Wszystkie sesje konta zostały wylogowane. Zaloguj się nowym hasłem.</span>
        </div>
      ) : (
        <>
          <label>
            Nowe hasło (co najmniej 10 znaków)
            <input type="password" value={password} autoComplete="new-password" maxLength={128} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <label>
            Powtórz nowe hasło
            <input type="password" value={repeat} autoComplete="new-password" maxLength={128} onChange={(event) => setRepeat(event.target.value)} />
          </label>
          {error && <div className="alert alert-error auth-alert">{error}</div>}
          <button type="button" className="primary-button auth-submit" disabled={busy || !password || !repeat} onClick={() => void submit()}>
            {busy ? "Zapisywanie…" : "Ustaw hasło"}
          </button>
        </>
      )}
    </Shell>
  );
}
