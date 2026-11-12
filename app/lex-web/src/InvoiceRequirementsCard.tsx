import { currentLocale, t } from "./i18n";
import { InfoTip } from "./InfoTip";
import { useEffect, useState } from "react";
import {
  ApiError,
  getInvoiceLegalBasis,
  getInvoiceRequirements,
  type InvoiceRequirementStatus,
  type InvoiceRequirementsReport
} from "./api.js";

const STATUS: Record<InvoiceRequirementStatus, string> = {
  UNVERIFIED: "niezweryfikowane",
  VERIFIED: t("zgodne z ELI"),
  MISMATCH: t("rozbieżne z ELI"),
  NOT_FOUND: t("brak punktu w ELI")
};

const ERRORS: Record<string, string> = {
  INVOICE_LEGAL_SOURCE_UNAVAILABLE: t("Konektor ISAP (ELI) nie zwrócił tekstu. Sprawdź go w Ustawieniach → Konektory MCP."),
  INVOICE_LEGAL_TEXT_MISSING: t("Konektor ISAP odpowiedział bez brzmienia artykułu.")
};

// Lista elementów faktury, które obsługuje generator, ze statusem weryfikacji
// względem art. 106e ust. 1 ustawy o VAT pobranego przez ELI.
export function InvoiceRequirementsCard() {
  const [report, setReport] = useState<InvoiceRequirementsReport | null>(null);
  const [secondary, setSecondary] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getInvoiceRequirements()
      .then((next) => {
        setReport(next.report);
        setSecondary(next.secondarySources);
      })
      .catch((failure) => setError(failure instanceof ApiError ? failure.code : String(failure)));
  }, []);

  async function verify(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const next = await getInvoiceLegalBasis();
      setReport(next.report);
      setSecondary(next.secondarySources);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const verified = report?.requirements.some((entry) => entry.status !== "UNVERIFIED");

  return (
    <section className="invoice-requirements">
      <div className="chat-form-row">
        <strong>
          {t("Wymagane elementy faktury (art. 106e ust. 1 ustawy o VAT)")}
          <InfoTip>{t("„Zweryfikuj przez ELI” porównuje listę z aktualnym brzmieniem ustawy.")}</InfoTip>
        </strong>
        <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void verify()}>
          {busy ? t("Sprawdzam w ELI…") : t("Zweryfikuj przez ELI")}
        </button>
      </div>
      {error ? <div className="alert alert-error">{ERRORS[error] ?? error}</div> : null}
      {report?.error ? <div className="alert alert-error">{ERRORS[report.error] ?? report.error}</div> : null}
      {report && verified ? (
        <p className="field-help">
          {t("Źródło:")}{" "}
          {report.sourceUrl ? (
            <a href={report.sourceUrl} target="_blank" rel="noreferrer">
              ELI {report.eli}{t(", art.")} {report.article}
            </a>
          ) : `ELI ${report.eli}, art. ${report.article}`}
          {report.statusDate ? t(", stan prawny na {statusDate}", { statusDate: report.statusDate }) : ""}
          {report.retrievedAt ? `, pobrano ${new Date(report.retrievedAt).toLocaleString(currentLocale())}` : ""}.
        </p>
      ) : (
        <p className="field-help">
          {t("Lista nie jest zweryfikowana z ustawą: zbudowano ją ze źródeł wtórnych")}
          {secondary.length ? (
            <>
              {" ("}
              {secondary.map((url, index) => (
                <span key={url}>
                  {index ? ", " : ""}
                  <a href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a>
                </span>
              ))}
              {")"}
            </>
          ) : null}
          .
        </p>
      )}
      <ul>
        {report?.requirements.map((entry) => (
          <li key={entry.id} className={`invoice-requirement invoice-requirement-${entry.status.toLowerCase()}`}>
            <span>
              <strong>{t("pkt")} {entry.point}</strong> {entry.label}
              {entry.condition ? <small> · {entry.condition}</small> : null}
            </span>
            <em title={entry.excerpt}>{STATUS[entry.status]}</em>
          </li>
        ))}
      </ul>
      {report?.uncoveredPoints.length ? (
        <div className="alert">
          {t("Punkty ust. 1 w aktualnym brzmieniu, których generator nie obsługuje:")}{" "}
          {report.uncoveredPoints.map((entry) => `pkt ${entry.point}`).join(", ")}.
        </div>
      ) : null}
    </section>
  );
}
