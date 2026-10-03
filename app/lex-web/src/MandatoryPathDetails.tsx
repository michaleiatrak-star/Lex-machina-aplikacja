import type { MandatoryPathStep, MandatoryPathView } from "./api.js";

const LAYERS: Array<[MandatoryPathStep["layer"], string]> = [
  ["ROUTER", "Router i bramki"],
  ["SKILL", "Wywołane skille"],
  ["VERIFICATION", "Weryfikacja"],
  ["HARD_GATE", "Hard gate"]
];

const STATUS: Record<MandatoryPathStep["status"], string> = {
  MET: "spełniony",
  MISSING: "BRAK",
  NOT_TRIGGERED: "nie dotyczy",
  NOT_EVALUATED: "nie oceniany"
};

/**
 * The register of the mandatory path kept by the application from the audit
 * (not the model's own account): what was required in this turn, by whom it
 * was done and on what evidence.
 */
export function MandatoryPathDetails({ path }: { path: MandatoryPathView }) {
  const counted = path.steps.filter((step) => step.status === "MET" || step.status === "MISSING");
  const met = counted.filter((step) => step.status === "MET").length;
  return (
    <details className="chat-evidence chat-mandatory-path">
      <summary>
        Ścieżka obowiązkowa — profil {path.profile === "PELNY" ? "pełny" : "lekki"}: {met}/{counted.length}
        {path.complete ? "" : ` · brak: ${path.missing.length}`}
      </summary>
      <p className="field-help">Rejestr prowadzi aplikacja na podstawie audytu tej odpowiedzi; źródło modelu ścieżki: {path.source}.</p>
      {path.routingTrace ? (
        <div>
          <strong>Ślad routingu (KROK 3A)</strong>
          <pre className="chat-routing-trace">{path.routingTrace}</pre>
        </div>
      ) : null}
      {LAYERS.map(([layer, title]) => {
        const steps = path.steps.filter((step) => step.layer === layer && step.status !== "NOT_TRIGGERED");
        if (!steps.length) return null;
        return (
          <div key={layer}>
            <strong>{title}</strong>
            <ul>
              {steps.map((step) => (
                <li key={step.id} className={step.status === "MISSING" ? "chat-mandatory-missing" : undefined}>
                  <span className="chat-evidence-meta">
                    <b>{STATUS[step.status]}</b>
                    {step.by ? <span>· {step.by === "APLIKACJA" ? "aplikacja" : "model"}</span> : null}
                  </span>
                  <strong>{step.label}</strong> <span>{step.evidence}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </details>
  );
}
