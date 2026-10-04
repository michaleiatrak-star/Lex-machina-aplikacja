import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createInvoice,
  deleteInvoice,
  deleteInvoiceTemplate,
  duplicateInvoice,
  exportInvoicePdf,
  getInvoiceSettings,
  issueInvoice,
  listInvoiceTemplates,
  listInvoices,
  saveInvoiceTemplate,
  previewInvoiceNumber,
  updateInvoice,
  type InvoiceAnnotations,
  type InvoiceDraft,
  type InvoiceLine,
  type InvoiceParty,
  type InvoiceSettingsResponse,
  type InvoiceSort,
  type InvoiceTemplate,
  type InvoiceView
} from "./api.js";
import {
  FACTORY_DEFAULTS,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  VAT_RATES,
  addDays,
  draftFromTemplate,
  draftOf,
  emptyDraft,
  emptyLine,
  formatMoney,
  templateFromDraft,
  termDaysOf,
  invoiceErrorText,
  lineNet,
  previewTotals
} from "./invoice-form.js";
import { CompanyNipField } from "./CompanyNipField.js";
import type { CompanyLookup } from "./company-lookup.js";
import { InvoiceRequirementsCard } from "./InvoiceRequirementsCard.js";
import { downloadBlob } from "./download-file.js";
import "./invoices.css";

const SORTS: Array<[InvoiceSort, string]> = [
  ["date-desc", "Data: najnowsze"],
  ["date-asc", "Data: najstarsze"],
  ["client-asc", "Klient: A–Z"],
  ["client-desc", "Klient: Z–A"]
];

type Editing = { invoiceId: string | null; draft: InvoiceDraft };

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function failureText(error: unknown): string {
  return invoiceErrorText(
    error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error)
  );
}

function PartyFields({
  title,
  party,
  onChange,
  onFound
}: {
  title: string;
  party: InvoiceParty;
  onChange: (next: InvoiceParty) => void;
  onFound?: (lookup: CompanyLookup) => string | null;
}) {
  return (
    <fieldset className="invoice-party">
      <legend>{title}</legend>
      <CompanyNipField party={party} onChange={onChange} onFound={onFound} />
      <label>
        Nazwa
        <input value={party.name} onChange={(event) => onChange({ ...party, name: event.target.value })} />
      </label>
      <label>
        Adres
        <input value={party.address} onChange={(event) => onChange({ ...party, address: event.target.value })} />
      </label>
    </fieldset>
  );
}

// Treść oznaczeń jak w polu faktury; brzmienie wymogu sprawdza „Zweryfikuj przez ELI”.
function annotationTexts(annotations: InvoiceAnnotations | undefined): string[] {
  if (!annotations) return [];
  return [
    annotations.cashMethod ? "metoda kasowa" : "",
    annotations.selfBilling ? "samofakturowanie" : "",
    annotations.reverseCharge ? "odwrotne obciążenie" : "",
    annotations.splitPayment ? "mechanizm podzielonej płatności" : "",
    annotations.exemptionBasis ? `Podstawa zwolnienia: ${annotations.exemptionBasis}` : ""
  ].filter(Boolean);
}

const ANNOTATION_FLAGS: Array<[keyof Omit<InvoiceAnnotations, "exemptionBasis">, string]> = [
  ["cashMethod", "metoda kasowa"],
  ["selfBilling", "samofakturowanie"],
  ["reverseCharge", "odwrotne obciążenie"],
  ["splitPayment", "mechanizm podzielonej płatności"]
];

