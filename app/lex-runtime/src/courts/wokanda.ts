// The wokanda of a common court: hearings of a case by its signature, read from the court's own
// site on the user's request (one search and the details of each hearing found; never a scan).
// Most courts publish it in the Ministry's court portal (index.php?p=cases): a search by the
// signature's department, repertory, number and year. Courts whose wokanda only a browser opens
// (a browser verification, reCAPTCHA, another system) get its address instead. The register of
// which court publishes how: app/courts/probe_wokanda.py, re-checked from the user's computer.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { courtByName } from "./court-base.js";
import { WOKANDA_REGISTER } from "./wokanda-registry-data.js";
import { isIncompleteChain, missingIntermediate, networkReason, requestWithIntermediate } from "./tls-chain.js";

export type WokandaStatus = "PORTAL" | "BROWSER" | "NONE" | "UNREACHABLE";

// How a readable wokanda searches by signature (app/courts/probe_wokanda.py search_system).
export type WokandaSystem = "MS_PORTAL" | "CMS_FORM" | "GET_FORM" | "POST_FORM" | "DRUPAL_VIEW" | "LIST";

export type WokandaCourt = {
  nazwa: string;
  domena: string;
  status: WokandaStatus;
  url?: string;
  powod?: string;
  system?: WokandaSystem;
  // CMS_FORM: the signature field of its search form ("pole315").
  pole?: string;
};

export type WokandaRegister = { sprawdzono: string; sady: WokandaCourt[] };

export type WokandaHearing = {
  sygnatura: string;
  wydzial: string;
  data: string;
  godzina: string;
  sala: string;
  status: string;
  miejsce?: string;
  przewodniczacy?: string;
  sklad?: string;
  url: string;
};

export type WokandaResult =
  | {
      state: "FOUND" | "NOT_FOUND";
      court: string;
      signature: string;
      searchUrl: string;
      hearings: WokandaHearing[];
      checkedAt: string;
      // The court's wokanda is one list without a search: only the hearings on it were checked.
      note?: string;
    }
  // The court's wokanda needs a browser, or the court publishes none: its address to open.
  | {
      state: "BROWSER_ONLY" | "NO_WOKANDA" | "UNREACHABLE";
      court: string;
      signature: string;
      url?: string;
      reason: string;
      checkedAt: string;
      // A browser verification the user passes in the court's window of the application (as for
      // sn.pl); after it the check runs again with that session.
      verification?: { domain: string; url: string; savedSession: boolean };
    };

export type FetchText = (
  url: string,
  headers?: Record<string, string>,
  init?: { method: "POST"; body: string }
) => Promise<{ status: number; url: string; text: string }>;

export const WOKANDA_USER_AGENT = "LexMachina (wokanda; zapytanie uzytkownika o jego sprawe)";
const TIMEOUT_MS = 20_000;
const MAX_HEARINGS = 10;
// A browser verification page (JavaScript challenge), reCAPTCHA or a similar guard: the
// application does not get past it and gives the address instead.
const GUARD = /weryfikacja przeglądarki|g-recaptcha|recaptcha_response|mosparo|cf-challenge/iu;

export const defaultFetchText: FetchText = async (url, headers = {}, init) => {
  const allHeaders = { "user-agent": WOKANDA_USER_AGENT, ...(init ? { "content-type": "application/x-www-form-urlencoded" } : {}), ...headers };
  try {
    const response = await fetch(url, {
      headers: allHeaders,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      ...(init ? { method: init.method, body: init.body } : {})
    });
    const text = await response.text();
    return { status: response.status, url: response.url || url, text: text.slice(0, 1_000_000) };
  } catch (error) {
    // A court site without its intermediate certificate: fetched the way a browser does.
    if (!isIncompleteChain(error)) throw error;
    const intermediate = await missingIntermediate(new URL(url).hostname);
    if (!intermediate) throw error;
    return await requestWithIntermediate(url, intermediate, allHeaders, init);
  }
};

// --- Sessions after a browser verification done by the user --------------------------------
// As for sn.pl: the user passes the court's verification in the application's window of that
// court; its cookies and the browser's User-Agent serve this user's wokanda queries to that
// court. Never returned or logged; sealed on disk by the store set with
// configureWokandaSessionStore, so a verification survives a restart (report 2026-11-11).
// A court that no longer accepts the session asks for the window again.

