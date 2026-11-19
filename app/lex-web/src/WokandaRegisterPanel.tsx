import { currentLocale, t, N_ } from "./i18n";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { InfoTip } from "./InfoTip";
import { WOKANDA_STATUS_LABEL } from "./CaseCourtCard.js";
import { listWokandaCourts, recheckWokandaCourts, type WokandaCourtInfo, type WokandaStatus } from "./api.js";
import { WokandaVerification } from "./WokandaVerification.js";
import { ROUND_SIZE, WokandaBulkVerification } from "./WokandaBulkVerification.js";
import { desktopInvoke } from "./SnVerification.js";

const GROUPS: Array<{ status: WokandaStatus; title: string; help: string }> = [
  { status: "PORTAL", title: N_("Dostępne"), help: N_("Portal sądu z wyszukiwarką po sygnaturze: aplikacja odczytuje terminy sprawy na żądanie.") },
  { status: "BROWSER", title: N_("Brak dostępu dla aplikacji"), help: N_("Wokanda jest, ale otwiera ją tylko przeglądarka (weryfikacja przeglądarki, reCAPTCHA albo inny system). Aplikacja podaje jej adres.") },
  { status: "NONE", title: N_("Sąd nie ma wokandy na stronie"), help: N_("Strona sądu nie wskazuje wokandy.") },
  { status: "UNREACHABLE", title: N_("Strona sądu nie odpowiada"), help: N_("Brak połączenia albo błąd strony przy ostatnim sprawdzeniu.") }
];

const SYSTEM_LABEL: Record<NonNullable<WokandaCourtInfo["system"]>, string> = {
  MS_PORTAL: N_("portal sądów (wyszukiwarka po sygnaturze)"),
  CMS_FORM: N_("e-Wokanda BIP (formularz)"),
  GET_FORM: N_("wyszukiwarka po sygnaturze"),
  POST_FORM: N_("wyszukiwarka po sygnaturze"),
  DRUPAL_VIEW: N_("e-Wokanda okręgu (widok z filtrem sygnatury)"),
  LIST: N_("jedna lista bez wyszukiwarki")
};

