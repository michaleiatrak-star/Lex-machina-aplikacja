import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  ApiError,
  getMcpSearchSources,
  getMcpSearchTools,
  queryMcpSearch,
  type McpPackageInfo,
  type McpSearchQueryResponse,
  type McpSearchSource,
  type McpSearchTool,
  type McpToolInputProperty
} from "./api.js";
import { fieldLabel, orderFields, orderTools, sourceHasPhraseSearch, toolLabel } from "./mcp-search-labels.js";
import { SourcePreviewFrame } from "./SourcePreviewFrame.js";
import { SnVerification, openExternalUrl } from "./SnVerification.js";
import {
  appendDocument,
  nextPageArgs,
  readSearchResult,
  type SearchDocument,
  type SearchItem,
  type SearchPage,
  type SourcePreviewTarget
} from "./mcp-search-results.js";

// SUDOP przyjmuje zlecenie do kolejki (około minuty); każde odebranie czeka do 50 s po stronie
// źródła. Najwyżej tyle prób, zanim użytkownik dostanie przycisk ponownego odbioru.
const PENDING_ATTEMPTS = 6;
const PENDING_PAUSE_MS = 10_000;

function previewKey(target: SourcePreviewTarget): string {
  return target.kind === "url" ? target.url : target.key;
}

type FieldValue = string | boolean;

const ERRORS: Record<string, string> = {
  MCP_SOURCE_UNAVAILABLE: "Źródło nie odpowiada albo nie jest zainstalowane — to niedostępność źródła, nie brak danych.",
  MCP_ARGUMENTS_INVALID: "Nieprawidłowe parametry zapytania.",
  UNKNOWN_MCP_SERVER: "Nieznane źródło MCP."
};

const STATUS_TEXT: Record<string, string> = {
  FOUND: "Znaleziono",
  NOT_FOUND: "Brak w źródle",
  AMBIGUOUS: "Niejednoznaczne — zawęź zapytanie",
  OUT_OF_SCOPE: "OUT_OF_SCOPE — poza zakresem źródła, nie dowód braku",
  ERROR: "Błąd źródła",
  PENDING: "Zlecenie w kolejce źródła — wynik w przygotowaniu",
  SOURCE_UNAVAILABLE: "Źródło niedostępne — nie wnioskuj o braku",
  POLICY_BLOCKED: "Zablokowane przez politykę źródeł",
  OK: "OK"
};

