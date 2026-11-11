import { t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { probeWokandaSession } from "./api.js";
import { AUTO_TRIES, desktopInvoke, openExternalUrl } from "./SnVerification.js";

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
  // The court's window opens by itself, minimized: a browser check that passes on its own
  // (most courts) needs nothing from the user; after AUTO_TRIES probes the window is shown.
  const [quiet, setQuiet] = useState(false);
  const [message, setMessage] = useState("");
  const done = useRef(false);
  const quietRef = useRef(false);
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
      if (quietRef.current && tries >= AUTO_TRIES && !cancelled && !done.current) {
        quietRef.current = false;
        setQuiet(false);
        await invoke!("verification_window_show", { kind: "wokanda" }).catch(() => undefined);
      }
      if (tries >= 45) setMessage(t("Weryfikacja trwa: dokończ ją w oknie sądu albo otwórz okno ponownie."));
    }
    const timer = window.setInterval(() => void tick(), 4000);
    const first = window.setTimeout(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [invoke, open, verification.domain, verification.url]);

  async function start(minimized: boolean): Promise<void> {
    setMessage("");
    done.current = false;
    if (!invoke) {
      await openExternalUrl(verification.url);
      return;
    }
    if (open && !minimized) {
      // Already open (also minimized in the background): bring it to the front.
      quietRef.current = false;
      setQuiet(false);
      await invoke("verification_window_show", { kind: "wokanda" }).catch(() => undefined);
      return;
    }
    try {
      await invoke("wokanda_verification_open", { url: verification.url, minimized });
      quietRef.current = minimized;
      setQuiet(minimized);
      setOpen(true);
    } catch (failure) {
      setMessage(String(failure));
    }
  }

  useEffect(() => {
    if (invoke) void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verification.url]);

  return (
    <div className="alert">
      <p>
        <strong>{t("Strona sądu wymaga weryfikacji przeglądarki.")}</strong>{" "}
        {verification.savedSession ? t("Sesja z poprzedniej weryfikacji wygasła.") : t("Aplikacja sama jej nie przechodzi.")}
      </p>
      <p className="field-help">
        {invoke
          ? t("Otwórz okno sądu i przejdź weryfikację, jeśli się pojawi. Sprawdzenie wokandy ponowi się samo; nie zamykaj okna przed wynikiem.")
          : t("W przeglądarce: otwórz wokandę sądu i wyszukaj sygnaturę samodzielnie.")}
      </p>
      {quiet ? <p className="field-help">{t("Sprawdzam stronę sądu w tle (do ok. 20 s)…")}</p> : null}
      <button type="button" className="chat-primary-action" onClick={() => void start(false)}>
        {invoke ? (open ? t("Okno sądu otwarte…") : t("Otwórz okno sądu")) : t("Otwórz wokandę sądu")}
      </button>
      {message ? <p className="field-help">{message}</p> : null}
    </div>
  );
}
