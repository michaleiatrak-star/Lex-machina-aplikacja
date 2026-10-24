// Starting points for an empty case thread: a click fills the message box, nothing is sent.
export const CHAT_STARTERS: Array<{ label: string; text: string }> = [
  { label: "Podsumuj dokumenty", text: "Podsumuj dokumenty tej sprawy: fakty, daty, kwoty i to, czego brakuje." },
  { label: "Oceń sytuację", text: "Oceń moją sytuację w tej sprawie i powiedz, co mogę zrobić dalej." },
  { label: "Wyjaśnij przepis", text: "Wyjaśnij przepis: " },
  { label: "Przygotuj pismo", text: "Przygotuj projekt pisma w tej sprawie: " }
];

export function ChatStarters({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="chat-starters" role="group" aria-label="Od czego zacząć">
      {CHAT_STARTERS.map((starter) => (
        <button key={starter.label} type="button" className="chat-secondary-action" onClick={() => onPick(starter.text)}>
          {starter.label}
        </button>
      ))}
    </div>
  );
}
