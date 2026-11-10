import { currentLocale, t } from "./i18n";
import { useEffect, useState } from "react";
import {
  ApiError,
  getWebSearchSettings,
  runWebSearchTest,
  setSearxngUrl,
  type SearchEngineName,
  type WebSearchSettings
} from "./api.js";
import { InfoTip } from "./InfoTip";
import { InlineEdit } from "./InlineEdit";
import { PencilIcon } from "./CaseAccessAdminPanel";

const SEARXNG_EXAMPLE = "http://localhost:8888";

const ENGINE_LABELS: Record<SearchEngineName, string> = {
  searxng: "SearXNG",
  duckduckgo: "DuckDuckGo"
};

function number(value: number): string {
  return value.toLocaleString(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function errorText(code: string | undefined): string {
  switch (code) {
    case "NOT_CONFIGURED":
      return t("brak adresu");
    case "RATE_LIMITED":
      return t("serwer odrzucił zapytania (limit)");
    case "BOT_CHECK":
      return t("serwer wymaga weryfikacji przeglądarki");
    case "JSON_FORMAT_DISABLED":
      return t("serwer nie udostępnia wyników w formacie JSON");
    default:
      return code ?? "";
  }
}

/**
 * Internet search (Ustawienia): the SearXNG address and a comparison test run from this computer.
 * The test scores every engine 0-10 and the search tool then asks them best first.
 */
export function WebSearchSection({ admin }: { admin: boolean }) {
  const [settings, setSettings] = useState<WebSearchSettings | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"" | "test" | "save">("");
  const [error, setError] = useState("");

  useEffect(() => {
    void getWebSearchSettings()
      .then(setSettings)
      .catch((failure) => setError(failure instanceof ApiError ? failure.code : String(failure)));
  }, []);

  async function saveUrl(next: string): Promise<boolean> {
    setBusy("save");
    try {
      setSettings(await setSearxngUrl(next));
      setEditing(false);
      setError("");
      return true;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function test(): Promise<void> {
    setBusy("test");
    try {
      setSettings(await runWebSearchTest());
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy("");
    }
  }

  if (!settings) return error ? <p className="field-error">{error}</p> : null;
  const order = settings.effectiveOrder.map((engine) => ENGINE_LABELS[engine]).join(" → ");
  return (
    <section className="core-law-updates web-search-settings">
      <div className="maintenance-heading">
        <div>
          <strong>
            {t("Wyszukiwarka internetowa")}
            <InfoTip>
              {t("Wyszukiwarka służy tylko do znajdowania tropów: każdy przepis i orzeczenie z wyników aplikacja sprawdza w źródle urzędowym (ELI, SN, NSA, SAOS). Test wysyła 8 pytań prawnych do każdej wyszukiwarki z tego komputera i ocenia je w skali 0–10: dostępność (3 pkt), źródła w pierwszej piątce (3 pkt: urzędowe w całości, darmowe artykuły i komentarze, także z serwisów komercyjnych, w 70%; płatne bazy za logowaniem się nie liczą), trafność (2 pkt), szybkość (2 pkt). Najlepsza jest pytana jako pierwsza.")}
            </InfoTip>
          </strong>
        </div>
        <span>{settings.providerForced ? t("ustawione w konfiguracji serwera: {value}", { value: settings.providerForced }) : order}</span>
      </div>

      <div className="web-search-url">
        <span>{t("Adres SearXNG:")}</span>
        {editing ? (
          <InlineEdit
            value={settings.searxngUrl}
            label={t("Adres SearXNG")}
            placeholder={SEARXNG_EXAMPLE}
            maxLength={300}
            onCancel={() => setEditing(false)}
            onSave={saveUrl}
          />
        ) : (
          <>
            <code>{settings.searxngUrl || t("nie ustawiono")}</code>
            {admin && !settings.searxngUrlForced ? (
              <button
                type="button"
                className="matter-title-pencil"
                title={t("Zmień adres SearXNG")}
                aria-label={t("Zmień adres SearXNG")}
                disabled={Boolean(busy)}
                onClick={() => setEditing(true)}
              >
                <PencilIcon />
              </button>
            ) : null}
            {admin && settings.searxngUrl && !settings.searxngUrlForced ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void saveUrl("")}>
                {t("Usuń adres")}
              </button>
            ) : null}
          </>
        )}
        <InfoTip>
          {t("Publiczne serwery SearXNG zwykle odrzucają zapytania aplikacji (limit, weryfikacja przeglądarki). Pewnie działa własny SearXNG na tym komputerze lub w kancelarii, z włączonym formatem JSON (search.formats: json w settings.yml).")}
        </InfoTip>
      </div>

      {settings.lastTest ? (
        <div className="web-search-scores">
          <small>{t("Wynik testu z {date}", { date: new Date(settings.lastTest.testedAt).toLocaleString(currentLocale()) })}</small>
          <ol>
            {settings.lastTest.scores.map((item) => (
              <li key={item.engine}>
                <span className="web-search-score-head">
                  <strong>{ENGINE_LABELS[item.engine]}</strong>
                  <strong>{number(item.score)}/10</strong>
                </span>
                <small>
                  {t("Odpowiedzi")}: {t("{answered} z {queries}", { answered: item.answered, queries: item.queries })}
                  {" · "}{t("Źródła urzędowe")}: {item.officialSources}%
                  {" · "}{t("Darmowe źródła")}: {item.freeSources ?? 0}%
                  {" · "}{t("Trafność")}: {item.relevance}%
                  {" · "}{t("Czas (mediana)")}: {item.medianMs === null ? "—" : t("{value} s", { value: number(item.medianMs / 1000) })}
                </small>
                {item.error && item.answered < item.queries ? <small className="web-search-score-error">{errorText(item.error)}</small> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <small>{t("Test nie był jeszcze uruchomiony.")}</small>
      )}

      {admin ? (
        <button type="button" disabled={Boolean(busy) || Boolean(settings.providerForced)} onClick={() => void test()}>
          {busy === "test" ? t("Testowanie wyszukiwarek… (do 2 minut)") : t("Uruchom test wyszukiwarek")}
        </button>
      ) : (
        <small>{t("Zmienia administrator.")}</small>
      )}
      {error ? <p className="field-error">{error}</p> : null}
    </section>
  );
}