function InvoiceDocument({
  invoice,
  settings
}: {
  invoice: InvoiceView;
  settings: InvoiceSettingsResponse | null;
}) {
  const party = (title: string, value: InvoiceParty) => (
    <div>
      <h4>{title}</h4>
      <strong>{value.name}</strong>
      <div>{value.address}</div>
      {value.nip ? <div>NIP: {value.nip}</div> : null}
    </div>
  );
  return (
    <article className="invoice-document" aria-label={`Faktura ${invoice.number}`}>
      <header>
        {settings?.logo ? (
          <img alt="" src={`data:${settings.logo.mediaType};base64,${settings.logo.base64}`} />
        ) : <span />}
        <div className="invoice-document-title">
          <h3>Faktura {invoice.number}</h3>
          <div>Data wystawienia: {invoice.issueDate}{invoice.placeOfIssue ? `, ${invoice.placeOfIssue}` : ""}</div>
          {invoice.saleDate ? <div>Data sprzedaży / wykonania usługi: {invoice.saleDate}</div> : null}
          {invoice.status === "DRAFT" ? <div className="invoice-draft-mark">SZKIC</div> : null}
        </div>
      </header>
      <div className="invoice-document-parties">
        {party("Sprzedawca", invoice.seller)}
        {party("Nabywca", invoice.buyer)}
      </div>
      <table>
        <thead>
          <tr>
            <th>Lp.</th>
            <th>Nazwa towaru lub usługi</th>
            <th>J.m.</th>
            <th>Ilość</th>
            <th>Cena netto</th>
            <th>Opust</th>
            <th>Wartość netto</th>
            <th>Stawka VAT</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, index) => (
            <tr key={index}>
              <td>{index + 1}</td>
              <td>{line.name}</td>
              <td>{line.unit}</td>
              <td>{line.quantity}</td>
              <td>{formatMoney(Number(line.unitNetPrice).toFixed(2), invoice.currency)}</td>
              <td>{line.discount ? formatMoney(Number(line.discount).toFixed(2), invoice.currency) : "—"}</td>
              <td>{formatMoney(lineNet(line) ?? "0.00", invoice.currency)}</td>
              <td>{/^\d/.test(line.vatRate) ? `${line.vatRate}%` : line.vatRate}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="invoice-document-totals">
        <thead>
          <tr><th>Stawka</th><th>Netto</th><th>VAT</th><th>Brutto</th></tr>
        </thead>
        <tbody>
          {invoice.totals.byRate.map((row) => (
            <tr key={row.vatRate}>
              <td>{/^\d/.test(row.vatRate) ? `${row.vatRate}%` : row.vatRate}</td>
              <td>{formatMoney(row.net, invoice.currency)}</td>
              <td>{formatMoney(row.vat, invoice.currency)}</td>
              <td>{formatMoney(row.gross, invoice.currency)}</td>
            </tr>
          ))}
          <tr className="invoice-document-sum">
            <td>Razem</td>
            <td>{formatMoney(invoice.totals.net, invoice.currency)}</td>
            <td>{formatMoney(invoice.totals.vat, invoice.currency)}</td>
            <td>{formatMoney(invoice.totals.gross, invoice.currency)}</td>
          </tr>
        </tbody>
      </table>
      <footer>
        {invoice.paymentMethod === "zapłacono"
          ? <div className="invoice-paid-mark">Zapłacono</div>
          : invoice.paymentMethod ? <div>Sposób płatności: {invoice.paymentMethod}</div> : null}
        {invoice.paymentDueDate ? <div>Termin płatności: {invoice.paymentDueDate}</div> : null}
        {invoice.bankAccount ? <div>Rachunek: {invoice.bankAccount}</div> : null}
        {annotationTexts(invoice.annotations).map((entry) => <div key={entry}><strong>{entry}</strong></div>)}
        {invoice.notes ? <p>{invoice.notes}</p> : null}
      </footer>
    </article>
  );
}

