import { useId, useMemo, useState } from "react";

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/gu, "l").replace(/Ł/gu, "L").toLowerCase();

/** Courts whose name holds every typed fragment ("rej krak" -> Sąd Rejonowy … w Krakowie …). */
export function filterCourts(names: readonly string[], query: string, limit = 50): string[] {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  if (!words.length) return names.slice(0, limit);
  return names.filter((name) => words.every((word) => fold(name).includes(word))).slice(0, limit);
}

/** A court chosen from the list: typing a part of its name leaves only the courts holding it. */
export function CourtPicker({ value, courts, onChange }: { value: string; courts: readonly string[]; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const options = useMemo(() => filterCourts(courts, value), [courts, value]);
  const exact = courts.includes(value);

  function choose(name: string) {
    onChange(name);
    setOpen(false);
  }

  return (
    <div className="court-picker">
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        placeholder="Wpisz fragment nazwy, np. rejonowy krak"
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, options.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && options[active]) {
            event.preventDefault();
            choose(options[active]!);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && !exact ? (
        <ul id={listId} role="listbox" className="court-picker-list">
          {options.length ? (
            options.map((name, index) => (
              <li
                key={name}
                role="option"
                aria-selected={index === active}
                className={index === active ? "active" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(name);
                }}
              >
                {name}
              </li>
            ))
          ) : (
            <li className="court-picker-empty">Brak sądu z tym fragmentem nazwy.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
