import { t } from "./i18n";
import { useEffect, useState } from "react";
import { fillPdfForm, getPdfFormFields, type PdfFormField } from "./workspace-client.js";

type Value = string | boolean | null;

/** Message for a form error code of the runtime (pdf_form_worker.py). */
export function pdfFormError(code: string): string {
  const field = code.split(":").slice(1).join(":");
  if (code.startsWith("PDF_FORM_VALUE_INVALID")) return t("Niedozwolona wartość pola „{field}”.", { field: field });
  if (code.startsWith("PDF_FORM_UNKNOWN_FIELD")) return t("Formularz nie ma pola „{field}”.", { field: field });
  if (code.startsWith("PDF_FORM_READ_ONLY")) return t("Pole „{field}” jest tylko do odczytu.", { field: field });
  if (code.startsWith("PDF_FORM_ENCRYPTED")) return t("Formularz jest chroniony hasłem.");
  return t("Nie udało się wypełnić formularza ({code}).", { code: code });
}

function filledName(filename: string): string {
  const stem = filename.replace(/\.pdf$/iu, "");
  return `${stem}-wypelniony.pdf`;
}

/**
 * The fields of a PDF form next to its preview: filled in here and saved as a new PDF in the case
 * files (the original stays). "Spłaszcz" writes the values into the page (no longer editable).
 */
export function PdfFormPanel(props: {
  caseId: string;
  itemId: string;
  filename: string;
  readOnly: boolean;
  onSave: (file: File) => Promise<void>;
}) {
  const [fields, setFields] = useState<PdfFormField[] | null>(null);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [changed, setChanged] = useState<Set<string>>(new Set());
  const [flatten, setFlatten] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    setFields(null);
    getPdfFormFields(props.caseId, props.itemId)
      .then((result) => {
        if (!alive) return;
        setFields(result.fields);
        setValues(Object.fromEntries(result.fields.map((field) => [field.name, field.value])));
        setChanged(new Set());
      })
      .catch(() => alive && setFields([]));
    return () => {
      alive = false;
    };
  }, [props.caseId, props.itemId]);

  if (!fields || fields.length === 0) return null;

  function set(name: string, value: Value): void {
    setValues((current) => ({ ...current, [name]: value }));
    setChanged((current) => new Set(current).add(name));
  }

  async function save(): Promise<void> {
    setSaving(true);
    setStatus("");
    try {
      const sent = Object.fromEntries([...changed].map((name) => [name, values[name] ?? null]));
      const blob = await fillPdfForm(props.caseId, props.itemId, { values: sent, flatten });
      const name = filledName(props.filename);
      await props.onSave(new File([blob], name, { type: "application/pdf" }));
      setStatus(t("Zapisano jako „{name}”. Oryginał pozostaje bez zmian.", { name: name }));
      setChanged(new Set());
    } catch (failure) {
      setStatus(pdfFormError(failure instanceof Error ? failure.message : String(failure)));
    } finally {
      setSaving(false);
    }
  }

  const editable = !props.readOnly;
  return (
    <section className="pdf-form-panel" aria-label={t("Pola formularza PDF")}>
      <header>
        <strong>{t("Formularz PDF:")} {fields.length} {t("pól")}</strong>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Zwiń" : "Wypełnij"}
        </button>
      </header>
      {open ? (
        <>
          <div className="pdf-form-fields">
            {fields.map((field) => {
              const id = `pdf-field-${field.name}`;
              const disabled = !editable || field.readOnly;
              const value = values[field.name];
              const label = (
                <label htmlFor={id}>
                  {field.label}
                  <small> {t("(str.")} {field.page})</small>
                </label>
              );
              if (field.type === "checkbox") {
                return (
                  <div key={field.name} className="pdf-form-field pdf-form-check">
                    <input id={id} type="checkbox" disabled={disabled} checked={value === true} onChange={(event) => set(field.name, event.target.checked)} />
                    {label}
                  </div>
                );
              }
              if (field.type === "radio" || field.type === "combo" || field.type === "list") {
                return (
                  <div key={field.name} className="pdf-form-field">
                    {label}
                    <select id={id} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => set(field.name, event.target.value || null)}>
                      <option value="">—</option>
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              return (
                <div key={field.name} className="pdf-form-field">
                  {label}
                  <input
                    id={id}
                    type="text"
                    disabled={disabled}
                    maxLength={field.maxLength}
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => set(field.name, event.target.value)}
                  />
                </div>
              );
            })}
          </div>
          {editable ? (
            <div className="pdf-form-actions">
              <label title={t("Wartości wpisane na stałe w stronę; pól nie da się już edytować")}>
                <input type="checkbox" checked={flatten} onChange={(event) => setFlatten(event.target.checked)} /> {t("Spłaszcz (do wysłania)")}
              </label>
              <button type="button" disabled={saving || changed.size === 0} onClick={() => void save()}>
                {saving ? "Zapisywanie…" : t("Zapisz wypełniony PDF")}
              </button>
            </div>
          ) : (
            <small>{t("Sprawa tylko do odczytu.")}</small>
          )}
          {status ? <p role="status">{status}</p> : null}
        </>
      ) : null}
    </section>
  );
}
