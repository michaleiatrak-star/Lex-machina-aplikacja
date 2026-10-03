import { useState } from "react";
import type { InvoiceParty } from "./api.js";
import { CompanyLookupError, lookupCompanyByNip, normalizeNip, type CompanyLookup } from "./company-lookup.js";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "found"; lookup: CompanyLookup; filled: string }
  | { kind: "failed"; message: string };

// Pole NIP z „Pobierz dane”: nazwa i adres z białej listy VAT albo CEIDG.
// Po wpisaniu poprawnego NIP i wyjściu z pola dane pobierają się same,
// gdy nazwa i adres są puste; przycisk pobiera i nadpisuje zawsze.
export function CompanyNipField({
  party,
  onChange,
  onFound
}: {
  party: InvoiceParty;
  onChange: (next: InvoiceParty) => void;
  onFound?: (lookup: CompanyLookup) => string | null;
}) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const nip = party.nip ?? "";
  const valid = normalizeNip(nip) !== null;

  async function load(): Promise<void> {
    setState({ kind: "busy" });
    try {
      const lookup = await lookupCompanyByNip(nip);
      onChange({ ...party, ...lookup.party });
      const extra = onFound?.(lookup);
      setState({ kind: "found", lookup, filled: extra ?? "" });
    } catch (error) {
      setState({
        kind: "failed",
        message: error instanceof CompanyLookupError ? error.message : `Nie udało się pobrać danych: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  return (
    <div className="company-nip">
      <label>
        NIP
        <span className="company-nip-row">
          <input
            inputMode="numeric"
            value={nip}
            onChange={(event) => {
              onChange({ ...party, nip: event.target.value });
              if (state.kind !== "busy") setState({ kind: "idle" });
            }}
            onBlur={() => {
              if (valid && state.kind === "idle" && !party.name.trim() && !party.address.trim()) void load();
            }}
          />
          <button
            type="button"
            className="chat-secondary-action"
            disabled={!valid || state.kind === "busy"}
            title="Nazwa i adres z białej listy VAT, a gdy podmiotu tam nie ma: z CEIDG"
            onClick={() => void load()}
          >
            {state.kind === "busy" ? "Pobieram…" : "Pobierz dane"}
          </button>
        </span>
      </label>
      {nip.trim() && !valid ? <span className="field-help">NIP: 10 cyfr z poprawną cyfrą kontrolną.</span> : null}
      {state.kind === "found" ? (
        <span className="field-help" role="status">
          Wstawiono z: {state.lookup.sourceLabel} ({state.lookup.status}){state.lookup.evidence ? `, id zapytania ${state.lookup.evidence}` : ""}.
          {state.filled ? ` ${state.filled}` : ""} Sprawdź dane przed wystawieniem.
        </span>
      ) : null}
      {state.kind === "found" && state.lookup.warnings.length ? (
        <span className="company-nip-warning" role="alert">{state.lookup.warnings.join(" ")}</span>
      ) : null}
      {state.kind === "failed" ? <span className="company-nip-warning" role="alert">{state.message}</span> : null}
    </div>
  );
}
