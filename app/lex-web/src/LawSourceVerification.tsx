import { t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { probeLawSourceSession } from "./api.js";
import { AUTO_TRIES, desktopInvoke, openExternalUrl } from "./SnVerification.js";

/**
 * An official law source behind a bot check (Cloudflare, DataDome), handled as sn.pl and the courts'
 * wokanda: the user passes the check in the source's window of the application; while the window is
 * open its cookies are probed every few seconds against the source, and once it answers the window
 * closes and the question is asked again. Outside the desktop application: the source in the browser.
 */
export function LawSourceVerification({
  verification,
  onVerified,
  autoStart = true
}: {
  verification: { url: string; host: string; label: string };
  onVerified: () => void;
  /** Open the window minimized right away; false for an older message of the conversation. */
  autoStart?: boolean;
}) {
  const invoke = desktopInvoke();
  const [open, setOpen] = useState(false);
  // Opened by itself, minimized; shown after AUTO_TRIES probes without a session (a captcha).
  const [quiet, setQuiet] = useState(false);
  const quietRef = useRef(false);
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
        const cookie = String(await invoke!("law_source_verification_cookies", { url: verification.url }));
        if (cookie) {
          const { ready } = await probeLawSourceSession(verification.host, cookie, navigator.userAgent);
          if (ready && !cancelled && !done.current) {
            done.current = true;
            await invoke!("law_source_verification_close").catch(() => undefined);
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
        await invoke!("verification_window_show", { kind: "law-source" }).catch(() => undefined);
      }
      if (tries >= 45) setMessage(t("Weryfikacja trwa: dokończ ją w oknie źródła albo otwórz okno ponownie."));
    }
    const timer = window.setInterval(() => void tick(), 4000);
    const first = window.setTimeout(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(first);
    };
  }, [invoke, open, verification.host, verification.url]);

  async function start(minimized: boolean): Promise<void> {
    setMessage("");
    done.current = false;
    if (!invoke) {
      await openExternalUrl(verification.url);
      return;
    }
    if (open && !minimized) {
      quietRef.current = false;
      setQuiet(false);
      await invoke("verification_window_show", { kind: "law-source" }).catch(() => undefined);
      return;
    }
    try {
      await invoke("law_source_verification_open", { url: verification.url, minimized });
      quietRef.current = minimized;
      setQuiet(minimized);
      setOpen(true);
    } catch (failure) {
      setMessage(String(failure));
    }
  }

  useEffect(() => {
    if (invoke && autoStart) void start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verification.url]);

  return (
    <div className="alert">
      <p>
        <strong>{t("Źródło prawa wymaga weryfikacji przeglądarki:")} {verification.label}.</strong> {t("Aplikacja sama jej nie przechodzi.")}
      </p>
      <p className="field-help">
        {invoke
          ? t("Otwórz okno źródła i przejdź weryfikację, jeśli się pojawi. Pytanie ponowi się samo; nie zamykaj okna przed wynikiem.")
          : t("W przeglądarce: otwórz źródło i odszukaj przepis samodzielnie.")}
      </p>
      {quiet ? <p className="field-help">{t("Sprawdzam w tle (do ok. 20 s); okno pokaże się, jeśli potrzebna będzie captcha.")}</p> : null}
      <button type="button" className="chat-primary-action" onClick={() => void start(false)}>
        {invoke ? (open ? t("Okno źródła otwarte…") : t("Otwórz okno źródła")) : t("Otwórz źródło")}
      </button>
      {message ? <p className="field-help">{message}</p> : null}
    </div>
  );
}
