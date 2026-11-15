import { currentLocale, t } from "./i18n";
import { useEffect, useId, useState } from "react";
import {
  ApiError,
  getWebSearchSettings,
  runWebSearchTest,
  setFirecrawlApiKey,
  setSearxngUrl,
  setStartpageSession,
  setStartpageSessionKeep,
  setupLocalSearxng,
  type LocalSearxngResult,
  type SearchEngineName,
  type WebSearchSettings
} from "./api.js";
import { InfoTip } from "./InfoTip";
import { InlineEdit } from "./InlineEdit";
import { PencilIcon } from "./CaseAccessAdminPanel";
import { LawSourceVerification } from "./LawSourceVerification.js";

// The Startpage window as the chat opens it (eli/law-source-sessions.ts): the user passes the check in it.
const STARTPAGE_VERIFICATION = { url: "https://www.startpage.com/sp/search?query=kodeks+karny&language=polski&lui=polski", host: "www.startpage.com", label: "Startpage" };

const SEARXNG_EXAMPLE = "http://localhost:8888";
const FIRECRAWL_EXAMPLE = "fc-…";

const ENGINE_LABELS: Record<SearchEngineName, string> = {
  startpage: "Startpage",
  gemini: "Gemini + Google",
  searxng: "SearXNG",
  duckduckgo: "DuckDuckGo",
  firecrawl: "Firecrawl"
};

function localSearxngText(result: LocalSearxngResult): string {
  if (result.reachable) return t("Lokalny SearXNG działa: {url}. Adres jest ustawiony.", { url: result.url });
  if (result.error === "CONTAINER_ENGINE_MISSING") {
    return t("Pliki SearXNG są gotowe w {directory}. Na tym komputerze nie ma Dockera ani Podmana. Kliknij „Zainstaluj Docker Desktop i uruchom SearXNG” albo zainstaluj Dockera samodzielnie i uruchom: {command}", {
      directory: result.directory,
      command: result.commands.join(" && ")
    });
  }
  if (result.error === "CONTAINER_ENGINE_NOT_RUNNING") {
    return t("Docker jest zainstalowany, ale nie działa (Docker Desktop nie jest uruchomiony i nie udało się go uruchomić). Uruchom Docker Desktop, poczekaj, aż będzie gotowy, i kliknij ponownie „Utwórz lokalny SearXNG na tym komputerze”. Jeśli Docker był przed chwilą instalowany, najpierw uruchom ponownie komputer. Pliki są w {directory}.", { directory: result.directory });
  }
  if (result.error === "INSTALLED_RESTART_NEEDED") return t("Docker Desktop został zainstalowany. Uruchom ponownie komputer, a potem kliknij „Utwórz lokalny SearXNG na tym komputerze”.");
  if (result.error?.startsWith("INSTALLER_MISSING:")) {
    const tool = result.error.slice("INSTALLER_MISSING:".length);
    return t("Nie można zainstalować Dockera automatycznie: brak instalatora pakietów ({tool}). Zainstaluj Docker Desktop ze strony docker.com i kliknij ponownie „Utwórz lokalny SearXNG na tym komputerze”.", { tool: tool === "linux" ? t("Linux: zainstaluj Dockera menedżerem pakietów systemu") : tool });
  }
  if (result.error?.startsWith("INSTALL_FAILED")) return t("Instalacja Docker Desktop nie powiodła się ({error}). Zainstaluj go ze strony docker.com i kliknij ponownie „Utwórz lokalny SearXNG na tym komputerze”.", { error: result.error.slice("INSTALL_FAILED: ".length) });
  if (result.error === "NOT_ANSWERING") {
    return t("SearXNG uruchomiony, ale jeszcze nie odpowiada. Spróbuj ponownie za chwilę (pierwsze uruchomienie pobiera obraz).");
  }
  return t("Nie udało się uruchomić SearXNG ({error}). Pliki są w {directory}; uruchom ręcznie: {command}", {
    error: result.error ?? "",
    directory: result.directory,
    command: result.commands.join(" && ")
  });
}

