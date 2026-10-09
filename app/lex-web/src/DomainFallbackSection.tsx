import { useEffect, useState } from "react";
import { ApiError, getDomainFallback, setDomainFallback, type DomainFallbackChoice } from "./api.js";

const LABELS: Record<DomainFallbackChoice, string> = {
  off: "Wyłączony",
  session: "Model rozmowy (ten sam, co odpowiada)",
  "local/bielik-11b-v3-q4km": "Lokalny Bielik 11B v3",
  "local/mistral-nemo-12b-q4km": "Lokalny Mistral NeMo 12B"
};

/**
 * The domain fallback (off by default): when the rules name no legal domain for a
 * question, one short call to the chosen model names it from the domains' descriptions.
 * The question goes pseudonymized; a local model keeps it on this computer.
 */
export function DomainFallbackSection() {
  const [choice, setChoice] = useState<DomainFallbackChoice>("off");
  const [choices, setChoices] = useState<DomainFallbackChoice[]>(["off"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getDomainFallback()
      .then((settings) => {
        setChoice(settings.choice);
        setChoices(settings.choices);
      })
      .catch((failure) => setError(failure instanceof ApiError ? failure.code : String(failure)));
  }, []);

  async function change(next: DomainFallbackChoice): Promise<void> {
    setBusy(true);
    try {
      setChoice((await setDomainFallback(next)).choice);
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="core-law-updates">
      <div className="maintenance-heading">
        <div>
          <strong>Model zapasowy routingu dziedzin</strong>
          <small>gdy reguły nie wskażą dziedziny prawa (ok. 1–3% pytań), krótkie zapytanie do wybranego modelu</small>
        </div>
        <span>{LABELS[choice]}</span>
      </div>
      <label className="core-law-auto">
        Model:{" "}
        <select value={choice} disabled={busy} onChange={(event) => void change(event.target.value as DomainFallbackChoice)}>
          {choices.map((item) => (
            <option key={item} value={item}>
              {LABELS[item]}
            </option>
          ))}
        </select>
      </label>
      <p className="field-help">
        Pytanie trafia do modelu po pseudonimizacji. Model lokalny musi być zainstalowany; jeśli nie działa albo nie odpowie, rozmowa toczy się dalej bez wskazówki dziedziny.
      </p>
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
