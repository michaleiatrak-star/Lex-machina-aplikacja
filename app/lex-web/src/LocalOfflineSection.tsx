import { useEffect, useState } from "react";
import { ApiError, getLocalOffline, setLocalOffline } from "./api.js";
import { InfoTip } from "./InfoTip";

/**
 * Tryb offline modelu lokalnego: odpowiedź bez źródeł zewnętrznych (lokalna kopia ELI,
 * biblioteka orzeczeń na dysku, materiały sprawy). Zmienia administrator.
 */
export function LocalOfflineSection({ admin }: { admin: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [forced, setForced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getLocalOffline()
      .then((settings) => {
        setEnabled(settings.enabled);
        setForced(settings.forced);
      })
      .catch((failure) => setError(failure instanceof ApiError ? failure.code : String(failure)));
  }, []);

  async function change(next: boolean): Promise<void> {
    setBusy(true);
    try {
      setEnabled((await setLocalOffline(next)).enabled);
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null && !error) return null;
  return (
    <section className="local-offline">
      <label className="local-offline-toggle">
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={!admin || busy || forced}
          onChange={(event) => void change(event.target.checked)}
        />
        <span>
          <strong>Tryb offline modelu lokalnego</strong>
          <small>
            {enabled
              ? "włączony: model lokalny nie korzysta ze źródeł zewnętrznych"
              : "wyłączony: model lokalny może sprawdzać przepisy i orzeczenia w źródłach online"}
          </small>
        </span>
        <InfoTip>
          Przy włączonym trybie model lokalny odpowiada wyłącznie na podstawie lokalnej kopii przepisów (ELI, stan na dzień kopii),
          orzeczeń zapisanych w bazie na dysku i materiałów sprawy. Aplikacja nie łączy się wtedy z ELI, SN, SAOS, CBOSA, EUREKA,
          portalami sądów ani wyszukiwarką; aktualności przepisów nie sprawdza, a odpowiedź mówi o tym wprost. Modele w chmurze nie są
          objęte tym trybem.
        </InfoTip>
      </label>
      {forced ? <small>Ustawienie wymuszone konfiguracją serwera (LEX_LOCAL_OFFLINE).</small> : null}
      {!admin ? <small>Zmienia administrator.</small> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
