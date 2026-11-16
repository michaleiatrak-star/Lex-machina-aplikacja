// Wyższy Sąd Dyscyplinarny Adwokatury: its rulings are published in the Bar's own portal
// (wsd.adwokatura.pl, "Portal Orzecznictwa Dyscyplinarnego Adwokatury", register 19), not in
// SN, SAOS or the courts' portals, and a web search does not index the ruling pages (RD 121/26,
// 2026-11-12: WSD 113/22 and WSD 128/17 cited in the case file were never looked up). The
// portal's own search takes the signature (field sygAK of its register search); every hit is a
// page …/rejestry/show/{slug}, read and accepted only when its text names the signature.
import { plainText } from "../eli/readers.js";
import { CASE_TEXT_BUDGET, caseTextExcerpt, holdCaseLawText } from "../case-law-texts.js";
import { currentPortalSearch } from "../official-portal-search.js";
import { pageRenderer } from "../browser-render.js";

export const WSD_PORTAL = "https://wsd.adwokatura.pl";
const REGISTER = 19;

export type WsdLookup =
  | { status: "FOUND"; signature: string; url: string; title: string; text: string }
  | { status: "NOT_FOUND"; signature: string; searched: string }
  | { status: "UNAVAILABLE"; signature: string; detail: string };

export type WsdFetch = (url: string, init: { method?: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** "WSD 113/22" -> "113/22"; null for another court's signature. */
export function wsdNumber(signature: string): string | null {
  return /^\s*WSD\s+(\d{1,5}\/\d{2,4})\s*$/u.exec(signature.normalize("NFKC"))?.[1] ?? null;
}

/**
 * Signatures the portal's register holds: WSD rulings and the Supreme Court's judgments on the
 * bar's disciplinary cassations (SDI, DSI), published there with theses ("Sygnatura: SDI 9/12").
 * RD 121/26: sn.pl asked for its captcha and SAOS failed, while the register had SDI 9/12.
 */
export function wsdRegisterSignature(signature: string): { prefix: "WSD" | "SDI" | "DSI"; number: string } | null {
  const match = /^\s*(WSD|SDI|DSI)\s+(\d{1,5}\/\d{2,4})\s*$/u.exec(signature.normalize("NFKC").replace(/\s+/gu, " "));
  return match ? { prefix: match[1] as "WSD" | "SDI" | "DSI", number: match[2]! } : null;
}

/** The ruling pages a result list of the portal's register search links to. */
export function wsdResultLinks(html: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']((?:https:\/\/wsd\.adwokatura\.pl)?\/?rejestry\/show\/[^"'#?]+)["']/gu)) {
    const path = match[1]!.replace(/^https:\/\/wsd\.adwokatura\.pl/u, "").replace(/^\/?/u, "/");
    links.add(`${WSD_PORTAL}${path}`);
  }
  return [...links];
}

/**
 * The page is the ruling with this signature: its own field "Sygnatura: …" when it has one (a
 * ruling cites others: WSD 111/22 cites SDI 87/17 and is not SDI 87/17, RD 121/26), otherwise
 * the signature named on it ("WSD 113/22", "sygn. akt WSD 113/22").
 */
export function wsdPageNames(text: string, number: string, prefix = "WSD"): boolean {
  const normalized = text.normalize("NFKC").replace(/\s+/gu, " ");
  const own = /Sygnatura:?\s*((?:WSD|SDI|DSI|WKD|SD)\s*\d{1,5}\s*\/\s*\d{2,4})/u.exec(normalized)?.[1];
  const wanted = `${prefix} ${number}`.replace(/\s+/gu, "");
  if (own) return own.replace(/\s+/gu, "") === wanted;
  const escaped = number.replace(/[/]/gu, "\\s*\\/\\s*");
  return new RegExp(`${prefix}\\s*${escaped}(?![\\d])`, "u").test(normalized);
}

/** Reads ruling pages and returns the first that names the signature. */
async function firstNaming(urls: string[], prefix: string, number: string, fetchImpl: WsdFetch): Promise<WsdLookup | null> {
  for (const url of urls) {
    try {
      const page = await fetchImpl(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
      const html = page?.ok ? await page.text() : "";
      const main = /<article\b[\s\S]*?<\/article>/u.exec(html)?.[0] ?? html;
      let text = plainText(main);
      let title = plainText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/u.exec(html)?.[1] ?? /<title>([\s\S]*?)<\/title>/u.exec(html)?.[1] ?? "");
      // Refused or a bot check instead of the ruling: the browser on this computer or server
      // (Chromium in Docker, Ustawienia > Wyszukiwarka internetowa) reads the page, when it runs.
      if (!wsdPageNames(text, number, prefix)) {
        const rendered = await pageRenderer()?.render(url).catch(() => null);
        if (!rendered || !wsdPageNames(rendered.text, number, prefix)) continue;
        text = rendered.text;
        title = rendered.title;
      }
      return { status: "FOUND", signature: `${prefix} ${number}`, url, title, text: text.slice(0, 60_000) };
    } catch {
      // Another hit may still be the ruling.
    }
  }
  return null;
}

/**
 * The portal's register search failing (HTTP 5xx, timeout): the configured web search with the
 * portal's address and the signature; only the portal's own ruling pages are read.
 */
async function viaWebSearch(prefix: string, number: string, fetchImpl: WsdFetch): Promise<WsdLookup | null> {
  const search = currentPortalSearch();
  if (!search) return null;
  try {
    const hits = await search(`site:wsd.adwokatura.pl "${prefix} ${number}"`, 8);
    const urls = hits.map((hit) => hit.url).filter((url) => /^https:\/\/wsd\.adwokatura\.pl\/rejestry\/show\//u.test(url));
    return await firstNaming(urls.slice(0, 6), prefix, number, fetchImpl);
  } catch {
    return null;
  }
}

export async function findWsdRuling(signature: string, fetchImpl: WsdFetch = fetch as unknown as WsdFetch): Promise<WsdLookup> {
  const register = await findWsdRulingInRegister(signature, fetchImpl);
  if (register.status !== "UNAVAILABLE" || register.detail === "WSD_SIGNATURE_INVALID") return register;
  const parsed = wsdRegisterSignature(signature)!;
  return (await viaWebSearch(parsed.prefix, parsed.number, fetchImpl)) ?? register;
}

async function findWsdRulingInRegister(signature: string, fetchImpl: WsdFetch): Promise<WsdLookup> {
  const parsed = wsdRegisterSignature(signature);
  if (!parsed) return { status: "UNAVAILABLE", signature, detail: "WSD_SIGNATURE_INVALID" };
  const { prefix, number } = parsed;
  const search = `${WSD_PORTAL}/ajax.php?m=aktyPrawne&o=listAkty&pp=1&idm=${REGISTER}`;
  const body = new URLSearchParams({ nazwaAK: "", sygAK: number, id_catAK: "", id_organAK: "", odAK: "", doAK: "", sortAK: "" }).toString();
  let list: string;
  try {
    const reply = await fetchImpl(search, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", accept: "text/html", referer: `${WSD_PORTAL}/rejestry/showMain/orzecznictwo-${REGISTER}` },
      body,
      signal: AbortSignal.timeout(30_000)
    });
    if (!reply.ok) return { status: "UNAVAILABLE", signature, detail: `WSD_SEARCH_${reply.status}` };
    list = await reply.text();
  } catch (error) {
    return { status: "UNAVAILABLE", signature, detail: error instanceof Error ? error.message.slice(0, 120) : "WSD_SEARCH_FAILED" };
  }
  const found = await firstNaming(wsdResultLinks(list).slice(0, prefix === "WSD" ? 6 : 12), prefix, number, fetchImpl);
  if (found) return found;
  return { status: "NOT_FOUND", signature: `${prefix} ${number}`, searched: `${WSD_PORTAL}/rejestry/showMain/orzecznictwo-${REGISTER} (wyszukiwarka portalu, sygnatura ${number})` };
}

/** For the model: what the application found for each WSD signature of the case file. */
export function wsdPrefetchPrompt(results: readonly WsdLookup[], quotes: Record<string, string[]> = {}, budget = CASE_TEXT_BUDGET): string {
  const lines = results.map((result) =>
    result.status === "FOUND"
      ? `- ${result.signature}: ZNALEZIONE w portalu WSD (${result.url}). Tekst ze strony orzeczenia (cytuj tylko z niego):\n${(holdCaseLawText(result.signature, result.url, result.text), caseTextExcerpt(result.text, quotes[result.signature] ?? [], budget).text)}`
      : result.status === "NOT_FOUND"
        ? `- ${result.signature}: NIE ZNALEZIONO w portalu orzecznictwa WSD (${result.searched}). Nie przypisuj mu treści ani cytatu; oznacz jako niezweryfikowane i wskaż źródło do sprawdzenia (LEX/Legalis, sekretariat WSD).`
        : `- ${result.signature}: portal WSD niedostępny (${result.detail}). Oznacz jako niezweryfikowane.`
  );
  return ["# ORZECZENIA WSD Z AKT SPRAWY — SPRAWDZONE PRZEZ APLIKACJĘ (ustalone przez aplikację)", "Każda sygnatura WSD z dokumentów sprawy została wyszukana w portalu orzecznictwa WSD; użyj wyniku dla każdej z nich.", ...lines].join("\n");
}
