import { useEffect, useState } from "react";
import { getAnonymizedVersion, type AnonymizedVersion } from "./api";
import { t } from "./i18n";

/**
 * A read case document next to the conversation (Patron-style preview): the text the model gets,
 * page by page - the anonymized version with symbols, or the clear text of a file read without
 * anonymization.
 */
export function CaseDocumentPreview({
  caseId,
  documentId,
  title,
  onClose,
  onAttach,
  attached
}: {
  caseId: string;
  documentId: string;
  title: string;
  onClose: () => void;
  onAttach?: () => void;
  attached?: boolean;
}) {
  const [version, setVersion] = useState<AnonymizedVersion | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setVersion(null);
    setError("");
    getAnonymizedVersion(caseId, documentId)
      .then((loaded) => {
        if (!cancelled) setVersion(loaded);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, documentId]);

  return (
    <section className="case-document-preview" aria-label={t("Podgląd dokumentu")}>
      <header>
        <button type="button" className="chat-link-button" onClick={onClose}>
          {t("← Pliki sprawy")}
        </button>
        <strong title={title}>{title}</strong>
        {onAttach ? (
          <button type="button" className="chat-secondary-action" onClick={onAttach}>
            {attached ? t("Odłącz od wiadomości") : t("Dołącz do wiadomości")}
          </button>
        ) : null}
      </header>
      {error ? (
        <p className="chat-inline-error">{t("Nie udało się wczytać dokumentu:")} {error}</p>
      ) : !version ? (
        <p role="status">{t("Wczytywanie dokumentu…")}</p>
      ) : (
        <div className="case-document-preview-body">
          {version.chunks.map((chunk) => (
            <article key={chunk.index}>
              <small>
                {t("Strona")} {chunk.pageStart}
                {chunk.pageEnd !== chunk.pageStart ? `–${chunk.pageEnd}` : ""}
              </small>
              <p>{chunk.text.replace(/^\s*\[STRONA \d+[^\]\n]*\]\s*/u, "")}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
