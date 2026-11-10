import { t } from "./i18n";
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
  type CoreLawProgress,
  type CoreLawStatus
} from "./api.js";
import { InfoTip } from "./InfoTip";

const STATE_LABEL: Record<CoreLawActStatus["state"], string> = {
  CURRENT: "aktualny",
  UPDATE_AVAILABLE: t("jest aktualizacja"),
  CHECK_DUE: t("do sprawdzenia"),
  MISSING: "niepobrany",
  ERROR: t("błąd pobierania"),
  UNAVAILABLE: t("brak tekstu w ELI")
};

export function coreLawProgressText(progress: CoreLawProgress): string {
  switch (progress.phase) {
    case "download":
      return t("pobieranie PDF z ELI…");
    case "extract":
      return "odczyt tekstu PDF…";
    case "ocr":
      return `OCR skanu: ${progress.done}/${progress.total} stron`;
  }
}

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
  REMOVED: t("usunięty akt")
};

export function coreLawActErrorText(code: string): string {
  switch (code) {
    case "CORE_LAW_ACT_REFERENCE_INVALID":
      return t("Nie rozpoznano aktu. Podaj adres z ISAP (np. WDU20250000383), ELI (DU/2025/383) albo „Dz.U. 2025 poz. 383”.");
    case "CORE_LAW_ACT_NOT_FOUND":
      return t("Sejm ELI nie ma aktu o tym oznaczeniu.");
    case "CORE_LAW_ACT_NOT_IN_FORCE":
      return t("Według Sejm ELI akt nie obowiązuje; kopia przepisów zawiera tylko akty obowiązujące.");
    case "CORE_LAW_ACT_TEXT_UNAVAILABLE":
      return t("Sejm ELI nie udostępnia tekstu tego aktu (ani HTML, ani PDF).");
    case "CORE_LAW_ACT_SOURCE_UNAVAILABLE":
      return t("Sejm ELI jest niedostępne. Spróbuj ponownie za chwilę.");
    case "CORE_LAW_ACT_ALREADY_PRESENT":
      return t("Ten akt jest już w kopii przepisów.");
    case "CORE_LAW_USER_ACT_NOT_FOUND":
      return t("Akt nie jest na liście dodanych przez użytkowników.");
    default:
      return code;
  }
}

