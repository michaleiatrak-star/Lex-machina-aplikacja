import { N_, t } from "./i18n";
import { useId, useRef, useState } from "react";
import { ApiError, exportCaseLawPackage, importCaseLawPackage, type CaseLawImportResult, type CaseLawServerStatus } from "./api.js";
import { downloadBlob } from "./download-file.js";
import { InfoTip } from "./InfoTip";

const ERRORS: Record<string, string> = {
  CASE_LAW_PACKAGE_FORMAT_UNKNOWN: N_("To nie jest paczka bazy orzeczeń Lex Machina."),
  CASE_LAW_DATABASE_EMPTY: N_("Baza jest pusta: nie ma czego wyeksportować."),
  CASE_LAW_IMPORT_FAILED: N_("Nie udało się wczytać paczki."),
  AUTHORIZATION_DENIED: N_("Wczytać paczkę może tylko administrator.")
};

/**
 * A package of the local database of rulings: built where a source answers only a browser (sn.pl
 * behind its check) and loaded on another installation. Each ruling keeps the source it came from;
 * the model searches this database first and asks the online sources only for what is missing.
 */
export function CaseLawPackage({
  server,
  library,
  onServer,
  onImported
}: {
  server: CaseLawServerStatus;
  library: number;
  onServer: (server: CaseLawServerStatus) => void;
  onImported: () => void;
}) {
  const held = server.sources.filter((item) => item.documents > 0);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const total = held.reduce((sum, item) => sum + item.documents, 0);
  const selectedCount = held.filter((item) => chosen.has(item.source)).reduce((sum, item) => sum + item.documents, 0);

  const failure = (caught: unknown) => {
    const code = caught instanceof ApiError ? caught.code : String(caught);
    setError(ERRORS[code] ? t(ERRORS[code]!) : code);
  };

  async function exportPackage(): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { blob, filename } = await exportCaseLawPackage([...chosen]);
      const saved = await downloadBlob(blob, filename);
      setMessage(saved ? t("Zapisano paczkę: {path}", { path: saved }) : t("Paczka została pobrana."));
    } catch (caught) {
      failure(caught);
    } finally {
      setBusy(false);
    }
  }

  async function importPackage(file: File): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result: CaseLawImportResult & { server: CaseLawServerStatus } = await importCaseLawPackage(file);
      onServer(result.server);
      onImported();
      setMessage(
        t("Wczytano {imported}, pominięto {skipped} (już w bazie), błędnych wierszy {invalid}.", {
          imported: result.imported,
          skipped: result.skipped,
          invalid: result.invalid
        })
      );
    } catch (caught) {
      failure(caught);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="case-law-package" aria-labelledby={headingId} role="group">
      <h3 id={headingId}>
        {t("Paczka bazy (eksport i import)")}
        <InfoTip>
          {t(
            "Bazę z orzeczeniami, których aplikacja nie może pobrać sama (np. SN za zabezpieczeniem strony), zbuduj na komputerze, gdzie przechodzisz weryfikację, wyeksportuj i wczytaj tutaj. Każde orzeczenie zachowuje źródło. Model szuka najpierw w tej bazie, a w źródłach w sieci tylko tego, czego w niej nie ma."
          )}
        </InfoTip>
      </h3>
      {held.length ? (
        <>
          <div className="case-access-list-head">
            <label className="case-access-select-all">
              <input
                type="checkbox"
                ref={(element) => {
                  if (element) element.indeterminate = chosen.size > 0 && chosen.size < held.length;
                }}
                checked={chosen.size === held.length}
                disabled={busy}
                onChange={(event) => setChosen(event.target.checked ? new Set(held.map((item) => item.source)) : new Set())}
              />
              {chosen.size
                ? t("Wybrano źródeł: {count} (orzeczeń: {documents})", { count: chosen.size, documents: selectedCount })
                : t("Wszystkie źródła ({count}, orzeczeń: {documents})", { count: held.length, documents: total })}
            </label>
          </div>
          <ul className="case-law-package-sources">
            {held.map((item) => (
              <li key={item.source}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(item.source)}
                    disabled={busy}
                    onChange={(event) =>
                      setChosen((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(item.source);
                        else next.delete(item.source);
                        return next;
                      })
                    }
                  />
                  <span>
                    {item.label} <small>({item.documents})</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {library ? (
        <p className="field-help">{t("Paczka obejmie też orzeczenia z biblioteki pobrane w pracy nad sprawami: {count} (z wybranych źródeł albo wszystkie).", { count: library })}</p>
      ) : null}
      {!held.length && !library ? <p className="field-help">{t("Baza jest pusta. Wczytaj paczkę zbudowaną na innym komputerze.")}</p> : null}
      <div className="case-law-package-actions">
        <button type="button" className="chat-secondary-action" disabled={busy || (!held.length && !library)} onClick={() => void exportPackage()}>
          {chosen.size ? t("Eksportuj wybrane") : t("Eksportuj całą bazę")}
        </button>
        <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => fileInput.current?.click()}>
          {t("Wczytaj paczkę")}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".gz,.jsonl,application/gzip"
          hidden
          aria-label={t("Plik paczki bazy orzeczeń")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importPackage(file);
          }}
        />
        {busy ? <span className="field-help" role="status">{t("Trwa…")}</span> : null}
      </div>
      {message ? <p className="field-help" role="status">{message}</p> : null}
      {error ? <p className="chat-inline-error">{error}</p> : null}
    </div>
  );
}
