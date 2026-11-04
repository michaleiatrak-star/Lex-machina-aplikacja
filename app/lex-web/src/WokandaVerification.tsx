import { useEffect, useRef, useState } from "react";
import { probeWokandaSession } from "./api.js";
import { desktopInvoke, openExternalUrl } from "./SnVerification.js";

/**
 * A court's wokanda behind a browser verification, as sn.pl: the user passes it in the court's
 * window of the application; while the window is open its cookies are probed every few seconds
 * against the court's wokanda, and once it answers the window closes and the check runs again.
 * Outside the desktop application: the court's page in the browser.
 */
export function WokandaVerification({
  verification,
  onVerified
}: {
  verification: { domain: string; url: string; savedSession: boolean };
  onVerified: () => void;
}) {
  const invoke = desktopInvoke();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const done = useRef(false);
  const onVerifiedRef = useRef(onVerified);
  onVerifiedRef.current = onVerified;

  useEffect(() => {
    if (!invoke || !open) return;
    let cancelled = false;
    let tries = 0;
    async function tick(): Promise<void> {
      if (cancelled || done.current) return;
      tries += 1;
      try {
        const cookie = String(await invoke!("wokanda_verification_cookies", { url: verification.url }));
        if (cookie) {
          const { ready } = await probeWokandaSession(verification.domain, cookie, navigator.userAgent);
          if (ready && !cancelled && !done.current) {
            done.current = true;
            await invoke!("wokanda_verification_close").catch(() => undefined);
            setOpen(false);
            onVerifiedRef.current();
            return;
          }
        }
      } catch {
        // the window was closed or the session is not set yet: try again up to the limit
      }
      if (tries >= 45) setMessage("Weryfikacja trwa: dokończ ją w oknie sądu albo otwórz okno ponownie.");
    }
    const timer = window.setInterval(() => void tick(), 4000);
    const first = window.setTimeout(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [invoke, open, verification.domain, verification.url]);

  async function start(): Promise<void> {
    setMessage("");
    done.current = false;
    if (!invoke) {
      await openExternalUrl(verification.url);
      return;
    }
    try {
      await invoke("wokanda_verification_open", { url: verification.url });
      setOpen(true);
    } catch (failure) {
      setMessage(String(failure));
    }
  }

  return (
    <div className="alert">
      <p>
        <strong>Strona sądu wymaga weryfikacji przeglądarki.</strong>{" "}
        {verification.savedSession ? "Sesja z poprzedniej weryfikacji wygasła." : "Aplikacja sama jej nie przechodzi."}
      </p>
      <p className="field-help">
        {invoke
          ? "Otwórz okno sądu i przejdź weryfikację, jeśli się pojawi. Sprawdzenie wokandy ponowi się samo; nie zamykaj okna przed wynikiem."
          : "W przeglądarce: otwórz wokandę sądu i wyszukaj sygnaturę samodzielnie."}
      </p>
      <button type="button" className="chat-primary-action" onClick={() => void start()}>
        {invoke ? (open ? "Okno sądu otwarte…" : "Otwórz okno sądu") : "Otwórz wokandę sądu"}
      </button>
      {message ? <p className="field-help">{message}</p> : null}
    </div>
  );
}
