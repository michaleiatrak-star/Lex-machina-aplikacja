import { t } from "./i18n";
import { useEffect, useRef, useState } from "react";
import { attemptLawSourceSessionOnServer, probeLawSourceSession } from "./api.js";
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
        <strong>{t("Źródło prawa wymaga weryfikacji przeglądarki:")} {verification.label}.</strong> {invoke ? t("Aplikacja sama jej nie przechodzi.") : null}
      </p>
      {invoke ? (
        <>
          <p className="field-help">{t("Otwórz okno źródła i przejdź weryfikację, jeśli się pojawi. Pytanie ponowi się samo; nie zamykaj okna przed wynikiem.")}</p>
          {quiet ? <p className="field-help">{t("Sprawdzam w tle (do ok. 20 s); okno pokaże się, jeśli potrzebna będzie captcha.")}</p> : null}
          <button type="button" className="chat-primary-action" onClick={() => void start(false)}>
            {open ? t("Okno źródła otwarte…") : t("Otwórz okno źródła")}
          </button>
        </>
      ) : (
        <ServerSessionVerification
          url={verification.url}
          autoStart={autoStart}
          attempt={() => attemptLawSourceSessionOnServer(verification.host)}
          probe={(cookie) => probeLawSourceSession(verification.host, cookie, navigator.userAgent)}
          onVerified={() => onVerifiedRef.current()}
        />
      )}
      {message ? <p className="field-help">{message}</p> : null}
    </div>
  );
}

const SERVER_REASONS: Record<string, string> = {
  SERVER_BROWSER_MISSING: t("Na serwerze nie ma przeglądarki do weryfikacji (Playwright z Chromium w katalogu serwerów MCP). Wklej sesję z przeglądarki albo poproś administratora o instalację."),
  SERVER_REJECTED: t("Serwer nie przeszedł weryfikacji tego źródła (np. captcha). Otwórz źródło w przeglądarce w sieci serwera, przejdź weryfikację i wklej sesję.")
};

// Server mode (a browser, no application window): the server tries the check itself in its headless
// browser; without success the user passes it in a browser in the server's network and pastes the
// Cookie header of the source's request, probed at the source before it is kept.
export function ServerSessionVerification({
  url,
  autoStart,
  attempt,
  probe,
  onVerified
}: {
  url: string;
  autoStart: boolean;
  attempt: () => Promise<{ ready: boolean; reason?: string }>;
  probe: (cookie: string) => Promise<{ ready: boolean }>;
  onVerified: () => void;
}) {
  const [stage, setStage] = useState<"idle" | "server" | "paste" | "saving">("idle");
  const [cookie, setCookie] = useState("");
  const [message, setMessage] = useState("");

  async function tryServer(): Promise<void> {
    setStage("server");
    setMessage(t("Serwer próbuje przejść weryfikację źródła (do ok. 30 s)…"));
    try {
      const result = await attempt();
      if (result.ready) {
        setMessage("");
        setStage("idle");
        onVerified();
        return;
      }
      setMessage(SERVER_REASONS[result.reason ?? ""] ?? SERVER_REASONS.SERVER_REJECTED!);
    } catch {
      setMessage(SERVER_REASONS.SERVER_REJECTED!);
    }
    setStage("paste");
  }

  useEffect(() => {
    if (autoStart) void tryServer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  async function save(): Promise<void> {
    if (!cookie.trim()) return;
    setStage("saving");
    try {
      const { ready } = await probe(cookie.trim());
      if (ready) {
        setCookie("");
        setMessage("");
        setStage("idle");
        onVerified();
        return;
      }
      setMessage(t("Źródło nie przyjęło tej sesji (inna sieć albo wygasła)."));
    } catch {
      setMessage(t("Nie udało się sprawdzić sesji."));
    }
    setStage("paste");
  }

  return (
    <>
      <div className="chat-form-row compact">
        <button type="button" className="chat-secondary-action" disabled={stage === "server" || stage === "saving"} onClick={() => void tryServer()}>
          {t("Spróbuj na serwerze")}
        </button>
        <button type="button" className="chat-secondary-action" onClick={() => void openExternalUrl(url)}>
          {t("Otwórz źródło")}
        </button>
        <button type="button" className="chat-secondary-action" disabled={stage === "server"} onClick={() => setStage("paste")}>
          {t("Wklej sesję")}
        </button>
      </div>
      {stage === "paste" || stage === "saving" ? (
        <div className="chat-form-row compact">
          <input
            aria-label={t("Nagłówek Cookie ze źródła")}
            placeholder={t("Nagłówek Cookie ze źródła")}
            value={cookie}
            autoComplete="off"
            onChange={(event) => setCookie(event.target.value)}
          />
          <button type="button" className="chat-primary-action" disabled={!cookie.trim() || stage === "saving"} onClick={() => void save()}>
            {t("Sprawdź i zapisz")}
          </button>
        </div>
      ) : null}
      {message ? <p className="field-help">{message}</p> : null}
    </>
  );
}
