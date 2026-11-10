import { useEffect, useId, useState, type ReactNode } from "react";
import { t } from "./i18n";

/**
 * Case-card section as one compact row: its name, how many entries it has, and buttons that open
 * the entries or the add form in a window above the page (the case card stays short).
 */
export function CollapsibleCaseSection({
  eyebrow,
  title,
  count,
  loading,
  error,
  resetKey,
  addLabel,
  hint,
  addForm,
  children
}: {
  eyebrow: string;
  title: string;
  count: number;
  loading: boolean;
  error?: string;
  resetKey: string | null;
  addLabel: string;
  hint?: ReactNode;
  addForm?: ReactNode;
  children: ReactNode;
}) {
  const hasEntries = count > 0;
  const [view, setView] = useState<"" | "list" | "add">("");
  const titleId = useId();

  useEffect(() => {
    setView("");
  }, [resetKey]);

  useEffect(() => {
    if (!view) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setView("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const countLabel = loading ? t("ładowanie…") : hasEntries ? String(count) : t("brak wpisów");

  return (
    <div className="chat-card matter-compact-row">
      <span className="matter-compact-heading" title={t(title)}>
        <strong>{t(eyebrow)}</strong>
        <span className={hasEntries ? "matter-compact-count has-entries" : "matter-compact-count"}>{countLabel}</span>
      </span>
      <span className="matter-compact-actions">
        {hasEntries ? (
          <button type="button" className="chat-secondary-action" onClick={() => setView("list")}>
            {t("Pokaż")}
          </button>
        ) : null}
        {addForm ? (
          <button type="button" className="chat-secondary-action" aria-label={t(addLabel)} title={t(addLabel)} onClick={() => setView("add")}>
            {t("+ Dodaj")}
          </button>
        ) : null}
      </span>
      {error ? <p className="chat-error matter-compact-error">{error}</p> : null}
      {view ? (
        <div
          className="privacy-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => {
            if (event.target === event.currentTarget) setView("");
          }}
        >
          <section className="chat-card matter-section-dialog">
            <div className="matter-section-dialog-head">
              <div>
                <p className="eyebrow">{t(eyebrow)}</p>
                <h2 id={titleId}>{view === "add" ? t(addLabel) : t(title)}</h2>
              </div>
              <button type="button" className="chat-secondary-action" onClick={() => setView("")}>
                {t("Zamknij")}
              </button>
            </div>
            {view === "list" ? (
              <>
                <div className="matter-schedule-list">{children}</div>
                {addForm ? (
                  <button type="button" className="chat-secondary-action matter-section-dialog-add" onClick={() => setView("add")}>
                    {t("+ Dodaj")}
                  </button>
                ) : null}
              </>
            ) : (
              <div className="matter-add-entry">
                {hint ? <p className="matter-collapsible-hint">{typeof hint === "string" ? t(hint) : hint}</p> : null}
                {addForm}
                {hasEntries ? (
                  <button type="button" className="chat-secondary-action matter-section-dialog-add" onClick={() => setView("list")}>
                    {t("Pokaż wpisy ({count})", { count })}
                  </button>
                ) : null}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
