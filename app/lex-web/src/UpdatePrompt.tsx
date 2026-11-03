import { useEffect, useRef, useState } from "react";
import {
  downloadApplicationUpdate,
  getUpdateStatus,
  installStagedApplicationUpdate,
  type UpdateStatusResponse
} from "./api.js";
import { friendlyError, manualUpdateInstruction, manualUpdateReleaseUrl, openReleasePage } from "./MaintenancePanel.js";
import {
  clearUpdateHandoff,
  failedUpdateMessage,
  rememberUpdateHandoff,
  skipUpdateVersion,
  startupUpdate,
  updateHandoffOutcome,
  updateOfferAfterCheck,
  updateStore,
  APP_VERSION,
  UPDATE_CHECK_INTERVAL_MS
} from "./update-prompt.js";

/**
 * Desktop, administrator: a newer version is offered as soon as it is released: the check runs at
 * the start and every hour while the application is open, and the question appears at once.
 * "Zaktualizuj teraz" downloads the installer (SHA-256 of the GitHub release, Windows also the
 * ProductVersion) and hands it over: Windows runs the update transaction (backup, health check,
 * rollback, restart), macOS opens the .pkg in the system Installer.
 */
export function UpdatePrompt() {
  const [store] = useState(updateStore);
  const [offer, setOffer] = useState(() => startupUpdate(store));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastAttempt, setLastAttempt] = useState<UpdateStatusResponse["lastAttempt"]>();
  // The outcome of the update handed over before this start (installed or why not).
  const [outcome, setOutcome] = useState<ReturnType<typeof updateHandoffOutcome>>(null);
  const outcomeChecked = useRef(false);

  // "Później": not asked again about this version until the next start.
  const postponed = useRef<string | null>(null);
  const busyRef = useRef(false);
  busyRef.current = busy;

  useEffect(() => {
    let alive = true;
    const check = () =>
      getUpdateStatus()
        .then((status) => {
          if (!alive) return;
          setLastAttempt(status.lastAttempt);
          if (!outcomeChecked.current) {
            outcomeChecked.current = true;
            setOutcome(updateHandoffOutcome(store, status.lastAttempt));
          }
          const found = updateOfferAfterCheck(store, status, postponed.current);
          // A download in progress keeps its own offer.
          if (found && !busyRef.current) setOffer(found);
        })
        .catch(() => undefined);
    void check();
    const timer = setInterval(() => void check(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [store]);

  if (!offer) {
    if (!outcome) return null;
    return (
      <div className="update-prompt-overlay">
        <section className="update-prompt" role="dialog" aria-modal="true" aria-labelledby="update-outcome-title">
          <h2 id="update-outcome-title">{outcome.kind === "INSTALLED" ? "Aktualizacja zainstalowana" : "Aktualizacja nie została zainstalowana"}</h2>
          <p className={outcome.kind === "INSTALLED" ? "update-prompt-status" : "update-prompt-error"} role={outcome.kind === "INSTALLED" ? "status" : "alert"}>
            {outcome.message}
          </p>
          <div className="update-prompt-actions">
            <button type="button" className="update-prompt-primary" onClick={() => setOutcome(null)}>
              OK
            </button>
          </div>
        </section>
      </div>
    );
  }
  const failure = failedUpdateMessage(lastAttempt, offer.version) ?? (outcome?.kind === "FAILED" && outcome.version === offer.version ? outcome.message : null);
  const macos = typeof navigator !== "undefined" && /Mac OS X|Macintosh/iu.test(navigator.userAgent);

  async function update(): Promise<void> {
    if (busy || !offer) return;
    setBusy(true);
    setError("");
    setMessage("Pobieram instalator i sprawdzam jego sumę kontrolną SHA-256…");
    try {
      const staged = await downloadApplicationUpdate();
      setMessage(
        macos
          ? "Otwieram instalator macOS. Lex Machina zamknie się teraz; przejdź kroki instalatora."
          : "Instaluję aktualizację. Lex Machina zamknie się, zaktualizuje i uruchomi ponownie."
      );
      rememberUpdateHandoff(store, staged.version || offer.version);
      await installStagedApplicationUpdate(staged.receiptToken);
    } catch (problem) {
      clearUpdateHandoff(store);
      const status = { status: "AVAILABLE", currentVersion: APP_VERSION, checkedAt: offer.detectedAt, latestVersion: offer.version, ...(offer.releaseUrl ? { releaseUrl: offer.releaseUrl } : {}) } satisfies UpdateStatusResponse;
      const releaseUrl = manualUpdateReleaseUrl(problem, status);
      if (releaseUrl) {
        try {
          await openReleasePage(releaseUrl);
          setMessage(manualUpdateInstruction(typeof navigator === "undefined" ? "" : navigator.userAgent));
          setBusy(false);
          return;
        } catch {
          // The instruction below without the page.
        }
      }
      setMessage("");
      setError(friendlyError(problem));
      setBusy(false);
    }
  }

  return (
    <div className="update-prompt-overlay">
      <section className="update-prompt" role="dialog" aria-modal="true" aria-labelledby="update-prompt-title">
        <h2 id="update-prompt-title">Dostępna jest nowa wersja Lex Machina</h2>
        <p>
          Zainstalowana: <strong>{APP_VERSION}</strong> · nowa: <strong>{offer.version}</strong>
        </p>
        <p>Czy zaktualizować teraz? Dane, sprawy i ustawienia zostają.</p>
        {failure && !message && !error ? (
          <p className="update-prompt-error" role="alert" title={lastAttempt?.lastError}>
            {failure}
          </p>
        ) : null}
        {message ? <p className="update-prompt-status" role="status">{message}</p> : null}
        {error ? <p className="update-prompt-error" role="alert">{error}</p> : null}
        <div className="update-prompt-actions">
          <button type="button" className="update-prompt-primary" disabled={busy} onClick={() => void update()}>
            {busy ? "Aktualizuję…" : "Zaktualizuj teraz"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              postponed.current = offer.version;
              setOffer(null);
            }}
          >
            Później
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              skipUpdateVersion(store, offer.version);
              setOffer(null);
            }}
          >
            Pomiń tę wersję
          </button>
        </div>
        {offer.releaseUrl ? (
          <button type="button" className="update-prompt-link" disabled={busy} onClick={() => void openReleasePage(offer.releaseUrl!)}>
            Co nowego w tej wersji
          </button>
        ) : null}
      </section>
    </div>
  );
}