type WokandaSession = { cookie: string; userAgent: string; at: number };
const sessions = new Map<string, WokandaSession>();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type WokandaSessionStore = {
  load(): Record<string, WokandaSession>;
  save(all: Record<string, WokandaSession>): void;
};
let sessionStore: WokandaSessionStore | null = null;

export function configureWokandaSessionStore(store: WokandaSessionStore | null): void {
  sessionStore = store;
  if (!store) return;
  for (const [domain, session] of Object.entries(store.load())) {
    if (Date.now() - session.at <= SESSION_TTL_MS && !sessions.has(domain)) sessions.set(domain, session);
  }
}

function persistSessions(): void {
  if (!sessionStore) return;
  const all: Record<string, WokandaSession> = {};
  for (const [domain, session] of sessions) {
    if (Date.now() - session.at <= SESSION_TTL_MS) all[domain] = session;
  }
  sessionStore.save(all);
}

/** Courts with a kept verification session (names of domains only, never the cookies). */
export function wokandaSessionDomains(): string[] {
  return [...sessions].filter(([, session]) => Date.now() - session.at <= SESSION_TTL_MS).map(([domain]) => domain);
}

export function courtDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./u, "");
}

function sessionHeaders(domain: string): Record<string, string> | null {
  const session = sessions.get(courtDomain(domain));
  if (!session || Date.now() - session.at > SESSION_TTL_MS) return null;
  return { cookie: session.cookie, "user-agent": session.userAgent };
}

export function setWokandaSession(domain: string, cookie: string, userAgent: string): void {
  if (!cookie.trim() || cookie.length > 16_384 || /[\r\n]/u.test(cookie + userAgent) || userAgent.length > 512) throw new Error("WOKANDA_SESSION_INVALID");
  sessions.set(courtDomain(domain), { cookie: cookie.trim(), userAgent: userAgent.trim() || WOKANDA_USER_AGENT, at: Date.now() });
  persistSessions();
}

export function clearWokandaSessions(): void {
  sessions.clear();
  persistSessions();
}

/** The court's wokanda page read with the window's cookies: the portal answered, the session is kept. */
export async function probeWokandaSession(domain: string, cookie: string, userAgent: string, fetchText: FetchText = defaultFetchText): Promise<{ ready: boolean }> {
  const court = WOKANDA_REGISTER.sady.find((item) => item.domena === courtDomain(domain));
  if (!court) throw new Error("WOKANDA_COURT_UNKNOWN");
  if (!cookie.trim()) return { ready: false };
  try {
    const page = await fetchText(`https://${court.domena}/wokanda`, { cookie, "user-agent": userAgent || WOKANDA_USER_AGENT });
    const ready = page.status === 200 && !GUARD.test(page.text) && page.text.includes('name="nrspr"');
    if (ready) setWokandaSession(court.domena, cookie, userAgent);
    return { ready };
  } catch {
    return { ready: false };
  }
}

/** "XI C 1768/26" -> department XI, repertory C, number 1768, year 2026. */
export function parseCommonSignature(value: string): { wydzial: string; repertorium: string; numer: string; rok: string } | null {
  const text = value.normalize("NFKC").replace(/^sygn\.?\s*(?:akt)?\s*:?\s*/iu, "").replace(/\s+/gu, " ").trim();
  const match = /^([IVXL]{1,6}) ([0-9]?[A-Z][A-Za-z]{0,5}(?:-[A-Za-z]+)?) (\d{1,6})\/(\d{2}|\d{4})$/u.exec(text);
  if (!match) return null;
  const [, wydzial, repertorium, numer, rok] = match as unknown as [string, string, string, string, string];
  return { wydzial, repertorium, numer, rok: rok.length === 2 ? `20${rok}` : rok };
}

export function wokandaRegister(): WokandaRegister {
  return WOKANDA_REGISTER;
}

export function wokandaCourt(name: string): WokandaCourt | null {
  const canonical = courtByName(name)?.nazwa ?? name;
  return WOKANDA_REGISTER.sady.find((court) => court.nazwa === canonical) ?? null;
}

