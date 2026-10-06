#!/usr/bin/env node
/**
 * sn-mcp-server.js — orzeczenia Sądu Najwyższego z oficjalnej bazy sn.pl (2026-10-06).
 *
 * Mechanika portalu od 2026 r. (pomiar CI G22, AUDYT-2026-10-06):
 *  • wyszukiwarka https://www.sn.pl/pl/wyszukiwarka-orzeczen pobiera wyniki przez
 *    `GET /index.php?option=com_ajax&plugin=snproxy&format=json&task=searchOrzeczenia&sygnatura=…`
 *    → rekordy {id, sygnatura_sprawy, data_wydania, forma_orzeczenia, …} (różne głębokości opakowania);
 *  • tekst: `task=OrzeczeniePlikHtml&id=ID` → base64 HTML (`OrzeczeniePlikPdf` → base64 PDF);
 *  • ŹRÓDŁEM jest KARTA orzeczenia: https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ID.
 *    Adres `blob:https://www.sn.pl/…` to kopia w jednej karcie przeglądarki (nie do powołania),
 *    a stary katalog /sites/orzecznictwo/Orzeczenia3/*.pdf nie serwuje orzeczeń — brak pliku tam
 *    NIE dowodzi braku publikacji.
 *  • sygnatury innych sądów (NSA/WSA, sądy powszechne, KIO, TK) nie są w tej bazie — narzędzie
 *    zwraca, gdzie ich szukać, zamiast mylącego „brak trafień”.
 * Orzeczenie SN to materiał orzeczniczy (R2A), nie źródło brzmienia przepisu; przepis weryfikuj w ELI.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sygnal, owinSerwer } from "../wspolne/budzet.mjs";

const PROXY = "https://www.sn.pl/index.php";
const KARTA = "https://www.sn.pl/pl/wyszukiwarka-orzeczen";
const HOSTY = new Set(["sn.pl", "www.sn.pl"]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const PORCJA = 20000;
const MAX_BASE64 = 8_000_000;

export const REPERTORIA_SN = new Set([
  "CSK", "CSKP", "KK", "NKK", "UK", "NSNC", "NSNU", "NKN", "CNP", "CNPP", "SDI", "ZK", "CZP", "KZP",
  "UZP", "PZP", "NSNZP", "SNO", "DSI", "DSP", "CZ", "KO", "KSP", "NSW"
]);
const NSA = new Set(["OSK", "FSK", "GSK", "OZ", "FZ", "GZ", "OPS", "FPS", "GPS", "OW", "FW", "GW"]);
const POWSZECHNE = new Set([
  "C", "Ca", "ACa", "ACz", "Cz", "Ns", "Nc", "Co", "Cps", "Nkd", "Nsm", "RC", "RCa", "RCz", "GC", "GCo", "GNc", "GNs",
  "Ga", "Gz", "AGa", "AGz", "GU", "Gzt", "K", "Ka", "Kz", "Kp", "Ko", "AKa", "AKz", "AKo", "W", "Wz", "Kop", "Kow",
  "P", "Pa", "Pz", "Po", "APa", "APz", "U", "Ua", "Uz", "AUa", "AUz", "Nmo"
]);
const TK = new Set(["K", "P", "SK", "U", "Kp", "Kpt", "Pp", "Ts", "Tw", "S"]);

/** „II  C.S.K.P. 89/26” → „II CSKP 89/26”. */
export function normalizujSygnature(s) {
  return String(s ?? "").normalize("NFKC").replace(/\./g, "").replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
}

/** Sąd właściwy dla sygnatury (repertorium); null = nie rozpoznano. Repertoria sądów powszechnych są wrażliwe na wielkość liter. */
export function sadSygnatury(s) {
  const m = /^(?:([IVXL]{1,5})\s+)?([A-Z][A-Za-z]{0,5})(?:\/([A-Z][a-z]{1,2}))?\s+\d{1,6}\/\d{2,4}$/u.exec(normalizujSygnature(s));
  if (!m) return null;
  const [, rzymska, rep, siedziba] = m;
  if (rep === "KIO") return "KIO";
  if (siedziba) return /^SAB?$/.test(rep) ? "NSA/WSA" : null;
  if (NSA.has(rep)) return "NSA/WSA";
  if (rep === rep.toUpperCase() && REPERTORIA_SN.has(rep)) return "SN";
  if (rzymska && POWSZECHNE.has(rep)) return "sąd powszechny";
  return !rzymska && TK.has(rep) ? "TK" : null;
}