function number(value: number): string {
  return value.toLocaleString(currentLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function errorText(code: string | undefined, engine?: SearchEngineName): string {
  switch (code) {
    case "NOT_CONFIGURED":
      return engine === "searxng" ? t("brak adresu") : t("brak klucza");
    case "RATE_LIMITED":
      return t("serwer odrzucił zapytania (limit)");
    case "BOT_CHECK":
      return t("serwer wymaga weryfikacji przeglądarki");
    case "JSON_FORMAT_DISABLED":
      return t("serwer nie udostępnia wyników w formacie JSON");
    case "QUOTA_DAILY":
      return t("wyczerpany dzienny darmowy limit klucza Gemini (odnawia się następnego dnia)");
    case "QUOTA_ZERO":
      return t("klucz Gemini nie ma darmowego limitu dla wyszukiwania Google; włącz płatności dla projektu w Google AI Studio");
    case "CREDITS_EXHAUSTED":
      return t("wyczerpany miesięczny limit planu darmowego");
    case "KEY_REJECTED":
      return t("klucz odrzucony");
    case "LAW_SOURCE_VERIFICATION_REQUIRED:www.startpage.com":
      return t("potrzebne potwierdzenie w oknie Startpage (przycisk wyżej albo w czacie)");
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
  const [editingKey, setEditingKey] = useState(false);
  const [busy, setBusy] = useState<"" | "test" | "save" | "searxng" | "docker">("");
  const [error, setError] = useState("");
  const [localMessage, setLocalMessage] = useState("");
  const [engineMissing, setEngineMissing] = useState(false);
  const [open, setOpen] = useState(false);
  const [startpageWindow, setStartpageWindow] = useState(false);
  const [startpageMessage, setStartpageMessage] = useState("");
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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

  async function saveKey(next: string): Promise<boolean> {
    setBusy("save");
    try {
      setSettings(await setFirecrawlApiKey(next));
      setEditingKey(false);
      setError("");
      return true;
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function saveStartpage(change: () => Promise<WebSearchSettings>): Promise<void> {
    setBusy("save");
    try {
      setSettings(await change());
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
    } finally {
      setBusy("");
    }
  }

  async function createLocalSearxng(install = false): Promise<void> {
    setBusy(install ? "docker" : "searxng");
    setLocalMessage("");
    try {
      const reply = await setupLocalSearxng(install);
      setEngineMissing(reply.local.error === "CONTAINER_ENGINE_MISSING");
      setSettings(reply.settings);
      setLocalMessage(localSearxngText(reply.local));
      setError("");
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.code : String(failure));
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
  const summary = settings.providerForced ? t("ustawione w konfiguracji serwera: {value}", { value: settings.providerForced }) : order;
  const best = settings.lastTest?.scores[0];
  return (
    <section className="core-law-updates">
      <div className="chat-card matter-compact-row">
        <span className="matter-compact-heading">
          <strong>
            {t("Wyszukiwarka internetowa")}
            <InfoTip>
              {t("Wyszukiwarka służy tylko do znajdowania tropów: każdy przepis i orzeczenie z wyników aplikacja sprawdza w źródle urzędowym (ELI, SN, NSA, SAOS). Test wysyła 8 pytań prawnych do każdej wyszukiwarki z tego komputera i ocenia je w skali 0–10: dostępność (3 pkt), źródła w pierwszej piątce (3 pkt: urzędowe w całości, darmowe artykuły i komentarze, także z serwisów komercyjnych, w 70%; płatne bazy za logowaniem się nie liczą), trafność (2 pkt), szybkość (2 pkt). Najlepsza jest pytana jako pierwsza.")}
            </InfoTip>
          </strong>
          <span className="matter-compact-count has-entries">
            {summary}
            {best ? ` · ${t("najlepsza w teście: {name} {score}/10", { name: ENGINE_LABELS[best.engine], score: number(best.score) })}` : ""}
          </span>
        </span>
        <span className="matter-compact-actions">
          <button type="button" className="chat-secondary-action" onClick={() => setOpen(true)}>
            {t("Pokaż")}
          </button>
        </span>
        {error && !open ? <p className="chat-error matter-compact-error">{error}</p> : null}
      </div>
      {open ? (
        <div
          className="privacy-preview-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="chat-card matter-section-dialog web-search-settings">
            <div className="matter-section-dialog-head">
              <div>
                <p className="eyebrow">{t("Ustawienia")}</p>
                <h2 id={titleId}>{t("Wyszukiwarka internetowa")}</h2>
                <small>{summary}</small>
              </div>
              <button type="button" className="chat-secondary-action" onClick={() => setOpen(false)}>
                {t("Zamknij")}
              </button>
            </div>
      <small>{t("Gemini + Google: wyszukiwanie Google przez Twój klucz Google z ustawień modeli; ponad darmowy limit płatne według cennika Google.")}</small>

      <label className="core-law-auto">
        <input
          type="checkbox"
          checked={settings.startpageSession}
          disabled={!admin || Boolean(busy)}
          onChange={(event) => void saveStartpage(() => setStartpageSession(event.target.checked))}
        />
        <span>{t("Startpage na Twojej sesji (pierwsza wyszukiwarka)")}</span>
        <InfoTip>
          {t("Wyszukiwanie idzie przez startpage.com (wyniki Google) z sesji okna aplikacji, jak przy sn.pl. Przy pierwszym wyszukiwaniu i gdy Startpage znów poprosi o weryfikację, w czacie pojawi się przycisk otwierający okno Startpage: weryfikację przechodzisz Ty, okno zamyka się samo, a pytanie ponawia się z wynikami. Do tego czasu wyniki daje następna wyszukiwarka. Działa w aplikacji na tym komputerze, nie w trybie serwerowym. Regulamin Startpage może zakazywać zapytań automatycznych: włączasz to na własną odpowiedzialność.")}
        </InfoTip>
      </label>
      {settings.startpageSession ? (
        <div className="web-search-session-window">
          <span>
            {settings.startpageSessionActive ? t("Sesja Startpage aktywna.") : t("Brak sesji Startpage: potwierdź w oknie Startpage, zanim wyszukiwarka zostanie użyta.")}
          </span>
          {startpageWindow ? (
            <LawSourceVerification
              verification={STARTPAGE_VERIFICATION}
              autoStart={false}
              onVerified={() => {
                setStartpageWindow(false);
                setStartpageMessage(t("Potwierdzone w oknie Startpage — sesja aktywna."));
                void getWebSearchSettings().then(setSettings).catch(() => undefined);
              }}
            />
          ) : (
            <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => { setStartpageMessage(""); setStartpageWindow(true); }}>
              {settings.startpageSessionActive ? t("Odnów sesję w oknie Startpage") : t("Potwierdź w oknie Startpage")}
            </button>
          )}
          {startpageMessage ? <small>{startpageMessage}</small> : null}
        </div>
      ) : null}
      {settings.startpageSession ? (
        <label className="core-law-auto web-search-keep">
          <input
            type="checkbox"
            checked={settings.startpageSessionKeep}
            disabled={!admin || Boolean(busy)}
            onChange={(event) => void saveStartpage(() => setStartpageSessionKeep(event.target.checked))}
          />
          <span>
            {t("Pamiętaj sesję po ponownym uruchomieniu")}
            {settings.startpageSessionKeep ? (
              <small> · {settings.startpageSessionSaved ? t("sesja zapisana") : t("zapisze się po najbliższym potwierdzeniu w oknie Startpage")}</small>
            ) : null}
          </span>
          <InfoTip>
            {t("Bez tej opcji sesja Startpage trwa do 6 godzin i znika przy zamknięciu aplikacji. Z nią ciasteczka okna Startpage są zapisane zaszyfrowane na tym komputerze (najwyżej 30 dni) i okno nie pojawia się po każdym uruchomieniu. Gdy Startpage znów poprosi o weryfikację, zapis jest usuwany, a okno wraca. Wyłączenie opcji usuwa zapisaną sesję.")}
          </InfoTip>
        </label>
      ) : null}

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
      {admin && !settings.searxngUrlForced ? (
        <div className="web-search-local">
          <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => void createLocalSearxng()}>
            {busy === "searxng" ? t("Tworzenie lokalnego SearXNG… (pierwsze uruchomienie do kilku minut)") : t("Utwórz lokalny SearXNG na tym komputerze")}
          </button>
          <InfoTip>
            {t("Aplikacja zapisuje konfigurację SearXNG (format JSON włączony, tylko adres 127.0.0.1) i uruchamia ją w Dockerze albo Podmanie, jeśli są zainstalowane. Gdy wyszukiwarka odpowie, adres ustawia się sam. Bez Dockera i Podmana dostajesz gotowe pliki i polecenie do uruchomienia.")}
          </InfoTip>
          {localMessage ? <small>{localMessage}</small> : null}
          {engineMissing ? (
            <>
              <button type="button" className="chat-secondary-action" disabled={Boolean(busy)} onClick={() => void createLocalSearxng(true)}>
                {busy === "docker" ? t("Instalowanie Docker Desktop… (do kilkudziesięciu minut; system poprosi o zgodę administratora)") : t("Zainstaluj Docker Desktop i uruchom SearXNG")}
              </button>
              <InfoTip>{t("Instalacja: Windows przez winget, macOS przez Homebrew; system poprosi o zgodę administratora, a po instalacji może być potrzebne ponowne uruchomienie komputera. Docker Desktop jest bezpłatny dla małych firm (do 250 pracowników i do 10 mln USD rocznego przychodu); większa kancelaria potrzebuje płatnej subskrypcji Docker.")}</InfoTip>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="web-search-url">
        <span>{t("Klucz Firecrawl:")}</span>
        {editingKey ? (
          <InlineEdit
            value=""
            label={t("Klucz Firecrawl")}
            placeholder={FIRECRAWL_EXAMPLE}
            maxLength={220}
            onCancel={() => setEditingKey(false)}
            onSave={saveKey}
          />
        ) : (
          <>
            <code>{settings.firecrawlConfigured ? t("zapisany (zaszyfrowany)") : t("nie ustawiono")}</code>
            {admin && !settings.firecrawlKeyForced ? (
              <button
                type="button"
                className="matter-title-pencil"
                title={t("Zmień klucz Firecrawl")}
                aria-label={t("Zmień klucz Firecrawl")}
                disabled={Boolean(busy)}
                onClick={() => setEditingKey(true)}
              >
                <PencilIcon />
              </button>
            ) : null}
            {admin && settings.firecrawlConfigured && !settings.firecrawlKeyForced ? (
              <button type="button" disabled={Boolean(busy)} onClick={() => void saveKey("")}>
                {t("Usuń klucz")}
              </button>
            ) : null}
          </>
        )}
        <InfoTip>
          {t("Firecrawl to płatna usługa z planem darmowym (1000 kredytów miesięcznie, wyszukiwanie: 2 kredyty za 10 wyników, ok. 500 wyszukiwań). Klucz zakładasz na firecrawl.dev; aplikacja przechowuje go zaszyfrowany i wysyła tylko ogólne frazy, nigdy dane sprawy. Po wyczerpaniu limitu aplikacja korzysta z kolejnej wyszukiwarki.")}
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
                {item.error && item.answered < item.queries ? <small className="web-search-score-error">{errorText(item.error, item.engine)}</small> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <small>{t("Test nie był jeszcze uruchomiony.")}</small>
      )}

      {admin ? (
        <button type="button" className="chat-secondary-action" disabled={Boolean(busy) || Boolean(settings.providerForced)} onClick={() => void test()}>
          {busy === "test" ? t("Testowanie wyszukiwarek… (do 2 minut)") : t("Uruchom test wyszukiwarek")}
        </button>
      ) : (
        <small>{t("Zmienia administrator.")}</small>
      )}
      {error ? <p className="field-error">{error}</p> : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
