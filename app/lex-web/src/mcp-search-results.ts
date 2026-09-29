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
  // Pozostałe pola pozycji (np. KRS, biała lista VAT, kurs NBP) jako etykieta: wartość.
  facts: Array<[string, string]>;
  // Pełna treść pozycji: narzędzie "pobierz" tego samego źródła.
  detail: { tool: string; args: Record<string, unknown> } | null;
};

export type SearchDocument = {
  title: string;
  meta: string[];
  url: string | null;
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
  const candidates: Array<[string, string, unknown]> = [
    ["cbosa_pobierz", "doc_id", row.doc_id],
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
  "tytul_lub_nazwa", "sygnatura", "identyfikator", "tytul", "doc_id", "id_eureka", "urn", "sad",
  "fragment", "teza", "sentencja", "url_zrodlowy", "url", "rola",
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

function itemOf(tool: string, row: Row, index: number, available: Set<string>, withFacts = false): SearchItem {
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
  const items = rows
    .filter((row): row is Row => Boolean(row) && typeof row === "object")
    .map((row, index) => itemOf(tool, row, index, available));
  if (single && !document) items.push(itemOf(tool, single, 0, available, !searchTool));
  const notice = text(root.uwaga) ?? text(root.powod) ?? text(root.detail) ?? text(root.error);
  return {
    status: text(root.status),
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
