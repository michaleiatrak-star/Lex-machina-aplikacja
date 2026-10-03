// Wynik narzędzia MCP (lex-mcp) jako czytelna strona wyników: lista pozycji, liczniki,
// kolejna strona i pobranie pełnej treści. Źródła mają wspólny schemat: status,
// liczba_trafien, strona/stron, kandydaci[] albo result{}, pola pozycji identyfikator,
// sygnatura, tytul_lub_nazwa, sad, data_*, prawomocnosc, fragment, url_zrodlowy.

export type SearchItem = {
  key: string;
  title: string;
  meta: string[];
  snippet: string | null;
  url: string | null;
  // Podgląd źródła w aplikacji: adres oficjalnego API/tekstu (url_podgladu) albo strona źródła;
  // dla rejestrów z limitem zapytań lub tokenem (biała lista VAT, CEIDG) — rekord już zwrócony przez API.
  preview: SourcePreviewTarget | null;
  // Pozostałe pola pozycji (np. KRS, biała lista VAT, kurs NBP) jako etykieta: wartość.
  facts: Array<[string, string]>;
  // Pełna treść pozycji: narzędzie "pobierz" tego samego źródła.
  detail: { tool: string; args: Record<string, unknown> } | null;
};

export type SourcePreviewTarget =
  | { kind: "url"; url: string }
  | { kind: "record"; key: string; html: string; anchor?: string };

export type SearchDocument = {
  title: string;
  meta: string[];
  url: string | null;
  preview: SourcePreviewTarget | null;
  sections: Array<{ label: string; text: string }>;
  // Treść porcjowana (EUREKA, UODO, ISAP): argumenty dalszej części.
  continuation: Record<string, unknown> | null;
};

export type SearchPage = {
  status: string | null;
  total: number | null;
  page: number | null;
  pages: number | null;
  notice: string | null;
  items: SearchItem[];
  document: SearchDocument | null;
  // Zlecenie przyjęte w kolejce źródła (SUDOP): narzędzie i argumenty odbioru wyniku.
  pending: { tool: string; args: Record<string, unknown>; message: string | null } | null;
};

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const DATE_LABELS: Array<[string, string]> = [
  ["data_wyroku", "wyrok"],
  ["data_publikacji_lub_wyroku", "data"],
  ["data_publikacji_w_eureka", "publikacja"],
  ["data_uprawomocnienia", "uprawomocnienie"],
  ["data_ostatniego_wpisu", "ostatni wpis"]
];

function metaOf(row: Row): string[] {
  const meta: string[] = [];
  const court = text(row.sad);
  if (court) meta.push(court);
  for (const [key, label] of DATE_LABELS) {
    const value = text(row[key]);
    if (value) meta.push(`${label}: ${value.slice(0, 10)}`);
  }
  for (const key of ["prawomocnosc", "status_obowiazywania", "status_eureka", "status_aktualnosci"]) {
    const value = text(row[key]);
    if (value) meta.push(value.replace(/_/g, " "));
  }
  return meta;
}

// Pełna treść pozycji: narzędzie pobierające tego samego źródła, jeśli jest dostępne.
function detailOf(tool: string, row: Row, available: Set<string>): SearchItem["detail"] {
  const source = tool.split("_", 1)[0];
  // CBOSA: bez „Pokaż treść” — strona orzeczenia jest w podglądzie źródła.
  const candidates: Array<[string, string, unknown]> = [
    ["isap_tekst", "eli", row.eli],
    ["kio_pobierz", "id", row.id_kio],
    ["eureka_pobierz", "id", row.id_eureka],
    ["uodo_pobierz", "urn_lub_sygnatura", row.urn ?? row.identyfikator]
  ];
  for (const [detailTool, argument, value] of candidates) {
    if (!detailTool.startsWith(source + "_") || detailTool === tool || !available.has(detailTool)) continue;
    const id = text(value);
    if (id) return { tool: detailTool, args: { [argument]: id } };
  }
  return null;
}

const SHOWN = new Set([
  "tytul_lub_nazwa", "sygnatura", "identyfikator", "tytul", "doc_id", "id_eureka", "id_kio", "urn", "sad",
  "fragment", "teza", "sentencja", "url_zrodlowy", "url_podgladu", "url", "rola",
  ...DATE_LABELS.map(([key]) => key),
  "prawomocnosc", "status_obowiazywania", "status_eureka", "status_aktualnosci"
]);

