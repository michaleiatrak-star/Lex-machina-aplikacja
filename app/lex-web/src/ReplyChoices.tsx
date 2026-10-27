import { replyChoices } from "./reply-choices";

/** Buttons for the choices the last answer asks for (lettered options, checkpoint frame). */
export function ReplyChoices({
  answer,
  disabled,
  onSend,
  onDraft
}: {
  answer: string;
  disabled: boolean;
  onSend: (message: string) => void;
  onDraft: (text: string) => void;
}) {
  const choices = replyChoices(answer);
  if (!choices.length) return null;
  return (
    <div className="chat-pipeline-next chat-reply-choices" role="group" aria-label="Odpowiedz na pytanie">
      {choices.map((choice, index) =>
        choice.kind === "SEND" ? (
          <button
            key={choice.label}
            type="button"
            className={index === 0 ? "primary-button" : "chat-secondary-action"}
            disabled={disabled}
            onClick={() => onSend(choice.message)}
          >
            {choice.label}
          </button>
        ) : (
          <button key={choice.label} type="button" className="chat-secondary-action" disabled={disabled} onClick={() => onDraft(choice.draft)}>
            {choice.label}
          </button>
        )
      )}
    </div>
  );
}