/** The portal's search address for one signature. */
export function portalSearchUrl(portalUrl: string, signature: ReturnType<typeof parseCommonSignature> & object): string {
  const root = /^https?:\/\/[^/]+/u.exec(portalUrl)?.[0] ?? portalUrl;
  const query = new URLSearchParams({
    p: "cases",
    action: "search",
    nr_wydzial: signature.wydzial,
    reper: signature.repertorium,
    nrspr: signature.numer,
    rok_rozpr: signature.rok,
    wydzial: "0",
    data: "",
    godz: "",
    sala: ""
  });
  return `${root}/index.php?${query.toString()}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/gu, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/giu, (entity, code: string) =>
      code.startsWith("#x") ? String.fromCodePoint(parseInt(code.slice(2), 16)) : code.startsWith("#") ? String.fromCodePoint(Number(code.slice(1))) : (ENTITIES[code.toLowerCase()] ?? entity)
    )
    .replace(/\s+/gu, " ")
    .trim();
}

function field(block: string, label: string): string {
  const match = new RegExp(`${label}\\s*:\\s*<span[^>]*>([\\s\\S]*?)</span>`, "iu").exec(block);
  return match ? plain(match[1]!) : "";
}

/** Hearings listed by the portal's search (results page). */
export function parsePortalResults(html: string, pageUrl: string): WokandaHearing[] {
  const start = html.indexOf("cases-results-wrapper");
  if (start < 0) return [];
  const root = /^https?:\/\/[^/]+/u.exec(pageUrl)?.[0] ?? "";
  return [...html.slice(start).matchAll(/<li>\s*<div class="row">([\s\S]*?)<\/li>/gu)]
    .map((match) => match[1]!)
    .map((block) => {
      const link = /href="([^"]+)"[^>]*class="more-link"/u.exec(block)?.[1] ?? "";
      return {
        sygnatura: field(block, "Sygnatura sprawy"),
        wydzial: field(block, "Wydział"),
        status: field(block, "Status"),
        data: field(block, "Data"),
        sala: field(block, "Sala"),
        godzina: field(block, "Godzina"),
        url: link ? (link.startsWith("http") ? link : `${root}/${link.replace(/^\//u, "")}`) : pageUrl
      };
    })
    .filter((hearing) => hearing.sygnatura && /^\d{4}-\d{2}-\d{2}$/u.test(hearing.data));
}

/** The hearing's details page: place, presiding judge and the rest of the bench. */
export function parsePortalDetails(html: string): Partial<Pick<WokandaHearing, "miejsce" | "przewodniczacy" | "sklad" | "godzina">> {
  const text = plain(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gu, " "));
  const after = (label: string, next: string) => {
    const match = new RegExp(`${label}:\\s*(.*?)\\s*(?:${next})[^:]{0,40}:`, "u").exec(text);
    return match?.[1]?.trim() || undefined;
  };
  const godzina = after("Godzina", "Przewodniczący|Pozostały skład|Sygnatura akt");
  const miejsce = after("Miejsce", "Sala");
  const przewodniczacy = after("Przewodniczący", "Pozostały skład sędziowski|Sygnatura akt");
  const sklad = after("Pozostały skład sędziowski", "Sygnatura akt");
  return {
    ...(miejsce ? { miejsce } : {}),
    ...(przewodniczacy ? { przewodniczacy } : {}),
    ...(sklad ? { sklad } : {}),
    ...(godzina ? { godzina: godzina.replace(/^(\d{2}:\d{2}):\d{2}$/u, "$1") } : {})
  };
}

// --- Other wokanda systems: tables with a header row, or labelled records ------------------

