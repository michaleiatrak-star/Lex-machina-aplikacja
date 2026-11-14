// Downloading whole official bases of rulings and interpretations into the local database (server
// mode). Official sources only: SAOS is an unofficial copy and is not downloaded. Each source has an
// adapter with its own state (cursor) saved in the database after every unit of work, so a run that
// stops (restart, network failure, budget spent) continues where it stopped; after the full pass an
// adapter only fetches what is new. One copy per ruling: a ruling held from another official source
// (same signature and date) is not stored again.
import { plainText } from "./eli/readers.js";
import type { OcrEngine } from "./document-ingestion.js";
import { inflateRawSync } from "node:zlib";
import { lawSourceSessionHeaders } from "./eli/law-source-sessions.js";
import { CaseLawDatabase, defaultCaseLawDbDir, setSharedCaseLawDatabase, sharedCaseLawDatabase, type CaseLawCard, type CaseLawSource } from "./case-law-db.js";
import { cbosaCaseNumber, cbosaDocIds, cbosaField, cbosaTotal, fetchCbosa, type CaseLawSearchFetch } from "./case-law-search.js";
import { supremeCourtFullTextHtml, supremeCourtSearch } from "./case-law-verifier.js";

export type SyncFetch = (input: string, init?: RequestInit) => Promise<Response>;

type Card = Omit<CaseLawCard, "id" | "fetchedAt" | "textSha256">;

// A neutral client name: the courts' portals (orzeczenia.*.gov.pl) refuse browser imitations.
const USER_AGENT = "Lex-Machina/0.1 (serwer bazy orzeczen)";

/** What an adapter is given for one run. */
export class SyncContext {
  requests = 0;
  stored = 0;
  duplicates = 0;
  waiting: string | null = null;

  constructor(
    readonly db: CaseLawDatabase,
    readonly fetcher: SyncFetch,
    readonly budget: number,
    readonly gapMs: number,
    readonly now: () => Date,
    // Local OCR for scanned PDF rulings (pages without a text layer); none: such a ruling is held without text.
    readonly ocr: OcrEngine | null = null
  ) {}

  /** False once the run's request budget is spent: the adapter saves its state and returns. */
  get open(): boolean {
    return this.requests < this.budget && !this.waiting;
  }

  // Cookies per host: some portals (TK's IPO) answer only within a session they set by redirect.
  private readonly jars = new Map<string, Map<string, string>>();

