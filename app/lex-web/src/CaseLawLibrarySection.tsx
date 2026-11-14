import { N_, t } from "./i18n";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  ApiError,
  getCaseLawLibrary,
  removeCaseLawLibraryEntry,
  setCaseLawLibrary,
  type CaseLawCatalogEntry,
  type CaseLawServerStatus
} from "./api.js";
import { CASE_RANGE_PRESETS, rangeForPreset, type CaseRangePreset } from "./CaseAccessAdminPanel.js";
import { InfoTip } from "./InfoTip";

function label(entry: CaseLawCatalogEntry): string {
  return [entry.court, entry.form, entry.signature, entry.date].filter(Boolean).join(" ") || entry.cardUrl;
}

type Sort = "date-desc" | "date-asc" | "fetched-desc" | "signature";
const SORT_LABELS: Record<Sort, string> = {
  "date-desc": N_("Data orzeczenia: najnowsze"),
  "date-asc": N_("Data orzeczenia: najstarsze"),
  "fetched-desc": N_("Ostatnio pobrane"),
  signature: N_("Sygnatura")
};
type RangeField = "date" | "fetched";

// The day an entry falls on for the range: the ruling's date or the day it was downloaded.
const dayOf = (entry: CaseLawCatalogEntry, field: RangeField) => ((field === "date" ? entry.date : entry.fetchedAt) ?? "").slice(0, 10);

/** Entries matching the court and date filters, in the chosen order (the text search runs on the server). */
export function filterCaseLaw(
  entries: readonly CaseLawCatalogEntry[],
  args: { court: string; sort: Sort; range: { from: string; to: string }; field: RangeField }
): CaseLawCatalogEntry[] {
  const listed = entries.filter((entry) => {
    if (args.court && entry.court !== args.court) return false;
    const day = dayOf(entry, args.field);
    if (args.range.from && (!day || day < args.range.from)) return false;
    if (args.range.to && (!day || day > args.range.to)) return false;
    return true;
  });
  const by = (key: (entry: CaseLawCatalogEntry) => string, desc = false) => (a: CaseLawCatalogEntry, b: CaseLawCatalogEntry) =>
    (desc ? -1 : 1) * key(a).localeCompare(key(b), "pl");
  if (args.sort === "date-desc") listed.sort(by((entry) => entry.date ?? "", true));
  else if (args.sort === "date-asc") listed.sort(by((entry) => entry.date ?? "9999"));
  else if (args.sort === "fetched-desc") listed.sort(by((entry) => entry.fetchedAt, true));
  else listed.sort(by((entry) => entry.signature ?? entry.cardUrl));
  return listed;
}

function runText(run: CaseLawServerStatus["sources"][number]["lastRun"]): string {
  if (!run) return "";
  const head = t("ostatni przebieg {date}: nowych {stored}, pominiętych duplikatów {duplicates}", {
    date: run.at.slice(0, 16).replace("T", " "),
    stored: run.stored,
    duplicates: run.duplicates
  });
  if (run.waiting) return `${head} · ${run.waiting}`;
  return run.error ? `${head} · ${t("błąd: {error}", { error: run.error })}` : head;
}

/**
 * The case-law library (off by default): every decision downloaded from an official source is
 * catalogued by court, signature and date, searchable here and by the model. Settings show one row;
 * the list opens in a window. In server mode the window also shows the database of all rulings the
 * server downloads from the bulk sources.
 */
