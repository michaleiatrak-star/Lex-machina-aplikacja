import { useEffect, useState } from "react";
import { ApiError, getJurisdiction, setJurisdiction, type JurisdictionSettings } from "./api.js";
import { InfoTip } from "./InfoTip";

const ERRORS: Record<string, string> = {
  JURISDICTION_FIXED_BY_DEPLOYMENT: "Jurysdykcję ustawia wdrożenie (LEX_JURISDICTION_PACK); zmiana w aplikacji jest wyłączona.",
  JURISDICTION_UNKNOWN: "Nie ma takiej jurysdykcji w korpusie skilli."
};

/**
 * The jurisdiction (Polish law by default): the country package whose national law, domain skills,
 * MCP connectors and application components (verification, case law, registries, anonymization,
 * OCR) are used. A component the application has no provider for in that country is named, not
 * replaced by another country's.
 */
export function JurisdictionSection() {
  const [settings, setSettings] = useState<JurisdictionSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getJurisdiction()
      .then(setSettings)
      .catch((failure) => setError(failure instanceof ApiError ? failure.code : String(failure)));
  }, []);

  async function change(pack: string): Promise<void> {
    setBusy(true);
    try {
      setSettings(await setJurisdiction(pack));
      setError("");
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : String(failure);
      setError(ERRORS[code] ?? code);
    } finally {
      setBusy(false);
    }
  }

  const active = settings?.jurisdictions.find((item) => item.pack === settings.active);
  return (
    <section className="core-law-updates">
      <div className="maintenance-heading">
        <div>
          <strong>
            Jurysdykcja
            <InfoTip>
              Prawo kraju, z którym pracuje aplikacja: treść prawa krajowego, skille dziedzinowe, konektory MCP i źródła
              weryfikacji. Widoczne są tylko konektory wybranej jurysdykcji.
            </InfoTip>
          </strong>
        </div>
        <span>{active?.name ?? settings?.active ?? ""}</span>
      </div>
      <label className="core-law-auto">
        Kraj:{" "}
        <select value={settings?.active ?? ""} disabled={busy || !settings} onChange={(event) => void change(event.target.value)}>
          {(settings?.jurisdictions ?? []).map((item) => (
            <option key={item.pack} value={item.pack}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {active?.missing.length ? (
        <p className="field-error">Bez dostawcy w aplikacji (tryb zdegradowany): {active.missing.join(", ")}.</p>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
