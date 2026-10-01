import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  applyCoreLawUpdates,
  checkCoreLawUpdates,
  getCoreLawStatus,
  setCoreLawAutoApply,
  type AuthenticatedUser,
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

  async function run(key: string, action: () => Promise<CoreLawStatus>) {
    setBusy(key);
    setError("");
    try {
      setStatus(await action());
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy("");
    }
  }

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
                      {change.kind === "CONSOLIDATED" ? "nowy tekst jednolity" : "dodana nowelizacja"} {change.eli}
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
