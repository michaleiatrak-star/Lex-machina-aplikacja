import { currentLocale, t } from "./i18n";
import { InfoTip } from "./InfoTip";
import { useEffect, useState } from "react";
import {
  ApiError,
  clearInvoiceLogo,
  clearKsefToken,
  getInvoiceLegalBasis,
  getInvoiceSettings,
  setInvoiceDefaults,
  setInvoiceLogo,
  setInvoiceNumbering,
  setInvoiceSeller,
  setKsefEnvironment,
  setKsefToken,
  type InvoiceDefaults,
  type InvoiceParty,
  type InvoiceSettingsResponse,
  type NumberingSettings
} from "./api.js";
import { CompanyNipField } from "./CompanyNipField.js";
import {
  FACTORY_DEFAULTS,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  VAT_RATES,
  emptyParty,
  invoiceErrorText
} from "./invoice-form.js";
import "./invoices.css";

const PRODUCTION_PHRASE = "PRODUKCJA";

function failureText(error: unknown): string {
  return invoiceErrorText(
    error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error)
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

// Ustawienia → Faktury i KSeF: token KSeF (szyfrowany, nie wraca do przeglądarki),
// środowisko (domyślnie testowe), dane sprzedawcy i logo na fakturach.
export function InvoiceSettingsPanel() {
  const [settings, setSettings] = useState<InvoiceSettingsResponse | null>(null);
  const [token, setToken] = useState("");
  const [contextNip, setContextNip] = useState("");
  const [seller, setSeller] = useState<InvoiceParty>(emptyParty());
  const [defaults, setDefaults] = useState<InvoiceDefaults>(FACTORY_DEFAULTS);
  const [rateBasis, setRateBasis] = useState("");
  const [numbering, setNumbering] = useState<NumberingSettings>({ pattern: "FV {NR}/{MM}/{RRRR}", reset: "monthly", padding: 1 });
  const [productionPhrase, setProductionPhrase] = useState("");
  const [askProduction, setAskProduction] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void getInvoiceSettings()
      .then((next) => {
        setSettings(next);
        setContextNip(next.ksef.contextNip ?? "");
        if (next.seller) setSeller({ ...next.seller, nip: next.seller.nip ?? "" });
        if (next.defaults) setDefaults(next.defaults);
        if (next.numbering) setNumbering(next.numbering);
      })
      .catch((failure) => setError(failureText(failure)));
  }, []);

  async function run(action: () => Promise<void>, success: string): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setMessage(success);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  const ksef = settings?.ksef;

  return (
    <article className="chat-card invoice-settings">
      <p className="eyebrow">{t("Integracja")}</p>
      <h2>
        {t("Faktury i KSeF")}
        <InfoTip>{t("Token KSeF, dane sprzedawcy i logo są zaszyfrowane Twoim kluczem konta. Zapisanego tokenu nie widać już w przeglądarce.")}</InfoTip>
      </h2>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert">{message}</div> : null}

      <section>
        <h3>{t("KSeF")}</h3>
        <p className="alert" role="note">
          <strong>{t("Wysyłka do KSeF jest niedostępna w tej wersji.")}</strong> {t("Faktury wystawiasz i drukujesz w programie.")}
          <InfoTip>{t("Token ani środowisko KSeF nie są teraz potrzebne do pracy.")}</InfoTip>
        </p>
        <details className="ksef-later">
          <summary>{t("Ustawienia KSeF na czas, gdy wysyłka będzie dostępna")}</summary>
        <section>
          <h3>{t("Token KSeF")}</h3>
          <p className="field-help">
            {ksef?.tokenConfigured
              ? `Token zapisany (${ksef.tokenHint ?? ""}${ksef.tokenSetAt ? `, ${new Date(ksef.tokenSetAt).toLocaleString(currentLocale())}` : ""}).`
              : "Brak tokenu."}
          </p>
          <div className="invoice-grid">
            <label>
              {t("Token")}
              <input
                type="password"
                autoComplete="off"
                value={token}
                placeholder={ksef?.tokenConfigured ? t("Wklej nowy token, aby zastąpić") : t("Wklej token wygenerowany w KSeF")}
                onChange={(event) => setToken(event.target.value)}
              />
            </label>
            <label>
              {t("NIP kontekstu (podmiotu w KSeF)")}
              <input
                inputMode="numeric"
                value={contextNip}
                onChange={(event) => setContextNip(event.target.value)}
              />
            </label>
          </div>
          <div className="chat-form-row">
            <button
              type="button"
              className="chat-primary-action"
              disabled={busy || !token.trim()}
              onClick={() =>
                void run(async () => {
                  const next = await setKsefToken(token.trim(), contextNip.trim() || undefined);
                  setSettings((current) => (current ? { ...current, ksef: next.ksef } : current));
                  setToken("");
                }, "Token KSeF zapisany.")
              }
            >
              {t("Zapisz token")}
            </button>
            {ksef?.tokenConfigured ? (
              <button
                type="button"
                className="chat-secondary-action"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await clearKsefToken();
                    setSettings((current) => (current ? { ...current, ksef: next.ksef } : current));
                  }, t("Token KSeF usunięty."))
                }
              >
                {t("Usuń token")}
              </button>
            ) : null}
          </div>
        </section>

        <section>
          <h3>{t("Środowisko KSeF")}</h3>
          <p className={ksef?.environment === "production" ? "alert alert-error" : "field-help"}>
            {ksef?.environment === "production"
              ? t("Środowisko PRODUKCYJNE: gdy wysyłka zostanie udostępniona, faktury będą trafiać do produkcyjnego systemu KSeF.")
              : t("Środowisko TESTOWE (domyślne).")}
          </p>
          {ksef?.environment === "production" ? (
            <button
              type="button"
              className="chat-secondary-action"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await setKsefEnvironment("test");
                  setSettings((current) => (current ? { ...current, ksef: next.ksef } : current));
                }, t("Przełączono na środowisko testowe."))
              }
            >
              {t("Wróć na środowisko testowe")}
            </button>
          ) : askProduction ? (
            <div className="invoice-confirm">
              <p>
                {t("Aby przełączyć na produkcję, wpisz")} <strong>{PRODUCTION_PHRASE}</strong>{t(". Każda przyszła wysyłka będzie wymagać osobnego potwierdzenia.")}
              </p>
              <div className="chat-form-row">
                <input value={productionPhrase} onChange={(event) => setProductionPhrase(event.target.value)} />
                <button
                  type="button"
                  className="chat-primary-action"
                  disabled={busy || productionPhrase !== PRODUCTION_PHRASE}
                  onClick={() =>
                    void run(async () => {
                      const next = await setKsefEnvironment("production", true);
                      setSettings((current) => (current ? { ...current, ksef: next.ksef } : current));
                      setAskProduction(false);
                      setProductionPhrase("");
                    }, t("Przełączono na środowisko produkcyjne."))
                  }
                >
                  {t("Przełącz na produkcję")}
                </button>
                <button type="button" className="chat-secondary-action" onClick={() => setAskProduction(false)}>
                  {t("Anuluj")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="chat-secondary-action" disabled={busy || !settings} onClick={() => setAskProduction(true)}>
              {t("Przełącz na produkcję…")}
            </button>
          )}
        </section>
        </details>
      </section>

      <section>
        <h3>
          {t("Dane sprzedawcy")}
          <InfoTip>{t("Wstawiane do każdej nowej faktury.")}</InfoTip>
        </h3>
        <div className="invoice-grid">
          <label>
            {t("Nazwa")}
            <input value={seller.name} onChange={(event) => setSeller({ ...seller, name: event.target.value })} />
          </label>
          <CompanyNipField party={seller} onChange={setSeller} />
          <label className="invoice-wide">
            {t("Adres")}
            <input value={seller.address} onChange={(event) => setSeller({ ...seller, address: event.target.value })} />
          </label>
        </div>
        <button
          type="button"
          className="chat-primary-action"
          disabled={busy || !seller.name.trim() || !seller.address.trim()}
          onClick={() =>
            void run(async () => {
              const next = await setInvoiceSeller(seller);
              setSettings((current) => (current ? { ...current, seller: next.seller } : current));
            }, "Dane sprzedawcy zapisane.")
          }
        >
          {t("Zapisz dane sprzedawcy")}
        </button>
      </section>

      <section>
        <h3>
          {t("Domyślne na nowej fakturze")}
          <InfoTip>{t("Na fakturze każdą wartość można zmienić.")}</InfoTip>
        </h3>
        <p className="field-help">
          {settings?.defaults ? "Zapisane ustawienia." : "Ustawienia fabryczne (niezapisane)."}
        </p>
        <div className="invoice-grid">
          <label>
            {t("Sposób płatności")}
            <select
              value={defaults.paymentMethod}
              onChange={(event) => setDefaults({ ...defaults, paymentMethod: event.target.value as InvoiceDefaults["paymentMethod"] })}
            >
              {PAYMENT_METHODS.map(([method, label]) => <option key={method} value={method}>{label}</option>)}
            </select>
          </label>
          <label>
            {t("Termin płatności przelewu")}
            <select
              value={defaults.paymentTermDays}
              disabled={defaults.paymentMethod !== "przelew"}
              onChange={(event) => setDefaults({ ...defaults, paymentTermDays: Number(event.target.value) })}
            >
              {[...new Set([...PAYMENT_TERMS, defaults.paymentTermDays])].sort((a, b) => a - b).map((days) => (
                <option key={days} value={days}>{days} {t("dni od wystawienia")}</option>
              ))}
            </select>
          </label>
          <label>
            {t("Stawka VAT")}
            <select value={defaults.vatRate} onChange={(event) => setDefaults({ ...defaults, vatRate: event.target.value })}>
              {VAT_RATES.map(([rate, label]) => <option key={rate} value={rate}>{label}</option>)}
            </select>
          </label>
        </div>
        <div className="chat-form-row">
          <button
            type="button"
            className="chat-primary-action"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await setInvoiceDefaults(defaults);
                setSettings((current) => (current ? { ...current, defaults: next.defaults } : current));
              }, t("Ustawienia domyślne zapisane."))
            }
          >
            {t("Zapisz domyślne")}
          </button>
          <button
            type="button"
            className="chat-secondary-action"
            disabled={busy}
            title={t("Fragmenty aktualnego tekstu ustawy o VAT z wyszukiwania w Sejm ELI")}
            onClick={() =>
              void run(async () => {
                const basis = await getInvoiceLegalBasis("vat-rate");
                const result = basis.result as { tekst?: string; text?: string; fragmenty?: unknown };
                setRateBasis(
                  `Ustawa o VAT, ELI ${basis.eli}, wyszukiwanie „${basis.search}” (pobrano ${new Date(basis.retrievedAt).toLocaleString(currentLocale())})\n\n` +
                    (result.tekst ?? result.text ?? JSON.stringify(basis.result, null, 2))
                );
              }, "")
            }
          >
            {t("Sprawdź stawkę w ELI")}
          </button>
        </div>
        {rateBasis ? <pre className="invoice-legal-basis">{rateBasis}</pre> : null}
      </section>

      <section>
        <h3>
          {t("Autonumeracja")}
          <InfoTip>
            {t("Puste pole numeru dostaje kolejny numer. Znaczniki wzoru:")} {"{NR}"} {t("licznik,")} {"{DD}"} {t("dzień,")} {"{MM}"} {t("miesiąc,")} {"{RRRR}"} {t("albo")} {"{RR}"} {t("rok (z daty wystawienia).")}
          </InfoTip>
        </h3>
        <p className="field-help">
          {settings?.numbering
            ? t("Włączona: {pattern}.", { pattern: settings.numbering.pattern })
            : t("Wyłączona: numer wpisujesz ręcznie.")}
        </p>
        <div className="invoice-grid">
          <label>
            {t("Wzór numeru")}
            <input value={numbering.pattern} onChange={(event) => setNumbering({ ...numbering, pattern: event.target.value })} />
          </label>
          <label>
            {t("Licznik od nowa")}
            <select
              value={numbering.reset}
              onChange={(event) => setNumbering({ ...numbering, reset: event.target.value as NumberingSettings["reset"] })}
            >
              <option value="monthly">{t("co miesiąc")}</option>
              <option value="yearly">{t("co rok")}</option>
              <option value="never">{t("nigdy")}</option>
            </select>
          </label>
          <label>
            {t("Cyfry licznika (min.)")}
            <input
              type="number"
              min={1}
              max={8}
              value={numbering.padding}
              onChange={(event) => setNumbering({ ...numbering, padding: Number(event.target.value) || 1 })}
            />
          </label>
        </div>
        <div className="chat-form-row">
          <button
            type="button"
            className="chat-primary-action"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await setInvoiceNumbering(numbering);
                setSettings((current) => (current && next.numbering ? { ...current, numbering: next.numbering } : current));
              }, "Autonumeracja zapisana.")
            }
          >
            {t("Zapisz wzór")}
          </button>
          {settings?.numbering ? (
            <button
              type="button"
              className="chat-secondary-action"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await setInvoiceNumbering(null);
                  setSettings((current) => {
                    if (!current) return current;
                    const { numbering: _removed, ...rest } = current;
                    return rest;
                  });
                }, t("Autonumeracja wyłączona."))
              }
            >
              {t("Wyłącz autonumerację")}
            </button>
          ) : null}
        </div>
      </section>

      <section>
        <h3>{t("Logo na fakturze")}</h3>
        {settings?.logo ? (
          <img
            className="invoice-logo-preview"
            alt={t("Logo na fakturze")}
            src={`data:${settings.logo.mediaType};base64,${settings.logo.base64}`}
          />
        ) : (
          <p className="field-help">{t("Brak logo. PNG albo JPEG, najwyżej 512 KB.")}</p>
        )}
        <div className="chat-form-row">
          <label className="chat-secondary-action invoice-file-button">
            {settings?.logo ? t("Zmień logo") : t("Wgraj logo")}
            <input
              type="file"
              accept="image/png,image/jpeg"
              hidden
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void run(async () => {
                  const next = await setInvoiceLogo({
                    mediaType: file.type,
                    fileName: file.name,
                    base64: await readBase64(file)
                  });
                  setSettings((current) => (current ? { ...current, logo: next.logo } : current));
                }, "Logo zapisane.");
              }}
            />
          </label>
          {settings?.logo ? (
            <button
              type="button"
              className="chat-secondary-action"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await clearInvoiceLogo();
                  setSettings((current) => {
                    if (!current) return current;
                    const { logo: _removed, ...rest } = current;
                    return rest;
                  });
                }, t("Logo usunięte."))
              }
            >
              {t("Usuń logo")}
            </button>
          ) : null}
        </div>
      </section>
    </article>
  );
}
