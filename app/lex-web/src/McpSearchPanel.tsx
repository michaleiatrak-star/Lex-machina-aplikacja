import {
  useEffect,
  useMemo,
  useState
} from "react";
import {
  ApiError,
  getMcpSearchSources,
  getMcpSourceDocument,
  searchMcpSource,
  type McpSearchSource
} from "./api.js";

type Json = Record<string, unknown>;

const TITLE_KEYS = ["tytul", "tytuł", "title", "nazwa", "name", "sygnatura", "teza", "celex"];
const ID_KEYS = ["doc_id", "id", "urn", "eli", "celex", "sygnatura", "numerKrs", "kolejka_id"];
const HIDDEN_KEYS = new Set(["_lexSourcePolicy"]);

// Podpowiedź pola zapytania: rejestry przyjmują identyfikator, reszta frazę.
const QUERY_HINT: Record<string, string> = {
  isap: "tytuł aktu albo fraza, np. kodeks wykroczeń",
  eurlex: "sygnatura (C-131/12), ECLI albo fraza",
  saos: "fraza, np. zadośćuczynienie za krzywdę",
  cbosa: "fraza, np. bezczynność organu",
  krs: "numer KRS (10 cyfr)",
  wl: "NIP (10 cyfr)",
  ceidg: "NIP (10 cyfr)",
  nbp: "kod waluty, np. EUR",
  eureka: "fraza, np. ulga na dzieci",
  sudop: "NIP beneficjenta",
  uodo: "fraza, np. monitoring wizyjny"
};

const ERRORS: Record<string, string> = {
  MCP_SEARCH_QUERY_REQUIRED: "Wpisz zapytanie.",
  UNKNOWN_MCP_SERVER: "Nieznane źródło.",
  LEX_MCP_SEARCH_UNAVAILABLE: "Wyszukiwarka MCP jest niedostępna w tym uruchomieniu aplikacji."
};

function failureText(error: unknown): string {
  const code =
    error instanceof ApiError
      ? error.code
      : error instanceof Error
        ? error.message
        : String(error);
  return ERRORS[code] ?? code;
}

function parse(content: string): unknown {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content;
  }
}

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Pierwsza lista obiektów w odpowiedzi (wyniki, kandydaci, firmy, orzeczenia...).
function findItems(value: unknown, depth = 0): Json[] | null {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isObject) ? value : null;
  }
  if (!isObject(value) || depth > 3) return null;
  for (const [key, item] of Object.entries(value)) {
    if (HIDDEN_KEYS.has(key)) continue;
    const found = findItems(item, depth + 1);
    if (found) return found;
  }
  return null;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function itemTitle(item: Json): string {
  for (const key of TITLE_KEYS) {
    const value = scalar(item[key]);
    if (value) return value.length > 220 ? value.slice(0, 220) + "…" : value;
  }
  return "Pozycja";
}

function itemFacts(item: Json): Array<[string, string]> {
  return Object.entries(item)
    .map(([key, value]) => [key, scalar(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]) && entry[1]!.length <= 80)
    .filter(([key]) => !TITLE_KEYS.includes(key))
    .slice(0, 5)
    .map(([key, value]) => [key, value]);
}

function itemId(item: Json): string | null {
  for (const key of ID_KEYS) {
    const value = scalar(item[key]);
    if (value) return value;
  }
  return null;
}

// Najdłuższy tekst w dokumencie (treść orzeczenia, przepisu, interpretacji).
function longestText(value: unknown, depth = 0): string | null {
  if (typeof value === "string") return value;
  if (depth > 4) return null;
  const children = Array.isArray(value)
    ? value
    : isObject(value)
      ? Object.entries(value).filter(([key]) => !HIDDEN_KEYS.has(key)).map(([, item]) => item)
      : [];
  let best: string | null = null;
  for (const child of children) {
    const candidate = longestText(child, depth + 1);
    if (candidate && (!best || candidate.length > best.length)) best = candidate;
  }
  return best;
}

function policyNote(payload: unknown): string | null {
  const policy = isObject(payload) ? payload._lexSourcePolicy : null;
  if (!isObject(policy)) return null;
  return `Poziom źródła ${String(policy.sourceTier ?? "?")} · wynik wyszukiwania, nie weryfikacja powołania`;
}

function statusProblem(payload: unknown): string | null {
  if (!isObject(payload)) return null;
  const status = scalar(payload.status);
  if (status === "SOURCE_UNAVAILABLE" || status === "POLICY_BLOCKED" || status === "ERROR") {
    return [scalar(payload.error), scalar(payload.detail), scalar(payload.instruction)]
      .filter(Boolean)
      .join(" · ") || status;
  }
  return null;
}

