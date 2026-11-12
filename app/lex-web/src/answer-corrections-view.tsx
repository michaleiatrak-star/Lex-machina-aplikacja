import { t } from "./i18n";
import type { AnswerCorrection } from "./api.js";

const ROUND: Record<AnswerCorrection["round"], string> = {
  CASE_GROUNDING: t("zgodność z tekstem dokumentów i orzeczeń"),
  NO_ANSWER: t("odpowiedź bez treści i bez pytania"),
  MANDATORY_PATH: t("ścieżka obowiązkowa i nadzór treści"),
  ACT_NAME: t("nazwa aktu przy powołaniu przepisu"),
  QUOTE_SOURCE: t("cytat zgodny ze źródłem (przepis, dokument)"),
  STATUTE_CONTENT: t("teza zgodna z brzmieniem powołanego przepisu")
};

/** What the application's correcting round changed in the answer: the findings and the removed sentences. */
export function CorrectionsDetails({ corrections }: { corrections: AnswerCorrection[] }) {
  const removed = corrections.reduce((sum, item) => sum + item.removed.length, 0);
  return (
    <details className="chat-evidence">
      <summary>{t("Poprawki kontroli aplikacji (")}{removed ? t("usunięte zdania: {removed}", { removed: removed }) : "uzupełnienia"})</summary>
      {corrections.map((correction, index) => (
        <div key={index}>
          <strong>{t("Runda poprawcza:")} {ROUND[correction.round]}</strong>
          {correction.findings.length ? (
            <ul>
              {correction.findings.map((finding) => (
                <li key={finding}>{t("Zarzut:")} {finding}</li>
              ))}
            </ul>
          ) : null}
          {correction.removed.length ? (
            <ul>
              {correction.removed.map((sentence) => (
                <li key={sentence}>
                  <del>{sentence}</del>
                </li>
              ))}
            </ul>
          ) : (
            <small>{t("Pierwsza wersja została uzupełniona; żadne jej zdanie nie zostało usunięte.")}</small>
          )}
        </div>
      ))}
    </details>
  );
}