function factText(value: unknown, depth = 0): string | null {
  if (typeof value === "boolean") return value ? "tak" : "nie";
  const scalar = text(value);
  if (scalar !== null || value === null || value === undefined || depth > 1) return scalar;
  if (Array.isArray(value)) {
    const parts = value.map((item) => factText(item, depth + 1)).filter(Boolean);
    return parts.length ? parts.join("; ") : null;
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Row)
      .map(([key, item]) => {
        const shown = factText(item, depth + 1);
        return shown ? `${key.replace(/_/g, " ")}: ${shown}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function factsOf(row: Row, skip: Set<string>): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(row)) {
    if (skip.has(key)) continue;
    const shown = factText(value);
    if (shown) facts.push([key.replace(/_/g, " "), shown.length > 600 ? `${shown.slice(0, 600)}…` : shown]);
  }
  return facts;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Rejestry, których rekord pokazujemy z odpowiedzi API (bez ponownego zapytania: limit
// zapytań białej listy, token CEIDG).
const RECORD_SOURCES: Record<string, string> = {
  wl: "Wykaz podatników VAT (biała lista), API Ministerstwa Finansów wl-api.mf.gov.pl",
  ceidg: "Centralna Ewidencja i Informacja o Działalności Gospodarczej, API dane.biznes.gov.pl"
};

export function recordPreviewHtml(title: string, sourceLabel: string, row: Row, retrievedAt: string | null): string {
  const rows = Object.entries(row)
    .filter(([key]) => !["url_zrodlowy", "url_podgladu", "url_rekordu_api"].includes(key))
    .map(([key, value]) => {
      const shown = factText(value, 0);
      return shown ? `<tr><th>${escapeHtml(key.replace(/_/g, " "))}</th><td>${escapeHtml(shown)}</td></tr>` : "";
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Calibri,Arial,sans-serif;margin:16px;font-size:14px;line-height:1.45}table{border-collapse:collapse}th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}th{background:#f3f3f3;white-space:nowrap}p{color:#555}</style></head><body><h1 style="font-size:1.2em">${escapeHtml(title)}</h1><p>Rekord z oficjalnego źródła: ${escapeHtml(sourceLabel)}${retrievedAt ? `, pobrany ${escapeHtml(retrievedAt.replace("T", " ").slice(0, 19))}` : ""}.</p><table>${rows}</table></body></html>`;
}

function previewOf(tool: string, row: Row, title: string, retrievedAt: string | null): SourcePreviewTarget | null {
  const source = tool.split("_", 1)[0] ?? "";
  if (RECORD_SOURCES[source]) {
    return { kind: "record", key: `${tool}:${title}`, html: recordPreviewHtml(title, RECORD_SOURCES[source]!, row, retrievedAt) };
  }
  const url = text(row.url_podgladu) ?? text(row.url_zrodlowy) ?? text(row.url);
  return url ? { kind: "url", url } : null;
}

function itemOf(tool: string, row: Row, index: number, available: Set<string>, withFacts = false, retrievedAt: string | null = null): SearchItem {
  const title =
    text(row.tytul_lub_nazwa) ??
    text(row.sygnatura) ??
    text(row.identyfikator) ??
    text(row.tytul) ??
    text(row.doc_id) ??
    `Wynik ${index + 1}`;
  const identifier = text(row.identyfikator) ?? text(row.sygnatura);
  return {
    key: text(row.doc_id) ?? text(row.id_eureka) ?? text(row.urn) ?? identifier ?? `${index}`,
    title,
    meta: [...(identifier && identifier !== title ? [identifier] : []), ...metaOf(row)],
    snippet: text(row.fragment) ?? text(row.teza) ?? text(row.sentencja)?.slice(0, 600) ?? null,
    url: text(row.url_zrodlowy) ?? text(row.url),
    preview: previewOf(tool, row, title, retrievedAt),
    facts: withFacts ? factsOf(row, SHOWN) : [],
    detail: detailOf(tool, row, available)
  };
}

const LONG_FIELDS: Array<[string, string]> = [
  ["teza", "Teza"],
  ["sentencja", "Sentencja"],
  ["uzasadnienie", "Uzasadnienie"],
  ["tresc", "Treść"],
  ["tekst", "Tekst"],
  ["tresc_artykulu", "Treść artykułu"]
];

function documentOf(tool: string, row: Row, args: Record<string, unknown>): SearchDocument | null {
  const sections = LONG_FIELDS
    .map(([key, label]) => ({ label, text: text(row[key]) ?? "" }))
    .filter((section) => section.text);
  const fragments = Array.isArray(row.fragmenty)
    ? row.fragmenty.map((value) => text(value)).filter((value): value is string => Boolean(value))
    : [];
  if (fragments.length) sections.push({ label: "Fragmenty", text: fragments.join("\n\n…\n\n") });
  if (!sections.length) return null;
  const offset = num(row.tresc_offset);
  const length = text(row.tresc)?.length ?? 0;
  const total = num(row.tresc_dlugosc);
  const incomplete =
    row.tresc_kompletna === false ||
    (row.tresc_kompletna === undefined && total !== null && offset !== null && offset + length < total);
  const continuation =
    incomplete && offset !== null && length > 0
      ? { ...args, offset: offset + length }
      : null;
  return {
    title: text(row.identyfikator) ?? text(row.sygnatura) ?? text(row.tytul_lub_nazwa) ?? tool,
    meta: metaOf(row),
    url: text(row.url_zrodlowy),
    preview: previewOf(tool, row, text(row.identyfikator) ?? text(row.sygnatura) ?? tool, null),
    sections,
    continuation
  };
}

export function readSearchResult(
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
  availableTools: string[]
): SearchPage {
  const root = (result && typeof result === "object" ? result : {}) as Row;
  const available = new Set(availableTools);
  const rows = Array.isArray(root.kandydaci)
    ? root.kandydaci
    : Array.isArray(root.results)
      ? root.results
      : [];
  const single = root.result && typeof root.result === "object" && !Array.isArray(root.result)
    ? root.result as Row
    : null;
  // Pojedyncze trafienie wyszukiwarki to pozycja listy (z "Pokaż treść"), nie dokument.
  const searchTool = /_(szukaj|search)$/.test(tool);
  const document = single && !searchTool ? documentOf(tool, single, args) : null;
  const retrievedAt = text(root.retrieved_at);
  const items = rows
    .filter((row): row is Row => Boolean(row) && typeof row === "object")
    .map((row, index) => itemOf(tool, row, index, available, false, retrievedAt));
  if (single && !document) items.push(itemOf(tool, single, 0, available, !searchTool, retrievedAt));
  const queueId = text(root.kolejka_id);
  const source = tool.split("_", 1)[0];
  const pendingTool = `${source}_odbierz_wynik`;
  const pending =
    text(root.detail) === "PENDING" && queueId && available.has(pendingTool)
      ? { tool: pendingTool, args: { kolejka_id: queueId }, message: text(root.komunikat_serwera) }
      : null;
  const notice = text(root.uwaga) ?? text(root.powod) ?? text(root.detail) ?? text(root.error);
  return {
    status: pending ? "PENDING" : text(root.status),
    pending,
    total: num(root.liczba_trafien),
    page: num(root.strona),
    pages: num(root.stron),
    notice,
    items,
    document
  };
}

// Argumenty kolejnej strony: narzędzie ma parametr "strona" i są dalsze wyniki.
export function nextPageArgs(
  args: Record<string, unknown>,
  page: SearchPage,
  loadedItems: number,
  parameters: string[]
): Record<string, unknown> | null {
  if (!parameters.includes("strona") || page.items.length === 0) return null;
  const current = page.page ?? (typeof args.strona === "number" ? args.strona : 1);
  const more =
    (page.pages !== null && current < page.pages) ||
    (page.pages === null && page.total !== null && loadedItems < page.total);
  return more ? { ...args, strona: current + 1 } : null;
}

// Dalsza część treści porcjowanej: dopisana do sekcji o tej samej nazwie.
export function appendDocument(previous: SearchDocument, next: SearchDocument): SearchDocument {
  const sections = previous.sections.map((section) => ({ ...section }));
  for (const section of next.sections) {
    const existing = sections.find((item) => item.label === section.label);
    if (existing) existing.text += section.text;
    else sections.push(section);
  }
  return { ...previous, sections, continuation: next.continuation };
}
