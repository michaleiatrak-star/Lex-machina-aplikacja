import { useEffect, useState, type ReactNode } from "react";

/**
 * Case-card section that only shows existing entries.
 * Open while it has entries (or an error), collapsed to its header when empty;
 * the add form stays behind its own toggle until there is nothing to list.
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
  const [open, setOpen] = useState(hasEntries);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    setOpen(hasEntries);
  }, [resetKey, hasEntries]);

  useEffect(() => {
    setAddOpen(false);
  }, [resetKey]);

  useEffect(() => {
    if (error) setOpen(true);
  }, [error]);

  const countLabel = loading
    ? "ładowanie…"
    : hasEntries
      ? String(count)
      : "brak wpisów";

  const addBody = (
    <>
      {hint ? <p className="matter-collapsible-hint">{hint}</p> : null}
      {addForm}
    </>
  );

  return (
    <details
      className="chat-card matter-schedule-card matter-collapsible"
      open={open}
      onToggle={(event) => {
        if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
      }}
    >
      <summary className="matter-collapsible-summary">
        <span className="matter-collapsible-heading">
          <span className="eyebrow">{eyebrow}</span>
          <span className="matter-collapsible-title">{title}</span>
        </span>
        <span className="matter-collapsible-count">{countLabel}</span>
      </summary>

      {error ? <p className="chat-error">{error}</p> : null}

      {hasEntries ? <div className="matter-schedule-list">{children}</div> : null}

      {addForm ? (
        hasEntries ? (
          <details
            className="matter-add-entry"
            open={addOpen}
            onToggle={(event) => {
              if (event.target === event.currentTarget) setAddOpen(event.currentTarget.open);
            }}
          >
            <summary>{addLabel}</summary>
            {addBody}
          </details>
        ) : (
          <div className="matter-add-entry">{addBody}</div>
        )
      ) : null}
    </details>
  );
}
