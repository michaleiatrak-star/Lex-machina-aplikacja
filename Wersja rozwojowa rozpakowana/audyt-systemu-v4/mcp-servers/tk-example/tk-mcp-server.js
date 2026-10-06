#!/usr/bin/env node
/**
 * tk-mcp-server.js — orzeczenia Trybunału Konstytucyjnego (2026-10-06). Konektor PROSTY.
 *
 * Zbadane (shared/DOSTEP-MASZYNOWY-API.md, F-184): ipo.trybunal.gov.pl i otkzu.trybunal.gov.pl są
 * osiągalne (200); wyszukiwarka IPO (`/ipo/Szukaj?cid=1`) to formularz JSF/PrimeFaces z ViewState —
 * `Sprawa?sygnatura=` nie jest kluczem, ale formularz da się wysłać bez przeglądarki: GET strony
 * (ciasteczko sesji + javax.faces.ViewState) → POST formularza z sygnaturą. Nazwy pól odczytujemy
 * z pobranego HTML (pole z „sygn” w id/nazwie, przycisk „Szukaj”), bo nie są stałe. Kolejność:
 *  • tk_sprawdz_sygnature — najpierw formularz IPO (źródło urzędowe); gdy formularz się zmieni albo
 *    IPO nie odpowie — SAOS (RZĄD 3; TK tylko do 2015 r.) po sygnaturze, z linkiem urzędowym,
 *    gdy SAOS go zna; poza oknem SAOS → OUT_OF_SCOPE z gotowym zapytaniem do wyszukiwarki
 *    (site:ipo.trybunal.gov.pl "K 33/07"), nie „nie istnieje”;
 *  • tk_pobierz — treść spod adresu IPO/OTK ZU (stały link do dokumentu orzeczenia) z kontrolą,
 *    że tekst zawiera pytaną sygnaturę.
 * Źródłem jest link do samego orzeczenia w IPO/OTK ZU. Orzeczenie TK to materiał orzeczniczy
 * (RZĄD 2A z IPO), nie źródło brzmienia przepisu (ELI).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sygnal, owinSerwer } from "../wspolne/budzet.mjs";

const SAOS = "https://www.saos.org.pl/api";
const UA = "Mozilla/5.0 (compatible; LexMachina-tk/1.0)";
const PORCJA = 20000;
const HOSTY = new Set(["ipo.trybunal.gov.pl", "otkzu.trybunal.gov.pl", "trybunal.gov.pl", "www.trybunal.gov.pl"]);
const REP_TK = new Set(["K", "P", "SK", "U", "Kp", "Kpt", "Pp", "Ts", "Tw", "S"]);

export function normalizujSygnature(s) {
  return String(s ?? "").normalize("NFKC").replace(/\./g, "").replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
}

/** Sygnatura TK: repertorium bez numeru wydziału (K 33/07, SK 3/20, Kp 1/09). */
export function toSygnaturaTk(s) {
  const m = /^([A-Za-z]{1,3}) \d{1,4}\/\d{2,4}$/.exec(normalizujSygnature(s));
  return Boolean(m && REP_TK.has(m[1]));
}

export function dozwolonyHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTY.has(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Czy tekst zawiera sygnaturę (odporne na spacje, kropki i zapis roku 07/2007). */
export function zawieraSygnature(tekstDok, syg) {
  const n = normalizujSygnature(syg);
  const m = /^([A-Za-z]{1,3}) (\d{1,4})\/(\d{2,4})$/.exec(n);
  if (!m) return false;
  const rok = m[3].length === 4 ? `(?:${m[3]}|${m[3].slice(2)})` : `(?:${m[3]}|(?:19|20)${m[3]})`;
  return new RegExp(`(?<![\\p{L}\\d])${m[1]}\\.?\\s*${m[2]}\\s*\\/\\s*${rok}(?!\\d)`, "u").test(String(tekstDok).normalize("NFKC"));
}

const ENCJE = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const dekoduj = (t) => String(t ?? "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENCJE[n.toLowerCase()] ?? m);
export const tekst = (html) => dekoduj(String(html ?? "")
  .replace(/<(script|style|head|nav|footer)[\s\S]*?<\/\1>/gi, "")
  .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h\d)>/gi, "\n").replace(/<[^>]+>/g, " "))
  .split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).filter(Boolean).join("\n");

