import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createInvoice,
  deleteInvoice,
  duplicateInvoice,
  getInvoiceSettings,
  issueInvoice,
  listInvoices,
  previewInvoiceNumber,
  updateInvoice,
  type InvoiceAnnotations,
  type InvoiceDraft,
  type InvoiceLine,
  type InvoiceParty,
  type InvoiceSettingsResponse,
  type InvoiceSort,
  type InvoiceView
} from "./api.js";
import {
  draftOf,
  emptyDraft,
  emptyLine,
  formatMoney,
  invoiceErrorText,
  lineNet,
  previewTotals
} from "./invoice-form.js";
import { InvoiceRequirementsCard } from "./InvoiceRequirementsCard.js";
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
  onChange
}: {
  title: string;
  party: InvoiceParty;
  onChange: (next: InvoiceParty) => void;
}) {
  return (
    <fieldset className="invoice-party">
      <legend>{title}</legend>
      <label>
        Nazwa
        <input value={party.name} onChange={(event) => onChange({ ...party, name: event.target.value })} />
      </label>
      <label>
        NIP
        <input inputMode="numeric" value={party.nip ?? ""} onChange={(event) => onChange({ ...party, nip: event.target.value })} />
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
        {invoice.paymentMethod ? <div>Sposób płatności: {invoice.paymentMethod}</div> : null}
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

  async function run(action: () => Promise<void>, success = ""): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
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

  function startNew(): void {
    setSelected(null);
    setConfirmIssue(false);
    setEditing({ invoiceId: null, draft: emptyDraft(settings?.seller, today()) });
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
                <input type="date" value={editing.draft.issueDate} onChange={(event) => patch({ issueDate: event.target.value })} />
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
              <PartyFields title="Sprzedawca" party={editing.draft.seller} onChange={(seller) => patch({ seller })} />
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
                    <td><input value={line.vatRate} placeholder="%" onChange={(event) => patchLine(index, { vatRate: event.target.value })} /></td>
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
              onClick={() => patch({ lines: [...editing.draft.lines, emptyLine()] })}
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
                <input value={editing.draft.paymentMethod ?? ""} onChange={(event) => patch({ paymentMethod: event.target.value })} />
              </label>
              <label>
                Termin płatności
                <input type="date" value={editing.draft.paymentDueDate ?? ""} onChange={(event) => patch({ paymentDueDate: event.target.value })} />
              </label>
              <label>
                Numer rachunku
                <input value={editing.draft.bankAccount ?? ""} onChange={(event) => patch({ bankAccount: event.target.value })} />
              </label>
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
            </div>
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
              <button type="button" className="chat-secondary-action" onClick={() => window.print()}>
                Drukuj / PDF
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