function cells(row: string, tag: "td" | "th" | "t[hd]"): string[] {
  return [...row.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag === "t[hd]" ? "t[hd]" : tag}>`, "giu"))].map((match) => plain(match[1]!));
}

const COLUMN: Array<[keyof WokandaHearing, RegExp]> = [
  ["sygnatura", /^sygn/u],
  ["godzina", /^godz/u],
  ["data", /^data|^termin/u],
  ["sala", /^sala/u],
  ["wydzial", /^wydz/u],
  ["przewodniczacy", /^przewodn|^sedzi|^sklad/u],
  ["status", /^status|^komunikat|^uwagi/u]
];

const foldLabel = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/gu, "l").toLowerCase().trim();

/** "04.11.2026", "2026-11-04 09:15", "2026-11-05 09:00:00" -> date and time. */
export function wokandaDateTime(value: string): { data: string; godzina: string } | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/u.exec(value);
  const pl = /(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/u.exec(value);
  if (iso) return { data: `${iso[1]}-${iso[2]}-${iso[3]}`, godzina: iso[4] ? `${iso[4].padStart(2, "0")}:${iso[5]}` : "" };
  if (pl) return { data: `${pl[3]}-${pl[2]!.padStart(2, "0")}-${pl[1]!.padStart(2, "0")}`, godzina: pl[4] ? `${pl[4].padStart(2, "0")}:${pl[5]}` : "" };
  return null;
}

/** Hearings of every table whose header names a signature and a date (any column order). */
export function parseTableHearings(html: string, pageUrl: string): WokandaHearing[] {
  const root = /^https?:\/\/[^/]+/u.exec(pageUrl)?.[0] ?? "";
  const out: WokandaHearing[] = [];
  for (const table of html.match(/<table\b[\s\S]*?<\/table>/giu) ?? []) {
    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/giu) ?? [];
    const headerRow = rows.find((row) => /<th\b/iu.test(row));
    if (!headerRow) continue;
    const columns = cells(headerRow, "th").map((label) => COLUMN.find(([, pattern]) => pattern.test(foldLabel(label)))?.[0] ?? null);
    if (!columns.includes("sygnatura") || !columns.includes("data")) continue;
    for (const row of rows) {
      if (row === headerRow) continue;
      const values = cells(row, "td");
      if (values.length < 2) continue;
      const record: Partial<Record<keyof WokandaHearing, string>> = {};
      columns.forEach((column, index) => {
        if (column && values[index] !== undefined) record[column] = values[index]!;
      });
      const when = wokandaDateTime(record.data ?? "");
      if (!record.sygnatura || !when) continue;
      const link = /href="([^"]+)"/u.exec(row)?.[1];
      out.push({
        sygnatura: record.sygnatura.replace(/\s+/gu, " ").trim(),
        wydzial: record.wydzial ?? "",
        data: when.data,
        godzina: (record.godzina ? wokandaDateTime(`2000-01-01 ${record.godzina}`)?.godzina : "") || when.godzina,
        sala: record.sala ?? "",
        status: record.status ?? "",
        ...(record.przewodniczacy ? { przewodniczacy: record.przewodniczacy } : {}),
        url: link ? (link.startsWith("http") ? link : `${root}/${link.replace(/^\//u, "")}`) : pageUrl
      });
    }
  }
  return out;
}

/** One hearing per table of label rows ("<th>Sygnatura</th><td>V RC 631/2026</td>"). */
export function parseVerticalHearings(html: string, pageUrl: string): WokandaHearing[] {
  const out: WokandaHearing[] = [];
  for (const table of html.match(/<table\b[\s\S]*?<\/table>/giu) ?? []) {
    const record: Partial<Record<keyof WokandaHearing, string>> = {};
    for (const row of table.match(/<tr\b[\s\S]*?<\/tr>/giu) ?? []) {
      const label = cells(row, "th")[0];
      const value = cells(row, "td")[0];
      const column = label ? COLUMN.find(([, pattern]) => pattern.test(foldLabel(label)))?.[0] : undefined;
      if (column && value !== undefined) record[column] = value;
    }
    const when = wokandaDateTime(`${record.data ?? ""} ${record.godzina ?? ""}`);
    if (!record.sygnatura || !when) continue;
    out.push({
      sygnatura: record.sygnatura.replace(/\s+/gu, " ").trim(),
      wydzial: record.wydzial ?? "",
      data: when.data,
      godzina: when.godzina,
      sala: record.sala ?? "",
      status: record.status ?? "",
      ...(record.przewodniczacy ? { przewodniczacy: record.przewodniczacy } : {}),
      url: pageUrl
    });
  }
  return out;
}

