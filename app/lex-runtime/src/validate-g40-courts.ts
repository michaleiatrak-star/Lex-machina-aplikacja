import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LegalFederationToolRuntime } from "./legal-federation-tool-runtime.js";
import { LexMcpConnectorStore } from "./lex-mcp-connectors.js";

// G40B — konektory orzeczeń na żywo przez lex-mcp.mjs: sądy powszechne (Portal Orzeczeń, link do
// samego orzeczenia), TK (karta sprawy IPO / OTK ZU, bez SAOS), ETPCz (baza MS), SN (karta). Wynik każdego przypadku w JSON.
const skillsRoot =
  process.env.LEX_SKILLS_PATH?.trim() ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../Wersja rozwojowa rozpakowana");

type Reply = { status?: string; result?: Record<string, unknown>; kandydaci?: Array<Record<string, unknown>>; [key: string]: unknown };

async function main(): Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-g40b-"));
  const connectors = new LexMcpConnectorStore(skillsRoot, stateDir, path.join(stateDir, "brak", "claude_desktop_config.json"));
  const runtime = new LegalFederationToolRuntime(undefined, undefined, connectors);
  const call = async (source: string, tool: string, args: Record<string, unknown>): Promise<Reply> => {
    const reply = await runtime.direct({ source, tool, arguments: args });
    const raw = typeof reply.result === "string" ? reply.result : JSON.stringify(reply.result);
    try {
      const parsed = JSON.parse(raw) as Reply | { content?: Array<{ text?: string }> };
      const text = (parsed as { content?: Array<{ text?: string }> }).content?.[0]?.text;
      return text ? (JSON.parse(text) as Reply) : (parsed as Reply);
    } catch {
      return { status: "UNPARSED", raw: raw.slice(0, 600) };
    }
  };
  const cases: Array<{ name: string; pass: boolean; detail: unknown }> = [];
  try {
    const sp = await call("sp", "sp_sprawdz_sygnature", { sygnatura: "I C 100/15", sad: "poznan.so" });
    const link = String(sp.result?.url_orzeczenia ?? "");
    const text = link ? await call("sp", "sp_pobierz", { url_lub_id: link }) : {};
    cases.push({
      name: "SP: I C 100/15 w SO Poznań, treść spod linku zawiera sygnaturę",
      pass: sp.status === "FOUND" && /I C 100\/15/i.test(String(text.result?.tresc ?? "").replace(/\s+/g, " ")),
      detail: { status: sp.status, link, textStatus: text.status, error: sp.detail ?? sp.portal_blad }
    });
    const agregat = await call("sp", "sp_sprawdz_sygnature", { sygnatura: "I C 100/15" });
    cases.push({ name: "SP: agregat — sygnatura w wielu sądach = AMBIGUOUS", pass: agregat.status === "AMBIGUOUS", detail: { status: agregat.status, liczba: agregat.liczba_trafien } });

    // Fraza: formularz Portalu Orzeczeń (nie SAOS); przy porażce formularze strony głównej.
    const fraza = await call("sp", "sp_szukaj", { fraza: "zadośćuczynienie" });
    const frazaPass = fraza.status === "AMBIGUOUS" && /^formularz/.test(String(fraza.metoda ?? "")) && Boolean(fraza.kandydaci?.[0]?.url_orzeczenia);
    cases.push({
      name: "SP: fraza przez formularz Portalu Orzeczeń, kandydaci z linkiem",
      pass: frazaPass,
      detail: { status: fraza.status, metoda: fraza.metoda, source: fraza.source, pierwszy: fraza.kandydaci?.[0], error: fraza.detail ?? fraza.portal_blad,
        ...(frazaPass ? {} : { forms: await homeForms("https://orzeczenia.ms.gov.pl/", "LexMachina-sp/1.0") }) }
    });

    const cbosa = await call("cbosa", "cbosa_sprawdz_sygnature", { sygnatura: "II OSK 2286/20" });
    cases.push({ name: "CBOSA: II OSK 2286/20 — odpowiedź źródła (nie błąd sieci)", pass: cbosa.status !== "ERROR", detail: { status: cbosa.status, error: cbosa.detail } });

    const tk = await call("tk", "tk_sprawdz_sygnature", { sygnatura: "K 33/07" });
    const tkLink = String(tk.result?.url_orzeczenia ?? tk.kandydaci?.[0]?.url_orzeczenia ?? "");
    const tkText = tkLink ? await call("tk", "tk_pobierz", { url: tkLink, sygnatura: "K 33/07" }) : {};
    cases.push({
      name: "TK: K 33/07 ze źródła urzędowego (IPO / OTK ZU), dokument zawiera sygnaturę",
      pass: /^(IPO|OTK ZU)/.test(String(tk.metoda ?? "")) && tkText.status === "FOUND",
      detail: { status: tk.status, metoda: tk.metoda ?? tk.source, link: tkLink, sources: tk.zrodla, textStatus: tkText.status }
    });

    const etpcz = await call("etpcz", "etpcz_szukaj", { numer_skargi: "43447/19" });
    const etpczLink = String(etpcz.result?.url_orzeczenia ?? "");
    const etpczText = etpczLink ? await call("etpcz", "etpcz_pobierz", { url_lub_id: etpczLink, numer_skargi: "43447/19" }) : {};
    const etpczPass = etpcz.status === "FOUND" && /etpccontent\/\$N\/.*_ETPC_043447_2019_/.test(etpczLink) && etpczText.status === "FOUND";
    cases.push({
      name: "ETPCz: skarga 43447/19 w bazie MS, treść spod stałego linku",
      pass: etpczPass,
      // Przy porażce: formularze strony głównej (akcja, metoda, pola) — do dopasowania konektora.
      detail: { status: etpcz.status, link: etpczLink, textStatus: etpczText.status, error: etpcz.detail, ...(etpczPass ? {} : { forms: await homeForms("https://etpcz.ms.gov.pl/", "LexMachina-etpcz/1.0") }) }
    });

    const sn = await call("sn", "sn_sprawdz_sygnature", { sygnatura: "III CZP 25/11" });
    cases.push({ name: "SN: III CZP 25/11 — karta orzeczenia", pass: sn.status === "FOUND" && /orzeczenie=/.test(String(sn.result?.url_karty ?? "")), detail: { status: sn.status, error: sn.detail } });
  } finally {
    await runtime.close();
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ gate: "G40B_LIVE_COURT_CONNECTORS", cases }, null, 2));
  if (cases.some((item) => !item.pass)) process.exitCode = 1;
}

async function homeForms(url: string, userAgent: string): Promise<unknown> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "text/html" }, signal: AbortSignal.timeout(30_000) });
    const html = await response.text();
    return {
      http: response.status,
      forms: [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].slice(0, 6).map(([, attributes, body]) => ({
        attributes: attributes!.trim().slice(0, 300),
        inputs: [...body!.matchAll(/<(input|select|button|textarea)\b[^>]*>/gi)].slice(0, 40).map(([tag]) => tag.slice(0, 200))
      })),
      links: [...new Set([...html.matchAll(/href="([^"]*(?:search|szukaj|wyszuk)[^"]*)"/gi)].map(([, href]) => href))].slice(0, 20)
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
