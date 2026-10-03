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
  VERIFIED: "zgodne z ELI",
  MISMATCH: "rozbieżne z ELI",
  NOT_FOUND: "brak punktu w ELI"
};

const ERRORS: Record<string, string> = {
  INVOICE_LEGAL_SOURCE_UNAVAILABLE: "Konektor ISAP (ELI) nie zwrócił tekstu. Sprawdź go w Ustawieniach → Konektory MCP.",
  INVOICE_LEGAL_TEXT_MISSING: "Konektor ISAP odpowiedział bez brzmienia artykułu."
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
        <strong>Wymagane elementy faktury (art. 106e ust. 1 ustawy o VAT)</strong>
        <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void verify()}>
          {busy ? "Sprawdzam w ELI…" : "Zweryfikuj przez ELI"}
        </button>
      </div>
      {error ? <div className="alert alert-error">{ERRORS[error] ?? error}</div> : null}
      {report?.error ? <div className="alert alert-error">{ERRORS[report.error] ?? report.error}</div> : null}
      {report && verified ? (
        <p className="field-help">
          Źródło:{" "}
          {report.sourceUrl ? (
            <a href={report.sourceUrl} target="_blank" rel="noreferrer">
              ELI {report.eli}, art. {report.article}
            </a>
          ) : `ELI ${report.eli}, art. ${report.article}`}
          {report.statusDate ? `, stan prawny na ${report.statusDate}` : ""}
          {report.retrievedAt ? `, pobrano ${new Date(report.retrievedAt).toLocaleString("pl-PL")}` : ""}.
        </p>
      ) : (
        <p className="field-help">
          Lista nie jest zweryfikowana z ustawą: zbudowano ją ze źródeł wtórnych
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
          . Kliknij „Zweryfikuj przez ELI”, aby porównać ją z aktualnym brzmieniem.
        </p>
      )}
      <ul>
        {report?.requirements.map((entry) => (
          <li key={entry.id} className={`invoice-requirement invoice-requirement-${entry.status.toLowerCase()}`}>
            <span>
              <strong>pkt {entry.point}</strong> {entry.label}
              {entry.condition ? <small> · {entry.condition}</small> : null}
            </span>
            <em title={entry.excerpt}>{STATUS[entry.status]}</em>
          </li>
        ))}
      </ul>
      {report?.uncoveredPoints.length ? (
        <div className="alert">
          Punkty ust. 1 w aktualnym brzmieniu, których generator nie obsługuje:{" "}
          {report.uncoveredPoints.map((entry) => `pkt ${entry.point}`).join(", ")}.
        </div>
      ) : null}
    </section>
  );
}