/** Hearings written as labelled records ("Sygnatura sprawy: … Data: … Sala: … Godzina: …"). */
export function parseLabeledHearings(html: string, pageUrl: string): WokandaHearing[] {
  const text = plain(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gu, " "));
  const labels = "Sygnatura sprawy|Wydział|Data|Sala|Godzina|Przewodniczący|Skład|Status";
  return text
    .split(/(?=Sygnatura sprawy:)/u)
    .slice(1)
    .map((block) => {
      const get = (label: string) => new RegExp(`${label}:\\s*(.*?)\\s*(?=(?:${labels}):|więcej|$)`, "u").exec(block)?.[1]?.trim() ?? "";
      const when = wokandaDateTime(`${get("Data")} ${get("Godzina")}`);
      const przewodniczacy = get("Przewodniczący");
      return when
        ? { sygnatura: get("Sygnatura sprawy"), wydzial: get("Wydział"), data: when.data, godzina: when.godzina, sala: get("Sala"), status: get("Status"), ...(przewodniczacy ? { przewodniczacy } : {}), url: pageUrl }
        : null;
    })
    .filter((hearing): hearing is WokandaHearing => Boolean(hearing?.sygnatura));
}

/** The request of one system's search by signature (CMS_FORM reads its form first). */
async function otherSystemPage(court: WokandaCourt, signature: string, fetchPage: FetchText): Promise<{ status: number; url: string; text: string; searchUrl: string }> {
  const url = court.url ?? `https://${court.domena}/wokanda`;
  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
  switch (court.system) {
    case "CMS_FORM": {
      // The form's own fields (names change between courts and versions): the signature in
      // the "Sygnatura" field, the rest empty, the default sort and page size.
      const page = await fetchPage(url);
      const formHtml = /<form\b[^>]*id="form_search\d+"[\s\S]*?<\/form>/u.exec(page.text)?.[0] ?? "";
      const field = court.pole && formHtml.includes(`name="${court.pole}"`) ? court.pole : /name="(pole\d+)"/u.exec(formHtml)?.[1];
      if (!field) return { ...page, searchUrl: url };
      const fields: Record<string, string> = {};
      for (const match of formHtml.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*>/gu)) {
        if (/type="(?:checkbox|submit)"/u.test(match[0])) continue;
        fields[match[1]!] = /value="([^"]*)"/u.exec(match[0])?.[1] ?? "";
      }
      for (const match of formHtml.matchAll(/<select\b[^>]*name="([^"]+)"[\s\S]*?<\/select>/gu)) {
        const options = match[0].match(/<option\b[^>]*>/gu) ?? [];
        const chosen = options.find((option) => /\sselected\b/u.test(option)) ?? options[0] ?? "";
        fields[match[1]!] = /value="([^"]*)"/u.exec(chosen)?.[1] ?? "";
      }
      fields[field] = signature;
      const action = /<form\b[^>]*action="([^"]+)"/u.exec(formHtml)?.[1] ?? url;
      const target = action.startsWith("http") ? action : `${/^https?:\/\/[^/]+/u.exec(page.url)?.[0] ?? ""}${action.startsWith("/") ? "" : "/"}${action}`;
      return { ...(await fetchPage(target, {}, { method: "POST", body: form(fields) })), searchUrl: url };
    }
    case "GET_FORM": {
      const searchUrl = `${url}${url.includes("?") ? "&" : "?"}${form({ sygnatura: signature, wydzial: "", data: "", szukaj: "" })}`;
      return { ...(await fetchPage(searchUrl)), searchUrl };
    }
    case "POST_FORM":
      return { ...(await fetchPage(url, {}, { method: "POST", body: form({ akcja: "szukaj", sygnatura: signature }) })), searchUrl: url };
    case "DRUPAL_VIEW": {
      const searchUrl = `${url}${url.includes("?") ? "&" : "?"}${form({ field_sygnatura_value: signature })}`;
      return { ...(await fetchPage(searchUrl)), searchUrl };
    }
    default:
      return { ...(await fetchPage(url)), searchUrl: url };
  }
}

/**
 * The same case: repertory, number and year equal (a 2- or 4-digit year), the department too
 * when both name it. Some wokandy list "K 151/2026" for "II K 151/26".
 */