/** A court whose wokanda a browser opens after its check (not another system): the user can pass it. */
export function needsVerification(court: WokandaCourtInfo): boolean {
  return court.status === "BROWSER" && /weryfikacja przeglądarki|blokuje zapytania/u.test(court.powod ?? "");
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Courts of a status (all with null) matching the search, by name. */
export function wokandaGroup(courts: readonly WokandaCourtInfo[], status: WokandaStatus | null, query: string): WokandaCourtInfo[] {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  return courts
    .filter((court) => (!status || court.status === status) && words.every((word) => fold(`${court.nazwa} ${court.domena}`).includes(word)))
    .sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl"));
}

/** Settings (developer mode): every common court's wokanda in one table, re-checked and verified on request. */
export function WokandaRegisterPanel({ admin }: { admin: boolean }) {
  const [courts, setCourts] = useState<WokandaCourtInfo[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<WokandaStatus | "">("BROWSER");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // One court's verification window (a modal), or the bulk verification of the chosen courts.
  const [verifying, setVerifying] = useState<WokandaCourtInfo | null>(null);
  const [bulk, setBulk] = useState<WokandaCourtInfo[] | null>(null);
  const titleId = useId();
  const desktop = Boolean(desktopInvoke());

  const load = () =>
    listWokandaCourts().then(
      (result) => {
        setCourts(result.courts);
        setCheckedAt(result.checkedAt);
      },
      (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure))
    );

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(() => Object.fromEntries(GROUPS.map((group) => [group.status, courts.filter((court) => court.status === group.status).length])), [courts]);
  const shown = useMemo(() => wokandaGroup(courts, status || null, query), [courts, status, query]);
  // The selection never holds a court the filters hide.
  useEffect(() => setSelected((current) => new Set(shown.filter((court) => current.has(court.nazwa)).map((court) => court.nazwa))), [shown]);
  const chosen = shown.filter((court) => selected.has(court.nazwa));
  const chosenVerifiable = chosen.filter(needsVerification);
  const rounds = Math.ceil(chosenVerifiable.length / ROUND_SIZE);
  const allBox = useRef<HTMLInputElement>(null);
  const allSelected = shown.length > 0 && chosen.length === shown.length;
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = chosen.length > 0 && !allSelected;
  }, [chosen.length, allSelected]);

  async function recheck(names?: string[]) {
    setBusy(names?.length === 1 ? names[0]! : "all");
    setError("");
    try {
      await recheckWokandaCourts(names);
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy("");
    }
  }

  const toggle = (name: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });

  return (
    <section className="chat-card case-list-page wokanda-register" aria-label={t("Wokandy sądów powszechnych")}>
      <p className="eyebrow">
        {t("Wokandy sądów powszechnych")}
        <InfoTip>
          {t("Rejestr z wydania aplikacji (sprawdzony")} {checkedAt ? new Date(checkedAt).toLocaleDateString(currentLocale()) : "—"}{t("); „Sprawdź ponownie” sprawdza z tego komputera, jedno zapytanie na sąd. Strona, która blokuje jedną sieć, może odpowiadać innej.")}
        </InfoTip>
      </p>
      <div className="case-list-filters">
        <label>
          <span>{t("Stan")}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as WokandaStatus | "")}>
            <option value="">{t("Wszystkie ({count})", { count: String(courts.length) })}</option>
            {GROUPS.map((group) => (
              <option key={group.status} value={group.status}>
                {t(group.title)} ({counts[group.status] ?? 0})
              </option>
            ))}
          </select>
        </label>
        {status ? <InfoTip>{t(GROUPS.find((group) => group.status === status)!.help)}</InfoTip> : null}
        <input type="search" value={query} placeholder={t("Nazwa sądu lub domena")} aria-label={t("Szukaj sądu")} onChange={(event) => setQuery(event.target.value)} />
        {admin ? (
          <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => void recheck()}>
            {busy === "all" ? t("Sprawdzanie wszystkich sądów…") : t("Sprawdź wszystkie ponownie")}
          </button>
        ) : null}
      </div>

      <div className="case-list-status">
        <small role="status">{t("Sądów: {count}", { count: String(shown.length) })}</small>
        {chosen.length ? (
          <div className="case-list-bulk">
            <small>{t("Zaznaczone: {count}", { count: String(chosen.length) })}</small>
            <button
              type="button"
              className="chat-secondary-action"
              disabled={Boolean(busy) || !chosenVerifiable.length || !desktop}
              title={
                !desktop
                  ? t("Weryfikacja w oknach sądów działa w aplikacji na komputerze.")
                  : chosenVerifiable.length
                    ? undefined
                    : t("Żaden z zaznaczonych sądów nie ma wokandy za weryfikacją przeglądarki.")
              }
              onClick={() => setBulk(chosenVerifiable)}
            >
              {t("Zweryfikuj w oknach sądów ({count}, tur: {rounds})", { count: String(chosenVerifiable.length), rounds: String(rounds) })}
            </button>
            {admin ? (
              <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => void recheck(chosen.map((court) => court.nazwa))}>
                {t("Sprawdź ponownie")}
              </button>
            ) : null}
            <button type="button" className="chat-link-button" onClick={() => setSelected(new Set())}>
              {t("Odznacz")}
            </button>
          </div>
        ) : null}
      </div>
      {error ? <p className="chat-inline-error">{error}</p> : null}

      {shown.length === 0 ? (
        <p>{t("Żaden sąd nie pasuje do filtrów.")}</p>
      ) : (
        <div className="case-list-scroll">
          <table className="lex-case-table wokanda-table">
            <thead>
              <tr>
                <th scope="col" className="case-list-check">
                  <input
                    ref={allBox}
                    type="checkbox"
                    aria-label={t("Zaznacz wszystkie widoczne")}
                    checked={allSelected}
                    onChange={(event) => setSelected(event.target.checked ? new Set(shown.map((court) => court.nazwa)) : new Set())}
                  />
                </th>
                <th scope="col">{t("Sąd")}</th>
                <th scope="col" className="wokanda-col-state">{t("Stan")}</th>
                <th scope="col" className="wokanda-col-site">{t("Strona")}</th>
                <th scope="col">
                  <span className="sr-only">{t("Działania")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((court) => (
                <tr key={court.nazwa} className="lex-case-row">
                  <td className="case-list-check">
                    <input
                      type="checkbox"
                      aria-label={t("Zaznacz sąd {value}", { value: court.nazwa })}
                      checked={selected.has(court.nazwa)}
                      onChange={(event) => toggle(court.nazwa, event.target.checked)}
                    />
                  </td>
                  <td>
                    <strong>{court.nazwa}</strong>
                    <small className="wokanda-mobile-state">{court.powod ?? WOKANDA_STATUS_LABEL[court.status]}</small>
                  </td>
                  <td className="wokanda-col-state">
                    <small title={court.powod}>
                      {[
                        // The status filter already names the status: only the details.
                        status ? "" : WOKANDA_STATUS_LABEL[court.status],
                        court.system ? t(SYSTEM_LABEL[court.system]) : "",
                        court.powod,
                        court.sesja ? t("sesja z weryfikacji zapisana") : "",
                        court.zrodlo === "TEN_KOMPUTER"
                          ? t("sprawdzono z tego komputera {time}", { time: court.sprawdzono ? new Date(court.sprawdzono).toLocaleString(currentLocale()) : "" })
                          : ""
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </td>
                  <td className="wokanda-col-site">
                    {court.url ? (
                      <a href={court.url} target="_blank" rel="noreferrer" title={court.url}>
                        {court.domena}
                      </a>
                    ) : (
                      <small>{court.domena}</small>
                    )}
                  </td>
                  <td className="wokanda-row-actions">
                    {needsVerification(court) ? (
                      <button type="button" className="chat-link-button" disabled={Boolean(busy)} onClick={() => setVerifying(court)}>
                        {t("Zweryfikuj")}
                      </button>
                    ) : null}
                    {admin ? (
                      <button type="button" className="chat-link-button" disabled={Boolean(busy)} onClick={() => void recheck([court.nazwa])}>
                        {busy === court.nazwa ? t("Sprawdzanie…") : t("Sprawdź")}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verifying ? (
        <div
          className="privacy-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => {
            if (event.target === event.currentTarget) setVerifying(null);
          }}
        >
          <section className="chat-card matter-section-dialog wokanda-bulk-dialog">
            <div className="case-collaboration-head">
              <h3 id={titleId}>{verifying.nazwa}</h3>
              <button type="button" className="chat-secondary-action" onClick={() => setVerifying(null)}>
                {t("Zamknij")}
              </button>
            </div>
            <WokandaVerification
              verification={{ domain: verifying.domena, url: verifying.url ?? `https://${verifying.domena}/wokanda`, savedSession: Boolean(verifying.sesja) }}
              onVerified={() => {
                const name = verifying.nazwa;
                setVerifying(null);
                void recheck([name]);
              }}
            />
          </section>
        </div>
      ) : null}
      {bulk ? (
        <WokandaBulkVerification
          courts={bulk}
          onRoundDone={async (verified) => {
            if (!verified.length) return;
            await recheckWokandaCourts(verified).catch(() => undefined);
            await load();
          }}
          onClose={() => {
            setBulk(null);
            setSelected(new Set());
            void load();
          }}
        />
      ) : null}
    </section>
  );
}