export function McpSearchPanel() {
  const [sources, setSources] = useState<McpSearchSource[] | null>(null);
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ source: string; payload: unknown } | null>(null);
  const [document, setDocument] = useState<{ id: string; payload: unknown } | null>(null);

  useEffect(() => {
    void getMcpSearchSources()
      .then((response) => {
        setSources(response.sources);
        setSource((current) => current || response.sources[0]?.id || "");
      })
      .catch((failure) => setError(failureText(failure)));
  }, []);

  const groups = useMemo(() => {
    const map = new Map<string, McpSearchSource[]>();
    for (const item of sources ?? []) {
      map.set(item.group, [...(map.get(item.group) ?? []), item]);
    }
    return [...map.entries()];
  }, [sources]);

  async function search(): Promise<void> {
    if (!source || !query.trim()) return;
    setBusy(true);
    setError("");
    setDocument(null);
    try {
      const response = await searchMcpSource({
        source,
        query: query.trim(),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {})
      });
      setResult({ source: response.source, payload: parse(response.content) });
    } catch (failure) {
      setError(failureText(failure));
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string): Promise<void> {
    if (!result) return;
    setBusy(true);
    setError("");
    try {
      const response = await getMcpSourceDocument(result.source, id);
      setDocument({ id, payload: parse(response.content) });
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  const items = result ? findItems(result.payload) : null;
  const problem = result ? statusProblem(result.payload) : null;
  const documentProblem = document ? statusProblem(document.payload) : null;
  const documentText = document ? longestText(document.payload) : null;

  return (
    <section className="chat-card-stack">
      <article className="chat-card">
        <p className="eyebrow">Źródła prawa · konektory MCP</p>
        <h2>Wyszukiwarka</h2>
        <p>
          Wyszukiwanie bezpośrednio w źródłach urzędowych przez zainstalowane konektory MCP Lex Machina. Nie wpisuj danych klienta ani faktów sprawy: zapytanie trafia do publicznego API źródła.
        </p>

        {error ? <div className="alert alert-error">{error}</div> : null}

        {sources && sources.length === 0 ? (
          <p className="field-help">
            Brak zainstalowanych konektorów. Administrator instaluje je w Ustawieniach → Konektory MCP.
          </p>
        ) : null}

        {sources && sources.length > 0 ? (
          <form
            className="mcp-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <label>
              Źródło
              <select
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setResult(null);
                  setDocument(null);
                }}
              >
                {groups.map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label>
              Zapytanie
              <input
                type="search"
                value={query}
                maxLength={300}
                placeholder={QUERY_HINT[source] ?? "fraza"}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="mcp-search-dates">
              <label>
                Od daty
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </label>
              <label>
                Do daty
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </label>
            </div>
            <div className="chat-form-row compact">
              <button type="submit" className="chat-primary-action" disabled={busy || !query.trim()}>
                {busy ? "Szukam…" : "Szukaj"}
              </button>
            </div>
          </form>
        ) : null}
      </article>

      {result ? (
        <article className="chat-card">
          <p className="eyebrow">{policyNote(result.payload) ?? "Wynik"}</p>
          {problem ? (
            <div className="alert alert-error">
              {problem}. Brak wyniku ze źródła nie oznacza, że materiału nie ma.
            </div>
          ) : items ? (
            <ul className="mcp-search-results">
              {items.map((item, index) => {
                const id = itemId(item);
                return (
                  <li key={id ?? index}>
                    <strong>{itemTitle(item)}</strong>
                    <dl>
                      {itemFacts(item).map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                    {id ? (
                      <button
                        type="button"
                        className="chat-secondary-action"
                        disabled={busy}
                        onClick={() => void open(id)}
                      >
                        Otwórz
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <pre className="mcp-search-raw">{longestText(result.payload) ?? ""}</pre>
          )}
          <details>
            <summary>Pełna odpowiedź źródła (JSON)</summary>
            <pre className="mcp-search-raw">{JSON.stringify(result.payload, null, 2)}</pre>
          </details>
        </article>
      ) : null}

      {document ? (
        <article className="chat-card">
          <p className="eyebrow">Dokument · {document.id}</p>
          {documentProblem ? (
            <div className="alert alert-error">{documentProblem}</div>
          ) : (
            <pre className="mcp-search-raw mcp-search-document">{documentText ?? ""}</pre>
          )}
          <details>
            <summary>Pełna odpowiedź źródła (JSON)</summary>
            <pre className="mcp-search-raw">{JSON.stringify(document.payload, null, 2)}</pre>
          </details>
        </article>
      ) : null}
    </section>
  );
}