export function sameSignature(a: string, b: string): boolean {
  const parts = (value: string) => {
    const match = /^(?:([IVXL]{1,6})\s+)?([0-9]?[A-Za-z][A-Za-z]{0,5}(?:-[A-Za-z]+)?)\s+(\d{1,6})\/(\d{2}|\d{4})$/u.exec(value.normalize("NFKC").replace(/\s+/gu, " ").trim());
    return match ? { wydzial: match[1] ?? "", repertorium: match[2]!.toLowerCase(), numer: String(Number(match[3])), rok: match[4]!.length === 2 ? `20${match[4]}` : match[4]! } : null;
  };
  const x = parts(a);
  const y = parts(b);
  if (!x || !y) return a.replace(/\s+/gu, " ").trim().toLowerCase() === b.replace(/\s+/gu, " ").trim().toLowerCase();
  return x.repertorium === y.repertorium && x.numer === y.numer && x.rok === y.rok && (!x.wydzial || !y.wydzial || x.wydzial === y.wydzial);
}

/** The hearings of one case (court and signature) from the court's wokanda. */
export async function checkWokanda(
  courtName: string,
  signature: string,
  fetchText: FetchText = defaultFetchText,
  now: () => Date = () => new Date(),
  register: (name: string) => WokandaCourt | null = wokandaCourt
): Promise<WokandaResult> {
  const checkedAt = now().toISOString();
  const court = register(courtName);
  const base = { court: courtByName(courtName)?.nazwa ?? courtName, signature, checkedAt };
  if (!court) return { ...base, state: "NO_WOKANDA", reason: "Sądu nie ma w rejestrze wokand (sądy powszechne)." };
  if (court.status === "NONE") return { ...base, state: "NO_WOKANDA", ...(court.url ? { url: court.url } : {}), reason: "Strona sądu nie publikuje wokandy." };
  // A browser check or a firewall that turns away the application's requests (403, 429): the
  // court's window, a real browser engine, gets through and lends its session.
  const verifiable =
    court.status === "PORTAL" ||
    (court.status === "BROWSER" && (court.powod === "weryfikacja przeglądarki" || Boolean(court.powod?.startsWith("strona blokuje zapytania aplikacji"))));
  const verification = (savedSession: boolean) => ({ domain: court.domena, url: court.url ?? `https://${court.domena}/wokanda`, savedSession });
  const session = verifiable ? sessionHeaders(court.domena) : null;
  if (court.status === "BROWSER" && !session) {
    return {
      ...base,
      state: "BROWSER_ONLY",
      ...(court.url ? { url: court.url } : {}),
      reason: verifiable
        ? "Strona sądu wymaga weryfikacji przeglądarki: przejdź ją w oknie sądu, a sprawdzenie ponowi się samo."
        : `Wokanda tego sądu otwiera się tylko w przeglądarce (${court.powod ?? "inny system"}).`,
      ...(verifiable ? { verification: verification(false) } : {})
    };
  }
  const fetchPage: FetchText = session ? (url, headers, init) => fetchText(url, { ...headers, ...session }, init) : fetchText;
  const parsed = parseCommonSignature(signature);
  if (!parsed) return { ...base, state: "UNREACHABLE", reason: "Sygnatura nie ma postaci sądu powszechnego (np. XI C 1768/26)." };
  const wanted = signature.replace(/^sygn\.?\s*(?:akt)?\s*:?\s*/iu, "");
  if (court.system && court.system !== "MS_PORTAL") {
    try {
      const page = await otherSystemPage(court, wanted, fetchPage);
      if (GUARD.test(page.text)) return { ...base, state: "BROWSER_ONLY", url: page.searchUrl, reason: "Strona sądu wymaga teraz weryfikacji przeglądarki: otwórz wokandę w przeglądarce." };
      if (page.status !== 200) return { ...base, state: "UNREACHABLE", url: page.searchUrl, reason: `Strona sądu odpowiedziała kodem ${page.status}.` };
      const seen = new Set<string>();
      const hearings = [...parseTableHearings(page.text, page.url), ...parseVerticalHearings(page.text, page.url), ...parseLabeledHearings(page.text, page.url)]
        .filter((hearing) => sameSignature(hearing.sygnatura, wanted))
        .filter((hearing) => {
          const key = `${hearing.data} ${hearing.godzina} ${hearing.sala}`;
          return seen.has(key) ? false : (seen.add(key), true);
        })
        .sort((a, b) => `${a.data} ${a.godzina}`.localeCompare(`${b.data} ${b.godzina}`))
        .slice(0, MAX_HEARINGS);
      return {
        ...base,
        state: hearings.length ? "FOUND" : "NOT_FOUND",
        searchUrl: page.searchUrl,
        hearings,
        ...(court.system === "LIST" ? { note: "Wokanda tego sądu to jedna lista bez wyszukiwarki: sprawdzono tylko terminy, które są na niej teraz." } : {})
      };
    } catch (error) {
      return { ...base, state: "UNREACHABLE", url: court.url ?? `https://${court.domena}`, reason: `Strona sądu nie odpowiedziała (${networkReason(error)}).` };
    }
  }
  const searchUrl = portalSearchUrl(court.url ?? `https://${court.domena}/wokanda`, parsed);
  let page: Awaited<ReturnType<FetchText>>;
  try {
    page = await fetchPage(searchUrl);
  } catch (error) {
    return { ...base, state: "UNREACHABLE", url: court.url ?? searchUrl, reason: `Strona sądu nie odpowiedziała (${networkReason(error)}).` };
  }
  if (GUARD.test(page.text) || page.status === 403 || page.status === 429) {
    return {
      ...base,
      state: "BROWSER_ONLY",
      url: searchUrl,
      reason: session ? "Sesja z weryfikacji wygasła: zweryfikuj się ponownie w oknie sądu." : "Strona sądu wymaga teraz weryfikacji przeglądarki: przejdź ją w oknie sądu.",
      verification: verification(Boolean(session))
    };
  }
  if (page.status !== 200) return { ...base, state: "UNREACHABLE", url: searchUrl, reason: `Strona sądu odpowiedziała kodem ${page.status}.` };
  const listed = parsePortalResults(page.text, page.url).filter((hearing) => sameSignature(hearing.sygnatura, wanted));
  const hearings: WokandaHearing[] = [];
  for (const hearing of listed.slice(0, MAX_HEARINGS)) {
    try {
      const details = await fetchPage(hearing.url);
      hearings.push(details.status === 200 && !GUARD.test(details.text) ? { ...hearing, ...parsePortalDetails(details.text) } : hearing);
    } catch {
      hearings.push(hearing);
    }
  }
  hearings.sort((a, b) => `${a.data} ${a.godzina}`.localeCompare(`${b.data} ${b.godzina}`));
  return { ...base, state: hearings.length ? "FOUND" : "NOT_FOUND", searchUrl, hearings };
}

