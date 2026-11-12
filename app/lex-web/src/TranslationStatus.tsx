import { useEffect, useState } from "react";
import { currentLocale, LOCALES, N_, t } from "./i18n";

type State = "całość" | "częściowo" | "wcale";
type Status = {
  languages: string[];
  totals: Record<string, Record<State, number>>;
  components: { component: string; translatable: number; notYetTranslatable: number; translated: Record<string, number>; state: Record<string, State> }[];
  areas: { area: string; state: Record<string, State>; otherLanguages: State; note: string }[];
};

const STATE_LABEL: Record<State, string> = { "całość": N_("w całości"), "częściowo": N_("częściowo"), "wcale": N_("wcale") };

/**
 * How far the interface and the other areas (installers, the model's answers) are translated into
 * the chosen language: generated from the code by scripts/i18n-status.mjs.
 */
export function TranslationStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [code, setCode] = useState(currentLocale());
  useEffect(() => {
    let active = true;
    void import("./locales/status.json").then((module) => {
      if (active) setStatus(module.default as Status);
    });
    return () => {
      active = false;
    };
  }, []);
  if (!status) return null;
  const totals = status.totals[code];
  return (
    <details className="translation-status">
      <summary>{t("Stan tłumaczeń")}</summary>
      <label>
        {t("Język")}
        <select value={code} onChange={(event) => setCode(event.target.value)}>
          {LOCALES.map((locale) => (
            <option key={locale.code} value={locale.code}>{locale.native}</option>
          ))}
        </select>
      </label>
      {totals ? (
        <p>
          {t("Elementy interfejsu: {done} w całości, {part} częściowo, {none} wcale.", {
            done: totals["całość"],
            part: totals["częściowo"],
            none: totals["wcale"]
          })}
        </p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th>{t("Obszar")}</th>
            <th>{t("Stan")}</th>
            <th>{t("Uwagi")}</th>
          </tr>
        </thead>
        <tbody>
          {status.areas.map((area) => (
            <tr key={area.area}>
              <td>{t(area.area)}</td>
              <td>{t(STATE_LABEL[area.state[code] ?? area.otherLanguages])}</td>
              <td>{t(area.note)}</td>
            </tr>
          ))}
          {status.components.map((item) => (
            <tr key={item.component}>
              <td>{item.component}</td>
              <td>{t(STATE_LABEL[item.state[code] ?? "wcale"])}</td>
              <td>
                {t("{done} z {all} tekstów przetłumaczonych; {left} do przygotowania", {
                  done: code === "pl" ? item.translatable : item.translated[code] ?? 0,
                  all: item.translatable,
                  left: item.notYetTranslatable
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