  /** One request to the source, with the pause the source is owed; null for 404. */
  async get(url: string, init: RequestInit = {}): Promise<Response | null> {
    if (this.requests > 0 && this.gapMs) await new Promise((resolve) => setTimeout(resolve, this.gapMs));
    this.requests += 1;
    let target = url;
    let request = init;
    for (let hop = 0; ; hop += 1) {
      const host = new URL(target).host;
      const jar = this.jars.get(host) ?? new Map<string, string>();
      this.jars.set(host, jar);
      const response = await this.fetcher(target, {
        ...request,
        redirect: "manual",
        signal: AbortSignal.timeout(90_000),
        headers: {
          "user-agent": USER_AGENT,
          accept: "*/*",
          "accept-language": "pl-PL,pl;q=0.9",
          ...(jar.size ? { cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ") } : {}),
          ...(request.headers as Record<string, string> | undefined)
        }
      });
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const pair = line.split(";")[0] ?? "";
        const at = pair.indexOf("=");
        if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location && hop < 8) {
        target = new URL(location, target).toString();
        request = {};
        continue;
      }
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP_${response.status} ${url.slice(0, 120)}`);
      return response;
    }
  }

  async html(url: string, init: RequestInit = {}): Promise<string | null> {
    const response = await this.get(url, init);
    return response ? response.text() : null;
  }

  /** Stores a document unless the same ruling is already held from another official source. */
  store(card: Card, text: string | null): boolean {
    if (this.db.duplicateOf(card.source, card.signatures, card.date)) {
      this.duplicates += 1;
      return false;
    }
    const kept = this.db.upsert(card, text && text.length > 40 ? text : null, []);
    if (kept) this.stored += 1;
    return kept;
  }

  today(): string {
    return this.now().toISOString().slice(0, 10);
  }
}

export type SyncAdapter = {
  source: CaseLawSource;
  label: string;
  run(ctx: SyncContext): Promise<void>;
  /** The state as text for the settings window. */
  progress(db: CaseLawDatabase): string;
};

// ── dates ──
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function nextMonth(day: string): string {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

function monthEnd(day: string): string {
  return addDays(nextMonth(day), -1);
}

const MONTHS: Record<string, string> = {
  stycznia: "01", lutego: "02", marca: "03", kwietnia: "04", maja: "05", czerwca: "06",
  lipca: "07", sierpnia: "08", "września": "09", "października": "10", listopada: "11", grudnia: "12"
};

/** "z dnia 16 czerwca 2005 r." -> "2005-06-16". */
export function polishDate(text: string): string | null {
  const match = /(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+(\d{4})/iu.exec(text);
  if (!match) return null;
  return `${match[3]}-${MONTHS[match[2]!.toLowerCase()]}-${match[1]!.padStart(2, "0")}`;
}

const squeeze = (value: string): string => value.replace(/\s+/gu, " ").trim();

/** Day-window state: the full pass from the oldest day, then a rolling window of recent days. */
type DayState = { phase: "FULL" | "INCREMENTAL"; day: string; page: number; since: string | null };

function dayProgress(state: DayState | null, first: string): string {
  if (!state) return `nie rozpoczęto (od ${first})`;
  if (state.phase === "FULL") return `pełne pobieranie: ${state.day}, strona ${state.page}`;
  return `pobrane w całości (${state.since?.slice(0, 10) ?? "?"}); dociąganie nowych`;
}

/** Number-sequence state: documents by their number in the source, up to the newest known. */
type NumberState = { next: number; max: number | null; completedAt: string | null };

function numberProgress(state: NumberState | null): string {
  if (!state) return "nie rozpoczęto";
  if (state.completedAt) return `pobrane w całości (${state.completedAt.slice(0, 10)}); dociąganie nowych od nr ${state.next}`;
  return `pełne pobieranie: nr ${state.next}${state.max ? ` z ${state.max}` : ""}`;
}

async function numberSequence(
  ctx: SyncContext,
  source: string,
  newest: () => Promise<number | null>,
  one: (id: number) => Promise<void>
): Promise<void> {
  let state = ctx.db.state<NumberState>(source) ?? { next: 1, max: null, completedAt: null };
  const max = await newest();
  if (max) state = { ...state, max: Math.max(max, state.max ?? 0) };
  ctx.db.saveState(source, state);
  while (ctx.open && state.max !== null && state.next <= state.max) {
    await one(state.next);
    state = { ...state, next: state.next + 1 };
    if (state.next > (state.max ?? 0) && !state.completedAt) state = { ...state, completedAt: ctx.now().toISOString() };
    ctx.db.saveState(source, state);
  }
}

// ── Portal Orzeczeń Sądów Powszechnych (orzeczenia.ms.gov.pl) ──
const SP = "https://orzeczenia.ms.gov.pl";
const SP_FIRST = "1950-01-01";

export function spSearchUrl(from: string | null, to: string | null, page: number, sort = "score/descending"): string {
  return `${SP}/search/advanced/${"$N/".repeat(7)}${from ?? "$N"}/${to ?? "$N"}/${"$N/".repeat(6)}${sort}/${page}`;
}

export type SpItem = { id: string; signature: string; kind: string | null; court: string; date: string | null; published: string | null };

export function spResults(html: string): { total: number; items: SpItem[] } {
  const total = Number(/big_number">(\d+)/u.exec(html)?.[1] ?? 0);
  const items: SpItem[] = [];
  for (const block of html.split(/<div class="single_result">/u).slice(1)) {
    const id = /href="\/details\/\$N\/([^"]+)"/u.exec(block)?.[1];
    const signature = plainText(/<h4>\s*<a[^>]*>([\s\S]*?)<\/a>/u.exec(block)?.[1] ?? "").trim();
    if (!id || !signature) continue;
    const lines = [...block.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gu)].map((match) => squeeze(plainText(match[1]!)));
    items.push({
      id,
      signature,
      kind: lines[0] ?? null,
      court: lines[1] ?? "",
      date: /Data orzeczenia:\s*(\d{4}-\d{2}-\d{2})/u.exec(block)?.[1] ?? null,
      published: /Data publikacji:\s*(\d{4}-\d{2}-\d{2})/u.exec(block)?.[1] ?? null
    });
  }
  return { total, items };
}

async function spItem(ctx: SyncContext, item: SpItem): Promise<boolean> {
  if (ctx.db.has("SP", item.id)) return false;
  const html = await ctx.html(`${SP}/content/$N/${item.id}`);
  if (html === null) return false;
  const start = html.indexOf("single_result");
  const end = html.indexOf("Deklaracja dostępności", start);
  const text = squeeze(plainText(html.slice(start >= 0 ? html.indexOf(">", start) + 1 : 0, end > start ? end : undefined)));
  return ctx.store(
    {
      source: "SP", sourceId: item.id, court: item.court, courtType: "COMMON", division: null, signatures: [item.signature],
      date: item.date, kind: item.kind, judges: [], keywords: [], legalBases: [], summary: null,
      url: `${SP}/details/$N/${item.id}`, modified: item.published
    },
    text
  );
}

export const spAdapter: SyncAdapter = {
  source: "SP",
  label: "Portal Orzeczeń Sądów Powszechnych",
  progress: (db) => dayProgress(db.state<DayState>("SP"), SP_FIRST),
  async run(ctx) {
    let state = ctx.db.state<DayState>("SP") ?? { phase: "FULL", day: SP_FIRST, page: 1, since: null };
    const save = () => ctx.db.saveState("SP", state);
    while (ctx.open) {
      if (state.phase === "INCREMENTAL") {
        // Newest publications first, over all dates, until a page brings nothing new.
        const html = await ctx.html(spSearchUrl(SP_FIRST, ctx.today(), state.page, "datapublikacji/descending"));
        const { items } = spResults(html ?? "");
        let fresh = 0;
        for (const item of items) if (ctx.open && (await spItem(ctx, item))) fresh += 1;
        if (!ctx.open) return save();
        state = fresh === 0 || items.length === 0 || state.page >= 500 ? { ...state, page: 1, since: ctx.now().toISOString() } : { ...state, page: state.page + 1 };
        save();
        if (state.page === 1) return;
        continue;
      }
      if (state.day > ctx.today()) {
        state = { phase: "INCREMENTAL", day: ctx.today(), page: 1, since: ctx.now().toISOString() };
        save();
        continue;
      }
      if (state.page === 1 && state.day.endsWith("-01")) {
        // An empty month is skipped with one request.
        const month = spResults((await ctx.html(spSearchUrl(state.day, monthEnd(state.day), 1))) ?? "");
        if (month.total === 0) {
          state = { ...state, day: nextMonth(state.day) };
          save();
          continue;
        }
      }
      const { total, items } = spResults((await ctx.html(spSearchUrl(state.day, state.day, state.page))) ?? "");
      for (const item of items) {
        if (!ctx.open) return save();
        await spItem(ctx, item);
      }
      state = state.page * 10 < total && items.length ? { ...state, page: state.page + 1 } : { ...state, day: addDays(state.day, 1), page: 1 };
      save();
    }
  }
};

// ── CBOSA (orzeczenia.nsa.gov.pl): NSA and WSA ──
const CBOSA = "https://orzeczenia.nsa.gov.pl";
const CBOSA_FIRST = "1980-01-01";
const CBOSA_WINDOW_DAYS = 60;

async function cbosaSearch(ctx: SyncContext, from: string, to: string): Promise<{ html: string; cookies: string[] }> {
  ctx.requests += 2;
  const warm = await fetchCbosa(ctx.fetcher as CaseLawSearchFetch, `${CBOSA}/cbo/query`, { method: "GET" }, []);
  const form = new URLSearchParams({
    wszystkieSlowa: "", wystepowanie: "gdziekolwiek", odmiana: "on", sygnatura: "", sad: "dowolny", rodzaj: "dowolny",
    symbole: "", odDaty: from, doDaty: to, sedziowie: "", funkcja: "", submit: "Szukaj"
  });
  const first = await fetchCbosa(
    ctx.fetcher as CaseLawSearchFetch,
    `${CBOSA}/cbo/search`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: CBOSA, Referer: `${CBOSA}/cbo/query` }, body: form.toString() },
    warm.cookies
  );
  if (!first.response.ok) throw new Error(`CBOSA_HTTP_${first.response.status}`);
  return { html: await first.response.text(), cookies: first.cookies };
}

async function cbosaDocument(ctx: SyncContext, id: string, cookies: string[]): Promise<void> {
  if (ctx.db.has("CBOSA", id)) return;
  ctx.requests += 1;
  const reply = await fetchCbosa(ctx.fetcher as CaseLawSearchFetch, `${CBOSA}/doc/${id}`, { method: "GET" }, cookies);
  if (!reply.response.ok) return;
  const html = await reply.response.text();
  const signatures = cbosaCaseNumber(html);
  if (!signatures.length) return;
  const date = cbosaField(html, "Data orzeczenia")?.trim().slice(0, 10) ?? null;
  const court = squeeze(cbosaField(html, "Sąd") ?? "");
  const kind = /<title\b[^>]*>[^<]*?-\s*(Wyrok|Postanowienie|Uchwała)/iu.exec(html)?.[1] ?? null;
  const body = html.replace(/<(?:nav|header|footer)\b[\s\S]*?<\/(?:nav|header|footer)>/giu, "");
  ctx.store(
    {
      source: "CBOSA", sourceId: id, court, courtType: "ADMINISTRATIVE", division: null, signatures, date, kind,
      judges: [], keywords: [], legalBases: [], summary: null, url: `${CBOSA}/doc/${id}`, modified: null
    },
    squeeze(plainText(body))
  );
}

export const cbosaAdapter: SyncAdapter = {
  source: "CBOSA",
  label: "CBOSA — orzeczenia NSA i WSA",
  progress: (db) => dayProgress(db.state<DayState>("CBOSA"), CBOSA_FIRST),
  async run(ctx) {
    let state = ctx.db.state<DayState>("CBOSA") ?? { phase: "FULL", day: CBOSA_FIRST, page: 1, since: null };
    const save = () => ctx.db.saveState("CBOSA", state);
    while (ctx.open) {
      if (state.day > ctx.today()) {
        // Full pass (or a window of recent days) done: next runs read the last weeks again.
        state = { phase: "INCREMENTAL", day: addDays(ctx.today(), -CBOSA_WINDOW_DAYS), page: 1, since: ctx.now().toISOString() };
        save();
        return;
      }
      if (state.page === 1 && state.day.endsWith("-01")) {
        const month = await cbosaSearch(ctx, state.day, monthEnd(state.day));
        if ((cbosaTotal(month.html) ?? 0) === 0) {
          state = { ...state, day: nextMonth(state.day) };
          save();
          continue;
        }
      }
      // A search session per day: its first page comes with the search, the next ones by number.
      const search = await cbosaSearch(ctx, state.day, state.day);
      const total = cbosaTotal(search.html) ?? 0;
      let page = 1;
      let html = search.html;
      while (page < state.page && ctx.open) {
        page += 1;
        ctx.requests += 1;
        html = await (await fetchCbosa(ctx.fetcher as CaseLawSearchFetch, `${CBOSA}/cbo/find?p=${page}`, { method: "GET" }, search.cookies)).response.text();
      }
      for (;;) {
        for (const id of cbosaDocIds(html)) {
          if (!ctx.open) return save();
          await cbosaDocument(ctx, id, search.cookies);
        }
        if (page * 10 >= total || !ctx.open) break;
        page += 1;
        state = { ...state, page };
        save();
        ctx.requests += 1;
        html = await (await fetchCbosa(ctx.fetcher as CaseLawSearchFetch, `${CBOSA}/cbo/find?p=${page}`, { method: "GET" }, search.cookies)).response.text();
      }
      if (!ctx.open && page * 10 < total) return save();
      state = { ...state, day: addDays(state.day, 1), page: 1 };
      save();
    }
  }
};

// ── EUREKA (eureka.mf.gov.pl): tax interpretations and other tax information ──
const EUREKA = "https://eureka.mf.gov.pl/api/public/v1";
const EUREKA_FIRST = "2000-01-01";
const EUREKA_PAGE = 100;
const EUREKA_WINDOW_DAYS = 30;

type EurekaField = { key?: string; value?: unknown };

export function eurekaText(document: { dokument?: { fields?: EurekaField[] } }): { text: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const parts: string[] = [];
  for (const field of document.dokument?.fields ?? []) {
    if (!field.key || typeof field.value !== "string") continue;
    fields[field.key] = field.value;
    if (/<[a-z]/iu.test(field.value) || field.value.length > 300) parts.push(squeeze(plainText(field.value)));
  }
  return { text: parts.join("\n\n"), fields };
}

export const eurekaAdapter: SyncAdapter = {
  source: "EUREKA",
  label: "EUREKA — interpretacje i informacje podatkowe",
  progress: (db) => dayProgress(db.state<DayState>("EUREKA"), EUREKA_FIRST),
  async run(ctx) {
    let state = ctx.db.state<DayState>("EUREKA") ?? { phase: "FULL", day: EUREKA_FIRST, page: 0, since: null };
    const save = () => ctx.db.saveState("EUREKA", state);
    while (ctx.open) {
      if (state.day > ctx.today()) {
        state = { phase: "INCREMENTAL", day: addDays(ctx.today(), -EUREKA_WINDOW_DAYS), page: 0, since: ctx.now().toISOString() };
        save();
        return;
      }
      // The search pages at most 10 000 hits, so the base is read one issue date at a time.
      const body = {
        filter: { DT_WYD: state.day },
        columns: ["ID_INFORMACJI", "SYG", "DT_WYD", "TEZA", "KATEGORIA_INFORMACJI", "STATUS_INFORMACJI"],
        searchInFullPhrase: false, searchInContent: false, searchInSynonyms: false, warunkiDodatkowe: []
      };
      const reply = await ctx.get(`${EUREKA}/wyszukiwarka/informacje/?size=${EUREKA_PAGE}&page=${state.page}&sort=ID_INFORMACJI%2Casc`, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body)
      });
      const results = ((reply ? await reply.json() : {}) as { results?: Array<Record<string, unknown>> }).results ?? [];
      for (const hit of results) {
        if (!ctx.open) return save();
        const id = String(hit.ID_INFORMACJI ?? "");
        if (!id || ctx.db.has("EUREKA", id)) continue;
        const document = await ctx.get(`${EUREKA}/informacje/${id}`, { headers: { accept: "application/json" } });
        if (!document) continue;
        const { text, fields } = eurekaText((await document.json()) as { dokument?: { fields?: EurekaField[] } });
        const list = (value: unknown) => (Array.isArray(value) ? value.map(String).join(", ") : value ? String(value) : null);
        const signature = list(hit.SYG) ?? fields.SYG ?? "";
        ctx.store(
          {
            source: "EUREKA", sourceId: id, court: "EUREKA (Ministerstwo Finansów)", courtType: "TAX", division: null,
            signatures: signature ? [signature] : [], date: state.day, kind: list(hit.KATEGORIA_INFORMACJI), judges: [], keywords: [],
            legalBases: [], summary: list(hit.TEZA) ? squeeze(plainText(list(hit.TEZA)!)) : null,
            url: `https://eureka.mf.gov.pl/informacje/podglad/${id}`, modified: list(hit.STATUS_INFORMACJI)
          },
          text
        );
      }
      state = results.length === EUREKA_PAGE ? { ...state, page: state.page + 1 } : { ...state, day: addDays(state.day, 1), page: 0 };
      save();
    }
  }
};

