import type { AnswerCorrection } from "./api.js";

const ROUND: Record<AnswerCorrection["round"], string> = {
  CASE_GROUNDING: "zgodność z tekstem dokumentów i orzeczeń",
  NO_ANSWER: "odpowiedź bez treści i bez pytania",
  MANDATORY_PATH: "ścieżka obowiązkowa i nadzór treści",
  ACT_NAME: "nazwa aktu przy powołaniu przepisu"
};

/** What the application's correcting round changed in the answer: the findings and the removed sentences. */
export function CorrectionsDetails({ corrections }: { corrections: AnswerCorrection[] }) {
  const removed = corrections.reduce((sum, item) => sum + item.removed.length, 0);
  return (
    <details className="chat-evidence">
      <summary>Poprawki kontroli aplikacji ({removed ? `usunięte zdania: ${removed}` : "uzupełnienia"})</summary>
      {corrections.map((correction, index) => (
        <div key={index}>
          <strong>Runda poprawcza: {ROUND[correction.round]}</strong>
          {correction.findings.length ? (
            <ul>
              {correction.findings.map((finding) => (
                <li key={finding}>Zarzut: {finding}</li>
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
            <small>Pierwsza wersja została uzupełniona; żadne jej zdanie nie zostało usunięte.</small>
          )}
        </div>
      ))}
    </details>
  );
}
