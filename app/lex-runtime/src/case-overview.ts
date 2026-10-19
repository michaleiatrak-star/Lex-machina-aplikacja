// The case summary (podsumowanie sprawy) kept in the case memory: a structured overview of the
// matter from its documents (parties, documents, timeline, money, key facts, disputes, gaps).
// Made on the user's request (a button), refreshed on the next request; later turns start from it.

export type CaseOverview = {
  text: string;
  updatedAt: string;
  sessionId?: string;
};

export const OVERVIEW_REQUEST = "Utwórz podsumowanie sprawy";
export const MAX_OVERVIEW_CHARS = 40_000;
// What a later turn gets of it (the window serves the documents first).
export const OVERVIEW_PROMPT_CHARS = 10_000;

// The structure of the summary: the sections a lawyer scans, each fact tied to its document.
export const OVERVIEW_TEMPLATE = [
  "[Szablon podsumowania sprawy Lex Machina — wypełnij wyłącznie z dokumentów sprawy i rozmowy; czego nie ma w materiale, wpisz „nie wynika z materiału”. Każde ustalenie z odesłaniem do dokumentu (D01, D02…). Twierdzenie strony oznacz jako twierdzenie, nie fakt. Bez oceny szans i bez przepisów z pamięci.]",
  "# PODSUMOWANIE SPRAWY",
  "## METRYKA SPRAWY — Sprawa (1–2 zdania), Profil sprawy, Etap / kontekst, Strony główne (P1 vs P2), WPS / kwoty, Kluczowe pytania do rozstrzygnięcia (maks. 5)",
  "## WYKAZ DOKUMENTÓW — tabela: doc_id | rodzaj | data | tytuł krótki",
  "## PODMIOTY — tabela: party_id | rola | nazwa / osoba | typ | identyfikatory (jeśli są) | reprezentacja | uwagi istotne prawnie | dowody; potem podmioty trzecie",
  "## RELACJA / PODSTAWA SPRAWY — akapit z dowodami",
  "## OŚ CZASU — tabela: event_id | data_od | data_do | typ zdarzenia | opis | strony | kwoty | dowody",
  "## FINANSE / ŚWIADCZENIA PIENIĘŻNE — tabela: fin_id | typ | data | tytuł | kwota | termin/wymagalność | status | opis | dowody (albo jeden wiersz „nie dotyczy / nie wynika z materiału”)",
  "## FAKTY KLUCZOWE — FC01 Strony i role, FC02 Przedmiot sporu / żądania, FC03 Zdarzenia materialne, FC04 Dokumenty i działania stron, FC05 Terminy, wymagalność, doręczenia, przedawnienie, FC06 Dowody i ich nośność, FC07 Postępowania równoległe; w każdym punkty z (Dowody: Dxx) i jedno zdanie „Znaczenie:”",
  "## CZYNNIKI KRYTYCZNE — tabela: db_id | cecha | dlaczego istotne (1 zdanie) | powiązane FC | dowody",
  "## SPORY I BRAKI — tabela SPORY: d_id | temat | stanowisko A | stanowisko B | wpływ | dowody; tabela BRAKI: g_id | czego brak | dlaczego ważne | jak uzupełnić | powiązane FC/DB | dowody",
  "## SYNTEZA — 2 akapity"
].join("\n");

/** The latest user turn asks for the case summary (the button's message). */
export function overviewRequested(query: string): boolean {
  const turns = query.split(/(?:^|\n\n)Użytkownik: /u);
  const last = (turns.at(-1) ?? "").trimStart();
  return last.startsWith(OVERVIEW_REQUEST);
}

/** The request with the template after it (the structure is the application's, not the model's). */
export function queryWithOverviewTemplate(query: string): string {
  return `${query.trimEnd()}\n\n${OVERVIEW_TEMPLATE}`;
}

export function validCaseOverview(value: unknown): CaseOverview | null {
  const item = value as Partial<CaseOverview> | null;
  if (
    !item ||
    typeof item !== "object" ||
    typeof item.text !== "string" ||
    !item.text.trim() ||
    item.text.length > MAX_OVERVIEW_CHARS ||
    typeof item.updatedAt !== "string" ||
    Number.isNaN(Date.parse(item.updatedAt)) ||
    (item.sessionId !== undefined && (typeof item.sessionId !== "string" || item.sessionId.length > 200))
  ) {
    return null;
  }
  return { text: item.text, updatedAt: item.updatedAt, ...(item.sessionId ? { sessionId: item.sessionId } : {}) };
}

/** The summary to keep from an answer to the summary request (the disclaimer left out). */
export function overviewFromAnswer(args: {
  answer: string | undefined;
  status: string;
  requested: boolean;
  sessionId?: string;
  now?: string;
}): CaseOverview | null {
  const text = args.answer?.split(/\n⚖️/u)[0]?.trim();
  if (!args.requested || !text || args.status !== "DRAFT_PRESENTABLE") return null;
  return {
    text: text.length > MAX_OVERVIEW_CHARS ? `${text.slice(0, MAX_OVERVIEW_CHARS - 50)}\n[…podsumowanie skrócone przy zapisie]` : text,
    updatedAt: args.now ?? new Date().toISOString(),
    ...(args.sessionId ? { sessionId: args.sessionId } : {})
  };
}

/** The block a later turn gets before its conversation; nothing when it already carries it. */
export function overviewBlock(overview: CaseOverview, conversation: string): string | null {
  if (conversation.includes(overview.text.slice(0, 200))) return null;
  const text =
    overview.text.length > OVERVIEW_PROMPT_CHARS
      ? `${overview.text.slice(0, OVERVIEW_PROMPT_CHARS)}\n[…dalsza część podsumowania w pamięci sprawy]`
      : overview.text;
  return `[Podsumowanie sprawy zapisane ${overview.updatedAt.slice(0, 10)}: kluczowe fakty, strony, kwoty i braki; użyj jako materiału sprawy, ustalenia sprawdź z dokumentami:]\n${text}\n[Koniec podsumowania]`;
}
