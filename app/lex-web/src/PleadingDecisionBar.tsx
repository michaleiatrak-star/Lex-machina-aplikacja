import { InfoTip } from "./InfoTip";
import { checkpointLabel } from "./developer-mode.js";
import { t } from "./i18n";
import type { PleadingDecision } from "./workflow-auto-advance.js";

/**
 * A court pleading's step waiting for the user's decision (strategy, final review): approve and
 * let the application go on to the file, or write what to change (user 2026-11-25: the chain
 * stopped at the strategy with no clear way on to the .docx).
 */
export function PleadingDecisionBar({
  decision,
  developer,
  onApprove,
  onChange
}: {
  decision: PleadingDecision;
  developer: boolean;
  onApprove: () => void;
  onChange: () => void;
}) {
  return (
    <div className="chat-contract-mode" role="group" aria-label={t("Decyzja w piśmie procesowym")}>
      <strong>
        {t("Potrzebna Twoja decyzja: {step}", { step: developer ? decision.checkpoint : checkpointLabel(decision.checkpoint) })}
        <InfoTip>
          {t("Zatwierdzenie przyjmuje propozycję i założenia robocze z odpowiedzi powyżej. Dalsze kroki aplikacja wykona sama: najpierw szkic pisma w pliku .docx, potem kontrola końcowa i gotowe pismo. Na każdym kroku możesz przerwać przyciskiem „Zatrzymaj”.")}
        </InfoTip>
      </strong>
      <small>{t("Ukończone kroki: {closed} z {total}. Do pliku .docx zostało {remaining}.", { closed: decision.closed, total: decision.total, remaining: decision.remaining })}</small>
      <div className="chat-contract-mode-options">
        <button type="button" className="chat-primary-action" onClick={onApprove}>
          {t("Zatwierdzam, przygotuj pismo")}
        </button>
        <button type="button" className="chat-secondary-action" onClick={onChange}>
          {t("Chcę coś zmienić")}
        </button>
      </div>
    </div>
  );
}
