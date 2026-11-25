import { useEffect, useId, useMemo, useState } from "react";
import { addCaseScheduleEvent, type CaseScheduleEvent } from "./api";
import { DEADLINE_PRESETS, computeDeadline, formatDate, termLabel, type DeadlineResult, type TermUnit } from "./deadline-calculator";
import { N_, t } from "./i18n";

const UNITS: Array<{ value: TermUnit; label: string }> = [
  { value: "DAYS", label: N_("dni") },
  { value: "WEEKS", label: N_("tygodnie") },
  { value: "MONTHS", label: N_("miesiące") },
  { value: "YEARS", label: N_("lata") }
];

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Case-card row of the deadline calculator: the count is done by rules (deadline-calculator.ts),
 * shown step by step with its provisions, and goes to the case schedule only when the user adds it.
 */
export function DeadlineCalculatorCard({
  caseId,
  canWrite,
  onAdded
}: {
  caseId: string | null;
  canWrite: boolean;
  onAdded?: (event: CaseScheduleEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState(today);
  const [portalPlaced, setPortalPlaced] = useState(false);
  const [preset, setPreset] = useState(DEADLINE_PRESETS[0]!.id);
  const [amount, setAmount] = useState(14);
  const [unit, setUnit] = useState<TermUnit>("DAYS");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const titleId = useId();

  const chosen = DEADLINE_PRESETS.find((item) => item.id === preset) ?? null;
  const termAmount = chosen ? chosen.amount : amount;
  const termUnit = chosen ? chosen.unit : unit;

  const result: DeadlineResult | null = useMemo(() => {
    try {
      return computeDeadline({ event, amount: termAmount, unit: termUnit, portalPlaced });
    } catch {
      return null;
    }
  }, [event, termAmount, termUnit, portalPlaced]);

  useEffect(() => {
    setTitle(chosen ? t(chosen.label) : t("Termin {term}", { term: termLabel(termAmount, termUnit) }));
    setMessage("");
  }, [preset, termAmount, termUnit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (key: KeyboardEvent) => {
      if (key.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function add(): Promise<void> {
    if (!caseId || !result || !title.trim() || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const notes = [
        ...(chosen ? [t("Podstawa terminu: {basis}", { basis: chosen.basis })] : []),
        ...result.steps.map((step) => (step.basis ? `${step.text} (${step.basis})` : step.text))
      ].join("\n");
      // Art. 111 § 1 KC: the deadline ends with the end of its last day.
      const created = await addCaseScheduleEvent(caseId, { kind: "DEADLINE", title: title.trim(), startsAt: `${result.end}T23:59`, notes });
      onAdded?.(created);
      setMessage(t("Dodano do terminarza sprawy: {title}, {date}.", { title: title.trim(), date: formatDate(result.end) }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Nie udało się dodać terminu."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat-card matter-compact-row">
      <span className="matter-compact-heading" title={t("Liczenie terminów procesowych z dniami wolnymi")}>
        <strong>{t("Kalkulator terminów")}</strong>
      </span>
      <span className="matter-compact-actions">
        <button type="button" className="chat-secondary-action" onClick={() => setOpen(true)}>
          {t("Oblicz")}
        </button>
      </span>
      {open ? (
        <div
          className="privacy-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(click) => {
            if (click.target === click.currentTarget) setOpen(false);
          }}
        >
          <section className="chat-card matter-section-dialog deadline-calculator">
            <div className="matter-section-dialog-head">
              <div>
                <p className="eyebrow">{t("Kalkulator terminów")}</p>
                <h2 id={titleId}>{t("Oblicz termin")}</h2>
              </div>
              <button type="button" className="chat-secondary-action" onClick={() => setOpen(false)}>
                {t("Zamknij")}
              </button>
            </div>
            <p className="matter-collapsible-hint">
              {t("Termin liczą reguły kodeksu (art. 111, 112 i 115 KC w zw. z art. 165 § 1 KPC) z dniami wolnymi od pracy i sobotami, nie model językowy. Sprawdź wynik przed dodaniem.")}
            </p>
            <div className="matter-schedule-form">
              <label className="deadline-field">
                <span>{portalPlaced ? t("Data umieszczenia pisma w portalu") : t("Data doręczenia")}</span>
                <input type="date" value={event} onChange={(change) => setEvent(change.target.value)} />
              </label>
              <label className="deadline-check">
                <input type="checkbox" checked={portalPlaced} onChange={(change) => setPortalPlaced(change.target.checked)} />
                <span>{t("Pismo w Portalu Informacyjnym, nieodebrane: doręczenie po 14 dniach od umieszczenia (art. 131¹a § 2 KPC)")}</span>
              </label>
              <label className="deadline-field">
                <span>{t("Rodzaj terminu")}</span>
                <select value={preset} onChange={(change) => setPreset(change.target.value)}>
                  {DEADLINE_PRESETS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.label)} - {termLabel(item.amount, item.unit)}, {item.basis}
                    </option>
                  ))}
                  <option value="">{t("Inny termin")}</option>
                </select>
              </label>
              {!chosen ? (
                <div className="chat-form-row">
                  <input
                    type="number"
                    min={1}
                    max={3650}
                    aria-label={t("Długość terminu")}
                    value={amount}
                    onChange={(change) => setAmount(Math.max(1, Math.min(3650, Math.trunc(Number(change.target.value) || 1))))}
                  />
                  <select aria-label={t("Jednostka terminu")} value={unit} onChange={(change) => setUnit(change.target.value as TermUnit)}>
                    {UNITS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {t(item.label)}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>
            {result ? (
              <div className="deadline-result" aria-live="polite">
                <p className="deadline-end">
                  {t("Termin upływa")} <strong>{formatDate(result.end)}</strong>
                </p>
                <ol className="deadline-steps">
                  {result.steps.map((step, index) => (
                    <li key={index}>
                      {step.text}
                      {step.basis ? <span className="deadline-basis"> {step.basis}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="chat-error">{t("Podaj poprawną datę.")}</p>
            )}
            {caseId && canWrite ? (
              <div className="chat-form-row">
                <input aria-label={t("Nazwa terminu w terminarzu")} value={title} onChange={(change) => setTitle(change.target.value)} />
                <button type="button" className="chat-primary-action" disabled={!result || !title.trim() || busy} onClick={() => void add()}>
                  {busy ? t("Dodawanie…") : t("Dodaj do terminarza sprawy")}
                </button>
              </div>
            ) : null}
            {message ? <p className="matter-collapsible-hint">{message}</p> : null}
            {error ? <p className="chat-error">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
