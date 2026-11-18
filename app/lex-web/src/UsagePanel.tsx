import { useEffect, useState } from "react";
import { getMyUsage, type UsageMonth } from "./api.js";
import { currentLocale, t } from "./i18n";

const number = (value: number) => value.toLocaleString(currentLocale());
const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString(currentLocale(), { month: "long", year: "numeric" });

/**
 * Ustawienia > Zużycie (Patron's usage page): the tokens the account's conversations used, month by
 * month and per model. A model reached through an account (CLI client) reports no tokens: its
 * calls are shown as not metered.
 */
export function UsagePanel() {
  const [months, setMonths] = useState<UsageMonth[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    getMyUsage()
      .then((result) => {
        if (!cancelled) setMonths(result.months);
      })
      .catch((failure) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <article className="chat-card"><p className="chat-inline-error">{t("Nie udało się wczytać zużycia: {error}", { error })}</p></article>;
  if (!months) return <article className="chat-card"><p role="status">{t("Wczytywanie zużycia…")}</p></article>;
  const current = months[0];
  return (
    <article className="chat-card usage-panel">
      <p className="eyebrow">{t("Zużycie")}</p>
      <h3>{t("Tokeny modeli w Twoich rozmowach")}</h3>
      {current ? (
        <div className="usage-summary">
          <div>
            <small>{t("Ten miesiąc: odpowiedzi")}</small>
            <strong>{number(current.total.turns)}</strong>
          </div>
          <div>
            <small>{t("Tokeny wejścia")}</small>
            <strong>{number(current.total.inputTokens)}</strong>
          </div>
          <div>
            <small>{t("Tokeny wyjścia")}</small>
            <strong>{number(current.total.outputTokens)}</strong>
          </div>
          <div>
            <small>{t("Z pamięci podręcznej")}</small>
            <strong>{number(current.total.cacheReadTokens)}</strong>
          </div>
        </div>
      ) : null}
      <table className="lex-case-table usage-table">
        <thead>
          <tr>
            <th scope="col">{t("Miesiąc")}</th>
            <th scope="col">{t("Model")}</th>
            <th scope="col">{t("Odpowiedzi")}</th>
            <th scope="col">{t("Wejście")}</th>
            <th scope="col">{t("Wyjście")}</th>
          </tr>
        </thead>
        <tbody>
          {months.flatMap((month) =>
            month.models.length
              ? month.models.map((row, index) => (
                  <tr key={`${month.month}-${row.model}`}>
                    <td>{index === 0 ? monthLabel(month.month) : ""}</td>
                    <td>
                      {row.model}
                      {row.unmeteredCalls ? <small className="usage-unmetered"> · {t("bez licznika: {count}", { count: String(row.unmeteredCalls) })}</small> : null}
                    </td>
                    <td>{number(row.turns)}</td>
                    <td>{number(row.inputTokens)}</td>
                    <td>{number(row.outputTokens)}</td>
                  </tr>
                ))
              : [
                  <tr key={month.month}>
                    <td>{monthLabel(month.month)}</td>
                    <td colSpan={4}>
                      <small>{t("brak rozmów")}</small>
                    </td>
                  </tr>
                ]
          )}
        </tbody>
      </table>
      <p className="field-help">
        {t("Liczone od wersji 0.2.0, dla rozmów z modelem. Model połączony przez konto (np. ChatGPT, Claude przez logowanie) nie podaje liczby tokenów — jego wywołania są oznaczone „bez licznika”.")}
      </p>
    </article>
  );
}
