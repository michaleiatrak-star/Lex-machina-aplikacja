import { useEffect, useRef, useState } from "react";
import { ApiError, isDesktopShell, probeSnSession, saveSnSession } from "./api.js";

function desktopInvoke():
  | ((command: string, args?: Record<string, unknown>) => Promise<unknown>)
  | null {
  if (!isDesktopShell()) return null;
  const internals = (
    window as Window & {
      __TAURI_INTERNALS__?: {
        invoke?: (
          command: string,
          args?: Record<string, unknown>
        ) => Promise<unknown>;
      };
    }
  ).__TAURI_INTERNALS__;
  return internals?.invoke ?? null;
}

export async function openExternalUrl(url: string): Promise<void> {
  const invoke = desktopInvoke();
  if (invoke) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

const SN_VERIFICATION_ERRORS: Record<string, string> = {
  SN_VERIFICATION_WINDOW_MISSING: "Okno weryfikacji sn.pl jest zamknięte — otwórz je ponownie i kliknij „Gotowe” przed jego zamknięciem.",
  SN_VERIFICATION_NO_COOKIES: "sn.pl nie ustawił jeszcze sesji — dokończ weryfikację w oknie sn.pl.",
  SN_VERIFICATION_COOKIES_FAILED: "Nie udało się odczytać sesji z okna sn.pl.",
  SN_SESSION_EMPTY: "sn.pl nie ustawił jeszcze sesji — dokończ weryfikację w oknie sn.pl."
};

// sn.pl (Imperva) wymaga weryfikacji człowieka: użytkownik rozwiązuje captcha w oknie sn.pl,
// aplikacja zapisuje tylko ciasteczka tej sesji dla konektora SN i ponawia zapytanie.
export function SnVerification({
  verification,
  onVerified
}: {
  verification: { url: string; savedSession?: boolean; instruction?: string | null };
  onVerified: () => void;
}) {
  const invoke = desktopInvoke();
  const [stage, setStage] = useState<"idle" | "open" | "saving">("idle");
  const [message, setMessage] = useState("");
  const doneRef = useRef(false);
  // Rodzice podają onVerified jako nową lambdę przy każdym renderze; w zależnościach
  // efektu restartowałaby odliczanie sondowania (i przy częstych renderach nie
  // wykonałaby się żadna próba).
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  // Auto-„Gotowe”: dopóki okno sn.pl jest otwarte, co kilka sekund sondujemy snproxy
  // ciasteczkami okna. Gdy przeszło (brak captchy albo rozwiązana przez użytkownika),
  // zamykamy okno i ponawiamy zapytanie bez ręcznego kliknięcia.
  useEffect(() => {
    if (!invoke || stage !== "open") return;
    let cancelled = false;
    let tries = 0;
    async function tick(): Promise<void> {
      if (cancelled || doneRef.current) return;
      tries += 1;
      try {
        const cookie = String(await invoke!("sn_verification_cookies"));
        if (cookie) {
          const { ready } = await probeSnSession(cookie, navigator.userAgent);
          if (ready && !cancelled && !doneRef.current) {
            doneRef.current = true;
            try {
              await invoke!("sn_verification_close");
            } catch {
              // okno mogło już zostać zamknięte
            }
            setStage("idle");
            onVerifiedRef.current();
            return;
          }
        }
      } catch {
        // okno zamknięte albo ciasteczka jeszcze niegotowe — próbujemy dalej do limitu
      }
      if (tries >= 45) {
        setMessage("Weryfikacja trwa — po rozwiązaniu zadania w oknie sn.pl kliknij „Gotowe”.");
      }
    }
    const timer = window.setInterval(() => void tick(), 4000);
    const first = window.setTimeout(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [invoke, stage]);

  async function open(): Promise<void> {
    if (!invoke) return;
    setMessage("");
    doneRef.current = false;
    try {
      await invoke("sn_verification_open");
      setStage("open");
    } catch (failure) {
      setMessage(String(failure));
    }
  }

  async function finish(): Promise<void> {
    if (!invoke || doneRef.current) return;
    setStage("saving");
    setMessage("");
    try {
      const cookie = String(await invoke("sn_verification_finish"));
      await saveSnSession(cookie, navigator.userAgent);
      doneRef.current = true;
      setStage("idle");
      onVerified();
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : String(failure);
      setMessage(SN_VERIFICATION_ERRORS[code] ?? code);
      setStage(code === "SN_VERIFICATION_WINDOW_MISSING" ? "idle" : "open");
    }
  }

  return (
    <div className="alert">
      <p>
        <strong>sn.pl wymaga weryfikacji człowieka (captcha).</strong>{" "}
        {verification.savedSession
          ? "Zapisana sesja wygasła albo została odrzucona — zweryfikuj się ponownie."
          : "Zapytanie automatyczne zostało zablokowane."}
      </p>
      {invoke ? (
        <>
          <p className="field-help">
            1. Otwórz okno sn.pl. Jeśli nie ma captchy, aplikacja sama przeszuka wyniki. 2. Jeśli pojawi się zadanie — rozwiąż je w oknie (aż zobaczysz wyszukiwarkę orzeczeń); aplikacja wykryje to i ponowi zapytanie automatycznie. Możesz zminimalizować okno, ale nie zamykaj go, zanim zobaczysz wynik. „Gotowe” jest potrzebne tylko, gdyby wykrycie się nie powiodło.
          </p>
          <div className="chat-form-row compact">
            <button type="button" className="chat-secondary-action" disabled={stage === "saving"} onClick={() => void open()}>
              {stage === "open" ? "Pokaż okno sn.pl" : "Zweryfikuj w sn.pl"}
            </button>
            <button type="button" className="chat-primary-action" disabled={stage !== "open"} onClick={() => void finish()}>
              {stage === "saving" ? "Zapisuję…" : "Gotowe — ponów zapytanie"}
            </button>
          </div>
        </>
      ) : (
        <p className="field-help">
          {verification.instruction ?? "Weryfikacja jest dostępna w aplikacji Lex Machina na komputerze."}{" "}
          <button type="button" className="chat-secondary-action" onClick={() => void openExternalUrl(verification.url)}>
            Otwórz sn.pl
          </button>
        </p>
      )}
      {message ? <p className="field-help">{message}</p> : null}
    </div>
  );
}