/** One court's wokanda checked again (developer settings): its page, one request. */
export async function recheckWokandaCourt(court: WokandaCourt, fetchText: FetchText = defaultFetchText): Promise<WokandaCourt> {
  const other = court.system && court.system !== "MS_PORTAL";
  const url = (court.status === "PORTAL" && !other) || !court.url ? `https://${court.domena}/wokanda` : court.url;
  // A court passed in its window by the user: the portal read with that session (report 2026-11-11:
  // the register kept "no access" after the user's verification).
  const session = sessionHeaders(court.domena);
  if (session) {
    try {
      const portal = await fetchText(`https://${court.domena}/wokanda`, session);
      if (portal.status === 200 && !GUARD.test(portal.text) && portal.text.includes('name="nrspr"')) {
        return { nazwa: court.nazwa, domena: court.domena, status: "PORTAL", url: portal.url, powod: "przez sesję z okna sądu" };
      }
    } catch {
      // The session no longer serves: the check below says what the court answers without it.
    }
  }
  try {
    const page = await fetchText(url);
    // Another system that answers without a guard keeps its way of searching.
    if (other && page.status === 200 && !GUARD.test(page.text)) return { ...court, url: court.url ?? url };
    if (page.status === 200 && page.text.includes('name="nrspr"') && page.text.includes('value="cases"')) return { nazwa: court.nazwa, domena: court.domena, status: "PORTAL", url: page.url };
    if (GUARD.test(page.text)) return { nazwa: court.nazwa, domena: court.domena, status: "BROWSER", url: page.url, powod: "weryfikacja przeglądarki" };
    if (page.status === 200 && /wokand/iu.test(page.text)) return { nazwa: court.nazwa, domena: court.domena, status: "BROWSER", url: page.url, powod: court.powod ?? "inny system wokandy" };
    // A firewall answering the application with 403 or 429 lets a browser through: the court's
    // window (as for a browser check) opens it.
    if (page.status === 403 || page.status === 429) return { nazwa: court.nazwa, domena: court.domena, status: "BROWSER", url: page.url || url, powod: `strona blokuje zapytania aplikacji (HTTP ${page.status})` };
    if (page.status === 200 || page.status === 404) return { nazwa: court.nazwa, domena: court.domena, status: court.status === "NONE" ? "NONE" : court.status, ...(court.url ? { url: court.url } : {}), ...(court.powod ? { powod: court.powod } : {}) };
    return { nazwa: court.nazwa, domena: court.domena, status: "UNREACHABLE", url, powod: `HTTP ${page.status}` };
  } catch (error) {
    return { nazwa: court.nazwa, domena: court.domena, status: "UNREACHABLE", url, powod: networkReason(error) };
  }
}