const GDZIE = {
  "NSA/WSA": "CBOSA (cbosa_sprawdz_sygnature) — orzeczenia.nsa.gov.pl",
  "sąd powszechny": "Portal Orzeczeń Sądów Powszechnych (orzeczenia.ms.gov.pl); SAOS tylko pomocniczo",
  KIO: "wyszukiwarka UZP (kio_sprawdz_sygnature)",
  TK: "ipo.trybunal.gov.pl",
};

/** ID karty z linku „…?orzeczenie=ID” albo samego ID. */
export function idKarty(v) {
  const t = String(v ?? "").trim();
  const zLinku = /[?&]orzeczenie=([\w-]{6,80})/u.exec(t)?.[1];
  if (zLinku) return zLinku;
  return /^[A-Za-z0-9_-]{12,40}$/u.test(t) && /[A-Za-z]/.test(t) ? t : null;
}
export const urlKarty = (id) => `${KARTA}?orzeczenie=${encodeURIComponent(id)}`;

/** Link, który nie jest źródłem: blob: albo stary katalog PDF (z nazwy pliku odzyskuje sygnaturę). */
export function problemLinku(v) {
  const t = String(v ?? "").trim();
  if (/^blob:/i.test(t)) return { rodzaj: "BLOB" };
  let u;
  try { u = new URL(t); } catch { return null; }
  if (!HOSTY.has(u.hostname.toLowerCase()) || !/\/sites\/orzecznictwo\//i.test(u.pathname)) return null;
  const nazwa = decodeURIComponent(u.pathname.split("/").pop() ?? "").replace(/\.(pdf|docx?|rtf)$/i, "").replace(/_/g, " ");
  const m = /^(.*\S)\s+(\d{1,6})-(\d{2,4})(?:-\d+)?$/u.exec(nazwa);
  return { rodzaj: "STARY_PDF", ...(m ? { sygnatura: `${m[1]} ${m[2]}/${m[3]}` } : {}) };
}

const obiekt = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : null);
const wyglada = (o) => obiekt(o) && ("sygnatura_sprawy" in o || "data_wydania" in o || "forma_orzeczenia" in o);

/** Rekordy wyszukiwania z dowolnej głębokości opakowania com_ajax; null = nieznany kształt. Czysta funkcja. */
export function rekordy(v, glebokosc = 0) {
  if (glebokosc > 6) return null;
  if (Array.isArray(v)) {
    if (!v.length) return [];
    if (v.every(wyglada)) return v;
    for (const x of v) { const r = rekordy(x, glebokosc + 1); if (r !== null) return r; }
    return null;
  }
  const o = obiekt(v);
  if (!o) return null;
  if ("sygnatura_sprawy" in o) return [o];
  for (const k of ["data", "items", "records", "results", "orzeczenia"]) {
    if (k in o) { const r = rekordy(o[k], glebokosc + 1); if (r !== null) return r; }
  }
  return null;
}

/** Błąd po stronie sn.pl w kopercie com_ajax ({error, debug}). */
export function bladSn(v) {
  let cur = v;
  for (let i = 0; i <= 4; i += 1) {
    const o = obiekt(cur) ?? obiekt(Array.isArray(cur) ? cur[0] : null);
    if (!o) return null;
    if (o.error !== undefined && o.error !== null && o.error !== false && !("sygnatura_sprawy" in o)) return String(o.error);
    cur = o.data;
  }
  return null;
}

/** Base64 z odpowiedzi OrzeczeniePlikHtml (data[0].raw albo data[0].data.raw). */
export function surowyTekst(v) {
  const p = obiekt(Array.isArray(obiekt(v)?.data) ? obiekt(v).data[0] : null);
  const raw = typeof p?.raw === "string" && p.raw ? p.raw : obiekt(p?.data)?.raw;
  return typeof raw === "string" && raw && raw.length <= MAX_BASE64 && /^[A-Za-z0-9+/=\s]+$/.test(raw) ? raw : null;
}