export function CaseLawLibrarySection() {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(true);
  const [entries, setEntries] = useState<CaseLawCatalogEntry[]>([]);
  const [server, setServer] = useState<CaseLawServerStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [court, setCourt] = useState("");
  const [sort, setSort] = useState<Sort>("date-desc");
  const [preset, setPreset] = useState<CaseRangePreset>("all");
  const [range, setRange] = useState({ from: "", to: "" });
  const [field, setField] = useState<RangeField>("date");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();

  const load = useCallback(async (search: string) => {
    try {
      const library = await getCaseLawLibrary(search);
      setEnabled(library.enabled);
      setAvailable(library.available);
      setEntries(library.entries);
      setServer(library.server ?? null);
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const courts = useMemo(() => [...new Set(entries.map((entry) => entry.court).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pl")), [entries]);
  const listed = useMemo(() => filterCaseLaw(entries, { court, sort, range, field }), [entries, court, sort, range, field]);

  // Selection covers only what is listed: a filter change drops the hidden ones.
  useEffect(() => {
    setSelected((current) => {
      const visible = new Set(listed.map((entry) => entry.cardUrl));
      const next = new Set([...current].filter((url) => visible.has(url)));
      return next.size === current.size ? current : next;
    });
  }, [listed]);

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

  async function remove(urls: string[]): Promise<void> {
    setBusy(true);
    try {
      for (const url of urls) await removeCaseLawLibraryEntry(url);
      setSelected(new Set());
      await load(query);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const filtered = Boolean(query || court || range.from || range.to || sort !== "date-desc");
  const serverDocs = server?.sources.reduce((sum, item) => sum + item.documents, 0) ?? 0;
  const status = enabled ? t("pozycji: {count}", { count: entries.length }) : t("wyłączona");

  return (
    <section className="core-law-updates">
      <div className="chat-card matter-compact-row">
        <span className="matter-compact-heading">
          <strong>
            {t("Baza orzeczeń (RAG)")}
            <InfoTip>{t("Orzeczenia pobrane z oficjalnych baz, katalogowane według sądu, sygnatury i daty. Źródłem jest karta orzeczenia.")}</InfoTip>
          </strong>
          <span className={entries.length ? "matter-compact-count has-entries" : "matter-compact-count"}>
            {status}
            {server?.active ? ` · ${t("serwer: {count}", { count: serverDocs })}` : ""}
          </span>
        </span>
        <span className="matter-compact-actions">
          <button type="button" className="chat-secondary-action" onClick={() => setOpen(true)}>
            {t("Pokaż")}
          </button>
        </span>
        {error && !open ? <p className="chat-error matter-compact-error">{error}</p> : null}
      </div>
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
          <section className="chat-card matter-section-dialog case-law-library-dialog">
            <div className="matter-section-dialog-head">
              <div>
                <p className="eyebrow">{t("Ustawienia")}</p>
                <h2 id={titleId}>{t("Baza orzeczeń (RAG)")}</h2>
              </div>
              <button type="button" className="chat-secondary-action" onClick={() => setOpen(false)}>
                {t("Zamknij")}
              </button>
            </div>
            <label className="core-law-auto">
              <input type="checkbox" checked={enabled} disabled={busy || !available} onChange={(event) => void toggle(event.target.checked)} />
              {t("Zapisuj pobrane orzeczenia w bazie")}
              <InfoTip>{t("Baza jest przeszukiwana także przez model. Wyłączona: orzeczenie trafia tylko do akt sprawy, w której je użyto.")}</InfoTip>
            </label>
            {enabled ? (
              <>
                <div className="case-access-filters" role="search">
                  <form
                    className="case-access-filters-row"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void load(query);
                    }}
                  >
                    <label className="case-access-filter-search">
                      {t("Szukaj")}
                      <input
                        type="search"
                        value={query}
                        placeholder={t("Sygnatura, sąd albo fraza z treści")}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <label className="case-law-filter-court">
                      {t("Sąd")}
                      <select value={court} onChange={(event) => setCourt(event.target.value)}>
                        <option value="">{t("Wszystkie sądy")}</option>
                        {courts.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="case-law-filter-sort">
                      {t("Sortowanie")}
                      <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                        {(Object.keys(SORT_LABELS) as Sort[]).map((key) => (
                          <option key={key} value={key}>
                            {t(SORT_LABELS[key])}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="chat-secondary-action case-law-filter-submit" disabled={busy}>
                      {t("Szukaj")}
                    </button>
                  </form>
                  <div className="case-access-filters-row case-access-range">
                    <span className="case-access-filter-label">{t("Zakres")}</span>
                    <select aria-label={t("Data, której dotyczy zakres")} value={field} onChange={(event) => setField(event.target.value as RangeField)}>
                      <option value="date">{t("data orzeczenia")}</option>
                      <option value="fetched">{t("data pobrania")}</option>
                    </select>
                    <div className="case-access-chips" role="group" aria-label={t("Zakres dat")}>
                      {CASE_RANGE_PRESETS.map(([key, name]) => (
                        <button
                          key={key}
                          type="button"
                          className={preset === key ? "case-access-chip active" : "case-access-chip"}
                          aria-pressed={preset === key}
                          onClick={() => {
                            setPreset(key);
                            const next = rangeForPreset(key, new Date(), { ...range, field: "created" });
                            setRange({ from: next.from, to: next.to });
                          }}
                        >
                          {t(name)}
                        </button>
                      ))}
                    </div>
                    {preset === "custom" ? (
                      <span className="case-access-dates">
                        <label>
                          {t("od")}
                          <input type="date" value={range.from} max={range.to || undefined} onChange={(event) => setRange({ ...range, from: event.target.value })} />
                        </label>
                        <label>
                          {t("do")}
                          <input type="date" value={range.to} min={range.from || undefined} onChange={(event) => setRange({ ...range, to: event.target.value })} />
                        </label>
                      </span>
                    ) : null}
                  </div>
                  <div className="case-access-results">
                    <span>{t("Wyświetlono {shown} z {all}", { shown: listed.length, all: entries.length })}</span>
                    {filtered ? (
                      <button
                        type="button"
                        className="case-access-link"
                        onClick={() => {
                          setCourt("");
                          setSort("date-desc");
                          setPreset("all");
                          setRange({ from: "", to: "" });
                          if (query) {
                            setQuery("");
                            void load("");
                          }
                        }}
                      >
                        {t("Wyczyść filtry")}
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className={selected.size ? "case-access-list-head has-selection" : "case-access-list-head"}>
                  <label className="case-access-select-all">
                    <input
                      type="checkbox"
                      ref={(element) => {
                        if (element) element.indeterminate = selected.size > 0 && selected.size < listed.length;
                      }}
                      checked={listed.length > 0 && selected.size === listed.length}
                      disabled={busy || listed.length === 0}
                      onChange={(event) => setSelected(event.target.checked ? new Set(listed.map((entry) => entry.cardUrl)) : new Set())}
                    />
                    {selected.size ? t("Zaznaczono {count}", { count: selected.size }) : t("Zaznacz wszystkie widoczne ({count})", { count: listed.length })}
                  </label>
                  {selected.size ? (
                    <>
                      <button type="button" className="case-access-link" disabled={busy} onClick={() => setSelected(new Set())}>
                        {t("Odznacz")}
                      </button>
                      <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void remove([...selected])}>
                        {t("Usuń zaznaczone ({count})", { count: selected.size })}
                      </button>
                    </>
                  ) : null}
                </div>
                {listed.length ? (
                  <div className="case-law-list">
                    <ul>
                      {listed.map((entry) => (
                        <li key={entry.cardUrl}>
                          <input
                            type="checkbox"
                            aria-label={t("Zaznacz {name}", { name: label(entry) })}
                            checked={selected.has(entry.cardUrl)}
                            disabled={busy}
                            onChange={(event) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(entry.cardUrl);
                                else next.delete(entry.cardUrl);
                                return next;
                              })
                            }
                          />
                          <span className="case-law-entry">
                            <a href={entry.cardUrl} target="_blank" rel="noreferrer" title={entry.cardUrl}>
                              {label(entry)}
                            </a>
                            <small> {t("· pobrane")} {entry.fetchedAt.slice(0, 10)}</small>
                            {entry.snippet ? <small className="field-help"> … {entry.snippet} …</small> : null}
                          </span>
                          <button type="button" className="case-access-link" disabled={busy} onClick={() => void remove([entry.cardUrl])}>
                            {t("Usuń")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="field-help">{query || filtered ? t("Brak trafień.") : t("Baza jest pusta.")}</p>
                )}
              </>
            ) : null}
            {server ? (
              <div className="case-law-server">
                <h3>
                  {t("Baza serwera — wszystkie orzeczenia")}
                  <InfoTip>{t("W trybie serwerowym serwer pobiera całe oficjalne bazy orzeczeń (od najstarszych), potem już tylko nowe. Przerwane pobieranie wznawia się od miejsca zatrzymania. To samo orzeczenie z dwóch baz jest zapisywane raz.")}</InfoTip>
                </h3>
                {server.active ? null : <p className="field-help">{t("Pobieranie działa tylko w trybie serwerowym.")}</p>}
                <ul>
                  {server.sources.map((item) => (
                    <li key={item.source}>
                      <strong>{item.label}</strong>: {t("dokumentów: {count}", { count: item.documents })} · {item.progress}
                      {item.running ? ` · ${t("pobieranie trwa")}` : ""}
                      {item.lastRun ? <small className="field-help"> {runText(item.lastRun)}</small> : null}
                    </li>
                  ))}
                  {server.notBulk.map((item) => (
                    <li key={item.source}>
                      <strong>{item.source}</strong>: {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {error ? <p className="chat-inline-error">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