export const INTEGRITY_TEXT: Record<McpPackageInfo["integrity"], string> = {
  MATCH: "zgodny z sumą kontrolną skilla (najnowsza instalacja)",
  MISMATCH: "NIEZGODNY z sumą kontrolną skilla — zaktualizuj skille",
  UNVERIFIED: "brak sumy kontrolnej w skillu — nie da się potwierdzić wersji",
  MISSING: "brak pakietu serwerów MCP"
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

// Wynik wyszukiwania złożony z kolejnych stron; surowe odpowiedzi tylko w danych technicznych.
type ResultView = {
  source: string;
  tool: string;
  ok: boolean;
  status: string | null;
  total: number | null;
  notice: string | null;
  items: SearchItem[];
  document: SearchDocument | null;
  documentArgs: Record<string, unknown>;
  next: Record<string, unknown> | null;
  raw: unknown[];
  pending: SearchPage["pending"];
  verification: SearchPage["verification"];
};

type DetailState = {
  busy: boolean;
  error?: string;
  document?: SearchDocument | null;
  args?: Record<string, unknown>;
  tool?: string;
};

function DocumentView({
  document,
  busy,
  onMore
}: {
  document: SearchDocument;
  busy: boolean;
  onMore: (() => void) | null;
}) {
  return (
    <div className="mcp-search-document">
      {document.meta.length ? (
        <p className="field-help">{document.meta.join(" · ")}</p>
      ) : null}
      {document.sections.map((section) => (
        <section key={section.label}>
          <h4>{section.label}</h4>
          <div className="mcp-search-text">{section.text}</div>
        </section>
      ))}
      {onMore ? (
        <button type="button" className="chat-secondary-action" disabled={busy} onClick={onMore}>
          {busy ? "Wczytuję…" : "Wczytaj dalszą część treści"}
        </button>
      ) : null}
    </div>
  );
}

function groupsOf(
  sources: McpSearchSource[]
): Array<[string, McpSearchSource[]]> {
  const groups = new Map<string, McpSearchSource[]>();
  for (const source of sources) {
    groups.set(source.group, [...(groups.get(source.group) ?? []), source]);
  }
  return [...groups.entries()];
}

function toArgument(
  property: McpToolInputProperty,
  value: FieldValue
): unknown {
  if (typeof value === "boolean") return value;
  const text = value.trim();
  if (property.type === "integer" || property.type === "number") return Number(text);
  if (property.type === "array") {
    const items = text.split(",").map((item) => item.trim()).filter(Boolean);
    return property.items?.type === "integer" ||
      property.items?.type === "number" ||
      items.every((item) => /^\d+$/.test(item))
      ? items.map(Number)
      : items;
  }
  return text;
}

export function McpSearchPanel() {
  const [sources, setSources] =
    useState<McpSearchSource[] | null>(null);
  const [packageInfo, setPackageInfo] =
    useState<McpPackageInfo | null>(null);
  const [sourceId, setSourceId] =
    useState("");
  const [tools, setTools] =
    useState<McpSearchTool[]>([]);
  const [toolName, setToolName] =
    useState("");
  const [values, setValues] =
    useState<Record<string, FieldValue>>({});
  const [busy, setBusy] =
    useState(false);
  // Sekundy oczekiwania na źródło (SAOS bywa wolny, CEIDG i SUDOP czekają po stronie źródła).
  const [waited, setWaited] =
    useState(0);

  useEffect(() => {
    if (!busy) {
      setWaited(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setWaited(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const [error, setError] =
    useState("");
  const [view, setView] =
    useState<ResultView | null>(null);
  const [details, setDetails] =
    useState<Record<string, DetailState>>({});
  // One source page previewed at a time (URL of the result or document).
  const [sourcePreview, setSourcePreview] =
    useState<string | null>(null);
  // Odbiór wyniku z kolejki źródła (SUDOP): numer próby; null = nie trwa.
  const [pendingAttempt, setPendingAttempt] =
    useState<number | null>(null);
  const pendingRun = useRef(0);

  useEffect(() => () => {
    pendingRun.current += 1;
  }, []);

  useEffect(() => {
    void getMcpSearchSources()
      .then((next) => {
        setSources(next.sources);
        setPackageInfo(next.package);
      })
      .catch((failure) => setError(failureText(failure)));
  }, []);

  useEffect(() => {
    setTools([]);
    setToolName("");
    setView(null);
    if (!sourceId) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    void getMcpSearchTools(sourceId)
      .then((next) => {
        if (cancelled) return;
        // Wyszukiwanie po frazie na początku listy, obsługa dostępu do źródła na końcu.
        const sorted = orderTools(next.tools);
        setTools(sorted);
        setToolName(sorted[0]?.name ?? "");
      })
      .catch((failure) => {
        if (!cancelled) setError(failureText(failure));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  useEffect(() => {
    setValues({});
    setView(null);
  }, [toolName]);

  const tool = useMemo(
    () => tools.find((item) => item.name === toolName),
    [tools, toolName]
  );
  const required = new Set(tool?.inputSchema.required ?? []);
  const properties = orderFields(Object.entries(tool?.inputSchema.properties ?? {}), required);
  const missing = properties.some(([name, property]) =>
    required.has(name) &&
    property.type !== "boolean" &&
    !String(values[name] ?? "").trim()
  );

  const availableTools = tools.map((item) => item.name);
  const parameters = properties.map(([name]) => name);

  function pageOf(
    response: McpSearchQueryResponse,
    args: Record<string, unknown>
  ) {
    return readSearchResult(response.tool, args, response.result, availableTools);
  }

  async function submit(): Promise<void> {
    if (!tool) return;
    const args: Record<string, unknown> = {};
    for (const [name, property] of properties) {
      const value = values[name];
      if (value === undefined || (typeof value === "string" && !value.trim())) continue;
      args[name] = toArgument(property, value);
    }
    setBusy(true);
    setError("");
    setView(null);
    setDetails({});
    pendingRun.current += 1;
    setPendingAttempt(null);
    try {
      const response = await queryMcpSearch(sourceId, tool.name, args);
      const page = pageOf(response, args);
      const next = viewOf(response, page, args, [response.result]);
      setView(next);
      if (page.pending) void collectPending(next);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  function viewOf(
    response: McpSearchQueryResponse,
    page: SearchPage,
    args: Record<string, unknown>,
    raw: unknown[]
  ): ResultView {
    return {
      source: response.source,
      tool: response.tool,
      ok: response.ok,
      status: page.status,
      total: page.total,
      notice: page.notice,
      items: page.items,
      document: page.document,
      documentArgs: args,
      next: nextPageArgs(args, page, page.items.length, parameters),
      raw,
      pending: page.pending,
      verification: page.verification
    };
  }

  // Wynik z kolejki źródła: kolejne odbiory, aż wynik będzie gotowy albo skończą się próby.
  async function collectPending(start: ResultView): Promise<void> {
    const run = (pendingRun.current += 1);
    let current = start;
    for (let attempt = 1; current.pending && attempt <= PENDING_ATTEMPTS; attempt += 1) {
      setPendingAttempt(attempt);
      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, PENDING_PAUSE_MS));
      if (pendingRun.current !== run) return;
      try {
        const { tool: pendingTool, args } = current.pending;
        const response = await queryMcpSearch(current.source, pendingTool, args);
        if (pendingRun.current !== run) return;
        const page = readSearchResult(pendingTool, args, response.result, availableTools);
        current = { ...viewOf(response, page, args, [...current.raw, response.result]), next: null };
        setView(current);
      } catch (failure) {
        if (pendingRun.current !== run) return;
        setError(failureText(failure));
        break;
      }
    }
    if (pendingRun.current === run) setPendingAttempt(null);
  }

  async function loadMore(): Promise<void> {
    if (!view?.next) return;
    const args = view.next;
    setBusy(true);
    setError("");
    try {
      const response = await queryMcpSearch(view.source, view.tool, args);
      const page = pageOf(response, args);
      const seen = new Set(view.items.map((item) => item.key));
      const items = [...view.items, ...page.items.filter((item) => !seen.has(item.key))];
      setView({
        ...view,
        items,
        notice: page.notice ?? view.notice,
        next: page.items.length ? nextPageArgs(args, page, items.length, parameters) : null,
        raw: [...view.raw, response.result]
      });
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function loadDocumentPart(): Promise<void> {
    if (!view?.document?.continuation) return;
    const args = view.document.continuation;
    setBusy(true);
    setError("");
    try {
      const response = await queryMcpSearch(view.source, view.tool, args);
      const next = pageOf(response, args).document;
      if (next) {
        setView({
          ...view,
          document: appendDocument(view.document, next),
          raw: [...view.raw, response.result]
        });
      }
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function toggleDetail(item: SearchItem, more = false): Promise<void> {
    if (!view || !item.detail) return;
    const current = details[item.key];
    if (current && !more) {
      const { [item.key]: _closed, ...rest } = details;
      setDetails(rest);
      return;
    }
    const detailTool = item.detail.tool;
    const args = more && current?.document?.continuation
      ? current.document.continuation
      : item.detail.args;
    setDetails((previous) => ({ ...previous, [item.key]: { ...previous[item.key], busy: true, error: undefined } }));
    try {
      const response = await queryMcpSearch(view.source, detailTool, args);
      const page = readSearchResult(detailTool, args, response.result, availableTools);
      const document =
        more && current?.document && page.document
          ? appendDocument(current.document, page.document)
          : page.document;
      setDetails((previous) => ({
        ...previous,
        [item.key]: document
          ? { busy: false, document, args, tool: detailTool }
          : { busy: false, error: page.notice ?? STATUS_TEXT[page.status ?? ""] ?? "Źródło nie zwróciło treści." }
      }));
    } catch (failure) {
      setDetails((previous) => ({
        ...previous,
        [item.key]: { busy: false, error: failureText(failure) }
      }));
    }
  }

  const status = view?.status ?? undefined;

  return (
    <section className="chat-card-stack">
      <article className="chat-card">
        <p className="eyebrow">
          Konektory MCP · wywołanie bezpośrednie
        </p>
        <h2>
          Wyszukiwanie w źródłach
        </h2>
        <p>
          Wynik pochodzi wprost z publicznego API źródła, bez modelu. To materiał do odnalezienia źródła, nie weryfikacja: przepisy potwierdza ścieżka ELI, sygnatury SN weryfikator SN.
        </p>
        <p className="field-help">
          Nie wpisuj faktów sprawy ani danych klienta — zapytania trafiają do publicznych API.
        </p>

        {packageInfo ? (
          <p className="field-help">
            Pakiet serwerów{packageInfo.version ? ` ${packageInfo.version}` : ""}
            {packageInfo.skillVersion ? ` (audyt-systemu-v4 ${packageInfo.skillVersion})` : ""}: {INTEGRITY_TEXT[packageInfo.integrity]}.
          </p>
        ) : null}

        {error ? <div className="alert alert-error">{error}</div> : null}

        {sources ? (
          <div className="mcp-search-form">
            <label>
              Źródło
              <select
                value={sourceId}
                disabled={busy}
                onChange={(event) => setSourceId(event.target.value)}
              >
                <option value="">— wybierz źródło —</option>
                {groupsOf(sources).map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {[...items]
                      .sort((a, b) => Number(sourceHasPhraseSearch(b.id)) - Number(sourceHasPhraseSearch(a.id)))
                      .map((source) => (
                        <option key={source.id} value={source.id} disabled={!source.ready}>
                          {source.label}
                          {sourceHasPhraseSearch(source.id) ? " · szukanie po frazie" : ""}
                          {!source.ready
                            ? " — niegotowe (Ustawienia → Konektory MCP)"
                            : source.lastCheck && !source.lastCheck.ok
                              ? " — ostatnie sprawdzenie nieudane"
                              : ""}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {tools.length ? (
              <label>
                Narzędzie
                <select
                  value={toolName}
                  disabled={busy}
                  onChange={(event) => setToolName(event.target.value)}
                >
                  {tools.map((item) => (
                    <option key={item.name} value={item.name} title={item.name}>
                      {toolLabel(item.name, item.description).label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {tool && toolLabel(tool.name, tool.description).help ? (
              <p className="field-help">{toolLabel(tool.name, tool.description).help}</p>
            ) : null}

            {properties.map(([name, property]) => {
              const field = fieldLabel(name);
              const options = field.options ??
                (property.enum ? Object.fromEntries(property.enum.map((value) => [value, value])) : undefined);
              if (property.type === "boolean") {
                return (
                  <label key={name} className="chat-toggle-row field-help" title={name}>
                    <input
                      type="checkbox"
                      checked={values[name] === true}
                      disabled={busy}
                      onChange={(event) => setValues({ ...values, [name]: event.target.checked })}
                    />
                    <span>{field.label}</span>
                  </label>
                );
              }
              return (
                <label key={name} title={name}>
                  <span>
                    {field.label}
                    {required.has(name) ? " *" : ""}
                    {field.help ? (
                      <small className="field-help"> — {field.help}</small>
                    ) : null}
                  </span>
                  {options ? (
                    <select
                      value={String(values[name] ?? "")}
                      disabled={busy}
                      onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                    >
                      <option value="">{required.has(name) ? "— wybierz —" : "dowolna"}</option>
                      {Object.entries(options).map(([value, text]) => (
                        <option key={value} value={value}>{text}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={
                        field.date
                          ? "date"
                          : property.type === "integer" || property.type === "number"
                            ? "number"
                            : "text"
                      }
                      min={property.minimum}
                      max={property.maximum}
                      value={String(values[name] ?? "")}
                      placeholder={field.placeholder}
                      disabled={busy}
                      onChange={(event) => setValues({ ...values, [name]: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !missing && !busy) void submit();
                      }}
                    />
                  )}
                </label>
              );
            })}

            {tool ? (
              <div className="chat-form-row compact">
                <button
                  type="button"
                  className="chat-primary-action"
                  disabled={busy || missing}
                  onClick={() => void submit()}
                >
                  {busy ? "Szukam…" : "Szukaj"}
                </button>
                {busy && waited >= 5 ? (
                  <span className="field-help">
                    Czekam na odpowiedź źródła: {waited} s
                    {waited >= 20 ? " — źródło odpowiada wolno, aplikacja ponawia zapytanie (do kilku minut)." : ""}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : !error ? (
          <p>Wczytywanie źródeł…</p>
        ) : null}
      </article>

      {view ? (
        <article className="chat-card">
          <p className="eyebrow">
            {toolLabel(view.tool).label}
          </p>
          <h2>
            {status ? STATUS_TEXT[status] ?? status : view.ok ? "Wynik" : "Błąd"}
          </h2>
          {view.total !== null ? (
            <p className="field-help">
              Trafień w źródle: {view.total}; wyświetlono: {view.items.length}.
            </p>
          ) : null}
          {view.source === "cbosa" ? (
            <p className="field-help">
              NSA/WSA z CBOSA to snapshot bez awansu do statusu zweryfikowanego; brak trafień = OUT_OF_SCOPE, nie dowód braku orzeczenia.
            </p>
          ) : null}
          {view.notice ? <div className="alert">{view.notice}</div> : null}
          {view.verification ? (
            <SnVerification verification={view.verification} onVerified={() => void submit()} />
          ) : null}
          {view.pending ? (
            <div className="chat-form-row compact">
              <p className="field-help">
                {pendingAttempt
                  ? `Odbieranie wyniku z kolejki źródła: próba ${pendingAttempt} z ${PENDING_ATTEMPTS}${
                      view.pending.message ? ` (${view.pending.message})` : ""
                    }…`
                  : "Wynik jeszcze niegotowy. Brak wyniku nie oznacza braku danych w źródle."}
              </p>
              {pendingAttempt ? null : (
                <button type="button" className="chat-secondary-action" onClick={() => void collectPending(view)}>
                  Odbierz wynik ponownie
                </button>
              )}
            </div>
          ) : null}

          {view.document ? (
            <>
              <h3>{view.document.title}</h3>
              {view.document.url || view.document.preview ? (
                <p>
                  {view.document.preview ? (
                    <button
                      type="button"
                      className="chat-secondary-action"
                      onClick={() => {
                        const key = previewKey(view.document!.preview!);
                        setSourcePreview(sourcePreview === key ? null : key);
                      }}
                    >
                      {sourcePreview === previewKey(view.document.preview) ? "Zwiń podgląd źródła" : "Podgląd źródła"}
                    </button>
                  ) : null}{" "}
                  {view.document.url ? (
                    <button type="button" className="chat-secondary-action" onClick={() => void openExternalUrl(view.document!.url!)}>
                      Otwórz w źródle
                    </button>
                  ) : null}
                </p>
              ) : null}
              {view.document.preview && sourcePreview === previewKey(view.document.preview) ? (
                <SourcePreviewFrame target={view.document.preview} />
              ) : null}
              <DocumentView
                document={view.document}
                busy={busy}
                onMore={view.document.continuation ? () => void loadDocumentPart() : null}
              />
            </>
          ) : null}

          {view.items.length ? (
            <ol className="mcp-search-items">
              {view.items.map((item) => {
                const detail = details[item.key];
                return (
                  <li key={item.key} className="mcp-search-item">
                    <strong>{item.title}</strong>
                    {item.meta.length ? (
                      <p className="field-help">{item.meta.join(" · ")}</p>
                    ) : null}
                    {item.snippet ? <p className="mcp-search-snippet">{item.snippet}</p> : null}
                    {item.facts.length ? (
                      <dl className="mcp-search-facts">
                        {item.facts.map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    <div className="chat-form-row compact">
                      {item.detail ? (
                        <button
                          type="button"
                          className="chat-secondary-action"
                          disabled={detail?.busy}
                          onClick={() => void toggleDetail(item)}
                        >
                          {detail?.busy ? "Wczytuję…" : detail ? "Zwiń treść" : "Pokaż treść"}
                        </button>
                      ) : null}
                      {item.preview ? (
                        <button
                          type="button"
                          className="chat-secondary-action"
                          onClick={() => {
                            const key = previewKey(item.preview!);
                            setSourcePreview(sourcePreview === key ? null : key);
                          }}
                        >
                          {sourcePreview === previewKey(item.preview) ? "Zwiń podgląd źródła" : "Podgląd źródła"}
                        </button>
                      ) : null}
                      {item.url ? (
                        <button type="button" className="chat-secondary-action" onClick={() => void openExternalUrl(item.url!)}>
                          Otwórz w źródle
                        </button>
                      ) : null}
                    </div>
                    {item.preview && sourcePreview === previewKey(item.preview) ? (
                      <SourcePreviewFrame target={item.preview} />
                    ) : null}
                    {detail?.error ? <div className="alert alert-error">{detail.error}</div> : null}
                    {detail?.document ? (
                      <DocumentView
                        document={detail.document}
                        busy={detail.busy}
                        onMore={detail.document.continuation ? () => void toggleDetail(item, true) : null}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : !view.document && !view.pending ? (
            <p>Brak pozycji do wyświetlenia.</p>
          ) : null}

          {view.next ? (
            <div className="chat-form-row compact">
              <button type="button" className="chat-secondary-action" disabled={busy} onClick={() => void loadMore()}>
                {busy ? "Wczytuję…" : "Wczytaj kolejne wyniki"}
              </button>
            </div>
          ) : null}

          <details className="mcp-search-raw">
            <summary>Dane techniczne (odpowiedź źródła)</summary>
            <pre className="mcp-search-result">
              {JSON.stringify(view.raw.length === 1 ? view.raw[0] : view.raw, null, 2)}
            </pre>
          </details>
        </article>
      ) : null}
    </section>
  );
}
