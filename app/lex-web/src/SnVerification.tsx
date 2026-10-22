import { useEffect, useRef, useState } from "react";
import { ApiError, apiBase, attemptSnSessionOnServer, closeSnProxyWindow, isDesktopShell, openSnProxyWindow, probeSnSession, saveSnSession, snProxyWindowStatus } from "./api.js";
import { InfoTip } from "./InfoTip";

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
            Otwórz okno sn.pl i rozwiąż captchę, jeśli się pojawi - zapytanie ponowi się samo. Nie zamykaj okna przed
            wynikiem.
            <InfoTip>Okno możesz zminimalizować. „Gotowe” jest potrzebne tylko, gdy aplikacja nie wykryje rozwiązania.</InfoTip>
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
        <ServerSnVerification url={verification.url} onVerified={() => onVerifiedRef.current()} />
      )}
      {message ? <p className="field-help">{message}</p> : null}
    </div>
  );
}

export const SN_SERVER_REASONS: Record<string, string> = {
  SN_SERVER_REJECTED:
    "sn.pl odrzuca zapytania z adresu serwera (ochrona Imperva; z adresów centrów danych często bez captchy do rozwiązania). Orzeczenia SN do ok. 2016 r. aplikacja sprawdza zastępczo w SAOS; nowsze — wklej sesję z przeglądarki w tej samej sieci co serwer albo użyj aplikacji na komputerze.",
  SN_SERVER_BROWSER_MISSING:
    "Na serwerze nie ma przeglądarki do weryfikacji (Playwright z Chromium w katalogu serwerów MCP). Wklej sesję z przeglądarki albo poproś administratora o instalację.",
  SN_CONNECTOR_UNAVAILABLE: "Konektor SN nie odpowiada na serwerze."
};

// Tryb serwerowy (przeglądarka, bez okna sn.pl aplikacji): próba serwera albo sesja wklejona
// z przeglądarki w sieci serwera (sprawdzana zapytaniem do sn.pl przed zapisem).
// The sn.pl window through the server: open, poll the ticket, close it when the session works
// (as the desktop window: no "Gotowe" needed).
export async function runSnProxyWindow(deps: {
  open: () => Promise<{ ticket: string; url: string }>;
  status: (ticket: string) => Promise<{ ready: boolean }>;
  close: (ticket: string) => Promise<unknown>;
  openWindow: (url: string) => { closed: boolean; close: () => void } | null;
  wait: (ms: number) => Promise<void>;
  base: string;
  timeoutMs?: number;
  // The user stopped waiting ("Anuluj"); popup.closed is not reliable across origins.
  cancelled?: () => boolean;
}): Promise<"ready" | "closed" | "blocked" | "timeout"> {
  const { ticket, url } = await deps.open();
  const popup = deps.openWindow(`${deps.base}${url}`);
  if (!popup) {
    await deps.close(ticket).catch(() => undefined);
    return "blocked";
  }
  const until = Date.now() + (deps.timeoutMs ?? 10 * 60_000);
  try {
    while (Date.now() < until) {
      await deps.wait(2_000);
      const { ready } = await deps.status(ticket).catch(() => ({ ready: false }));
      if (ready) {
        // The window also closes itself; the handle may be cut off by the opener policy.
        popup.close();
        return "ready";
      }
      if (deps.cancelled?.()) return "closed";
    }
    popup.close();
    return "timeout";
  } finally {
    await deps.close(ticket).catch(() => undefined);
  }
}

