import { currentLocale, t, N_ } from "./i18n";
import { useEffect, useMemo, useState } from "react";
import { InfoTip } from "./InfoTip";
import { WOKANDA_STATUS_LABEL } from "./CaseCourtCard.js";
import { listWokandaCourts, recheckWokandaCourts, type WokandaCourtInfo, type WokandaStatus } from "./api.js";

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

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Courts of a status matching the search, by name. */
export function wokandaGroup(courts: readonly WokandaCourtInfo[], status: WokandaStatus, query: string): WokandaCourtInfo[] {
  const words = fold(query).split(/\s+/u).filter(Boolean);
  return courts
    .filter((court) => court.status === status && words.every((word) => fold(`${court.nazwa} ${court.domena}`).includes(word)))
    .sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl"));
}

/** Settings (developer mode): every common court's wokanda, by status, re-checked on request. */
export function WokandaRegisterPanel({ admin }: { admin: boolean }) {
  const [courts, setCourts] = useState<WokandaCourtInfo[]>([]);
  const [checkedAt, setCheckedAt] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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

  return (
    <section className="chat-card-stack">
      <article className="chat-card">
        <p className="eyebrow">
          {t("Wokandy sądów powszechnych")}
          <InfoTip>
            {t("Rejestr z wydania aplikacji (sprawdzony")} {checkedAt || "—"}{t("); „Sprawdź ponownie” sprawdza z tego komputera, jedno zapytanie na sąd. Strona, która blokuje jedną sieć, może odpowiadać innej.")}
          </InfoTip>
        </p>
        <h2>
          {courts.length} {t("sądów:")} {GROUPS.map((group) => `${t(group.title).toLowerCase()} ${counts[group.status] ?? 0}`).join(", ")}
        </h2>
        <div className="case-access-admin-search">
          <label>
            {t("Szukaj sądu")}
            <input type="search" value={query} placeholder={t("Nazwa sądu lub domena")} onChange={(event) => setQuery(event.target.value)} />
          </label>
          {admin ? (
            <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => void recheck()}>
              {busy === "all" ? t("Sprawdzanie wszystkich sądów…") : t("Sprawdź wszystkie ponownie")}
            </button>
          ) : null}
        </div>
        {error ? <div className="alert alert-error">{error}</div> : null}
      </article>
      {GROUPS.map((group) => {
        const rows = wokandaGroup(courts, group.status, query);
        return (
          <details key={group.status} className="chat-card wokanda-group" open={group.status !== "PORTAL" && Boolean(query)}>
            <summary>
              <strong>
                {t(group.title)} ({rows.length})
              </strong>
              <InfoTip>{t(group.help)}</InfoTip>
            </summary>
            <ul className="wokanda-courts">
              {rows.map((court) => (
                <li key={court.nazwa}>
                  <span>
                    <strong>{court.nazwa}</strong>
                    <small>
                      {[WOKANDA_STATUS_LABEL[court.status], court.system ? t(SYSTEM_LABEL[court.system]) : "", court.powod, court.zrodlo === "TEN_KOMPUTER" ? t("sprawdzono z tego komputera {time}", { time: court.sprawdzono ? new Date(court.sprawdzono).toLocaleString(currentLocale()) : "" }) : t("stan z wydania")]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <span className="case-court-actions">
                    {court.url ? (
                      <a href={court.url} target="_blank" rel="noreferrer">
                        {court.domena}
                      </a>
                    ) : (
                      <small>{court.domena}</small>
                    )}
                    {admin ? (
                      <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => void recheck([court.nazwa])}>
                        {busy === court.nazwa ? "Sprawdzanie…" : "Sprawdź"}
                      </button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        );
      })}
    </section>
  );
}
