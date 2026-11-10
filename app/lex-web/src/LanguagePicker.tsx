import { currentLocale, LOCALES, saveLocale, t } from "./i18n";

/**
 * The interface language: every jurisdiction's language, by its own name. The model answers in
 * it too. Changing it draws the window again in the new language.
 */
export function LanguagePicker({ onChange }: { onChange?: (code: string) => void }) {
  return (
    <label className="language-picker">
      {t("Język interfejsu i odpowiedzi")}
      <select
        value={currentLocale()}
        onChange={(event) => {
          saveLocale(event.target.value);
          if (onChange) onChange(event.target.value);
          else globalThis.location?.reload();
        }}
      >
        {LOCALES.map((locale) => (
          <option key={locale.code} value={locale.code} lang={locale.code}>
            {locale.native}
            {locale.code === "pl" ? "" : ` (${locale.polish})`}
          </option>
        ))}
      </select>
    </label>
  );
}
