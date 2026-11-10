import { t } from "./i18n";
import { useState } from "react";
import type { KeyGrammar, PrivacyKeyEntry } from "./api.js";
import { caseLabel } from "./restoration-review.js";

export const KIND_LABEL: Record<string, string> = {
  PERSON: t("Osoba"),
  FIRM: t("Firma"),
  ADDRESS: t("Adres"),
  PESEL: "PESEL",
  NIP: "NIP",
  REGON: "REGON",
  IBAN: "Rachunek / IBAN",
  EMAIL: "E-mail",
  PHONE: t("Telefon"),
  ID_CARD: t("Dowód osobisty"),
  PASSPORT: t("Paszport"),
  BIRTH_DATE: t("Data urodzenia"),
  LAND_REGISTRY: t("Księga wieczysta"),
  KRS: "KRS",
  VEHICLE_PLATE: "Nr rejestracyjny",
  BAR_NUMBER: "Nr wpisu adwokata/radcy",
  PAYMENT_CARD: t("Karta płatnicza"),
  CUSTOM: t("Inne")
};

const GENDER_LABEL = { m: "mężczyzna", f: "kobieta", unknown: "nieustalona" } as const;

const GRAMMAR_LABEL: Record<KeyGrammar, string> = {
  m: t("osoba - mężczyzna"),
  f: "osoba - kobieta",
  "group-m": t("kilka osób (np. małżonkowie)"),
  "group-f": "kilka kobiet",
  organization: t("firma (nazwa z imieniem/nazwiskiem)")
};

function grammarOf(entry: PrivacyKeyEntry): KeyGrammar | "" {
  if (entry.entity === "organization") return "organization";
  if (entry.entity === "group") return entry.gender === "f" ? "group-f" : "group-m";
  return entry.gender === "m" ? "m" : entry.gender === "f" ? "f" : "";
}

function describeEntry(entry: PrivacyKeyEntry): string {
  if (entry.entity === "organization") return ` · firma${entry.legalForm ? ` (${entry.legalForm})` : ""}`;
  if (entry.entity === "group") return entry.gender === "f" ? " · kilka kobiet" : t(" · kilka osób");
  return entry.gender ? ` · ${GENDER_LABEL[entry.gender]}` : "";
}

/**
 * A document's anonymization key: what each placeholder stands for and the
 * case forms used to put it back. Values stay hidden until asked for; with
 * edit callbacks the user corrects forms or takes a value out of the
 * anonymization, and the anonymized version changes with it.
 */
export function PrivacyKeyTable(props: {
  entries: PrivacyKeyEntry[];
  highlight?: string | null;
  busy?: boolean;
  onRemove?: (entry: PrivacyKeyEntry) => void;
  onSaveForms?: (entry: PrivacyKeyEntry, forms: Record<string, string>) => void;
  // Sets what a person symbol is; the model's key and the restored forms follow.
  onSaveGrammar?: (entry: PrivacyKeyEntry, grammar: KeyGrammar) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const editable = Boolean(props.onRemove || props.onSaveForms || props.onSaveGrammar);

  return (
    <div className="privacy-key">
      <div className="privacy-key-bar">
        <small>
          {props.entries.length} {t("symboli · klucz widoczny tylko na tym komputerze, nigdy nie jest wysyłany do modeli")}
        </small>
        <button type="button" onClick={() => setVisible((value) => !value)}>
          {visible ? t("Ukryj dane") : t("Pokaż dane")}
        </button>
      </div>
      {props.entries.length === 0 ? (
        <p className="privacy-key-empty">{t("W tym dokumencie nie zanonimizowano żadnych danych.")}</p>
      ) : (
        <div className="privacy-key-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">{t("Symbol wysyłany do modelu")}</th>
                <th scope="col">{t("Rodzaj")}</th>
                <th scope="col">{t("Zastępuje")}</th>
                <th scope="col">{t("Odmiana (przypadek: forma)")}</th>
                <th scope="col">{t("Wystąpienia")}</th>
                {editable ? <th scope="col">{t("Zmiany")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {props.entries.map((entry) => (
                <tr key={entry.token} className={props.highlight === entry.token ? "privacy-key-highlight" : ""}>
                  <td><code>{entry.token}</code></td>
                  <td>
                    {KIND_LABEL[entry.kind] ?? entry.kind}
                    {describeEntry(entry)}
                    {entry.kind === "PERSON" && props.onSaveGrammar ? (
                      <select
                        aria-label={t("Kim jest {token}", { token: entry.token })}
                        title={t("Rodzaj i liczba trafiają do klucza dla modelu (uzgadnianie form) i zmieniają odmianę przy przywracaniu")}
                        disabled={props.busy}
                        value={grammarOf(entry)}
                        onChange={(event) => {
                          const next = event.target.value as KeyGrammar;
                          if (next) props.onSaveGrammar?.(entry, next);
                        }}
                      >
                        {grammarOf(entry) === "" ? <option value="">{t("nieustalona - wybierz")}</option> : null}
                        {(Object.keys(GRAMMAR_LABEL) as KeyGrammar[]).map((value) => (
                          <option key={value} value={value}>{GRAMMAR_LABEL[value]}</option>
                        ))}
                      </select>
                    ) : null}
                  </td>
                  <td>{visible ? entry.value : "••••••"}</td>
                  <td>
                    {editing === entry.token && entry.forms ? (
                      <div className="privacy-key-forms">
                        {entry.forms.map((form) => (
                          <label key={form.case}>
                            {caseLabel(form.case)}
                            <input
                              value={draft[form.case] ?? form.text}
                              onChange={(event) => setDraft({ ...draft, [form.case]: event.target.value })}
                            />
                          </label>
                        ))}
                      </div>
                    ) : entry.forms ? (
                      visible
                        ? entry.forms.map((form) => `${caseLabel(form.case)}: ${form.text}`).join(" · ")
                        : `${entry.forms.length} form`
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{entry.occurrences}</td>
                  {editable ? (
                    <td className="privacy-key-actions">
                      {editing === entry.token ? (
                        <>
                          <button
                            type="button"
                            disabled={props.busy}
                            onClick={() => {
                              props.onSaveForms?.(entry, draft);
                              setEditing(null);
                            }}
                          >
                            {t("Zapisz formy")}
                          </button>
                          <button type="button" onClick={() => setEditing(null)}>{t("Anuluj")}</button>
                        </>
                      ) : (
                        <>
                          {entry.forms && props.onSaveForms ? (
                            <button
                              type="button"
                              disabled={props.busy}
                              onClick={() => {
                                setVisible(true);
                                setDraft({});
                                setEditing(entry.token);
                              }}
                            >
                              {t("Popraw formy")}
                            </button>
                          ) : null}
                          {props.onRemove ? (
                            <button
                              type="button"
                              disabled={props.busy}
                              title={t("Przywraca wartość w tekście (osoba i adres w mianowniku) i usuwa symbol z klucza")}
                              onClick={() => props.onRemove?.(entry)}
                            >
                              {t("Usuń z anonimizacji")}
                            </button>
                          ) : null}
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