// Acts whose text in RAG is current, acts that need an update or check, and
// acts whose text ELI does not publish (nothing to update, not an error).
export function groupCoreLawActs(acts: CoreLawActStatus[]): {
  current: CoreLawActStatus[];
  needsUpdate: CoreLawActStatus[];
  unavailable: CoreLawActStatus[];
} {
  const current: CoreLawActStatus[] = [];
  const needsUpdate: CoreLawActStatus[] = [];
  const unavailable: CoreLawActStatus[] = [];
  for (const act of acts) {
    (act.state === "CURRENT" ? current : act.state === "UNAVAILABLE" ? unavailable : needsUpdate).push(act);
  }
  const order: CoreLawActStatus["state"][] = ["UPDATE_AVAILABLE", "ERROR", "MISSING", "CHECK_DUE", "CURRENT"];
  needsUpdate.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));
  return { current, needsUpdate, unavailable };
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
          <strong>
            {t("Przepisy prawne")}
            <InfoTip>
              {t("Kopia aktów z Dziennika Ustaw na tym komputerze. Nowszy tekst jednolity zastępuje tekst aktu w RAG, a nowelizacja ogłoszona po nim trafia do RAG jako osobny dokument.")}
            </InfoTip>
          </strong>
          <small>
            {t("ostatnie sprawdzenie:")} {day(status?.lastCheckAt)}
            {status?.refreshing ? t(" · sprawdzanie w toku…") : ""}
            {status?.progress ? ` · ${status.progress.eli}: ${coreLawProgressText(status.progress)}` : ""}
          </small>
        </div>
        <span>
          {!status
            ? "—"
            : status.refreshing
              ? "sprawdzanie…"
              : groups.needsUpdate.length
                ? t("do aktualizacji: {count}", { count: groups.needsUpdate.length })
                : "aktualne"}
        </span>
      </div>

      {status ? (
        <>
          <ul className="core-law-counts">
            <li>
              <strong>{status.counts.consolidated}</strong> {t("tekstów jednolitych")}
            </li>
            <li>
              <strong>{status.counts.amendments}</strong> {t("nowelizacji po t.j.")}
            </li>
            <li>
              <strong>{status.counts.other}</strong> {t("pozostałych aktów")}
            </li>
            <li>
              <strong>{status.counts.articles}</strong> {t("artykułów")}
            </li>
          </ul>

          {pendingTotal ? (
            <small className="maintenance-trust-warning">
              {t("Nowe w ELI, jeszcze niezastosowane:")} {status.pending.consolidated} {t("nowszych tekstów jednolitych,")}{" "}
              {status.pending.amendments} {t("nowelizacji. Do czasu zastosowania weryfikacja tych aktów korzysta bezpośrednio z ELI, nie z kopii.")}
            </small>
          ) : null}

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
                {t("Aktualizuj automatycznie (sprawdzenie raz dziennie)")}
              </label>
              <div className="maintenance-actions">
                <button type="button" disabled={disabled} onClick={() => void run("check", checkCoreLawUpdates)}>
                  {busy === "check" ? "Sprawdzanie…" : t("Sprawdź teraz")}
                </button>
                <button
                  type="button"
                  disabled={disabled || !pendingTotal}
                  onClick={() => void run("apply", () => applyCoreLawUpdates())}
                >
                  {t("Zastosuj wszystkie aktualizacje (")}{pendingTotal})
                </button>
              </div>
            </>
          ) : (
            <small>{t("Aktualizacje kopii przepisów uruchamia administrator.")}</small>
          )}

          {admin ? (
            <div className="core-law-add">
              <strong>
                {t("Dodaj akt prawny")}
                <InfoTip>
                  {t("Adres z ISAP (np. WDU20250000383), ELI (DU/2025/383) albo „Dz.U. 2025 poz. 383”. Do RAG trafia najnowszy tekst jednolity z Sejm ELI.")}
                </InfoTip>
              </strong>
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
                  aria-label={t("Akt prawny: adres ISAP, ELI albo Dz.U.")}
                  placeholder={t("https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU…")}
                  disabled={Boolean(busy)}
                  onChange={(event) => {
                    setReference(event.target.value);
                    setFound(null);
                  }}
                />
                <button type="submit" disabled={Boolean(busy) || !reference.trim()}>
                  {busy === "lookup" ? t("Sprawdzanie w ELI…") : t("Sprawdź w ELI")}
                </button>
              </form>
              {found ? (
                <div className="core-law-found">
                  <strong>{found.act.title}</strong>
                  <small>
                    {found.act.type ?? "akt"} · {found.act.baseEli}
                    {found.act.status ? ` · ${found.act.status}` : ""}
                    {found.act.promulgation ? t(" · ogłoszony {promulgation}", { promulgation: day(found.act.promulgation) }) : ""}
                  </small>
                  <small>
                    {found.act.consolidated
                      ? t("Do RAG: tekst jednolity {currentEli}.", { currentEli: found.act.currentEli })
                      : t("Do RAG: tekst aktu {currentEli} (brak tekstu jednolitego w ELI).", { currentEli: found.act.currentEli })}
                    {found.act.inputEli !== found.act.currentEli && found.act.inputEli !== found.act.baseEli
                      ? t(" Podano {inputEli}; w ELI jest nowszy tekst jednolity.", { inputEli: found.act.inputEli })
                      : ""}
                  </small>
                  {found.act.amendmentsAfter ? (
                    <small className="maintenance-trust-warning">
                      {t("Nowelizacje po tym tekście:")} {found.act.amendmentsAfter}{t(". Do czasu nowego tekstu jednolitego przepisy tego aktu są weryfikowane bezpośrednio w ELI.")}
                    </small>
                  ) : null}
                  {found.presentAs ? (
                    <small>{t("Ten akt jest już w kopii przepisów (")}{found.presentAs}).</small>
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
                      {busy === "add" ? "Dodawanie…" : t("Dodaj do RAG")}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {userActs.length ? (
            <details className="core-law-list" open>
              <summary>{t("Dodane przez użytkowników (")}{userActs.length})</summary>
              <ul>
                {userActs.map((act) => (
                  <li key={act.eli}>
                    <div>
                      <strong>{actName(act)}</strong> <small>{act.currentEli}</small>{" "}
                      <span className="security-pill">{STATE_LABEL[act.state]}</span>
                    </div>
                    <small>
                      {t("dodał")} {act.addedBy ?? "—"} {day(act.addedAt)} · {act.articleCount} {t("art.")}
                      {act.fetchedAt ? ` · pobrano ${day(act.fetchedAt)}` : t(" · pobieranie w toku")}
                    </small>
                    {admin ? (
                      <button
                        type="button"
                        className="danger-button"
                        disabled={disabled}
                        onClick={() => {
                          if (window.confirm(t("Usunąć z kopii przepisów „{act}”?", { act: actName(act) }))) {
                            void run(`remove:${act.eli}`, () => removeCoreLawAct(act.eli));
                          }
                        }}
                      >
                        {t("Usuń z RAG")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <details className="core-law-list" open={groups.needsUpdate.length > 0 && groups.needsUpdate.length <= 10}>
            <summary>{t("Wymagające aktualizacji (")}{groups.needsUpdate.length})</summary>
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
                        {t("Nowszy tekst jednolity")} {act.pendingConsolidated.eli}
                        {act.pendingConsolidated.promulgation ? t(" z {promulgation}", { promulgation: day(act.pendingConsolidated.promulgation) }) : ""}{" "}
                        {t("zastąpi tekst w RAG.")}
                      </small>
                    ) : null}
                    {act.pendingAmendments.map((amendment) => (
                      <small key={amendment.eli}>
                        {t("Nowelizacja")} {amendment.eli}
                        {amendment.title ? ` „${amendment.title}”` : ""}
                        {amendment.promulgation ? t(" z {promulgation}", { promulgation: day(amendment.promulgation) }) : ""} {t("zostanie dodana do RAG.")}
                      </small>
                    ))}
                    {status.progress?.eli === act.currentEli || status.progress?.eli === act.eli ? (
                      <small>{t("W toku:")} {coreLawProgressText(status.progress)}</small>
                    ) : act.lastError ? (
                      <small className="maintenance-error">{t("Ostatni błąd:")} {act.lastError}</small>
                    ) : null}
                    {act.state === "CHECK_DUE" ? (
                      <small>{t("Ostatnie sprawdzenie w ELI:")} {day(act.relationsCheckedAt)}</small>
                    ) : null}
                    {admin ? (
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => void run(`act:${act.eli}`, () => applyCoreLawUpdates([act.eli]))}
                      >
                        {act.state === "UPDATE_AVAILABLE" ? "Zastosuj" : t("Sprawdź i zaktualizuj")}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <small>{t("Brak.")}</small>
            )}
          </details>

          {groups.unavailable.length ? (
            <details className="core-law-list">
              <summary>
                {t("Bez tekstu w ELI (")}{groups.unavailable.length})
                <InfoTip>{t("Sejm ELI nie publikuje tekstu tych aktów, więc nie ma ich w lokalnej kopii. ELI jest sprawdzane ponownie raz na dobę.")}</InfoTip>
              </summary>
              <ul>
                {groups.unavailable.map((act) => (
                  <li key={act.eli}>
                    <div>
                      <strong>{actName(act)}</strong> <small>{act.currentEli}</small>{" "}
                      <span className="security-pill">{STATE_LABEL[act.state]}</span>
                    </div>
                    {act.unavailable ? <small>{act.unavailable}</small> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <details className="core-law-list">
            <summary>{t("Aktualne (")}{groups.current.length})</summary>
            <ul>
              {groups.current.map((act) => (
                <li key={act.eli}>
                  <div>
                    <strong>{actName(act)}</strong> <small>{act.currentEli}</small>
                    {act.consolidated ? <span className="security-pill">t.j.</span> : null}
                  </div>
                  <small>
                    {t("pobrano")} {day(act.fetchedAt)} · {act.articleCount} {t("art.")}
                    {act.consolidated ? t(" · sprawdzono w ELI {relationsCheckedAt}", { relationsCheckedAt: day(act.relationsCheckedAt) }) : ""}
                  </small>
                  {act.amendmentsAfter.map((amendment) => (
                    <small key={amendment.eli}>
                      {t("+ nowelizacja")} {amendment.eli}
                      {amendment.title ? ` „${amendment.title}”` : ""} {t("(osobny dokument w RAG)")}
                    </small>
                  ))}
                </li>
              ))}
            </ul>
          </details>

          {status.recent.length ? (
            <details className="core-law-list">
              <summary>{t("Ostatnie zmiany w RAG (")}{status.recent.length})</summary>
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
