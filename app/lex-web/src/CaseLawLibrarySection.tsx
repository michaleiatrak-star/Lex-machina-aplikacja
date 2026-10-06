import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  getCaseLawLibrary,
  removeCaseLawLibraryEntry,
  setCaseLawLibrary,
  type CaseLawCatalogEntry
} from "./api.js";

function label(entry: CaseLawCatalogEntry): string {
  return [entry.court, entry.form, entry.signature, entry.date].filter(Boolean).join(" ") || entry.cardUrl;
}

/**
 * The case-law library (off by default): every decision downloaded from an
 * official source is catalogued by court, signature and date, searchable here
 * and by the model. Off: decisions stay only in the case files where they were
 * used, and quotes are marked on that copy.
 */
export function CaseLawLibrarySection() {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(true);
  const [entries, setEntries] = useState<CaseLawCatalogEntry[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (search: string) => {
    try {
      const library = await getCaseLawLibrary(search);
      setEnabled(library.enabled);
      setAvailable(library.available);
      setEntries(library.entries);
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  async function toggle(next: boolean): Promise<void> {
    setBusy(true);
    try {
      setEnabled((await setCaseLawLibrary(next)).enabled);
      await load(query);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: CaseLawCatalogEntry): Promise<void> {
    setBusy(true);
    try {
      await removeCaseLawLibraryEntry(entry.cardUrl);
      await load(query);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="core-law-updates">
      <div className="maintenance-heading">
        <div>
          <strong>Baza orzeczeń (RAG)</strong>
          <small>
            orzeczenia pobrane z oficjalnych baz, skatalogowane według sądu, sygnatury i daty; źródłem jest karta orzeczenia
          </small>
        </div>
        <span>{enabled ? `pozycji: ${entries.length}${query ? " (wyszukane)" : ""}` : "wyłączona"}</span>
      </div>
      <label className="core-law-auto">
        <input type="checkbox" checked={enabled} disabled={busy || !available} onChange={(event) => void toggle(event.target.checked)} />
        Zapisuj pobrane orzeczenia w bazie orzeczeń (wyszukiwanej także przez model)
      </label>
      <p className="field-help">
        Wyłączone: orzeczenie trafia tylko do akt sprawy, w której zostało użyte, i na tej kopii zaznaczane są cytaty.
      </p>
      {enabled ? (
        <>
          <div className="core-law-add">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void load(query);
            }}
          >
            <input
              type="search"
              value={query}
              placeholder="Sygnatura, sąd albo fraza z treści"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="submit" disabled={busy}>
              Szukaj
            </button>
          </form>
          </div>
          {entries.length ? (
            <div className="core-law-list">
            <ul>
              {entries.map((entry) => (
                <li key={entry.cardUrl}>
                  <a href={entry.cardUrl} target="_blank" rel="noreferrer" title={entry.cardUrl}>
                    {label(entry)}
                  </a>
                  <small> · pobrane {entry.fetchedAt.slice(0, 10)}</small>
                  {entry.snippet ? <small className="field-help"> … {entry.snippet} …</small> : null}
                  <button type="button" disabled={busy} onClick={() => void remove(entry)}>
                    Usuń
                  </button>
                </li>
              ))}
            </ul>
            </div>
          ) : (
            <p className="field-help">{query ? "Brak trafień." : "Baza jest pusta - orzeczenia trafią tu przy pobraniu."}</p>
          )}
        </>
      ) : null}
      {error ? <p className="chat-inline-error">{error}</p> : null}
    </section>
  );
}
