import { useEffect, useState } from "react";
import {
  ApiError,
  clearSearchKey,
  getSearchKeyStatus,
  getWebSearchOrder,
  runWebSearchBenchmark,
  setGoogleSearchKey,
  setSearxngUrl,
  type SearchBenchmarkResult,
  type SearchKeyStatus,
  type SearchProviderId
} from "./api.js";
import { InfoTip } from "./InfoTip";
import { openExternalUrl } from "./SnVerification.js";

const NAMES: Record<SearchProviderId, string> = {
  searxng: "SearXNG (instancja kancelarii)",
  google: "Google (lista witryn)",
  brave: "Brave Search API",
  duckduckgo: "DuckDuckGo"
};

const ERRORS: Record<string, string> = {
  SEARXNG_URL_INVALID: "Podaj adres instancji SearXNG: https://… albo http:// tylko dla tego komputera lub sieci lokalnej.",
  SEARXNG_NO_RESULTS: "Instancja odpowiada, ale nie zwróciła wyników na zapytanie testowe.",
  GOOGLE_SEARCH_KEY_INVALID: "Nieprawidłowy klucz Google API albo identyfikator wyszukiwarki (cx)."
};

function errorText(error: unknown): string {
  const code = error instanceof ApiError ? error.code : error instanceof Error ? error.message : String(error);
  if (code.startsWith("SEARXNG_PROBE_FAILED:HTTP_403")) return "SearXNG odmówił formatu JSON. W settings.yml instancji dodaj json do search.formats.";
  if (code.startsWith("SEARXNG_PROBE_FAILED:HTTP_429")) return "SearXNG zablokował zapytanie aplikacji (limiter). We własnej instancji ustaw server.limiter: false albo dopuść adres tego komputera.";
  if (code.startsWith("SEARXNG_PROBE_FAILED:")) return `Nie udało się połączyć z instancją SearXNG (${code.slice(21)}).`;
  return ERRORS[code] ?? code;
}

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        event.preventDefault();
        void openExternalUrl(href);
      }}
    >
      {children}
    </a>
  );
}

