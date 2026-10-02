import { useEffect, useState } from "react";
import {
  ApiError,
  clearInvoiceLogo,
  clearKsefToken,
  getInvoiceSettings,
  setInvoiceLogo,
  setInvoiceSeller,
  setKsefEnvironment,
  setKsefToken,
  type InvoiceParty,
  type InvoiceSettingsResponse
} from "./api.js";
import { emptyParty, invoiceErrorText } from "./invoice-form.js";
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
      <p className="eyebrow">Integracja</p>
      <h2>Faktury i KSeF</h2>
      <p className="field-help">
        Token KSeF, dane sprzedawcy i logo są zapisywane w pliku zaszyfrowanym Twoim kluczem konta.
        Token nie jest później wyświetlany ani wysyłany do przeglądarki.
      </p>

      {error ? <div className="alert alert-error">{error}</div> : null}
      {message ? <div className="alert">{message}</div> : null}

      <section>
        <h3>Token KSeF</h3>
        <p className="field-help">
          {ksef?.tokenConfigured
            ? `Token zapisany (${ksef.tokenHint ?? ""}${ksef.tokenSetAt ? `, ${new Date(ksef.tokenSetAt).toLocaleString("pl-PL")}` : ""}).`
            : "Brak tokenu. Bez niego faktury można wystawiać i drukować, ale nie wysyłać do KSeF."}
        </p>
        <div className="invoice-grid">
          <label>
            Token
            <input
              type="password"
              autoComplete="off"
              value={token}
              placeholder={ksef?.tokenConfigured ? "Wklej nowy token, aby zastąpić" : "Wklej token wygenerowany w KSeF"}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <label>
            NIP kontekstu (podmiotu w KSeF)
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
            Zapisz token
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
                }, "Token KSeF usunięty.")
              }
            >
              Usuń token
            </button>
          ) : null}
        </div>
      </section>

      <section>
        <h3>Środowisko KSeF</h3>
        <p className={ksef?.environment === "production" ? "alert alert-error" : "field-help"}>
          {ksef?.environment === "production"
            ? "Środowisko PRODUKCYJNE: wysyłki trafią do produkcyjnego systemu KSeF."
            : "Środowisko TESTOWE (domyślne): wysyłki trafią do testowego środowiska KSeF."}
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
              }, "Przełączono na środowisko testowe.")
            }
          >
            Wróć na środowisko testowe
          </button>
        ) : askProduction ? (
          <div className="invoice-confirm">
            <p>
              Aby przełączyć na produkcję, wpisz <strong>{PRODUCTION_PHRASE}</strong>. Każda wysyłka i tak
              będzie wymagać osobnego potwierdzenia.
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
                  }, "Przełączono na środowisko produkcyjne.")
                }
              >
                Przełącz na produkcję
              </button>
              <button type="button" className="chat-secondary-action" onClick={() => setAskProduction(false)}>
                Anuluj
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="chat-secondary-action" disabled={busy || !settings} onClick={() => setAskProduction(true)}>
            Przełącz na produkcję…
          </button>
        )}
      </section>

      <section>
        <h3>Dane sprzedawcy</h3>
        <p className="field-help">Wstawiane do każdej nowej faktury.</p>
        <div className="invoice-grid">
          <label>
            Nazwa
            <input value={seller.name} onChange={(event) => setSeller({ ...seller, name: event.target.value })} />
          </label>
          <label>
            NIP
            <input inputMode="numeric" value={seller.nip ?? ""} onChange={(event) => setSeller({ ...seller, nip: event.target.value })} />
          </label>
          <label className="invoice-wide">
            Adres
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
          Zapisz dane sprzedawcy
        </button>
      </section>

      <section>
        <h3>Logo na fakturze</h3>
        {settings?.logo ? (
          <img
            className="invoice-logo-preview"
            alt="Logo na fakturze"
            src={`data:${settings.logo.mediaType};base64,${settings.logo.base64}`}
          />
        ) : (
          <p className="field-help">Brak logo. PNG albo JPEG, najwyżej 512 KB.</p>
        )}
        <div className="chat-form-row">
          <label className="chat-secondary-action invoice-file-button">
            {settings?.logo ? "Zmień logo" : "Wgraj logo"}
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
                }, "Logo usunięte.")
              }
            >
              Usuń logo
            </button>
          ) : null}
        </div>
      </section>
    </article>
  );
}
