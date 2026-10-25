import { useRef } from "react";
import { DETERMINISTIC_ACTIONS, TASK_GROUPS, type DeterministicActionId } from "./chat-routing.js";

type Action = (typeof DETERMINISTIC_ACTIONS)[number];

// "Zadanie" next to the message box: automatic, or one kind of work (pinned after the first message).
export function TaskMenu({
  actions,
  selected,
  pinned,
  developerMode,
  onSelect
}: {
  actions: readonly Action[];
  selected: Action | null;
  pinned: boolean;
  developerMode: boolean;
  onSelect: (id: DeterministicActionId | "") => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pick = (id: DeterministicActionId | "") => {
    onSelect(id);
    if (menu.current) menu.current.open = false;
  };
  const label = selected ? selected.label : "Automatycznie";
  if (pinned) {
    return (
      <span className="chat-task-pinned" title="Rodzaj pracy jest przypięty do tej rozmowy od pierwszej wiadomości.">
        Zadanie: {label}
      </span>
    );
  }
  return (
    <details ref={menu} className="chat-menu chat-task-menu">
      <summary aria-label={`Zadanie: ${label}`}>Zadanie: {label}</summary>
      <div className="chat-menu-panel" role="menu" aria-label="Wybierz zadanie">
        <button type="button" role="menuitemradio" aria-checked={!selected} onClick={() => pick("")}>
          <strong>Automatycznie</strong>
          <small>{developerMode ? "Router sam dobiera skille i moduły." : "Aplikacja sama dobiera sposób pracy."}</small>
        </button>
        {TASK_GROUPS.map((group) => {
          const items = actions.filter((action) => action.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group} role="group" aria-label={group}>
              <small className="chat-menu-caption">{group}</small>
              {items.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected?.id === action.id}
                  onClick={() => pick(action.id)}
                >
                  <strong>{action.label}</strong>
                  <small>{developerMode ? `${action.description} (${action.skills.join(", ")})` : action.result}</small>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );
}
