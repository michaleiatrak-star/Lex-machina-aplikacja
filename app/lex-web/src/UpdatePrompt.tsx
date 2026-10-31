import { useEffect, useState } from "react";
import {
  downloadApplicationUpdate,
  getUpdateStatus,
  installStagedApplicationUpdate,
  type UpdateStatusResponse
} from "./api.js";
import { friendlyError, manualUpdateInstruction, manualUpdateReleaseUrl, openReleasePage } from "./MaintenancePanel.js";
import { failedUpdateMessage, rememberUpdateStatus, skipUpdateVersion, startupUpdate, updateStore, APP_VERSION } from "./update-prompt.js";

/**
 * Desktop, administrator: a newer version found earlier is offered when the application starts.
 * "Zaktualizuj teraz" downloads the installer (SHA-256 of the GitHub release, Windows also the
 * ProductVersion) and hands it over: Windows runs the update transaction (backup, health check,
 * rollback, restart), macOS opens the .pkg in the system Installer. Each start checks again in
 * the background for the next one.
 */
export function UpdatePrompt() {
  const [store] = useState(updateStore);
  const [offer, setOffer] = useState(() => startupUpdate(store));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lastAttempt, setLastAttempt] = useState<UpdateStatusResponse["lastAttempt"]>();

  useEffect(() => {
    let alive = true;
    getUpdateStatus()
      .then((status) => {
        if (!alive) return;
        rememberUpdateStatus(store, status);
        setLastAttempt(status.lastAttempt);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [store]);

  if (!offer) return null;
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
      await installStagedApplicationUpdate(staged.receiptToken);
    } catch (problem) {
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
        {failedUpdateMessage(lastAttempt, offer.version) && !message && !error ? (
          <p className="update-prompt-error" role="alert" title={lastAttempt?.lastError}>
            {failedUpdateMessage(lastAttempt, offer.version)}
          </p>
        ) : null}
        {message ? <p className="update-prompt-status" role="status">{message}</p> : null}
        {error ? <p className="update-prompt-error" role="alert">{error}</p> : null}
        <div className="update-prompt-actions">
          <button type="button" className="update-prompt-primary" disabled={busy} onClick={() => void update()}>
            {busy ? "Aktualizuję…" : "Zaktualizuj teraz"}
          </button>
          <button type="button" disabled={busy} onClick={() => setOffer(null)}>
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
