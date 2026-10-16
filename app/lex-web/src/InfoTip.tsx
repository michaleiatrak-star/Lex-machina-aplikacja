import { useId, useState, type ReactNode } from "react";

/**
 * A short explanation kept out of the layout: an "i" next to a heading or a control, the text
 * in a bubble on hover, keyboard focus or a tap (and for screen readers through
 * aria-describedby). For what matters but need not be read every time; warnings and errors
 * stay visible in the view.
 */
export function InfoTip({ children, label = "Więcej informacji" }: { children: ReactNode; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className={open ? "info-tip open" : "info-tip"}>
      <button
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      >
        i
      </button>
      <span role="tooltip" id={id} className="info-tip-bubble">
        {children}
      </span>
    </span>
  );
}