// Ustawienia -> Integracje (administrator): wyszukiwarki narzędzia web_search wszystkich modeli
// (chmurowych i lokalnego w trybie online). Bez konfiguracji działa DuckDuckGo.
export function WebSearchKeysPanel() {
  const [searxng, setSearxng] = useState<SearchKeyStatus | null>(null);
  const [google, setGoogle] = useState<SearchKeyStatus | null>(null);
  const [order, setOrder] = useState<SearchProviderId[]>([]);
  const [url, setUrl] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [cx, setCx] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<SearchBenchmarkResult[] | null>(null);

  const refreshOrder = () => void getWebSearchOrder().then((value) => setOrder(value.available), () => undefined);

  useEffect(() => {
    void getSearchKeyStatus("searxng").then(setSearxng, (error) => setMessage(errorText(error)));
    void getSearchKeyStatus("google").then(setGoogle, () => undefined);
    refreshOrder();
  }, []);

  async function run(name: string, work: () => Promise<void>, done: string): Promise<void> {
    setBusy(name);
    setMessage("");
    try {
      await work();
      setMessage(done);
      refreshOrder();
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  const state = (status: SearchKeyStatus | null) =>
    !status ? "sprawdzam…" : status.fromEnvironment ? "ze zmiennej środowiskowej" : status.configured ? "skonfigurowano" : "nie skonfigurowano";

  return (
    <article className="chat-card">
      <p className="eyebrow">Wyszukiwanie w internecie</p>
      <h2>
        Wyszukiwarki dla modeli
        <InfoTip>
          Modele (chmurowe i lokalny w trybie online) szukają przez narzędzie aplikacji. Pytana jest najpierw wyszukiwarka z
          najlepszym wynikiem testu, a gdy odmówi, następna. Wynik wyszukiwarki to trop: orzeczenie lub przepis dostaje znacznik
          ostrzeżenia, dopóki nie potwierdzi go źródło urzędowe.
        </InfoTip>
      </h2>
      <p className="field-help">
        Kolejność teraz: {order.length ? order.map((id) => NAMES[id]).join(" → ") : "…"}
      </p>

      <section>
        <h3>SearXNG — cały internet, bez opłat</h3>
        <p className="field-help">
          Stan: {state(searxng)}
          {searxng?.url ? ` (${searxng.url})` : ""}. Własna instancja łączy wyniki m.in. Google, Startpage, Bing, DuckDuckGo i
          Mojeek. Publiczne instancje blokują programy, dlatego potrzebna jest własna (np. Docker na tym komputerze lub serwerze
          kancelarii) z json w search.formats.{" "}
          <Link href="https://docs.searxng.org/admin/installation-docker.html">Instalacja SearXNG</Link>
        </p>
        <label>
          Adres instancji
          <input type="url" autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:8888" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <div className="chat-form-row compact">
          <button
            type="button"
            className="chat-primary-action"
            disabled={Boolean(busy) || !url.trim()}
            onClick={() =>
              void run(
                "searxng",
                async () => {
                  setSearxng(await setSearxngUrl(url.trim()));
                  setUrl("");
                },
                "Instancja SearXNG odpowiada i została zapisana."
              )
            }
          >
            {busy === "searxng" ? "Sprawdzam…" : "Sprawdź i zapisz"}
          </button>
          <button
            type="button"
            className="chat-secondary-action"
            disabled={Boolean(busy) || !searxng?.configured || searxng.fromEnvironment}
            onClick={() => void run("searxng", async () => setSearxng(await clearSearchKey("searxng")), "Adres SearXNG usunięty.")}
          >
            Usuń
          </button>
        </div>
      </section>

      <section>
        <h3>Google Programmable Search — tylko wybrane witryny</h3>
        <p className="field-help">
          Stan: {state(google)}. Nowe wyszukiwarki Google obejmują do 50 wskazanych domen (np. sn.pl, orzeczenia.ms.gov.pl,
          orzeczenia.nsa.gov.pl), nie cały internet.{" "}
          <Link href="https://programmablesearchengine.google.com/controlpanel/create">Utwórz wyszukiwarkę</Link>
        </p>
        <label>
          Klucz Google API
          <input type="password" autoComplete="off" spellCheck={false} value={googleKey} onChange={(event) => setGoogleKey(event.target.value)} />
        </label>
        <label>
          Identyfikator wyszukiwarki (cx)
          <input type="text" autoComplete="off" spellCheck={false} value={cx} onChange={(event) => setCx(event.target.value)} />
        </label>
        <div className="chat-form-row compact">
          <button
            type="button"
            className="chat-primary-action"
            disabled={Boolean(busy) || !googleKey.trim() || !cx.trim()}
            onClick={() =>
              void run(
                "google",
                async () => {
                  setGoogle(await setGoogleSearchKey(googleKey.trim(), cx.trim()));
                  setGoogleKey("");
                  setCx("");
                },
                "Klucz Google zapisany."
              )
            }
          >
            Zapisz klucz
          </button>
          <button
            type="button"
            className="chat-secondary-action"
            disabled={Boolean(busy) || !google?.configured || google.fromEnvironment}
            onClick={() => void run("google", async () => setGoogle(await clearSearchKey("google")), "Klucz Google usunięty.")}
          >
            Usuń klucz
          </button>
        </div>
      </section>

      <section>
        <h3>
          Test porównawczy
          <InfoTip>
            Sześć pytań prawnych (przepisy, sygnatury SN i SA, orzecznictwo) w każdej dostępnej wyszukiwarce. Ocena 0–10 na
            pytanie: do 5 pkt za źródła urzędowe w pierwszych pięciu wynikach, 3 pkt gdy wyniki zawierają to, o co pytano, do 2
            pkt za czas. Odmowa lub blokada = 0.
          </InfoTip>
        </h3>
        <div className="chat-form-row compact">
          <button
            type="button"
            className="chat-primary-action"
            disabled={Boolean(busy)}
            onClick={() =>
              void run(
                "bench",
                async () => {
                  const value = await runWebSearchBenchmark(true);
                  setResults(value.results);
                },
                "Test zakończony. Kolejność ustawiona według wyniku."
              )
            }
          >
            {busy === "bench" ? "Testuję (do minuty)…" : "Uruchom test i ustaw kolejność"}
          </button>
        </div>
        {results ? (
          <table className="chat-table">
            <thead>
              <tr>
                <th>Wyszukiwarka</th>
                <th>Średnia</th>
                {results[0]?.questions.map((question) => <th key={question.id}>{question.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {results.map((row) => (
                <tr key={row.provider}>
                  <td>{NAMES[row.provider]}</td>
                  <td>
                    <strong>{row.score.toFixed(1)}</strong>
                  </td>
                  {row.questions.map((question) => (
                    <td key={question.id} title={question.error ?? (question.top ?? []).join("\n")}>
                      {question.score.toFixed(1)}
                      {question.error ? ` (${question.error === "BOT_CHECK" ? "blokada" : "błąd"})` : ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
      {message ? <p role="status">{message}</p> : null}
    </article>
  );
}
