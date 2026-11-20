import { t } from "./i18n";
import { useEffect, useId, useRef, useState } from "react";
import { ApiError, getLetterSender, listSharedTemplates, saveLetterLogo, saveLetterSender, type LetterSender, type SharedTemplateManifest } from "./api.js";
import { InfoTip } from "./InfoTip";

/**
 * Papier firmowy: who sends the letters. The name (a person's or a firm's), address and contact go
 * to every letter's file: its letterhead with the case's signature when the firm has no template,
 * the template's {{nadawca}} and {{adres nadawcy}} when it has one. Kept on this computer.
 */
export function LetterSenderSection() {
  const [sender, setSender] = useState<LetterSender>({ name: "", address: "", contact: "", templateId: "", logo: false });
  const [templates, setTemplates] = useState<SharedTemplateManifest[]>([]);
  const [saved, setSaved] = useState<LetterSender | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const headingId = useId();
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getLetterSender()
      .then((value) => {
        setSender(value);
        setSaved(value);
      })
      .catch((caught: unknown) => setError(caught instanceof ApiError ? caught.code : String(caught)));
    // DOCX files of the firm's templates (Wzory i wiedza) that can serve as the letterhead.
    void listSharedTemplates()
      .then((list) => setTemplates(list.templates.filter((item) => item.mediaType.includes("wordprocessingml"))))
      .catch(() => setTemplates([]));
  }, []);

  async function changeLogo(file: File | null): Promise<void> {
    setError("");
    try {
      const value = await saveLetterLogo(file);
      setSender((current) => ({ ...current, logo: value.logo }));
      setSaved((current) => (current ? { ...current, logo: value.logo } : current));
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : String(caught);
      setError(code === "LETTER_LOGO_TOO_LARGE" ? t("Logo może mieć najwyżej 1 MB.") : code === "LETTER_LOGO_TYPE_UNSUPPORTED" ? t("Logo musi być plikiem PNG albo JPEG.") : code);
    }
  }

  const changed = !saved || saved.name !== sender.name || saved.address !== sender.address || saved.contact !== sender.contact || saved.templateId !== sender.templateId;

  async function save(): Promise<void> {
    setError("");
    try {
      const value = await saveLetterSender(sender);
      setSender(value);
      setSaved(value);
      setMessage(t("Zapisano. Dane trafią do nagłówka każdego pisma."));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code : String(caught));
    }
  }

  return (
    <section className="account-security-panel letter-sender" aria-labelledby={headingId}>
      <h3 id={headingId}>
        {t("Papier firmowy: dane nadawcy")}
        <InfoTip>
          {t("Imię i nazwisko albo nazwa kancelarii, adres i dane kontaktowe trafiają do nagłówka każdego pisma, razem z sygnaturą sprawy z karty sprawy. Gdy kancelaria ma własny wzór papieru firmowego, wypełniają jego pola")} {"{{nadawca}}"} {t("i")} {"{{adres nadawcy}}"}.
        </InfoTip>
      </h3>
      {!sender.name ? <p className="field-help">{t("Uzupełnij nazwę nadawcy: bez niej pismo nie ma nagłówka z danymi uczestnika.")}</p> : null}
      <div className="account-security-grid">
      <div>
      <label>
        {t("Imię i nazwisko albo nazwa")}
        <input type="text" value={sender.name} maxLength={160} onChange={(event) => setSender({ ...sender, name: event.target.value })} />
      </label>
      <label>
        {t("Adres")}
        <textarea rows={3} value={sender.address} maxLength={300} placeholder={t("ulica i numer, kod pocztowy i miejscowość")} onChange={(event) => setSender({ ...sender, address: event.target.value })} />
      </label>
      <label>
        {t("Kontakt (opcjonalnie)")}
        <textarea rows={2} value={sender.contact} maxLength={200} placeholder={t("telefon, e-mail")} onChange={(event) => setSender({ ...sender, contact: event.target.value })} />
      </label>
      <div className="letter-sender-field">
        <span className="letter-sender-label">{t("Logo (PNG lub JPEG, do 1 MB)")}</span>
        <span className="letter-sender-logo">
          <span>{sender.logo ? t("Logo dodane") : t("Brak logo")}</span>
          <button type="button" className="secondary-button" onClick={() => logoInput.current?.click()}>
            {sender.logo ? t("Zmień logo") : t("Dodaj logo")}
          </button>
          <input
            ref={logoInput}
            type="file"
            hidden
            accept="image/png,image/jpeg"
            aria-label={t("Wybierz logo")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void changeLogo(file);
              event.target.value = "";
            }}
          />
          {sender.logo ? (
            <button type="button" className="secondary-button" onClick={() => void changeLogo(null)}>
              {t("Usuń logo")}
            </button>
          ) : null}
        </span>
      </div>
      <label>
        {t("Plik papieru firmowego z wzorów kancelarii (opcjonalnie)")}
        <select value={sender.templateId} onChange={(event) => setSender({ ...sender, templateId: event.target.value })}>
          <option value="">{t("Bez pliku: nagłówek z danych powyżej i logo")}</option>
          {templates.map((item) => (
            <option key={item.templateId} value={item.templateId}>
              {item.filename}
            </option>
          ))}
        </select>
        <small className="field-help">{t("Wybrany plik daje nagłówek i stopkę pisma, gdy przy piśmie nie wybrano innego wzoru. Numer strony jest dodawany, jeśli stopka go nie ma.")}</small>
      </label>
      </div>
      </div>
      <div className="letter-sender-actions">
        <button type="button" className="primary-button" disabled={!changed} onClick={() => void save()}>
          {t("Zapisz")}
        </button>
        {message && !changed ? <span className="field-help" role="status">{message}</span> : null}
      </div>
      {error ? <p className="chat-inline-error">{error}</p> : null}
    </section>
  );
}