// ── UODO (orzeczenia.uodo.gov.pl): decisions of the President of UODO ──
const UODO = "https://orzeczenia.uodo.gov.pl";

/** "urn:ndoc:gov:pl:uodo:2023:dkn_5131_27" -> "DKN.5131.27.2023". */
export function uodoSignature(urn: string): string | null {
  const match = /uodo:(\d{4}):([a-z]+(?:_[a-z0-9]+)*)$/iu.exec(urn);
  return match ? `${match[2]!.replace(/_/gu, ".").toUpperCase()}.${match[1]}` : null;
}

type PageState = { phase: "FULL" | "INCREMENTAL"; page: number; since: string | null };

export const uodoAdapter: SyncAdapter = {
  source: "UODO",
  label: "UODO — decyzje Prezesa UODO",
  progress: (db) => {
    const state = db.state<PageState>("UODO");
    if (!state) return "nie rozpoczęto";
    return state.phase === "FULL" ? `pełne pobieranie: strona ${state.page}` : `pobrane w całości (${state.since?.slice(0, 10) ?? "?"}); dociąganie nowych`;
  },
  async run(ctx) {
    let state = ctx.db.state<PageState>("UODO") ?? { phase: "FULL", page: 1, since: null };
    const save = () => ctx.db.saveState("UODO", state);
    while (ctx.open) {
      const html = (await ctx.html(`${UODO}/search?page=${state.page}`)) ?? "";
      const urns = [...new Set([...html.matchAll(/\/document\/(urn:[^/"?]+)\/content/gu)].map((match) => match[1]!))];
      let fresh = 0;
      for (const urn of urns) {
        if (!ctx.open) return save();
        if (ctx.db.has("UODO", urn)) continue;
        const page = await ctx.html(`${UODO}/document/${urn}/content`);
        if (!page) continue;
        const text = squeeze(plainText(page.replace(/<(?:nav|header|footer)\b[\s\S]*?<\/(?:nav|header|footer)>/giu, "")));
        const signature = uodoSignature(urn);
        if (
          ctx.store(
            {
              source: "UODO", sourceId: urn, court: "Prezes Urzędu Ochrony Danych Osobowych", courtType: "AUTHORITY", division: null,
              signatures: signature ? [signature] : [], date: polishDate(/Warszawa,?\s+(?:dnia\s+)?\d{1,2}\s+\S+\s+\d{4}/u.exec(text)?.[0] ?? ""), kind: "decyzja", judges: [], keywords: [], legalBases: [], summary: null,
              url: `${UODO}/document/${urn}/content`, modified: null
            },
            text
          )
        )
          fresh += 1;
      }
      const end = urns.length === 0 || (state.phase === "INCREMENTAL" && fresh === 0);
      state = end ? { phase: "INCREMENTAL", page: 1, since: ctx.now().toISOString() } : { ...state, page: state.page + 1 };
      save();
      if (end) return;
    }
  }
};

// ── KIO (orzeczenia.uzp.gov.pl): rulings of the National Appeal Chamber, by number ──
const KIO = "https://orzeczenia.uzp.gov.pl";

export function kioDetails(html: string): { signature: string | null; date: string | null; kind: string | null } {
  const text = squeeze(plainText(html));
  const signature = /Sygnatura akt(?: \/ Sposób rozstrzygnięcia)?\s+(KIO[^/]*?\d+\/\d{2,4})/u.exec(text)?.[1]?.trim() ?? null;
  const dmy = /Data wydania(?: rozstrzygnięcia)?\s+(\d{2})-(\d{2})-(\d{4})/u.exec(text);
  const kind = /Rodzaj dokumentu\s+(wyrok|postanowienie|uchwała)/iu.exec(text)?.[1] ?? null;
  return { signature, date: dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : null, kind };
}

export const kioAdapter: SyncAdapter = {
  source: "KIO",
  label: "KIO — orzeczenia Krajowej Izby Odwoławczej",
  progress: (db) => numberProgress(db.state<NumberState>("KIO")),
  async run(ctx) {
    await numberSequence(
      ctx,
      "KIO",
      async () => {
        const list = await ctx.html(`${KIO}/Home/GetResults`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest" },
          body: "Pg=1&CountStats=True&SCnt=1&Fle=1"
        });
        const ids = [...(list ?? "").matchAll(/\/Home\/Details\/(\d+)/gu)].map((match) => Number(match[1]));
        return ids.length ? Math.max(...ids) : null;
      },
      async (id) => {
        if (ctx.db.has("KIO", String(id))) return;
        const details = await ctx.html(`${KIO}/Home/Details/${id}`);
        if (!details) return;
        const meta = kioDetails(details);
        if (!meta.signature) return;
        const content = await ctx.html(`${KIO}/Home/ContentHtml/${id}?Kind=KIO`);
        ctx.store(
          {
            source: "KIO", sourceId: String(id), court: "Krajowa Izba Odwoławcza", courtType: "KIO", division: null, signatures: [meta.signature],
            date: meta.date, kind: meta.kind, judges: [], keywords: [], legalBases: [], summary: null, url: `${KIO}/Home/Details/${id}`, modified: null
          },
          content ? squeeze(plainText(content)) : null
        );
      }
    );
  }
};

// ── TK (ipo.trybunal.gov.pl): case pages by number, each with its documents ──
const TK = "https://ipo.trybunal.gov.pl/ipo";
const TK_RULING = /wyrok|postanowienie|uchwał|orzeczenie|sygnalizacj|rozstrzygnięci/iu;

export function tkDocuments(html: string): { signature: string | null; documents: Array<{ tab: string; title: string; text: string }> } {
  const titles = new Map<string, string>();
  for (const match of html.matchAll(/<a\b[^>]*href="#sprawaForm:tabView:dok_(\d+)"[^>]*>([^<]*)/giu)) {
    if (!titles.has(match[1]!)) titles.set(match[1]!, squeeze(plainText(match[2]!)));
  }
  const starts = [...html.matchAll(/<div\b[^>]*\bid="sprawaForm:tabView:dok_(\d+)"/giu)].map((match) => ({ tab: match[1]!, at: match.index! }));
  const documents = starts.map(({ tab, at }, index) => {
    let end = index + 1 < starts.length ? starts[index + 1]!.at : html.length;
    const form = html.indexOf("</form>", at);
    if (form !== -1) end = Math.min(end, form);
    return { tab, title: titles.get(tab) ?? "", text: squeeze(plainText(html.slice(at, end))) };
  });
  const signature = /Sygnatura\s+((?:K|P|SK|U|Kp|Kpt|Pp|Ts|Tw|S)\s+\d{1,4}\/\d{2,4})/u.exec(squeeze(plainText(html)))?.[1] ?? null;
  return { signature, documents };
}

export const tkAdapter: SyncAdapter = {
  source: "TK",
  label: "Trybunał Konstytucyjny (IPO)",
  progress: (db) => numberProgress(db.state<NumberState>("TK")),
  async run(ctx) {
    await numberSequence(
      ctx,
      "TK",
      async () => {
        const page = await ctx.html(`${TK}/Szukaj?cid=1`);
        const ids = [...(page ?? "").matchAll(/sprawa=(\d+)/gu)].map((match) => Number(match[1]));
        return ids.length ? Math.max(...ids) : null;
      },
      async (id) => {
        if (ctx.db.has("TK", `${id}-0`)) return;
        const page = await ctx.html(`${TK}/view/sprawa.xhtml?pokaz=dokumenty&sprawa=${id}`);
        if (!page) return;
        const { signature, documents } = tkDocuments(page);
        if (!signature) return;
        const rulings = documents.filter((document) => TK_RULING.test(document.title));
        for (const [index, document] of rulings.entries()) {
          ctx.store(
            {
              source: "TK", sourceId: `${id}-${index}`, court: "Trybunał Konstytucyjny", courtType: "CONSTITUTIONAL_TRIBUNAL", division: null,
              signatures: [signature], date: polishDate(document.title), kind: document.title.split(/\s+z dnia/u)[0] ?? null,
              judges: [], keywords: [], legalBases: [], summary: null, url: `${TK}/view/sprawa.xhtml?sprawa=${id}`, modified: null
            },
            document.text
          );
        }
      }
    );
  }
};

// ── Portal Orzecznictwa Dyscyplinarnego Adwokatury (wsd.adwokatura.pl), by page number ──
const WSD = "https://wsd.adwokatura.pl";

export function wsdRuling(html: string): { title: string; signature: string | null; text: string } | null {
  const crumbs = squeeze(plainText(/<(?:ol|ul|div)\b[^>]*(?:breadcrumb|okruszki)[^>]*>([\s\S]*?)<\/(?:ol|ul|div)>/iu.exec(html)?.[1] ?? ""));
  const article = /<article\b[\s\S]*?<\/article>/u.exec(html)?.[0] ?? "";
  const text = squeeze(plainText(article));
  if (!/Orzecznictwo/u.test(crumbs + " " + text.slice(0, 200))) return null;
  const title = squeeze(plainText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/u.exec(html)?.[1] ?? ""));
  const signature = /Sygnatura:\s*([^\n]+?)(?:\s+Tagi\b|$)/u.exec(text)?.[1]?.trim() ?? null;
  return { title, signature, text };
}

export const wsdAdapter: SyncAdapter = {
  source: "WSD",
  label: "Orzecznictwo dyscyplinarne adwokatury (WSD)",
  progress: (db) => numberProgress(db.state<NumberState>("WSD")),
  async run(ctx) {
    await numberSequence(
      ctx,
      "WSD",
      async () => {
        const page = await ctx.html(`${WSD}/rejestry/showMain/orzecznictwo-19`);
        const ids = [...(page ?? "").matchAll(/rejestry\/show\/[^"#?]*?-(\d+)["#?]/gu)].map((match) => Number(match[1]));
        return ids.length ? Math.max(...ids) : null;
      },
      async (id) => {
        if (ctx.db.has("WSD", String(id))) return;
        const html = await ctx.html(`${WSD}/rejestry/show/${id}`);
        const ruling = html ? wsdRuling(html) : null;
        if (!ruling || !ruling.signature) return;
        ctx.store(
          {
            source: "WSD", sourceId: String(id),
            court: /Sądu Najwyższego/u.test(ruling.title) ? "Sąd Najwyższy" : "Sądownictwo dyscyplinarne adwokatury",
            courtType: "DISCIPLINARY", division: null, signatures: [ruling.signature], date: polishDate(ruling.title),
            kind: ruling.title.split(/\s+z dnia/u)[0] ?? null, judges: [], keywords: [], legalBases: [], summary: null,
            url: `${WSD}/rejestry/show/${id}`, modified: null
          },
          ruling.text
        );
      }
    );
  }
};

// ── SN (sn.pl): with the session the user verified in the app's sn.pl window ──
const SN_FIRST = "1995-01-01";
const SN_WINDOW_DAYS = 60;
const SN_PAGE = 25;

/** "Waiting for the user" message when sn.pl asks for its human check. */
export const SN_WAITING = "czeka na potwierdzenie w oknie sn.pl (Ustawienia albo czat); potem pobieranie wznowi się samo";

export const snAdapter: SyncAdapter = {
  source: "SN",
  label: "Sąd Najwyższy (sn.pl)",
  progress: (db) => {
    const waiting = db.state<{ at: string }>("SN:waiting");
    const base = dayProgress(db.state<DayState>("SN"), SN_FIRST);
    return waiting ? `${base}; ${SN_WAITING}` : base;
  },
  async run(ctx) {
    let state = ctx.db.state<DayState>("SN") ?? { phase: "FULL", day: SN_FIRST, page: 1, since: null };
    const save = () => ctx.db.saveState("SN", state);
    const fetcher = ctx.fetcher as unknown as typeof fetch;
    try {
      while (ctx.open) {
        if (state.day > ctx.today()) {
          state = { phase: "INCREMENTAL", day: addDays(ctx.today(), -SN_WINDOW_DAYS), page: 1, since: ctx.now().toISOString() };
          save();
          return;
        }
        // A month at a time (the search pages by 25).
        const to = monthEnd(state.day);
        ctx.requests += 1;
        const hits = await supremeCourtSearch({ data_wydania_od: state.day, data_wydania_do: to < ctx.today() ? to : ctx.today(), strona: state.page, rozmiar_strony: SN_PAGE }, fetcher);
        for (const hit of hits) {
          if (!ctx.open) return save();
          if (ctx.db.has("SN", hit.id)) continue;
          ctx.requests += 1;
          const html = await supremeCourtFullTextHtml(hit.cardUrl, fetcher);
          ctx.store(
            {
              source: "SN", sourceId: hit.id, court: "Sąd Najwyższy", courtType: "SUPREME", division: null, signatures: [hit.signature],
              date: hit.date ?? null, kind: hit.form ?? null, judges: [], keywords: [], legalBases: [], summary: null, url: hit.cardUrl, modified: null
            },
            html ? squeeze(plainText(html)) : null
          );
        }
        state = hits.length === SN_PAGE ? { ...state, page: state.page + 1 } : { ...state, day: nextMonth(state.day), page: 1 };
        save();
      }
      ctx.db.saveState("SN:waiting", null);
    } catch (error) {
      // sn.pl's human check: no way around it; the run waits for the user's window and resumes.
      if (/403|BOT_PROTECTION|HTTP_4\d\d/u.test(error instanceof Error ? error.message : String(error))) {
        ctx.waiting = SN_WAITING;
        ctx.db.saveState("SN:waiting", { at: ctx.now().toISOString() });
        save();
        return;
      }
      throw error;
    }
  }
};

// ── First-instance disciplinary courts of the bar and the legal advisers' chambers ──
// Each chamber publishes on its own site, in its own way (a page of PDF files, year pages, articles,
// posts); the seeds below are the pages found, checked 2026-11-14 (DR-12 mod-ustawa-odpowiedzialnosc-
// dyscyplinarna-zawodow lists the chambers and which publish). A run reads a chamber's list pages and
// fetches the rulings not held yet; the next chamber continues in the next run.
type CrawlSeed = { id: string; body: string; start: string; listing: RegExp | null; item: RegExp };
type WpSeed = { id: string; body: string; site: string; search: string; title: RegExp };
export type DisciplinarySeed = CrawlSeed | WpSeed;

export const DISCIPLINARY_SEEDS: DisciplinarySeed[] = [
  { id: "oirp-lublin", body: "Okręgowy Sąd Dyscyplinarny OIRP w Lublinie", start: "https://oirp.lu/o-izbie/okregowy-sad-dyscyplinarny/orzeczenia-okregowego-sadu-dyscyplinarnego/", listing: null, item: /\/wp-content\/uploads\/.+\.pdf$/iu },
  { id: "oirp-warszawa", body: "Okręgowy Sąd Dyscyplinarny OIRP w Warszawie", start: "https://www.oirpwarszawa.pl/dla-radcow-prawnych/odpowiedzialnosc-dyscyplinarna/okregowy-sad-dyscyplinarny-oirp-w-warszawie-2/orzeczenia-dyscyplinarne/", listing: /orzeczenia-dyscyplinarne\/\?temidium_page=\d+$/u, item: /\/temidium\/artykul\/(?:orzeczenie|postanowienie|wyrok)/iu },
  { id: "oirp-szczecin", body: "Okręgowy Sąd Dyscyplinarny OIRP w Szczecinie", start: "https://oirp.szczecin.pl/izba/orzeczenia-postanowienia-sadu-dyscyplinarnego/", listing: /\/orzeczenie_sadu\/\d{4}\/?$/u, item: /\/wp-content\/uploads\/.+OSD[^/]*\.pdf$/iu },
  { id: "oirp-gdansk", body: "Okręgowy Sąd Dyscyplinarny OIRP w Gdańsku", start: "https://oirp.gda.pl/izba/orzeczenia-okregowego-sadu-dyscyplinarnego/", listing: /\/orzeczenia-okregowego-sadu-dyscyplinarnego\/[^/]+\/?$/u, item: /\/media\/.+\.pdf$/iu },
  { id: "oirp-wroclaw", body: "Okręgowy Sąd Dyscyplinarny OIRP we Wrocławiu", start: "https://oirp.wroclaw.pl/akty-prawne/orzeczenia-postanowienia-osd", listing: null, item: /\/uploads\/pdf\/.+\.pdf$/iu },
  { id: "oirp-rzeszow", body: "Okręgowy Sąd Dyscyplinarny OIRP w Rzeszowie", start: "https://www.oirp.rzeszow.pl/radcowie/odpowiedzialnosc-dyscyplinarna", listing: /\/radcowie\/odpowiedzialnosc-dyscyplinarna\/\d{4}$/u, item: /\/item\.php\?id=\d+$/u },
  { id: "oirp-kielce", body: "Okręgowy Sąd Dyscyplinarny OIRP w Kielcach", start: "https://www.oirpkielce.pl/o-izbie/odpowiedzialnosc-dyscyplinarna/orzeczenia-osd", listing: /\/orzeczenia-osd\/\d{4}[^/]*$/u, item: /\.pdf$/iu },
  { id: "oirp-katowice", body: "Okręgowy Sąd Dyscyplinarny OIRP w Katowicach", start: "https://www.oirp.katowice.pl/orzeczenia-sadu-dyscyplinarnego/orzeczenia-sadu-dyscyplinarnego.html", listing: /\/orzeczenia-sadu-dyscyplinarnego\/\d{4}-orzeczenia-sadu-dyscyplinarnego\.html$/u, item: /\/add\/vrecord\/.+\.pdf$/iu },
  { id: "ora-poznan", body: "Sąd Dyscyplinarny Izby Adwokackiej w Poznaniu", site: "https://ora.poznan.pl", search: "orzeczenie sądu dyscyplinarnego", title: /orzeczeni|postanowieni/iu }
];

const SIGNATURE_AFTER_SYGN = /sygn(?:atura)?\.?\s*(?:akt)?\s*:?\s*((?:[A-Z]{1,4}\.?\s*){1,2}\d{1,4}\s*\/\s*\d{2,4})/iu;
const DISCIPLINARY_SIGNATURE = /\b((?:WO|OSD|SD|OS|D|O|SDI|ZK|WSD)(?:[.\s-]*OSD)?[.\s-]*\d{1,4}\s*[/_.\s-]\s*\d{2,4})(?![\d])/u;

/** "OS-1_26-an" -> "OS 1/26", "OSD 32 25" -> "OSD 32/25", "Sygn. akt D 210/19" -> "D 210/19". */
export function disciplinarySignature(...texts: string[]): string | null {
  for (const text of texts) {
    const sygn = SIGNATURE_AFTER_SYGN.exec(text.normalize("NFKC"))?.[1];
    if (sygn) return squeeze(sygn);
  }
  for (const text of texts) {
    const found = DISCIPLINARY_SIGNATURE.exec(text.normalize("NFKC"))?.[1];
    if (found) {
      const match = /^(.*?\D)[.\s-]*(\d{1,4})\s*[/_.\s-]\s*(\d{2,4})$/u.exec(found);
      return match ? `${squeeze(match[1]!.replace(/[.-]+/gu, " "))} ${match[2]}/${match[3]}` : squeeze(found);
    }
  }
  return null;
}

/** The ruling's date: "z dnia 14 maja 2024 r." / "dnia 14.05.2024", not the first date of a cited act. */
export function rulingDate(text: string): string | null {
  // The header only (up to the bench): a date further on is a cited act's or a party's letter's.
  const bench = text.search(/w\s+składzie|skład\s+orzekający/iu);
  const head = text.slice(0, bench > 0 ? bench : 400);
  const after = /(?:z\s+)?dnia\s+(\d{1,2}\s+\p{L}+\s+\d{4}|\d{1,2}[.-]\d{1,2}[.-]\d{4})/u.exec(head)?.[1];
  if (after) return polishDate(after) ?? numericDate(after);
  return null;
}

function numericDate(text: string): string | null {
  const match = /(\d{1,2})[.-](\d{1,2})[.-](\d{4})\s*r?/u.exec(text);
  return match ? `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}` : null;
}

let pdfExtractor: { extract(data: Uint8Array): Promise<{ text: string; pageTexts?: string[] }> } | null = null;
const OCR_MAX_PAGES = 60;

/** A PDF's text; pages without a text layer (scans) are read by the local OCR when there is one. */
async function pdfText(ctx: SyncContext, data: Uint8Array): Promise<string> {
  if (!pdfExtractor) {
    const { LocalPdfTextExtractor } = await import("./pdf-text-extractor.js");
    pdfExtractor = new LocalPdfTextExtractor(undefined, { lines: true, allowEmpty: true });
  }
  const extracted = await pdfExtractor.extract(data);
  const pages = extracted.pageTexts ?? [extracted.text];
  const scanned = pages.flatMap((page, index) => (page.replace(/\s+/gu, "").length < 30 ? [index + 1] : []));
  if (scanned.length && ctx.ocr && scanned.length <= OCR_MAX_PAGES) {
    try {
      for (const result of await ctx.ocr.recognizePages(data, scanned)) {
        if (result.page >= 1 && result.page <= pages.length) pages[result.page - 1] = result.text;
      }
    } catch {
      // OCR unavailable or failed: the ruling is held with its card and link, without text.
    }
  }
  return squeeze(pages.join("\n"));
}

/** The text of a published ruling: a PDF file or a page (its article or main part). */
async function documentText(ctx: SyncContext, url: string): Promise<string | null> {
  const response = await ctx.get(url);
  if (!response) return null;
  const type = response.headers.get("content-type") ?? "";
  // A PDF is known by its first bytes: some chambers send it as application/octet-stream
  // (OIRP Rzeszów, item.php?id=N with the file name only in content-disposition).
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return pdfText(ctx, bytes);
  if (!/html|text/iu.test(type)) return null;
  const html = new TextDecoder("utf-8").decode(bytes);
  const main = /<article\b[\s\S]*?<\/article>/u.exec(html)?.[0] ?? /<main\b[\s\S]*?<\/main>/u.exec(html)?.[0] ?? html;
  return squeeze(plainText(main.replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/giu, "")));
}

function storeDisciplinary(ctx: SyncContext, seed: DisciplinarySeed, url: string, label: string, text: string | null, source: CaseLawSource = "OSD"): void {
  const head = (text ?? "").slice(0, 2000);
  ctx.store(
    {
      source, sourceId: url, court: seed.body, courtType: source === "OSD" ? "DISCIPLINARY" : "AUTHORITY", division: null,
      signatures: [(source === "OSD" ? disciplinarySignature(label, head, decodeURIComponent(url.split("/").pop() ?? "")) : authoritySignature(label, head)) ?? label.slice(0, 80)].filter(Boolean),
      date: rulingDate(head), kind: source === "OSD" ? (/postanowieni/iu.test(head.slice(0, 300)) ? "postanowienie" : "orzeczenie") : "decyzja",
      judges: [], keywords: [], legalBases: [], summary: null, url, modified: null
    },
    text
  );
}

async function crawlSeed(ctx: SyncContext, seed: CrawlSeed, source: CaseLawSource = "OSD"): Promise<boolean> {
  const queue = [seed.start];
  const seen = new Set(queue);
  const items = new Map<string, string>();
  while (queue.length && ctx.open && seen.size <= 300) {
    const page = queue.shift()!;
    const html = await ctx.html(page);
    if (!html) continue;
    for (const match of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/giu)) {
      let link: URL;
      try {
        link = new URL(match[1]!.replace(/&amp;/gu, "&"), page);
      } catch {
        continue;
      }
      if (link.host !== new URL(seed.start).host) continue;
      const href = link.toString();
      if (seed.item.test(href)) {
        // The link's own text, or (a bare "Pobierz") the table row it sits in.
        let label = squeeze(plainText(match[2]!));
        if (label.length < 12) {
          const row = html.lastIndexOf("<tr", match.index);
          const end = html.indexOf("</tr>", match.index);
          if (row >= 0 && end > row) label = squeeze(plainText(html.slice(row, end)));
        }
        items.set(href, label);
      }
      else if (seed.listing?.test(href) && !seen.has(href)) {
        seen.add(href);
        queue.push(href);
      }
    }
  }
  for (const [url, label] of items) {
    if (!ctx.open) return false;
    if (ctx.db.has(source, url)) continue;
    storeDisciplinary(ctx, seed, url, label, await documentText(ctx, url).catch(() => null), source);
  }
  return ctx.open;
}

async function wpSeed(ctx: SyncContext, seed: WpSeed): Promise<boolean> {
  for (let page = 1; ctx.open; page += 1) {
    const reply = await ctx.get(`${seed.site}/wp-json/wp/v2/posts?search=${encodeURIComponent(seed.search)}&per_page=50&page=${page}&_fields=link,title,content,date`).catch(() => null);
    let posts: Array<{ link?: string; title?: { rendered?: string }; content?: { rendered?: string } }> = [];
    try {
      posts = reply ? ((await reply.json()) as typeof posts) : [];
    } catch {
      return true;
    }
    if (!Array.isArray(posts) || !posts.length) return true;
    for (const post of posts) {
      const title = squeeze(plainText(post.title?.rendered ?? ""));
      if (!post.link || !seed.title.test(title) || ctx.db.has("OSD", post.link)) continue;
      const content = post.content?.rendered ?? "";
      let text = squeeze(plainText(content));
      // A post that only links the ruling ("Treść orzeczenia" -> PDF): the PDF is the text.
      const pdf = /href="([^"]+\.pdf)"/iu.exec(content)?.[1];
      if (pdf && text.length < 400) text = (await documentText(ctx, new URL(pdf.replace(/^http:/u, "https:"), seed.site).toString()).catch(() => null)) ?? text;
      storeDisciplinary(ctx, seed, post.link, title, text);
    }
    if (posts.length < 50) return true;
  }
  return false;
}

type SeedState = { seed: number; rounds: number; lastRoundAt: string | null };

export const disciplinaryAdapter: SyncAdapter = {
  source: "OSD",
  label: "Sądy dyscyplinarne izb radców prawnych i adwokackich (I instancja)",
  progress: (db) => {
    const state = db.state<SeedState>("OSD");
    if (!state) return "nie rozpoczęto";
    const head = state.rounds ? `pełny przegląd izb zakończony ${state.lastRoundAt?.slice(0, 10)}; ` : "";
    return `${head}izba ${state.seed + 1} z ${DISCIPLINARY_SEEDS.length} (${DISCIPLINARY_SEEDS[state.seed]?.body ?? ""})`;
  },
  async run(ctx) {
    let state = ctx.db.state<SeedState>("OSD") ?? { seed: 0, rounds: 0, lastRoundAt: null };
    while (ctx.open) {
      const seed = DISCIPLINARY_SEEDS[state.seed]!;
      const done = "site" in seed ? await wpSeed(ctx, seed) : await crawlSeed(ctx, seed);
      if (!done) break;
      const next = state.seed + 1;
      state = next >= DISCIPLINARY_SEEDS.length ? { seed: 0, rounds: state.rounds + 1, lastRoundAt: ctx.now().toISOString() } : { ...state, seed: next };
      ctx.db.saveState("OSD", state);
      if (state.seed === 0) return;
    }
    ctx.db.saveState("OSD", state);
  }
};

// ── Sejm (api.sejm.gov.pl): prints (bills with their justifications) and legislative processes ──
// The current term first, then the earlier ones; after the full pass every run re-reads the current
// term's lists and fetches what changed (changeDate) since the previous run.
const SEJM = "https://api.sejm.gov.pl/sejm";
const SEJM_PDF_MAX = 12 * 1024 * 1024;

type SejmPrint = { number: string; title?: string; documentDate?: string; changeDate?: string; attachments?: string[] };
type SejmProcess = { number: string; title?: string; processStartDate?: string; changeDate?: string; documentType?: string; ELI?: string; passed?: boolean; stages?: Array<{ stageName?: string; date?: string; children?: Array<{ stageName?: string; date?: string }> }> };
type SejmState = { phase: "FULL" | "INCREMENTAL"; term: number; kind: "prints" | "processes"; index: number; since: string | null; current: number };

async function sejmPrint(ctx: SyncContext, term: number, print: SejmPrint): Promise<void> {
  const parts: string[] = [];
  for (const name of (print.attachments ?? []).filter((file) => /\.pdf$/iu.test(file))) {
    if (!ctx.open) break;
    const reply = await ctx.get(`${SEJM}/term${term}/prints/${encodeURIComponent(print.number)}/${encodeURIComponent(name)}`).catch(() => null);
    if (!reply) continue;
    const bytes = new Uint8Array(await reply.arrayBuffer());
    if (bytes.length <= SEJM_PDF_MAX) parts.push(await pdfText(ctx, bytes).catch(() => ""));
  }
  ctx.store(
    {
      source: "SEJM", sourceId: `druk:${term}/${print.number}`, court: "Sejm RP", courtType: "LEGISLATIVE", division: `${term}. kadencja`,
      signatures: [`druk nr ${print.number} (${term}. kadencja)`], date: print.documentDate ?? null, kind: "druk sejmowy", judges: [], keywords: [],
      legalBases: [], summary: print.title ?? null, url: `${SEJM}/term${term}/prints/${encodeURIComponent(print.number)}`, modified: print.changeDate ?? null
    },
    parts.filter(Boolean).join("\n\n") || print.title || null
  );
}

async function sejmProcess(ctx: SyncContext, term: number, number: string): Promise<void> {
  const reply = await ctx.get(`${SEJM}/term${term}/processes/${encodeURIComponent(number)}`, { headers: { accept: "application/json" } });
  if (!reply) return;
  const process = (await reply.json()) as SejmProcess;
  const stages = (process.stages ?? []).flatMap((stage) => [`${stage.date ?? ""} ${stage.stageName ?? ""}`, ...(stage.children ?? []).map((child) => `  ${child.date ?? ""} ${child.stageName ?? ""}`)]);
  ctx.store(
    {
      source: "SEJM", sourceId: `proces:${term}/${number}`, court: "Sejm RP", courtType: "LEGISLATIVE", division: `${term}. kadencja`,
      signatures: [`proces nr ${number} (${term}. kadencja)`, ...(process.ELI ? [process.ELI] : [])], date: process.processStartDate ?? null,
      kind: `przebieg procesu legislacyjnego${process.documentType ? ` — ${process.documentType}` : ""}`, judges: [], keywords: [], legalBases: [],
      summary: process.title ?? null, url: `${SEJM}/term${term}/processes/${encodeURIComponent(number)}`, modified: process.changeDate ?? null
    },
    [process.title ?? "", process.passed === undefined ? "" : process.passed ? "uchwalono" : "", ...stages].filter(Boolean).join("\n")
  );
}

export const sejmAdapter: SyncAdapter = {
  source: "SEJM",
  label: "Sejm — druki i przebieg procesów legislacyjnych",
  progress: (db) => {
    const state = db.state<SejmState>("SEJM");
    if (!state) return "nie rozpoczęto";
    if (state.phase === "INCREMENTAL") return `pobrane w całości (${state.since?.slice(0, 10) ?? "?"}); dociąganie zmian bieżącej kadencji`;
    return `pełne pobieranie: ${state.term}. kadencja, ${state.kind === "prints" ? "druki" : "procesy"}, pozycja ${state.index + 1}`;
  },
  async run(ctx) {
    const terms = (await (await ctx.get(`${SEJM}/term`, { headers: { accept: "application/json" } }))?.json()) as Array<{ num: number; current?: boolean }> | undefined;
    const current = terms?.find((term) => term.current)?.num ?? terms?.at(-1)?.num ?? 10;
    let state = ctx.db.state<SejmState>("SEJM") ?? { phase: "FULL", term: current, kind: "prints", index: 0, since: null, current };
    const save = () => ctx.db.saveState("SEJM", state);
    const list = async <T>(term: number, kind: "prints" | "processes"): Promise<T[]> => {
      const reply = await ctx.get(`${SEJM}/term${term}/${kind}${kind === "processes" ? "?limit=5000" : ""}`, { headers: { accept: "application/json" } }).catch(() => null);
      return reply ? ((await reply.json()) as T[]) : [];
    };
    if (state.phase === "INCREMENTAL") {
      // The current term's lists, only what changed since the previous run (a new term starts its full pass).
      const since = state.since ?? "";
      const startedAt = ctx.now().toISOString();
      if (current !== state.current) state = { phase: "FULL", term: current, kind: "prints", index: 0, since: null, current };
      else {
        for (const print of await list<SejmPrint>(current, "prints")) {
          if (!ctx.open) return save();
          if ((print.changeDate ?? "") > since.slice(0, 19)) await sejmPrint(ctx, current, print);
        }
        for (const process of await list<SejmProcess>(current, "processes")) {
          if (!ctx.open) return save();
          if ((process.changeDate ?? "") > since.slice(0, 19)) await sejmProcess(ctx, current, process.number);
        }
        state = { ...state, since: startedAt };
        return save();
      }
    }
    while (ctx.open) {
      const items = state.kind === "prints" ? await list<SejmPrint>(state.term, "prints") : await list<SejmProcess>(state.term, "processes");
      for (; state.index < items.length && ctx.open; state.index += 1) {
        const item = items[state.index]!;
        const id = `${state.kind === "prints" ? "druk" : "proces"}:${state.term}/${item.number}`;
        if (!ctx.db.has("SEJM", id)) {
          if (state.kind === "prints") await sejmPrint(ctx, state.term, item as SejmPrint);
          else await sejmProcess(ctx, state.term, item.number);
        }
        save();
      }
      if (state.index < items.length) return save();
      if (state.kind === "prints") state = { ...state, kind: "processes", index: 0 };
      else if (state.term > 1) state = { ...state, term: state.term - 1, kind: "prints", index: 0 };
      else state = { phase: "INCREMENTAL", term: current, kind: "prints", index: 0, since: ctx.now().toISOString(), current };
      save();
      if (state.phase === "INCREMENTAL") return;
    }
  }
};

// ── DOCX text (word/document.xml) without a zip library ──
export function docxText(data: Uint8Array): string {
  const buffer = Buffer.from(data);
  // End of central directory: the last "PK\x05\x06".
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return "";
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  for (let n = 0; n < count && at + 46 <= buffer.length; n += 1) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    if (name === "word/document.xml") {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const raw = buffer.subarray(start, start + size);
      const xml = (method === 8 ? inflateRawSync(raw) : raw).toString("utf8");
      return squeeze(plainText(xml.replace(/<\/w:p>/gu, "</p>").replace(/<w:tab\/>/gu, " ")));
    }
    at += 46 + nameLength + extra + comment;
  }
  return "";
}

// ── NIL (Portal Orzeczeń Sądowych, SharePoint): on the session the user opened in the application ──
export const NIL_HOST = "naczelnaizbalekarska.sharepoint.com";
const NIL_SITE = `https://${NIL_HOST}/sites/POS`;
const NIL_FOLDERS: Array<[string, string]> = [["NSL", "Naczelny Sąd Lekarski"], ["OSL", "Okręgowe sądy lekarskie"]];
export const NIL_WAITING = "czeka na otwarcie folderu NIL w oknie aplikacji (Baza orzeczeń → „Otwórz folder NIL”); pobieranie idzie na Twojej sesji i wznowi się samo";

type NilFile = { Name: string; ServerRelativeUrl: string; TimeLastModified?: string };

export const nilAdapter: SyncAdapter = {
  source: "NIL",
  label: "NIL — prawomocne orzeczenia sądów lekarskich",
  progress: (db) => {
    const waiting = db.state<{ at: string }>("NIL:waiting");
    const state = db.state<{ completedAt: string | null }>("NIL");
    const base = state?.completedAt ? `pobrane w całości (${state.completedAt.slice(0, 10)}); dociąganie nowych` : state ? "pełne pobieranie w toku" : "nie rozpoczęto";
    return waiting ? `${base}; ${NIL_WAITING}` : base;
  },
  async run(ctx) {
    const session = lawSourceSessionHeaders(NIL_HOST);
    const wait = () => {
      ctx.waiting = NIL_WAITING;
      ctx.db.saveState("NIL:waiting", { at: ctx.now().toISOString() });
    };
    if (!session) return wait();
    const headers = { ...session, accept: "application/json;odata=nometadata" };
    try {
      for (const [folder, court] of NIL_FOLDERS) {
        const path = `/sites/POS/Shared Documents/PRAWOMOCNE ORZECZENIA/${folder}`;
        const list = await ctx.get(`${NIL_SITE}/_api/web/GetFolderByServerRelativeUrl('${encodeURIComponent(path)}')/Files?$select=Name,ServerRelativeUrl,TimeLastModified&$top=5000`, { headers });
        const files = ((list ? await list.json() : {}) as { value?: NilFile[] }).value ?? [];
        for (const file of files) {
          if (!ctx.open) return;
          if (ctx.db.has("NIL", file.ServerRelativeUrl)) continue;
          const reply = await ctx.get(`${NIL_SITE}/_api/web/GetFileByServerRelativeUrl('${encodeURIComponent(file.ServerRelativeUrl)}')/$value`, { headers: session });
          if (!reply) continue;
          const bytes = new Uint8Array(await reply.arrayBuffer());
          const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
          const text = isPdf ? await pdfText(ctx, bytes).catch(() => "") : /\.docx$/iu.test(file.Name) ? docxText(bytes) : "";
          const name = file.Name.replace(/\.(pdf|docx?)$/iu, "");
          ctx.store(
            {
              source: "NIL", sourceId: file.ServerRelativeUrl, court, courtType: "DISCIPLINARY", division: folder,
              signatures: [disciplinarySignature(text.slice(0, 1500)) ?? name], date: rulingDate(text.slice(0, 3000)), kind: "orzeczenie sądu lekarskiego",
              judges: [], keywords: [], legalBases: [], summary: null, url: `https://${NIL_HOST}${encodeURI(file.ServerRelativeUrl)}`, modified: file.TimeLastModified ?? null
            },
            text
          );
        }
      }
      ctx.db.saveState("NIL", { completedAt: ctx.now().toISOString() });
      ctx.db.saveState("NIL:waiting", null);
    } catch (error) {
      // The session ran out or lacks rights to the files: wait for the user's window again.
      if (/HTTP_40[13]/u.test(error instanceof Error ? error.message : String(error))) return wait();
      throw error;
    }
  }
};

// ── Decisions of authorities published as tables of files (URE) ──
const AUTHORITY_SIGNATURE = /\b([A-ZŁŚŻ]{2,5}(?:[.-][A-Z0-9]{1,6})*[ .-]?\d{1,5}\/\d{4}|[A-ZŁŚŻ][a-ząćęłńóśźż]{2,12} \d{1,5}\/\d{4}|[IVXL]{1,5}\.\d{3,4}(?:\.\d{1,5}){1,3}\.\d{4})\b/u;
export function authoritySignature(...texts: string[]): string | null {
  for (const text of texts) {
    const found = AUTHORITY_SIGNATURE.exec(text.normalize("NFKC"))?.[1];
    if (found) return squeeze(found);
  }
  return null;
}

const URE_START = "https://bip.ure.gov.pl/bip/taryfy-i-inne-decyzje-b";
export const URE_SEEDS: CrawlSeed[] = ["cieplo", "energia-elektryczna", "inne-decyzje-informacj", "paliwa-ciekle", "paliwa-gazowe", "wodor"].map((part) => ({
  id: `ure-${part}`,
  body: "Prezes Urzędu Regulacji Energetyki",
  start: `${URE_START}/${part}`,
  listing: new RegExp(`/taryfy-i-inne-decyzje-b/${part}/\\d+,[^/]+\\.html$`, "u"),
  item: /\/download\/[^?#]+$/u
}));

export const ureAdapter: SyncAdapter = {
  source: "URE",
  label: "URE — decyzje, taryfy i informacje Prezesa URE",
  progress: (db) => {
    const state = db.state<SeedState>("URE");
    if (!state) return "nie rozpoczęto";
    const head = state.rounds ? `pełny przegląd zakończony ${state.lastRoundAt?.slice(0, 10)}; ` : "";
    return `${head}dział ${state.seed + 1} z ${URE_SEEDS.length} (${URE_SEEDS[state.seed]?.id.replace("ure-", "") ?? ""})`;
  },
  async run(ctx) {
    let state = ctx.db.state<SeedState>("URE") ?? { seed: 0, rounds: 0, lastRoundAt: null };
    while (ctx.open) {
      if (!(await crawlSeed(ctx, URE_SEEDS[state.seed]!, "URE"))) break;
      const next = state.seed + 1;
      state = next >= URE_SEEDS.length ? { seed: 0, rounds: state.rounds + 1, lastRoundAt: ctx.now().toISOString() } : { ...state, seed: next };
      ctx.db.saveState("URE", state);
      if (state.seed === 0) return;
    }
    ctx.db.saveState("URE", state);
  }
};

// ── RPO (bip.brpo.gov.pl): general submissions, on the session the user opened in the application ──
export const RPO_HOST = "bip.brpo.gov.pl";
const RPO_LIST = "https://bip.brpo.gov.pl/sprawy-generalne/index.php?p_rodzaj=8779";
export const RPO_WAITING = "czeka na potwierdzenie w oknie BIP RPO (Baza orzeczeń → „Otwórz BIP RPO”); pobieranie idzie na Twojej sesji i wznowi się samo";
const isImpervaPage = (html: string) => /_Incapsula_Resource|Incapsula incident/u.test(html.slice(0, 4000));

export const rpoAdapter: SyncAdapter = {
  source: "RPO",
  label: "RPO — wystąpienia generalne Rzecznika Praw Obywatelskich",
  progress: (db) => {
    const waiting = db.state<{ at: string }>("RPO:waiting");
    const state = db.state<{ completedAt: string | null }>("RPO");
    const base = state?.completedAt ? `pobrane w całości (${state.completedAt.slice(0, 10)}); dociąganie nowych` : state ? "pełne pobieranie w toku" : "nie rozpoczęto";
    return waiting ? `${base}; ${RPO_WAITING}` : base;
  },
  async run(ctx) {
    const session = lawSourceSessionHeaders(RPO_HOST);
    const wait = () => {
      ctx.waiting = RPO_WAITING;
      ctx.db.saveState("RPO:waiting", { at: ctx.now().toISOString() });
    };
    if (!session) return wait();
    try {
      const list = (await ctx.html(RPO_LIST, { headers: session })) ?? "";
      if (isImpervaPage(list)) return wait();
      // One row per submission: its link to the case page and the row's text (addressee, reference, date, subject).
      for (const row of list.split(/<tr\b/iu).slice(1)) {
        if (!ctx.open) return;
        const href = /href="([^"#]+)"/u.exec(row)?.[1];
        if (!href) continue;
        const url = new URL(href.replace(/&amp;/gu, "&"), RPO_LIST).toString();
        if (new URL(url).host !== RPO_HOST || url === RPO_LIST || ctx.db.has("RPO", url)) continue;
        const summary = squeeze(plainText(row.slice(0, row.search(/<\/tr>/iu) > 0 ? row.search(/<\/tr>/iu) : undefined)));
        const page = await ctx.html(url, { headers: session });
        if (page && isImpervaPage(page)) return wait();
        const main = page ? /<article\b[\s\S]*?<\/article>/u.exec(page)?.[0] ?? /<main\b[\s\S]*?<\/main>/u.exec(page)?.[0] ?? page : "";
        const text = main ? squeeze(plainText(main.replace(/<(?:nav|header|footer|aside)\b[\s\S]*?<\/(?:nav|header|footer|aside)>/giu, ""))) : null;
        ctx.store(
          {
            source: "RPO", sourceId: url, court: "Rzecznik Praw Obywatelskich", courtType: "AUTHORITY", division: null,
            signatures: [authoritySignature(summary) ?? summary.slice(0, 80)], date: (/(\d{4}-\d{2}-\d{2})/u.exec(summary)?.[1]) ?? numericDate(summary),
            kind: "wystąpienie generalne", judges: [], keywords: [], legalBases: [], summary, url, modified: null
          },
          text ?? summary
        );
      }
      ctx.db.saveState("RPO", { completedAt: ctx.now().toISOString() });
      ctx.db.saveState("RPO:waiting", null);
    } catch (error) {
      if (/HTTP_40[13]/u.test(error instanceof Error ? error.message : String(error))) return wait();
      throw error;
    }
  }
};

export const CASE_LAW_ADAPTERS: SyncAdapter[] = [spAdapter, cbosaAdapter, snAdapter, tkAdapter, kioAdapter, uodoAdapter, eurekaAdapter, wsdAdapter, disciplinaryAdapter, nilAdapter, rpoAdapter, ureAdapter, sejmAdapter];

// ── schedule and status ──

/** Sources not downloaded as a whole, with the reason shown in the settings window. */
export const CASE_LAW_NOT_BULK: Array<{ source: string; reason: string }> = [
  { source: "SAOS", reason: "kopia nieoficjalna — używana tylko do wyszukiwania, bez pobierania i bez zapisu w bazie" },
  { source: "WSD KIRP", reason: "orzeczenia nie są już publikowane (wsd.kirp.pl przekierowuje na kirp.pl)" },
  { source: "ORKA2 (Sejm)", reason: "serwis chroniony przed automatami; druki i procesy pobierane z API Sejmu (źródło „Sejm”)" },
  { source: "UOKiK, dzienniki urzędowe", reason: "moduł pobierania w przygotowaniu" },
  { source: "OIRP Toruń", reason: "lista orzeczeń ładowana skryptem (menedżer plików), bez adresów do pobrania" },
  { source: "Pozostałe izby", reason: "brak publicznego archiwum orzeczeń I instancji (DR-12, tabela izb)" }
];

type AdapterRun = { at: string; requests: number; stored: number; duplicates: number; error?: string; waiting?: string };
const runs = new Map<string, AdapterRun>();
const running = new Set<string>();
let syncActive = false;

export type CaseLawSyncOptions = {
  isServerMode?: () => boolean;
  fetcher?: SyncFetch;
  /** sn.pl requests with the session the user verified in the app's window. */
  snFetcher?: SyncFetch;
  intervalMs?: number;
  budget?: number;
  gapMs?: number;
  adapters?: SyncAdapter[];
  database?: () => CaseLawDatabase;
  /** Local OCR for scanned rulings (disciplinary courts publish scans). */
  ocr?: OcrEngine | null;
};

/** One run of one adapter; its state is saved by the adapter, so an error loses nothing. */
export async function runAdapter(adapter: SyncAdapter, database: CaseLawDatabase, fetcher: SyncFetch, budget: number, gapMs: number, now: () => Date = () => new Date(), ocr: OcrEngine | null = null): Promise<AdapterRun> {
  const ctx = new SyncContext(database, fetcher, budget, gapMs, now, ocr);
  let error: string | undefined;
  try {
    await adapter.run(ctx);
  } catch (caught) {
    error = (caught instanceof Error ? caught.message : String(caught)).slice(0, 200);
  }
  return { at: now().toISOString(), requests: ctx.requests, stored: ctx.stored, duplicates: ctx.duplicates, ...(error ? { error } : {}), ...(ctx.waiting ? { waiting: ctx.waiting } : {}) };
}

/**
 * Background download of the whole official bases: in server mode (LEX_CASE_LAW_SYNC=1 also on a
 * desktop; =0 turns it off). Every tick starts each source that is not running, with a request
 * budget; the sources run side by side (different hosts), each at most one run at a time.
 */
export function startCaseLawSync(options: CaseLawSyncOptions = {}): () => void {
  const isServerMode = options.isServerMode ?? (() => false);
  const fetcher = options.fetcher ?? (globalThis.fetch.bind(globalThis) as SyncFetch);
  const adapters = options.adapters ?? CASE_LAW_ADAPTERS;
  const budget = options.budget ?? 600;
  const gapMs = options.gapMs ?? 1_000;
  const wanted = () => process.env.LEX_CASE_LAW_SYNC === "1" || (process.env.LEX_CASE_LAW_SYNC !== "0" && isServerMode());
  const database =
    options.database ??
    (() => {
      const held = sharedCaseLawDatabase() ?? new CaseLawDatabase(defaultCaseLawDbDir());
      setSharedCaseLawDatabase(held);
      return held;
    });
  const tick = () => {
    syncActive = wanted();
    if (!syncActive) return;
    const db = database();
    for (const adapter of adapters) {
      if (running.has(adapter.source)) continue;
      running.add(adapter.source);
      void runAdapter(adapter, db, adapter.source === "SN" && options.snFetcher ? options.snFetcher : fetcher, budget, gapMs, undefined, options.ocr ?? null)
        .then((run) => runs.set(adapter.source, run))
        .finally(() => running.delete(adapter.source));
    }
  };
  tick();
  const timer = setInterval(tick, options.intervalMs ?? 10 * 60 * 1000);
  timer.unref?.();
  return () => clearInterval(timer);
}

export type CaseLawSourceStatus = { source: string; label: string; documents: number; progress: string; running: boolean; lastRun: AdapterRun | null };

/** What the settings window shows: whether the download runs, and each source's count and place. */
export function caseLawSyncStatus(): { active: boolean; sources: CaseLawSourceStatus[]; notBulk: typeof CASE_LAW_NOT_BULK } {
  const database = sharedCaseLawDatabase();
  return {
    active: syncActive,
    sources: CASE_LAW_ADAPTERS.map((adapter) => ({
      source: adapter.source,
      label: adapter.label,
      documents: database ? database.count(adapter.source) : 0,
      progress: database ? adapter.progress(database) : "nie rozpoczęto",
      running: running.has(adapter.source),
      lastRun: runs.get(adapter.source) ?? null
    })),
    notBulk: CASE_LAW_NOT_BULK
  };
}
