import { t } from "./i18n";
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * A short explanation kept out of the layout: an "i" next to a heading or a control, the text
 * in a bubble on hover, keyboard focus or a tap (and for screen readers through
 * aria-describedby). For what matters but need not be read every time; warnings and errors
 * stay visible in the view.
 */
export function InfoTip({ children, label = t("Więcej informacji") }: { children: ReactNode; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [shift, setShift] = useState(0);
  const bubble = useRef<HTMLSpanElement>(null);
  const shown = open || hover;
  // The bubble centred on the "i" would leave the window near its edge: moved back inside (8 px margin).
  useLayoutEffect(() => {
    if (!shown || !bubble.current) {
      setShift(0);
      return;
    }
    const rect = bubble.current.getBoundingClientRect();
    const left = rect.left - shift;
    const right = rect.right - shift;
    const margin = 8;
    const next = right > window.innerWidth - margin ? window.innerWidth - margin - right : left < margin ? margin - left : 0;
    if (next !== shift) setShift(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  return (
    <span
      className={["info-tip", open ? "open" : "", shown ? "shown" : ""].filter(Boolean).join(" ")}
      style={{ "--info-tip-shift": `${shift}px` } as CSSProperties}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
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
      <span ref={bubble} role="tooltip" id={id} className="info-tip-bubble">
        {children}
      </span>
    </span>
  );
}
