import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  addCoreLawAct,
  applyCoreLawUpdates,
  checkCoreLawUpdates,
  getCoreLawStatus,
  lookupCoreLawAct,
  removeCoreLawAct,
  setCoreLawAutoApply,
  type AuthenticatedUser,
  type CoreLawActLookup,
  type CoreLawActStatus,
  type CoreLawStatus
} from "./api.js";

const STATE_LABEL: Record<CoreLawActStatus["state"], string> = {
  CURRENT: "aktualny",
  UPDATE_AVAILABLE: "jest aktualizacja",
  CHECK_DUE: "do sprawdzenia",
  MISSING: "niepobrany",
  ERROR: "błąd pobierania"
};

function day(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

function actName(act: CoreLawActStatus): string {
  return act.title ?? act.labels[0] ?? act.eli;
}

const CHANGE_LABEL: Record<CoreLawStatus["recent"][number]["kind"], string> = {
  CONSOLIDATED: "nowy tekst jednolity",
  AMENDMENT: "dodana nowelizacja",
  ADDED: "dodany akt",
  REMOVED: "usunięty akt"
};

export function coreLawActErrorText(code: string): string {
  switch (code) {
    case "CORE_LAW_ACT_REFERENCE_INVALID":
      return "Nie rozpoznano aktu. Podaj adres z ISAP (np. WDU20250000383), ELI (DU/2025/383) albo „Dz.U. 2025 poz. 383”.";
    case "CORE_LAW_ACT_NOT_FOUND":
      return "Sejm ELI nie ma aktu o tym oznaczeniu.";
    case "CORE_LAW_ACT_NOT_IN_FORCE":
      return "Według Sejm ELI akt nie obowiązuje; kopia przepisów zawiera tylko akty obowiązujące.";
    case "CORE_LAW_ACT_TEXT_UNAVAILABLE":
      return "Sejm ELI nie udostępnia tekstu tego aktu (ani HTML, ani PDF).";
    case "CORE_LAW_ACT_SOURCE_UNAVAILABLE":
      return "Sejm ELI jest niedostępne. Spróbuj ponownie za chwilę.";
    case "CORE_LAW_ACT_ALREADY_PRESENT":
      return "Ten akt jest już w kopii przepisów.";
    case "CORE_LAW_USER_ACT_NOT_FOUND":
      return "Akt nie jest na liście dodanych przez użytkowników.";
    default:
      return code;
  }
}

// Acts whose text in RAG is current, and acts that need an update or check.
export function groupCoreLawActs(acts: CoreLawActStatus[]): {
  current: CoreLawActStatus[];
  needsUpdate: CoreLawActStatus[];
} {
  const current: CoreLawActStatus[] = [];
  const needsUpdate: CoreLawActStatus[] = [];
  for (const act of acts) {
    (act.state === "CURRENT" ? current : needsUpdate).push(act);
  }
  const order: CoreLawActStatus["state"][] = ["UPDATE_AVAILABLE", "ERROR", "MISSING", "CHECK_DUE", "CURRENT"];
  needsUpdate.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return { current, needsUpdate };
}

// Settings → Aplikacja i utrzymanie: the local copy of law (RAG). A newer
// consolidated text replaces the act's text; an amendment after it is added
// to RAG as its own document.
export function CoreLawUpdatesSection({ user }: { user: AuthenticatedUser }) {
  const [status, setStatus] = useState<CoreLawStatus | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [reference, setReference] = useState("");
  const [found, setFound] = useState<{ act: CoreLawActLookup; presentAs: string | null } | null>(null);
  const admin = user.appRole === "ADMIN";

  const load = useCallback(async () => {
    try {
      setStatus(await getCoreLawStatus());
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // While a check or update runs in the background, follow its progress.
  useEffect(() => {
    if (!status?.refreshing) return;
    const timer = setInterval(() => void load(), 3_000);
    return () => clearInterval(timer);
  }, [status?.refreshing, load]);

  async function run(key: string, action: () => Promise<CoreLawStatus | null>) {
    setBusy(key);
    setError("");
    try {
      const next = await action();
      if (next) setStatus(next);
    } catch (failure) {
      setError(failure instanceof ApiError ? coreLawActErrorText(failure.code) : String(failure));
    } finally {
      setBusy("");
    }
  }

  const userActs = (status?.acts ?? []).filter((act) => act.origin === "USER");

  const groups = groupCoreLawActs(status?.acts ?? []);
  const pendingTotal = (status?.pending.consolidated ?? 0) + (status?.pending.amendments ?? 0);
  const disabled = Boolean(busy) || Boolean(status?.refreshing);

  return (
    <section className="core-law-updates">
      <div className="maintenance-heading">
        <div>
          <strong>Przepisy (RAG)</strong>
          <small>
            lokalna kopia aktów z Sejm ELI · ostatnie sprawdzenie: {day(status?.lastCheckAt)}
            {status?.refreshing ? " · sprawdzanie w toku…" : ""}
          </small>
        </div>
        <span>
          {!status
            ? "—"
            : groups.needsUpdate.length
              ? `do aktualizacji: ${groups.needsUpdate.length}`
              : "aktualne"}
        </span>
      </div>

      {status ? (
        <>
          <ul className="core-law-counts">
            <li>
              <strong>{status.counts.consolidated}</strong> tekstów jednolitych
            </li>
            <li>
              <strong>{status.counts.amendments}</strong> nowelizacji po t.j.
            </li>
            <li>
              <strong>{status.counts.other}</strong> pozostałych aktów
            </li>
            <li>
              <strong>{status.counts.articles}</strong> artykułów
            </li>
          </ul>

          {pendingTotal ? (
            <small className="maintenance-trust-warning">
              Nowe w ELI, jeszcze niezastosowane: {status.pending.consolidated} nowszych tekstów jednolitych,{" "}
              {status.pending.amendments} nowelizacji. Do czasu zastosowania weryfikacja tych aktów korzysta
              bezpośrednio z ELI, nie z kopii.
            </small>
          ) : null}

          <small>
            Nowszy tekst jednolity zastępuje tekst aktu w RAG. Nowelizacja ogłoszona po tekście jednolitym jest
            dodawana do RAG jako osobny dokument.
          </small>

          {admin ? (
            <>
              <label className="core-law-auto">
                <input
                  type="checkbox"
                  checked={status.autoApply}
                  disabled={disabled}
                  onChange={(event) =>
                    void run("auto", () => setCoreLawAutoApply(event.target.checked))
                  }
                />
                Aktualizuj automatycznie (sprawdzenie raz dziennie)
              </label>
              <div className="maintenance-actions">
                <button type="button" disabled={disabled} onClick={() => void run("check", checkCoreLawUpdates)}>
                  {busy === "check" ? "Sprawdzanie…" : "Sprawdź teraz"}
                </button>
                <button
                  type="button"
                  disabled={disabled || !pendingTotal}
                  onClick={() => void run("apply", () => applyCoreLawUpdates())}
                >
                  Zastosuj wszystkie aktualizacje ({pendingTotal})
                </button>
              </div>
            </>
          ) : (
            <small>Aktualizacje kopii przepisów uruchamia administrator.</small>
          )}

          {admin ? (
            <div className="core-law-add">
              <strong>Dodaj akt prawny</strong>
              <small>
                Adres z ISAP (isap.sejm.gov.pl, np. WDU20250000383), ELI (DU/2025/383) albo „Dz.U. 2025 poz. 383”.
                Akt jest sprawdzany w Sejm ELI; do RAG trafia jego najnowszy tekst jednolity.
              </small>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!reference.trim()) return;
                  setFound(null);
                  void run("lookup", async () => {
                    setFound(await lookupCoreLawAct(reference.trim()));
                    return null;
                  });
                }}
              >
                <input
                  type="text"
                  value={reference}
                  aria-label="Akt prawny: adres ISAP, ELI albo Dz.U."
                  placeholder="https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU…"
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    setReference(event.target.value);
                    setFound(null);
                  }}
                />
                <button type="submit" disabled={Boolean(busy) || !reference.trim()}>
                  {busy === "lookup" ? "Sprawdzanie w ELI…" : "Sprawdź w ELI"}
                </button>
              </form>
              {found ? (
                <div className="core-law-found">
                  <strong>{found.act.title}</strong>
                  <small>
                    {found.act.type ?? "akt"} · {found.act.baseEli}
                    {found.act.status ? ` · ${found.act.status}` : ""}
                    {found.act.promulgation ? ` · ogłoszony ${day(found.act.promulgation)}` : ""}
                  </small>
                  <small>
                    {found.act.consolidated
                      ? `Do RAG: tekst jednolity ${found.act.currentEli}.`
                      : `Do RAG: tekst aktu ${found.act.currentEli} (brak tekstu jednolitego w ELI).`}
                    {found.act.inputEli !== found.act.currentEli && found.act.inputEli !== found.act.baseEli
                      ? ` Podano ${found.act.inputEli}; w ELI jest nowszy tekst jednolity.`
                      : ""}
                  </small>
                  {found.act.amendmentsAfter ? (
                    <small className="maintenance-trust-warning">
                      Nowelizacje po tym tekście: {found.act.amendmentsAfter}. Zostaną dodane do RAG jako osobne
                      dokumenty; do czasu nowego tekstu jednolitego przepisy tego aktu są weryfikowane bezpośrednio w ELI.
                    </small>
                  ) : null}
                  {found.presentAs ? (
                    <small>Ten akt jest już w kopii przepisów ({found.presentAs}).</small>
                  ) : (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() =>
                        void run("add", async () => {
                          const result = await addCoreLawAct(reference.trim());
                          setFound(null);
                          setReference("");
                          return result.status;
                        })
                      }
                    >
                      {busy === "add" ? "Dodawanie…" : "Dodaj do RAG"}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {userActs.length ? (
            <details className="core-law-list" open>
              <summary>Dodane przez użytkowników ({userActs.length})</summary>
              <ul>
                {userActs.map((act) => (
                  <li key={act.eli}>
                    <div>
                      <strong>{actName(act)}</strong> <small>{act.currentEli}</small>{" "}
                      <span className="security-pill">{STATE_LABEL[act.state]}</span>
                    </div>
                    <small>
                      dodał {act.addedBy ?? "—"} {day(act.addedAt)} · {act.articleCount} art.
                      {act.fetchedAt ? ` · pobrano ${day(act.fetchedAt)}` : " · pobieranie w toku"}
                    </small>
                    {admin ? (
                      <button
                        type="button"
                        className="danger-button"
                        disabled={disabled}
                        onClick={() => {
                          if (window.confirm(`Usunąć z kopii przepisów „${actName(act)}”?`)) {
                            void run(`remove:${act.eli}`, () => removeCoreLawAct(act.eli));
                          }
                        }}
                      >
                        Usuń z RAG
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <details className="core-law-list" open={groups.needsUpdate.length > 0 && groups.needsUpdate.length <= 10}>
            <summary>Wymagające aktualizacji ({groups.needsUpdate.length})</summary>
            {groups.needsUpdate.length ? (
              <ul>
                {groups.needsUpdate.map((act) => (
                  <li key={act.eli}>
                    <div>
                      <strong>{actName(act)}</strong> <small>{act.currentEli}</small>{" "}
                      <span className="security-pill">{STATE_LABEL[act.state]}</span>
                    </div>
                    {act.pendingConsolidated ? (
                      <small>
                        Nowszy tekst jednolity {act.pendingConsolidated.eli}
                        {act.pendingConsolidated.promulgation ? ` z ${day(act.pendingConsolidated.promulgation)}` : ""}{" "}
                        zastąpi tekst w RAG.
                      </small>
                    ) : null}
                    {act.pendingAmendments.map((amendment) => (
                      <small key={amendment.eli}>
                        Nowelizacja {amendment.eli}
                        {amendment.title ? ` „${amendment.title}”` : ""}
                        {amendment.promulgation ? ` z ${day(amendment.promulgation)}` : ""} zostanie dodana do RAG.
                      </small>
                    ))}
                    {act.lastError ? <small className="maintenance-error">Ostatni błąd: {act.lastError}</small> : null}
                    {act.state === "CHECK_DUE" ? (
                      <small>Ostatnie sprawdzenie w ELI: {day(act.relationsCheckedAt)}</small>
                    ) : null}
                    {admin ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void run(`act:${act.eli}`, () => applyCoreLawUpdates([act.eli]))}
                      >
                        {act.state === "UPDATE_AVAILABLE" ? "Zastosuj" : "Sprawdź i zaktualizuj"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <small>Brak.</small>
            )}
          </details>

          <details className="core-law-list">
            <summary>Aktualne ({groups.current.length})</summary>
            <ul>
              {groups.current.map((act) => (
                <li key={act.eli}>
                  <div>
                    <strong>{actName(act)}</strong> <small>{act.currentEli}</small>
                    {act.consolidated ? <span className="security-pill">t.j.</span> : null}
                  </div>
                  <small>
                    pobrano {day(act.fetchedAt)} · {act.articleCount} art.
                    {act.consolidated ? ` · sprawdzono w ELI ${day(act.relationsCheckedAt)}` : ""}
                  </small>
                  {act.amendmentsAfter.map((amendment) => (
                    <small key={amendment.eli}>
                      + nowelizacja {amendment.eli}
                      {amendment.title ? ` „${amendment.title}”` : ""} (osobny dokument w RAG)
                    </small>
                  ))}
                </li>
              ))}
            </ul>
          </details>

          {status.recent.length ? (
            <details className="core-law-list">
              <summary>Ostatnie zmiany w RAG ({status.recent.length})</summary>
              <ul>
                {status.recent.map((change) => (
                  <li key={`${change.at}:${change.eli}`}>
                    <small>
                      {day(change.at)} ·{" "}
                      {CHANGE_LABEL[change.kind]} {change.eli}
                      {change.title ? ` „${change.title}”` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}

      {error ? <p className="maintenance-error">{error}</p> : null}
    </section>
  );
}