const ATRYBUT = (tag, nazwa) => new RegExp(`\\b${nazwa}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1];

/**
 * Formularz wyszukiwarki IPO z pobranego HTML: akcja, pola ukryte (z ViewState), pole sygnatury
 * i przycisk „Szukaj”. Czysta funkcja; null, gdy formularza nie da się rozpoznać.
 */
export function formularzIpo(html, baza = "https://ipo.trybunal.gov.pl/ipo/Szukaj?cid=1") {
  const t = String(html ?? "");
  for (const forma of t.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const [, atrForm, wnetrze] = forma;
    const pola = {};
    let poleSygnatury = null;
    let przycisk = null;
    for (const [tag] of wnetrze.matchAll(/<(?:input|button)\b[^>]*>/gi)) {
      const nazwa = ATRYBUT(tag, "name");
      if (!nazwa) continue;
      const typ = (ATRYBUT(tag, "type") ?? "text").toLowerCase();
      const id = ATRYBUT(tag, "id") ?? "";
      if (typ === "hidden") pola[nazwa] = dekoduj(ATRYBUT(tag, "value") ?? "");
      else if ((typ === "text" || typ === "search") && /sygn/i.test(`${nazwa} ${id}`) && !poleSygnatury) poleSygnatury = nazwa;
      else if ((typ === "submit" || /^<button/i.test(tag)) && !przycisk) przycisk = nazwa;
    }
    const przyciskSzukaj = [...wnetrze.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
      .find(([, atr, tresc]) => /szukaj|wyszukaj/i.test(tekst(tresc) + " " + (ATRYBUT(atr, "value") ?? "")) && ATRYBUT(atr, "name"));
    if (!poleSygnatury || !("javax.faces.ViewState" in pola)) continue;
    const akcja = dekoduj(ATRYBUT(atrForm, "action") ?? baza);
    return { akcja: new URL(akcja, baza).toString(), pola, poleSygnatury, przycisk: przyciskSzukaj ? ATRYBUT(przyciskSzukaj[1], "name") : przycisk };
  }
  return null;
}

/** Wyniki wyszukiwarki IPO: odnośniki do spraw/dokumentów, przy których stoi pytana sygnatura. Czysta funkcja. */
export function wynikiIpo(html, syg, baza = "https://ipo.trybunal.gov.pl/ipo/Szukaj?cid=1") {
  const t = String(html ?? "");
  const wiersze = t.split(/<\/tr>|<\/li>|<\/div>\s*<div class="[^"]*(?:wynik|result|ui-datalist-item)/i);
  const linki = [];
  for (const wiersz of wiersze) {
    if (!zawieraSygnature(tekst(wiersz), syg)) continue;
    for (const [, href] of wiersz.matchAll(/href="([^"]*(?:Sprawa|dokument|Dokument)[^"]*)"/g)) {
      const url = new URL(dekoduj(href), baza).toString();
      if (dozwolonyHost(url) && !linki.includes(url)) linki.push(url);
    }
  }
  return linki;
}

/** Wyszukiwarka IPO: GET formularza (sesja + ViewState) → POST z sygnaturą → linki do orzeczenia. */
async function ipoSzukaj(syg) {
  const start = "https://ipo.trybunal.gov.pl/ipo/Szukaj?cid=1";
  const r1 = await fetch(start, { signal: sygnal(30000), headers: { "User-Agent": UA, Accept: "text/html" } });
  if (!r1.ok) throw new Error(`IPO HTTP ${r1.status}`);
  const ciastka = (r1.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const forma = formularzIpo(await r1.text(), r1.url || start);
  if (!forma) throw new Error("IPO: nie rozpoznano formularza wyszukiwarki (zmiana strony?)");
  const dane = new URLSearchParams({ ...forma.pola, [forma.poleSygnatury]: normalizujSygnature(syg), ...(forma.przycisk ? { [forma.przycisk]: forma.przycisk } : {}) });
  const r2 = await fetch(forma.akcja, {
    method: "POST", signal: sygnal(30000), body: dane.toString(),
    headers: { "User-Agent": UA, Accept: "text/html", "Content-Type": "application/x-www-form-urlencoded", Referer: start, ...(ciastka ? { Cookie: ciastka } : {}) },
  });
  if (!r2.ok) throw new Error(`IPO HTTP ${r2.status}`);
  return wynikiIpo(await r2.text(), syg, forma.akcja);
}

async function pobierz(url, typ = "text") {
  const r = await fetch(url, { signal: sygnal(30000), headers: { "User-Agent": UA, Accept: typ === "json" ? "application/json" : "text/html,*/*" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return typ === "json" ? await r.json() : await r.text();
}

const baza = { source: "ipo.trybunal.gov.pl", query_type: "orzeczenie" };
const zapytanie = (syg) => `site:ipo.trybunal.gov.pl "${normalizujSygnature(syg)}"`;
const NOTA = "Źródłem jest link do samego orzeczenia w IPO/OTK ZU. IPO nie ma wyszukiwania po sygnaturze dostępnego bez przeglądarki — " +
  "SAOS (RZĄD 3) obejmuje TK tylko do 2015 r. Brak trafienia ≠ brak orzeczenia.";
const odp = (w) => ({ content: [{ type: "text", text: JSON.stringify(w, null, 2) }] });
const blad = (e) => ({ status: "ERROR", ...baza, detail: String(e?.message ?? e), retrieved_at: new Date().toISOString() });

const server = owinSerwer(globalThis.__LEX_MCP_WSPOLNY ?? new McpServer({ name: "tk-connector", version: "1.0.0" }));

server.registerTool("tk_sprawdz_sygnature", {
  title: "Sprawdź sygnaturę orzeczenia Trybunału Konstytucyjnego",
  description: "Orzeczenie TK po sygnaturze (K, P, SK, U, Kp, Kpt…): wyszukiwarka IPO; zapasowo SAOS (do 2015 r.) z linkiem urzędowym; poza tym " +
    "zwraca gotowe zapytanie do wyszukiwarki (site:ipo.trybunal.gov.pl) — znaleziony adres IPO sprawdź narzędziem tk_pobierz. " +
    "Najpierw formularz wyszukiwarki IPO (Szukaj?cid=1), SAOS tylko gdy IPO nie da wyniku.",
  inputSchema: { sygnatura: z.string().min(3).max(30).describe("np. K 33/07, SK 3/20") },
}, async ({ sygnatura }) => {
  const oczekiwana = normalizujSygnature(sygnatura);
  if (!toSygnaturaTk(oczekiwana)) {
    return odp({ status: "OUT_OF_SCOPE", ...baza, oczekiwana, powod: "SYGNATURA_INNEGO_SADU",
      uwaga: `${oczekiwana} nie ma postaci sygnatury TK (repertorium K, P, SK, U, Kp, Kpt, Pp, Ts, Tw, S bez numeru wydziału).` });
  }
  // 1. Wyszukiwarka IPO (źródło urzędowe). Trafienie = link przy pytanej sygnaturze; tożsamość potwierdza tk_pobierz.
  let ipoBlad = null;
  try {
    const linki = await ipoSzukaj(oczekiwana);
    if (linki.length) {
      return odp({ status: linki.length === 1 ? "FOUND" : "AMBIGUOUS", ...baza, metoda: "IPO — formularz wyszukiwarki", oczekiwana,
        ...(linki.length === 1 ? { result: { sygnatura: oczekiwana, url_orzeczenia: linki[0] } } : { kandydaci: linki.map((url) => ({ sygnatura: oczekiwana, url_orzeczenia: url })) }),
        uwaga: "Link z wyszukiwarki IPO — przed powołaniem przeczytaj dokument tk_pobierz (z sygnaturą). " + NOTA,
        retrieved_at: new Date().toISOString() });
    }
  } catch (e) {
    ipoBlad = String(e?.message ?? e);
  }
  // 2. SAOS (RZĄD 3, TK do 2015 r.) — gdy IPO nie dało wyniku.
  try {
    const dane = await pobierz(`${SAOS}/search/judgments?caseNumber=${encodeURIComponent(oczekiwana)}&courtType=CONSTITUTIONAL_TRIBUNAL&pageSize=10`, "json");
    const trafione = (dane.items ?? []).filter((it) => (it.courtCases ?? []).some((c) => normalizujSygnature(c.caseNumber).toUpperCase() === oczekiwana.toUpperCase()));
    if (!trafione.length) {
      return odp({ status: "OUT_OF_SCOPE", ...baza, oczekiwana, zapytanie_wyszukiwarki: zapytanie(oczekiwana), ...(ipoBlad ? { ipo_blad: ipoBlad } : { ipo: "brak trafienia w wyszukiwarce IPO" }),
        uwaga: `Brak ${oczekiwana} w SAOS (TK tylko do 2015 r.). Znajdź dokument orzeczenia w IPO (zapytanie_wyszukiwarki) i sprawdź go tk_pobierz. ${NOTA}`,
        retrieved_at: new Date().toISOString() });
    }
    const kandydaci = [];
    for (const it of trafione.slice(0, 5)) {
      const pelny = await pobierz(`${SAOS}/judgments/${it.id}`, "json").catch(() => null);
      const zrodlo = pelny?.data?.source?.judgmentUrl;
      kandydaci.push({ sygnatura: oczekiwana, data: it.judgmentDate ?? null, rodzaj: it.judgmentType ?? null,
        url_orzeczenia: zrodlo && dozwolonyHost(zrodlo) ? zrodlo : null, url_saos: `https://www.saos.org.pl/judgments/${it.id}` });
    }
    return odp({ status: kandydaci.length === 1 ? "FOUND" : "AMBIGUOUS", ...baza, source: "saos → IPO", oczekiwana,
      ...(kandydaci.length === 1 ? { result: kandydaci[0] } : { kandydaci }),
      ...(kandydaci.some((k) => !k.url_orzeczenia) ? { zapytanie_wyszukiwarki: zapytanie(oczekiwana) } : {}),
      uwaga: "Rekord z SAOS (RZĄD 3) — powołuj url_orzeczenia z IPO; gdy go brak, znajdź dokument w IPO i sprawdź tk_pobierz. " + NOTA,
      retrieved_at: new Date().toISOString() });
  } catch (e) {
    return odp({ ...blad(e), zapytanie_wyszukiwarki: zapytanie(oczekiwana) });
  }
});

