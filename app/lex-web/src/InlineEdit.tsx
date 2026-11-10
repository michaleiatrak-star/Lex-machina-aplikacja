import { useEffect, useRef, useState } from "react";
import { t } from "./i18n";

/**
 * Edit in place (Atlassian inline edit pattern): the field with confirm (✓) and cancel (✕)
 * buttons beside it; Enter or leaving the field saves, Escape or ✕ cancels. An unchanged or empty
 * value is not saved. onSave resolves true when saved (the field closes), false to stay open.
 */
export function InlineEdit({
  value,
  label,
  placeholder,
  maxLength = 160,
  className,
  onSave,
  onCancel
}: {
  value: string;
  label: string;
  placeholder?: string;
  maxLength?: number;
  className?: string;
  onSave: (next: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  async function confirm(): Promise<void> {
    if (busy || done.current) return;
    const next = draft.trim();
    if (!next || next === value.trim()) {
      done.current = true;
      onCancel();
      return;
    }
    setBusy(true);
    const saved = await onSave(next).catch(() => false);
    setBusy(false);
    if (saved) done.current = true;
  }

  function cancel(): void {
    done.current = true;
    onCancel();
  }

  return (
    <div
      ref={group}
      className={className ? `inline-edit ${className}` : "inline-edit"}
      onBlur={(event) => {
        // Leaving the whole group (not moving to ✓ or ✕) saves.
        if (!group.current?.contains(event.relatedTarget as Node | null)) void confirm();
      }}
    >
      <input
        autoFocus
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void confirm();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          }
        }}
      />
      <button type="button" className="inline-edit-confirm" aria-label={t("Zapisz")} title={t("Zapisz (Enter)")} disabled={busy || !draft.trim()} onClick={() => void confirm()}>
        ✓
      </button>
      <button type="button" className="inline-edit-cancel" aria-label={t("Anuluj")} title={t("Anuluj (Esc)")} disabled={busy} onClick={cancel}>
        ✕
      </button>
    </div>
  );
}
