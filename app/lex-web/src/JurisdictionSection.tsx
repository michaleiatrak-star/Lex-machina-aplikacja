import { t } from "./i18n";
import { useEffect, useState } from "react";
import { ApiError, getJurisdiction, setLegalSystem, type JurisdictionSettings, type LegalSystemOption } from "./api.js";
import { InfoTip } from "./InfoTip";

const ERRORS: Record<string, string> = {
  JURISDICTION_FIXED_BY_DEPLOYMENT: "System prawny ustawia wdrożenie (LEX_JURISDICTION_PACK / LEX_JURISDICTION_COUNTRY); zmiana w aplikacji jest wyłączona.",
  JURISDICTION_UNKNOWN: "Nie ma takiego kraju w rejestrze."
};

const READING: Record<string, string> = {
  "PEŁNY": "pełna weryfikacja przepisów",
  CZYTNIK: "czytnik tekstu przepisów ze źródła urzędowego",
  PDF: "tekst z urzędowego PDF",
  KLUCZ: "źródło wymaga klucza API",
  JS: "portal wymaga przeglądarki (brak odczytu automatycznego)",
  BLOKADA: "portal blokuje odczyt automatyczny",
  "BRAK-POŁĄCZENIA": "brak połączenia ze źródłem",
  "DO-ZBADANIA": "źródło do zbadania"
};

// Legal families: the category of the country list; the method the model uses follows from it.
const FAMILIES: Array<[NonNullable<LegalSystemOption["family"]>, string]> = [
  ["kontynentalne", "Prawo kontynentalne"],
  ["nordyckie", "Prawo nordyckie"],
  ["mieszane", "Systemy mieszane"],
  ["common-law", "Common law"]
];

/**
 * The legal system (Polish law by default): one country from the list, in alphabetical order.
 * The chosen country's package (prawo-<kraj>, domain skills <kod>-xx), connectors and readers are
 * used; every other country's are off. Today only Poland has a package and domain skills.
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

  async function change(country: string): Promise<void> {
    setBusy(true);
    try {
      setSettings(await setLegalSystem(country));
      setError("");
      // The chat reads its skills again: the new country's package and domain skills, the others off.
      window.dispatchEvent(new CustomEvent("lex:jurisdiction-changed", { detail: { country } }));
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : String(failure);
      setError(ERRORS[code] ?? code);
    } finally {
      setBusy(false);
    }
  }

  const countries = settings?.countries ?? [];
  const chosen = countries.find((item) => item.code === settings?.country);
  const provider = settings?.jurisdictions.find((item) => item.pack === settings.active);
  return (
    <section className="core-law-updates">
      <div className="maintenance-heading">
        <div>
          <strong>
            {t("System prawny")}
            <InfoTip>
              {t("Prawo kraju, z którym pracuje aplikacja. Zmiana działa od razu: skill prawa krajowego, skille dziedzinowe, konektory i źródła przepisów przełączają się na wybrany kraj, a pozostałe kraje są wyłączone. Lokalna baza aktów (RAG) aktualizuje się tylko dla wybranej jurysdykcji; w trybie serwerowym — dla wszystkich. Pakiet ze skillami dziedzinowymi ma dziś tylko Polska.")}
            </InfoTip>
          </strong>
        </div>
        <span>{chosen?.name ?? settings?.country ?? ""}</span>
      </div>
      <label className="core-law-auto">
        {t("Kraj:")}{" "}
        <select value={settings?.country ?? ""} disabled={busy || !settings} onChange={(event) => void change(event.target.value)}>
          {FAMILIES.map(([family, label]) => {
            const members = countries.filter((item) => (item.family ?? "kontynentalne") === family);
            return members.length ? (
              <optgroup key={family} label={label}>
                {members.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      </label>
      {chosen ? (
        <p className="field-help">
          {chosen.pack ? `Pakiet prawa krajowego: ${chosen.pack}. ` : t("Brak pakietu prawa krajowego i skilli dziedzinowych tego kraju: skille metod działają bez nich. ")}
          {t("Źródło przepisów:")} {READING[chosen.reading] ?? chosen.reading} ({chosen.portal}).
          {chosen.familyLabel ? ` Rodzina prawa: ${chosen.familyLabel.toLowerCase()}.` : ""}
          {chosen.family === "common-law" ? t(" Źródłem są ustawy i orzeczenia (precedens); model sprawdza oba.") : ""}
        </p>
      ) : null}
      {chosen?.familyNote ? <p className="field-help">{chosen.familyNote}</p> : null}
      {provider?.missing.length ? (
        <p className="field-error">{t("Bez dostawcy w aplikacji (tryb zdegradowany):")} {provider.missing.join(", ")}.</p>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
