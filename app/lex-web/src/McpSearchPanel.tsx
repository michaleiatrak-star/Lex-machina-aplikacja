import {
  useEffect,
  useMemo,
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
import { fieldLabel, toolLabel } from "./mcp-search-labels.js";

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

function resultStatus(
  response: McpSearchQueryResponse
): string | undefined {
  const result = response.result;
  if (result && typeof result === "object" && typeof (result as { status?: unknown }).status === "string") {
    return (result as { status: string }).status;
  }
  return undefined;
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
  const [error, setError] =
    useState("");
  const [response, setResponse] =
    useState<McpSearchQueryResponse | null>(null);

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
    setResponse(null);
    if (!sourceId) return;
    let cancelled = false;
    setBusy(true);
    setError("");
    void getMcpSearchTools(sourceId)
      .then((next) => {
        if (cancelled) return;
        // Wyszukiwanie po słowie kluczowym lub fragmencie tekstu na początku listy.
        const sorted = [...next.tools].sort(
          (a, b) =>
            Number(Boolean(toolLabel(b.name).fullText)) -
            Number(Boolean(toolLabel(a.name).fullText))
        );
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
    setResponse(null);
  }, [toolName]);

  const tool = useMemo(
    () => tools.find((item) => item.name === toolName),
    [tools, toolName]
  );
  const properties = Object.entries(tool?.inputSchema.properties ?? {});
  const required = new Set(tool?.inputSchema.required ?? []);
  const missing = properties.some(([name, property]) =>
    required.has(name) &&
    property.type !== "boolean" &&
    !String(values[name] ?? "").trim()
  );

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
    setResponse(null);
    try {
      setResponse(await queryMcpSearch(sourceId, tool.name, args));
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  const status = response ? resultStatus(response) : undefined;

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
                    {items.map((source) => (
                      <option key={source.id} value={source.id} disabled={!source.ready}>
                        {source.label}
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
              </div>
            ) : null}
          </div>
        ) : !error ? (
          <p>Wczytywanie źródeł…</p>
        ) : null}
      </article>

      {response ? (
        <article className="chat-card">
          <p className="eyebrow">
            {toolLabel(response.tool).label}
          </p>
          <h2>
            {status ? STATUS_TEXT[status] ?? status : response.ok ? "Wynik" : "Błąd"}
          </h2>
          {response.source === "cbosa" ? (
            <p className="field-help">
              NSA/WSA z CBOSA to snapshot bez awansu do statusu zweryfikowanego; brak trafień = OUT_OF_SCOPE, nie dowód braku orzeczenia.
            </p>
          ) : null}
          <pre className="mcp-search-result">
            {JSON.stringify(response.result, null, 2)}
          </pre>
        </article>
      ) : null}
    </section>
  );
}