function ServerSnVerification({ url, onVerified }: { url: string; onVerified: () => void }) {
  const [stage, setStage] = useState<"idle" | "window" | "server" | "paste" | "saving">("idle");
  const [cookie, setCookie] = useState("");
  const [message, setMessage] = useState("");
  const cancelRef = useRef(false);
  async function openWindow() {
    cancelRef.current = false;
    setStage("window");
    setMessage("Okno sn.pl otwarte przez serwer — rozwiąż captchę, jeśli się pojawi. Okno zamknie się samo.");
    try {
      const result = await runSnProxyWindow({
        open: openSnProxyWindow,
        status: snProxyWindowStatus,
        close: closeSnProxyWindow,
        openWindow: (target) => window.open(target, "lex-sn-verification", "popup,width=1100,height=820"),
        wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        base: apiBase(),
        cancelled: () => cancelRef.current
      });
      if (result === "ready") {
        setMessage("Sesja sn.pl zapisana na serwerze — ponawiam zapytanie.");
        onVerified();
      } else if (result === "blocked") setMessage("Przeglądarka zablokowała okno — zezwól na wyskakujące okna dla tej strony i spróbuj ponownie.");
      else if (result === "closed") setMessage("Przerwano oczekiwanie na weryfikację w oknie sn.pl.");
      else setMessage("Weryfikacja w oknie nie przeszła w 10 minut.");
    } catch (error) {
      setMessage(error instanceof ApiError ? `Nie udało się otworzyć okna sn.pl (${error.code}).` : "Nie udało się otworzyć okna sn.pl.");
    } finally {
      setStage("idle");
    }
  }
  async function tryServer() {
    setStage("server");
    setMessage("Serwer próbuje przejść weryfikację sn.pl (do ok. minuty)…");
    try {
      const result = await attemptSnSessionOnServer();
      if (result.ready) {
        setMessage("Sesja sn.pl zapisana na serwerze — ponawiam zapytanie.");
        onVerified();
      } else setMessage(SN_SERVER_REASONS[result.reason ?? ""] ?? "Weryfikacja na serwerze nie przeszła.");
    } catch (error) {
      setMessage(error instanceof ApiError ? `Weryfikacja na serwerze nie powiodła się (${error.code}).` : "Weryfikacja na serwerze nie powiodła się.");
    } finally {
      setStage("idle");
    }
  }
  async function savePasted() {
    setStage("saving");
    try {
      const { ready } = await probeSnSession(cookie.replace(/^\s*cookie:\s*/iu, "").trim(), navigator.userAgent);
      if (ready) {
        setMessage("Sesja działa z serwera — zapisana, ponawiam zapytanie.");
        setCookie("");
        onVerified();
      } else setMessage("sn.pl nie przyjął tej sesji z adresu serwera (sesja z innej sieci albo wygasła).");
    } catch {
      setMessage("Nie udało się sprawdzić sesji.");
    } finally {
      setStage("idle");
    }
  }
  return (
    <>
      <p className="field-help">
        Okno sn.pl otwiera się przez serwer Lex Machina, więc sesja należy do jego adresu; zamknie się samo po przejściu weryfikacji.
        <InfoTip>Sesja sn.pl działa tylko z adresu, z którego przeszła weryfikację. Wklejany jest wyłącznie nagłówek Cookie zapytania do sn.pl (narzędzia programisty → Sieć); aplikacja go nie wyświetla ani nie zapisuje w logach.</InfoTip>
      </p>
      <div className="chat-form-row compact">
        {stage === "window" ? (
          <button type="button" className="chat-secondary-action" onClick={() => (cancelRef.current = true)}>
            Anuluj oczekiwanie
          </button>
        ) : (
          <button type="button" className="chat-primary-action" disabled={stage !== "idle"} onClick={() => void openWindow()}>
            Zweryfikuj w oknie sn.pl
          </button>
        )}
        <button type="button" className="chat-secondary-action" disabled={stage !== "idle"} onClick={() => void tryServer()}>
          {stage === "server" ? "Serwer sprawdza…" : "Spróbuj na serwerze"}
        </button>
        <button type="button" className="chat-secondary-action" onClick={() => void openExternalUrl(url)}>
          Otwórz sn.pl
        </button>
        <button type="button" className="chat-secondary-action" disabled={stage !== "idle"} onClick={() => setStage("paste")}>
          Wklej sesję
        </button>
      </div>
      {stage === "paste" || stage === "saving" ? (
        <div className="chat-form-row compact">
          <input
            type="password"
            aria-label="Nagłówek Cookie z sn.pl"
            placeholder="Cookie: visid_incap_…; incap_ses_…"
            value={cookie}
            onChange={(event) => setCookie(event.target.value)}
          />
          <button type="button" className="chat-primary-action" disabled={!cookie.trim() || stage === "saving"} onClick={() => void savePasted()}>
            {stage === "saving" ? "Sprawdzam…" : "Sprawdź i zapisz"}
          </button>
        </div>
      ) : null}
      {message ? <p className="field-help">{message}</p> : null}
    </>
  );
}