const ENCJE = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const dekoduj = (t) => String(t ?? "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENCJE[n.toLowerCase()] ?? m);
export const tekst = (html) => dekoduj(String(html ?? "")
  .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " "))
  .split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");

function proxy(task, params) {
  const u = new URL(PROXY);
  for (const [k, v] of Object.entries({ option: "com_ajax", plugin: "snproxy", format: "json", task, ...params })) u.searchParams.set(k, v);
  return u.toString();
}

async function pobierzJson(url) {
  let adres = url;
  let ciastka = [];
  for (let i = 0; i <= 3; i += 1) {
    const r = await fetch(adres, {
      redirect: "manual", signal: sygnal(40000),
      headers: { "User-Agent": UA, Accept: "*/*", ...(ciastka.length ? { Cookie: ciastka.join("; ") } : {}) },
    });
    const nowe = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]);
    ciastka = [...ciastka.filter((c) => !nowe.some((n) => n.split("=")[0] === c.split("=")[0])), ...nowe];
    if (r.status >= 300 && r.status < 400) {
      const dalej = new URL(r.headers.get("location") ?? "", adres);
      if (dalej.protocol !== "https:" || !HOSTY.has(dalej.hostname)) throw new Error("Przekierowanie poza sn.pl");
      adres = dalej.toString();
      continue;
    }
    if (!r.ok) throw new Error(`sn.pl HTTP ${r.status}`);
    return await r.json();
  }
  throw new Error("Za dużo przekierowań sn.pl");
}

const baza = { source: "sn.pl", query_type: "orzeczenie" };
const NOTA = "Źródło = KARTA orzeczenia (link „url_karty”), nigdy blob: ani PDF. Orzeczenie SN to materiał orzeczniczy (R2A), " +
  "przepis weryfikuj w ELI. Brak trafienia nie dowodzi braku orzeczenia (np. jeszcze nieopublikowane).";
const odp = (w) => ({ content: [{ type: "text", text: JSON.stringify(w, null, 2) }] });
const blad = (e) => ({ status: "ERROR", ...baza, detail: String(e?.message ?? e), retrieved_at: new Date().toISOString() });
const pozycja = (r) => ({
  sygnatura: normalizujSygnature(r.sygnatura_sprawy),
  data_wydania: typeof r.data_wydania === "string" ? r.data_wydania.slice(0, 10) : null,
  forma: r.forma_orzeczenia ?? null,
  id_karty: String(r.id ?? ""),
  url_karty: r.id ? urlKarty(String(r.id)) : null,
});

const server = owinSerwer(globalThis.__LEX_MCP_WSPOLNY ?? new McpServer({ name: "sn-connector", version: "1.0.0" }));

server.registerTool("sn_sprawdz_sygnature", {
  title: "Sprawdź sygnaturę orzeczenia Sądu Najwyższego",
  description: "Czy w oficjalnej bazie sn.pl jest orzeczenie o tej sygnaturze (dokładne dopasowanie); zwraca kartę orzeczenia " +
    "(url_karty) do powołania. Sygnatura innego sądu → wskazanie właściwej bazy.",
  inputSchema: { sygnatura: z.string().min(4).max(40).describe("np. II CSKP 89/26, III CZP 25/11") },
}, async ({ sygnatura }) => {
  const oczekiwana = normalizujSygnature(sygnatura);
  const sad = sadSygnatury(oczekiwana);
  if (sad && sad !== "SN") {
    return odp({ status: "OUT_OF_SCOPE", ...baza, oczekiwana, sad, powod: "SYGNATURA_INNEGO_SADU",
      uwaga: `${oczekiwana} to sygnatura: ${sad}. Szukaj w: ${GDZIE[sad]}. Baza sn.pl jej nie zawiera.` });
  }
  try {
    const dane = await pobierzJson(proxy("searchOrzeczenia", { sygnatura: oczekiwana, strona: "1", rozmiar_strony: "25" }));
    const upstream = bladSn(dane);
    if (upstream) return odp({ status: "ERROR", ...baza, oczekiwana, detail: `sn.pl zgłosił błąd: ${upstream}`, retrieved_at: new Date().toISOString() });
    const lista = rekordy(dane);
    if (lista === null) return odp({ status: "ERROR", ...baza, oczekiwana, detail: "Nieznany kształt odpowiedzi snproxy (zmiana portalu?).", retrieved_at: new Date().toISOString() });
    const trafione = lista.filter((r) => normalizujSygnature(r.sygnatura_sprawy).toUpperCase() === oczekiwana.toUpperCase());
    if (!trafione.length) {
      return odp({ status: "OUT_OF_SCOPE", ...baza, oczekiwana, odrzucone: lista.map((r) => normalizujSygnature(r.sygnatura_sprawy)).slice(0, 10),
        uwaga: `Brak dokładnego trafienia ${oczekiwana} w bazie sn.pl. ${NOTA}`, retrieved_at: new Date().toISOString() });
    }
    return odp({ status: trafione.length === 1 ? "FOUND" : "AMBIGUOUS", ...baza, oczekiwana,
      ...(trafione.length === 1 ? { result: pozycja(trafione[0]) } : { kandydaci: trafione.map(pozycja) }),
      uwaga: NOTA, retrieved_at: new Date().toISOString(), confidence: "deterministic" });
  } catch (e) { return odp(blad(e)); }
});