// Karta „Faktury”: wyszukiwarka (klient, numer), sortowanie, formularz,
// wystawienie, nowa faktura na podstawie istniejącej i wydruk z logo.
export function InvoicesPanel({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const [settings, setSettings] = useState<InvoiceSettingsResponse | null>(null);
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<InvoiceSort>("date-desc");
  const [selected, setSelected] = useState<InvoiceView | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmIssue, setConfirmIssue] = useState(false);
  const [suggestedNumber, setSuggestedNumber] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    const next = await listInvoiceTemplates();
    setTemplates(next.templates);
    setTemplateId((current) => (next.templates.some((item) => item.templateId === current) ? current : next.templates[0]?.templateId ?? ""));
  }, []);

  useEffect(() => {
    void refreshTemplates().catch((failure) => setError(failureText(failure)));
  }, [refreshTemplates]);

  const refresh = useCallback(async () => {
    const next = await listInvoices(query, sort);
    setInvoices(next.invoices);
  }, [query, sort]);

  useEffect(() => {
    void getInvoiceSettings().then(setSettings).catch((failure) => setError(failureText(failure)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch((failure) => setError(failureText(failure)));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  // success: a fixed text, or one the action leaves (e.g. where a file was saved).
  async function run(action: () => Promise<void | string>, success = ""): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const outcome = await action();
      setMessage(typeof outcome === "string" ? outcome : success);
      await refresh();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  function open(invoice: InvoiceView): void {
    setSelected(invoice);
    setEditing(null);
    setConfirmIssue(false);
  }

  function startFromTemplate(): void {
    const template = templates.find((item) => item.templateId === templateId);
    if (!template) return;
    setSelected(null);
    setConfirmIssue(false);
    setTemplateName(null);
    setEditing({ invoiceId: null, draft: draftFromTemplate(template, settings?.seller, today(), defaults) });
    setMessage(`Nowa faktura ze wzoru „${template.name}”. Uzupełnij numer i sprawdź pozycje.`);
  }

  // Zapis jako wzór; wzór o tej samej nazwie jest aktualizowany.
  function saveTemplate(): void {
    if (!editing || templateName === null || !templateName.trim()) return;
    const name = templateName.trim();
    const existing = templates.find((item) => item.name.toLocaleLowerCase("pl") === name.toLocaleLowerCase("pl"));
    void run(async () => {
      const saved = await saveInvoiceTemplate(templateFromDraft(editing.draft, name), existing?.templateId);
      await refreshTemplates();
      setTemplateId(saved.template.templateId);
      setTemplateName(null);
    }, existing ? `Wzór „${name}” zaktualizowany.` : `Wzór „${name}” zapisany.`);
  }

  function removeTemplate(): void {
    const template = templates.find((item) => item.templateId === templateId);
    if (!template || !window.confirm(`Usunąć wzór „${template.name}”? Faktury utworzone ze wzoru zostają.`)) return;
    void run(async () => {
      await deleteInvoiceTemplate(template.templateId);
      await refreshTemplates();
    }, `Wzór „${template.name}” usunięty.`);
  }

  function startNew(): void {
    setSelected(null);
    setConfirmIssue(false);
    setEditing({ invoiceId: null, draft: emptyDraft(settings?.seller, today(), defaults) });
  }

  const defaults = settings?.defaults ?? FACTORY_DEFAULTS;

  // Termin przelewu: wybór liczby dni od daty wystawienia albo własna data.
  function setTerm(value: string, draft: InvoiceDraft): void {
    if (value === "custom") return patch({ paymentDueDate: draft.paymentDueDate || addDays(draft.issueDate, defaults.paymentTermDays) });
    patch({ paymentDueDate: addDays(draft.issueDate, Number(value)) });
  }

  function setIssueDate(issueDate: string, draft: InvoiceDraft): void {
    const days = draft.paymentMethod === "przelew" ? termDaysOf(draft.issueDate, draft.paymentDueDate) : null;
    patch(days === null ? { issueDate } : { issueDate, paymentDueDate: addDays(issueDate, days) });
  }

  function setPaymentMethod(paymentMethod: string, draft: InvoiceDraft): void {
    patch(paymentMethod === "przelew"
      ? { paymentMethod, paymentDueDate: draft.paymentDueDate || addDays(draft.issueDate, defaults.paymentTermDays) }
      : { paymentMethod, paymentDueDate: "", bankAccount: "" });
  }

  function patch(change: Partial<InvoiceDraft>): void {
    setEditing((current) => (current ? { ...current, draft: { ...current.draft, ...change } } : current));
  }

  function patchLine(index: number, change: Partial<InvoiceLine>): void {
    setEditing((current) => {
      if (!current) return current;
      const lines = current.draft.lines.map((line, at) => (at === index ? { ...line, ...change } : line));
      return { ...current, draft: { ...current.draft, lines } };
    });
  }

  function save(): void {
    if (!editing) return;
    void run(async () => {
      const result = editing.invoiceId
        ? await updateInvoice(editing.invoiceId, editing.draft)
        : await createInvoice(editing.draft);
      setEditing(null);
      setSelected(result.invoice);
    }, "Szkic faktury zapisany.");
  }

  const editingIssueDate = editing?.draft.issueDate ?? "";
  const autoNumbering = Boolean(settings?.numbering);
  useEffect(() => {
    if (!autoNumbering || !/^\d{4}-\d{2}-\d{2}$/.test(editingIssueDate)) {
      setSuggestedNumber(null);
      return;
    }
    let cancelled = false;
    void previewInvoiceNumber(editingIssueDate)
      .then((next) => {
        if (!cancelled) setSuggestedNumber(next.number);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [autoNumbering, editingIssueDate]);

  function patchAnnotations(change: Partial<InvoiceAnnotations>): void {
    setEditing((current) =>
      current
        ? { ...current, draft: { ...current.draft, annotations: { ...current.draft.annotations, ...change } } }
        : current
    );
  }

  const totals = editing ? previewTotals(editing.draft.lines) : null;

  return (
    <section className="invoice-panel">
      {error ? <div className="alert alert-error invoice-no-print">{error}</div> : null}
      {message ? <div className="alert invoice-no-print">{message}</div> : null}

      <aside className="chat-card invoice-list invoice-no-print">
        <div className="chat-form-row">
          <button type="button" className="chat-primary-action" disabled={busy} onClick={startNew}>
            Nowa faktura
          </button>
          {onOpenSettings ? (
            <button type="button" className="chat-secondary-action" onClick={onOpenSettings}>
              Ustawienia KSeF
            </button>
          ) : null}
        </div>
        <p className="field-help">
          KSeF: {settings ? (settings.ksef.tokenConfigured ? "token zapisany" : "brak tokenu") : "…"}
          {settings ? ` · środowisko ${settings.ksef.environment === "production" ? "PRODUKCYJNE" : "testowe"}` : ""}
        </p>
        <input
          type="search"
          placeholder="Szukaj po kliencie, NIP lub numerze"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select value={sort} onChange={(event) => setSort(event.target.value as InvoiceSort)} aria-label="Sortowanie">
          {SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <ul>
          {invoices.map((invoice) => (
            <li key={invoice.invoiceId}>
              <button
                type="button"
                className={selected?.invoiceId === invoice.invoiceId ? "active" : ""}
                onClick={() => open(invoice)}
              >
                <strong>{invoice.number}</strong>
                <span>{invoice.buyer.name}</span>
                <small>
                  {invoice.issueDate} · {formatMoney(invoice.totals.gross, invoice.currency)}
                  {invoice.status === "DRAFT" ? " · szkic" : ""}
                </small>
              </button>
            </li>
          ))}
          {invoices.length === 0 ? <li className="field-help">Brak faktur.</li> : null}
        </ul>
        <div className="invoice-templates">
          <h3>Wzory faktur</h3>
          {templates.length ? (
            <>
              <select value={templateId} aria-label="Wzór faktury" onChange={(event) => setTemplateId(event.target.value)}>
                {templates.map((item) => <option key={item.templateId} value={item.templateId}>{item.name}</option>)}
              </select>
              <div className="chat-form-row">
                <button type="button" className="chat-primary-action" disabled={busy || !templateId} onClick={startFromTemplate}>
                  Nowa ze wzoru
                </button>
                <button type="button" className="chat-secondary-action" disabled={busy || !templateId} onClick={removeTemplate}>
                  Usuń wzór
                </button>
              </div>
            </>
          ) : (
            <p className="field-help">Brak wzorów. W edytorze faktury użyj „Zapisz jako wzór”, aby zapisać stałego klienta z pozycjami i płatnością.</p>
          )}
        </div>
      </aside>

      <div className="invoice-main">
        {editing ? (
          <article className="chat-card invoice-editor">
            <h2>{editing.invoiceId ? "Edycja szkicu" : "Nowa faktura"}</h2>
            <div className="invoice-grid">
              <label>
                Numer faktury
                <input
                  value={editing.draft.number}
                  placeholder={suggestedNumber ? `auto: ${suggestedNumber}` : ""}
                  onChange={(event) => patch({ number: event.target.value })}
                />
                {autoNumbering && !editing.draft.number.trim() ? (
                  <small className="field-help">Puste pole = numer nadany automatycznie przy zapisie.</small>
                ) : null}
              </label>
              <label>
                Data wystawienia
                <input type="date" value={editing.draft.issueDate} onChange={(event) => setIssueDate(event.target.value, editing.draft)} />
              </label>
              <label>
                Data sprzedaży / wykonania usługi
                <input type="date" value={editing.draft.saleDate ?? ""} onChange={(event) => patch({ saleDate: event.target.value })} />
              </label>
              <label>
                Miejsce wystawienia
                <input value={editing.draft.placeOfIssue ?? ""} onChange={(event) => patch({ placeOfIssue: event.target.value })} />
              </label>
            </div>
            <div className="invoice-parties">
              <PartyFields
                title="Sprzedawca"
                party={editing.draft.seller}
                onChange={(seller) => patch({ seller })}
                onFound={(lookup) => {
                  // Jedyny rachunek sprzedawcy z wykazu VAT trafia do pustego pola rachunku.
                  if (editing.draft.paymentMethod !== "przelew" || editing.draft.bankAccount?.trim() || lookup.accounts.length !== 1) return null;
                  patch({ bankAccount: lookup.accounts[0] });
                  return "Rachunek z wykazu VAT wstawiony.";
                }}
              />
              <PartyFields title="Nabywca" party={editing.draft.buyer} onChange={(buyer) => patch({ buyer })} />
            </div>
            <table className="invoice-lines">
              <thead>
                <tr>
                  <th>Nazwa towaru lub usługi</th>
                  <th>J.m.</th>
                  <th>Ilość</th>
                  <th>Cena netto</th>
                  <th>Opust (kwota)</th>
                  <th>Stawka VAT</th>
                  <th>Wartość netto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {editing.draft.lines.map((line, index) => (
                  <tr key={index}>
                    <td><input value={line.name} onChange={(event) => patchLine(index, { name: event.target.value })} /></td>
                    <td><input value={line.unit} onChange={(event) => patchLine(index, { unit: event.target.value })} /></td>
                    <td><input inputMode="decimal" value={line.quantity} onChange={(event) => patchLine(index, { quantity: event.target.value })} /></td>
                    <td><input inputMode="decimal" value={line.unitNetPrice} onChange={(event) => patchLine(index, { unitNetPrice: event.target.value })} /></td>
                    <td><input inputMode="decimal" value={line.discount ?? ""} placeholder="0" onChange={(event) => patchLine(index, { discount: event.target.value })} /></td>
                    <td>
                      <select value={line.vatRate} aria-label="Stawka VAT" onChange={(event) => patchLine(index, { vatRate: event.target.value })}>
                        {line.vatRate === "" ? <option value="">wybierz</option> : null}
                        {line.vatRate && !VAT_RATES.some(([rate]) => rate === line.vatRate)
                          ? <option value={line.vatRate}>{line.vatRate}</option>
                          : null}
                        {VAT_RATES.map(([rate, label]) => <option key={rate} value={rate}>{label}</option>)}
                      </select>
                    </td>
                    <td>{lineNet(line) ?? "—"}</td>
                    <td>
                      <button
                        type="button"
                        className="chat-secondary-action"
                        disabled={editing.draft.lines.length === 1}
                        onClick={() => patch({ lines: editing.draft.lines.filter((_, at) => at !== index) })}
                      >
                        Usuń
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              type="button"
              className="chat-secondary-action"
              onClick={() => patch({ lines: [...editing.draft.lines, emptyLine(defaults.vatRate)] })}
            >
              Dodaj pozycję
            </button>
            <p className="invoice-totals-preview">
              {totals
                ? `Netto ${formatMoney(totals.net, editing.draft.currency)} · VAT ${formatMoney(totals.vat, editing.draft.currency)} · Brutto ${formatMoney(totals.gross, editing.draft.currency)}`
                : "Uzupełnij ilość, cenę i stawkę w każdej pozycji, aby zobaczyć sumy."}
            </p>
            <div className="invoice-grid">
              <label>
                Waluta
                <input maxLength={3} value={editing.draft.currency} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} />
              </label>
              <label>
                Sposób płatności
                <select value={editing.draft.paymentMethod ?? ""} onChange={(event) => setPaymentMethod(event.target.value, editing.draft)}>
                  {editing.draft.paymentMethod && !PAYMENT_METHODS.some(([method]) => method === editing.draft.paymentMethod)
                    ? <option value={editing.draft.paymentMethod}>{editing.draft.paymentMethod}</option>
                    : null}
                  {PAYMENT_METHODS.map(([method, label]) => <option key={method} value={method}>{label}</option>)}
                </select>
              </label>
              {editing.draft.paymentMethod === "przelew" ? (
                <>
                  <label>
                    Termin płatności
                    <select
                      value={String(termDaysOf(editing.draft.issueDate, editing.draft.paymentDueDate) ?? "custom")}
                      onChange={(event) => setTerm(event.target.value, editing.draft)}
                    >
                      {PAYMENT_TERMS.map((days) => <option key={days} value={days}>{days} dni</option>)}
                      <option value="custom">inna data</option>
                    </select>
                  </label>
                  <label>
                    Data płatności
                    <input type="date" value={editing.draft.paymentDueDate ?? ""} onChange={(event) => patch({ paymentDueDate: event.target.value })} />
                  </label>
                  <label>
                    Numer rachunku
                    <input value={editing.draft.bankAccount ?? ""} onChange={(event) => patch({ bankAccount: event.target.value })} />
                  </label>
                </>
              ) : null}
              <label className="invoice-wide">
                Uwagi
                <textarea value={editing.draft.notes ?? ""} onChange={(event) => patch({ notes: event.target.value })} />
              </label>
            </div>
            <fieldset className="invoice-party">
              <legend>Oznaczenia na fakturze</legend>
              {ANNOTATION_FLAGS.map(([flag, label]) => (
                <label key={flag} className="invoice-flag">
                  <input
                    type="checkbox"
                    checked={editing.draft.annotations?.[flag] === true}
                    onChange={(event) => patchAnnotations({ [flag]: event.target.checked })}
                  />
                  <span>„{label}”</span>
                </label>
              ))}
              <label>
                Podstawa zwolnienia od podatku (wymagana przy pozycjach ze stawką „zw”)
                <input
                  value={editing.draft.annotations?.exemptionBasis ?? ""}
                  onChange={(event) => patchAnnotations({ exemptionBasis: event.target.value })}
                />
              </label>
            </fieldset>
            <details className="invoice-requirements-details">
              <summary>Sprawdź wymagane elementy faktury</summary>
              <InvoiceRequirementsCard />
            </details>
            <div className="chat-form-row">
              <button type="button" className="chat-primary-action" disabled={busy} onClick={save}>
                Zapisz szkic
              </button>
              <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => setEditing(null)}>
                Anuluj
              </button>
              <button
                type="button"
                className="chat-secondary-action"
                disabled={busy}
                onClick={() => setTemplateName(templateName === null ? editing.draft.buyer.name : null)}
              >
                Zapisz jako wzór…
              </button>
            </div>
            {templateName !== null ? (
              <div className="chat-form-row invoice-template-save">
                <label>
                  Nazwa wzoru
                  <input value={templateName} maxLength={200} onChange={(event) => setTemplateName(event.target.value)} />
                </label>
                <button type="button" className="chat-primary-action" disabled={busy || !templateName.trim()} onClick={saveTemplate}>
                  {templates.some((item) => item.name.toLocaleLowerCase("pl") === templateName.trim().toLocaleLowerCase("pl"))
                    ? "Zaktualizuj wzór"
                    : "Zapisz wzór"}
                </button>
                <span className="field-help">Wzór zapisuje nabywcę, pozycje, płatność (termin w dniach), miejsce wystawienia i uwagi; bez numeru i dat.</span>
              </div>
            ) : null}
          </article>
        ) : selected ? (
          <>
            <div className="chat-form-row invoice-no-print invoice-actions">
              {selected.status === "DRAFT" ? (
                <>
                  <button
                    type="button"
                    className="chat-secondary-action"
                    disabled={busy}
                    onClick={() => setEditing({ invoiceId: selected.invoiceId, draft: draftOf(selected) })}
                  >
                    Edytuj
                  </button>
                  <button type="button" className="chat-primary-action" disabled={busy} onClick={() => setConfirmIssue(true)}>
                    Wystaw
                  </button>
                  <button
                    type="button"
                    className="chat-secondary-action"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await deleteInvoice(selected.invoiceId);
                        setSelected(null);
                      }, "Szkic usunięty.")
                    }
                  >
                    Usuń szkic
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="chat-secondary-action"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const copy = await duplicateInvoice(selected.invoiceId);
                    setSelected(null);
                    setEditing({ invoiceId: copy.invoice.invoiceId, draft: draftOf(copy.invoice) });
                  }, `Utworzono szkic na podstawie faktury ${selected.number}.`)
                }
              >
                Nowa na podstawie tej
              </button>
              <button
                type="button"
                className="chat-secondary-action"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const exported = await exportInvoicePdf(selected.invoiceId);
                    const saved = await downloadBlob(exported.blob, exported.filename);
                    const where = saved ? `Zapisano: ${saved}.` : `Pobrano ${exported.filename}.`;
                    return exported.logoOmitted
                      ? `${where} Logo pominięto: obraz w nieobsługiwanym formacie (np. PNG z przeplotem); zapisz logo ponownie jako zwykły PNG lub JPEG.`
                      : where;
                  })
                }
              >
                Eksport PDF
              </button>
              <button type="button" className="chat-secondary-action" onClick={() => window.print()}>
                Drukuj
              </button>
              <button
                type="button"
                className="chat-secondary-action"
                disabled
                title="Wysyłka do KSeF będzie dostępna w kolejnym etapie, po weryfikacji wymogów przez ELI."
              >
                Wyślij do KSeF
              </button>
            </div>
            {confirmIssue ? (
              <div className="invoice-confirm invoice-no-print">
                <p>
                  Wystawionej faktury nie można już edytować ani usunąć. Wystawić fakturę {selected.number}?
                </p>
                <div className="chat-form-row">
                  <button
                    type="button"
                    className="chat-primary-action"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const issued = await issueInvoice(selected.invoiceId);
                        setSelected(issued.invoice);
                        setConfirmIssue(false);
                      }, `Faktura ${selected.number} wystawiona.`)
                    }
                  >
                    Tak, wystaw
                  </button>
                  <button type="button" className="chat-secondary-action" onClick={() => setConfirmIssue(false)}>
                    Anuluj
                  </button>
                </div>
              </div>
            ) : null}
            <InvoiceDocument invoice={selected} settings={settings} />
          </>
        ) : (
          <article className="chat-card invoice-no-print">
            <h2>Faktury</h2>
            <p>Wybierz fakturę z listy albo utwórz nową.</p>
            <InvoiceRequirementsCard />
          </article>
        )}
      </div>
    </section>
  );
}