server.registerTool("tk_pobierz", {
  title: "Pobierz orzeczenie TK spod adresu IPO / OTK ZU",
  description: "Treść dokumentu orzeczenia z ipo.trybunal.gov.pl albo otkzu.trybunal.gov.pl (stały link) z kontrolą, czy zawiera " +
    "pytaną sygnaturę; porcjami po 20 000 znaków (offset).",
  inputSchema: {
    url: z.string().url().max(600),
    sygnatura: z.string().max(30).optional().describe("sygnatura do kontroli tożsamości dokumentu"),
    offset: z.number().int().min(0).optional(),
  },
}, async ({ url, sygnatura, offset = 0 }) => {
  if (!dozwolonyHost(url)) return odp({ status: "ERROR", ...baza, detail: "Dozwolone są tylko adresy ipo.trybunal.gov.pl i otkzu.trybunal.gov.pl." });
  try {
    const calosc = tekst(await pobierz(url));
    if (calosc.length < 40) return odp({ status: "NOT_FOUND", ...baza, url_orzeczenia: url, uwaga: "Strona nie zawiera treści orzeczenia (np. wymaga przeglądarki)." });
    if (sygnatura && !zawieraSygnature(calosc, sygnatura)) {
      return odp({ status: "MISMATCH", ...baza, url_orzeczenia: url, oczekiwana: normalizujSygnature(sygnatura),
        uwaga: "Dokument pod tym adresem nie zawiera pytanej sygnatury — to nie jest to orzeczenie (albo strona wymaga przeglądarki)." });
    }
    const czesc = calosc.slice(offset, offset + PORCJA);
    return odp({ status: "FOUND", ...baza, confidence: sygnatura ? "deterministic" : "unverified-identity",
      result: { ...(sygnatura ? { sygnatura: normalizujSygnature(sygnatura) } : {}), url_orzeczenia: url,
        tresc: czesc, tresc_offset: offset, tresc_dlugosc: calosc.length, tresc_kompletna: offset + czesc.length >= calosc.length },
      uwaga: NOTA, retrieved_at: new Date().toISOString() });
  } catch (e) { return odp(blad(e)); }
});

if (!globalThis.__LEX_MCP_WSPOLNY && process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  await server.connect(new StdioServerTransport());
  console.error("tk-mcp-server: nasłuchuję na stdio (MCP)");
}