server.registerTool("sn_pobierz", {
  title: "Pobierz orzeczenie Sądu Najwyższego (po karcie)",
  description: "Pełny tekst orzeczenia SN po karcie (link …?orzeczenie=ID albo samo ID); porcjami po 20 000 znaków (offset). " +
    "Link blob: albo stary PDF /sites/orzecznictwo/ nie jest źródłem — narzędzie poprosi o sygnaturę lub kartę.",
  inputSchema: {
    karta: z.string().min(6).max(300).describe("https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ID albo ID"),
    offset: z.number().int().min(0).optional(),
  },
}, async ({ karta, offset = 0 }) => {
  const problem = problemLinku(karta);
  if (problem) {
    return odp({ status: "OUT_OF_SCOPE", ...baza, powod: problem.rodzaj === "BLOB" ? "LINK_TYMCZASOWY_BLOB" : "STARY_KATALOG_PDF",
      ...(problem.sygnatura ? { sygnatura_z_nazwy_pliku: problem.sygnatura } : {}),
      uwaga: problem.rodzaj === "BLOB"
        ? "blob: to kopia w jednej karcie przeglądarki — nikt inny jej nie otworzy. Poproś o sygnaturę albo link do karty."
        : `Stary katalog PDF sn.pl nie serwuje orzeczeń.${problem.sygnatura ? ` Sprawdź sygnaturę ${problem.sygnatura} narzędziem sn_sprawdz_sygnature.` : " Poproś o sygnaturę albo kartę."}` });
  }
  const id = idKarty(karta);
  if (!id) return odp({ status: "ERROR", ...baza, detail: "To nie jest karta orzeczenia sn.pl (…?orzeczenie=ID) ani ID." });
  try {
    const dane = await pobierzJson(proxy("OrzeczeniePlikHtml", { id }));
    const raw = surowyTekst(dane);
    if (!raw) return odp({ status: "NOT_FOUND", ...baza, id_karty: id, url_karty: urlKarty(id), uwaga: `sn.pl nie zwrócił tekstu dla karty ${id}.` });
    const calosc = tekst(Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8"));
    const sygnatura = /Sygn\.?\s*akt:?\s*([IVXL]{1,5}\s+[A-Z]{2,6}\s+\d{1,6}\/\d{2,4})/u.exec(calosc)?.[1] ?? null;
    const czesc = calosc.slice(offset, offset + PORCJA);
    return odp({ status: "FOUND", ...baza, confidence: "deterministic",
      result: {
        sygnatura: sygnatura ? normalizujSygnature(sygnatura) : null,
        id_karty: id, url_karty: urlKarty(id), url_zrodlowy: urlKarty(id),
        tresc: czesc, tresc_offset: offset, tresc_dlugosc: calosc.length, tresc_kompletna: offset + czesc.length >= calosc.length,
      },
      uwaga: NOTA, retrieved_at: new Date().toISOString() });
  } catch (e) { return odp(blad(e)); }
});

if (!globalThis.__LEX_MCP_WSPOLNY && process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await server.connect(new StdioServerTransport());
  console.error("sn-mcp-server: nasłuchuję na stdio (MCP)");
}