// --- The register as this computer sees it ---------------------------------------------------
// A re-check from the user's computer replaces the shipped status of that court (a site that
// blocks one network may answer another); kept in %LOCALAPPDATA%\LexMachina\wokanda.json.

export type WokandaCourtView = WokandaCourt & { sprawdzono: string; zrodlo: "WYDANIE" | "TEN_KOMPUTER" };

export function wokandaOverridesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "LexMachina", "wokanda.json") : path.join(os.tmpdir(), "LexMachina-wokanda.json");
}

function readOverrides(file: string): Record<string, WokandaCourt & { sprawdzono: string }> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    // A re-check older than the register shipped with the application gives way to it: the release
    // may correct the court's address (report 2026-11-11: addresses kept from an older re-check).
    const shipped = Date.parse(WOKANDA_REGISTER.sprawdzono);
    return Object.fromEntries(
      Object.entries(parsed as Record<string, WokandaCourt & { sprawdzono: string }>).filter(
        ([, court]) => !(Date.parse(court?.sprawdzono ?? "") < shipped)
      )
    );
  } catch {
    return {};
  }
}

/** Every court with its status: the re-check on this computer where there is one. */
export function wokandaCourtsView(file: string = wokandaOverridesPath()): WokandaCourtView[] {
  const overrides = readOverrides(file);
  return WOKANDA_REGISTER.sady.map((court) => {
    const local = overrides[court.nazwa];
    return local ? { ...local, nazwa: court.nazwa, zrodlo: "TEN_KOMPUTER" as const } : { ...court, sprawdzono: WOKANDA_REGISTER.sprawdzono, zrodlo: "WYDANIE" as const };
  });
}

/** The court's status for a check: this computer's re-check first. */
export function effectiveWokandaCourt(name: string, file: string = wokandaOverridesPath()): WokandaCourt | null {
  const shipped = wokandaCourt(name);
  if (!shipped) return null;
  const local = readOverrides(file)[shipped.nazwa];
  return local ? { nazwa: shipped.nazwa, domena: local.domena, status: local.status, ...(local.url ? { url: local.url } : {}), ...(local.powod ? { powod: local.powod } : {}) } : shipped;
}

/** Re-checks the named courts (all when none), a few at a time, and keeps the results. */
export async function recheckWokandaCourts(names: readonly string[] | null, fetchText: FetchText = defaultFetchText, file: string = wokandaOverridesPath(), concurrency = 6): Promise<WokandaCourtView[]> {
  const targets = WOKANDA_REGISTER.sady.filter((court) => !names || names.includes(court.nazwa));
  const checked: Array<WokandaCourt & { sprawdzono: string }> = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (next < targets.length) {
        const court = targets[next++]!;
        checked.push({ ...(await recheckWokandaCourt(court, fetchText)), sprawdzono: new Date().toISOString() });
      }
    })
  );
  const overrides = readOverrides(file);
  for (const court of checked) overrides[court.nazwa] = court;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(overrides), "utf8");
  return wokandaCourtsView(file).filter((court) => checked.some((item) => item.nazwa === court.nazwa));
}
