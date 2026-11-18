import { useEffect, useId, useState, type ReactNode } from "react";
import { t } from "./i18n";

/**
 * A setting group of the case card as one compact row (its name and a short state), opened in a
 * window above the page with "Zmień" (the same pattern as the case sections: the card stays short).
 */
export function CompactSettingRow({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="chat-card matter-compact-row">
      <span className="matter-compact-heading">
        <strong>{title}</strong>
        <span className="matter-compact-count has-entries">{summary}</span>
      </span>
      <span className="matter-compact-actions">
        <button type="button" className="chat-secondary-action" onClick={() => setOpen(true)}>
          {t("Zmień")}
        </button>
      </span>
      {open ? (
        <div
          className="privacy-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="chat-card matter-section-dialog">
            <div className="matter-section-dialog-head">
              <h2 id={titleId}>{title}</h2>
              <button type="button" className="chat-secondary-action" onClick={() => setOpen(false)}>
                {t("Zamknij")}
              </button>
            </div>
            {children}
          </section>
        </div>
      ) : null}
    </div>
  );
}
