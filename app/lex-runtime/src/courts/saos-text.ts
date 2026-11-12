// Full text of a ruling the case file cites, from SAOS (RZĄD 3: an academic aggregator, the
// text for reading and quoting; the ruling's status comes from the court's own database).
// SAOS covers the common courts and SN up to 2016. RD 121/26 (2026-11-12): sn.pl asked for its
// human check, the app answered "the fragment holds only the signature" for SDI 9/12, while
// SAOS holds the whole judgment and the quotes of the case file match it word for word.
import { plainText } from "../eli/readers.js";
import { CASE_TEXT_BUDGET, caseTextExcerpt, holdCaseLawText } from "../case-law-texts.js";

function excerptFor(signature: string, source: string, text: string, quotes: readonly string[], budget: number): string {
  holdCaseLawText(signature, source, text);
  return caseTextExcerpt(text, quotes, budget).text;
}

const SAOS = "https://www.saos.org.pl/api";

export type SaosText = { signature: string; status: "FOUND"; url: string; court: string; date: string; text: string } | { signature: string; status: "NOT_FOUND" | "UNAVAILABLE"; detail: string };

export type SaosFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** SAOS holds SN rulings up to 2016 and the common courts: "SDI 9/12" yes, "II CSKP 89/26" no. */
export function saosCovers(signature: string, court: "SN" | "POWSZECHNY" | string): boolean {
  const year = Number(/\/(\d{2,4})\s*$/u.exec(signature)?.[1] ?? "");
  const full = year < 100 ? 2000 + year : year;
  return court === "POWSZECHNY" || (court === "SN" && full <= 2016);
}

export async function saosText(signature: string, fetchImpl: SaosFetch = fetch as unknown as SaosFetch): Promise<SaosText> {
  try {
    const search = await fetchImpl(`${SAOS}/search/judgments?caseNumber=${encodeURIComponent(signature)}&pageSize=5`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!search.ok) return { signature, status: "UNAVAILABLE", detail: `SAOS_${search.status}` };
    const items = ((await search.json()) as { items?: Array<{ href?: string; courtCases?: Array<{ caseNumber?: string }> }> }).items ?? [];
    const exact = items.filter((item) => item.courtCases?.some((entry) => entry.caseNumber?.replace(/\s+/gu, " ").trim() === signature));
    if (exact.length !== 1 || !exact[0]!.href?.startsWith(`${SAOS}/judgments/`)) return { signature, status: "NOT_FOUND", detail: exact.length > 1 ? "AMBIGUOUS" : "NO_EXACT_CASE_NUMBER" };
    const reply = await fetchImpl(exact[0]!.href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!reply.ok) return { signature, status: "UNAVAILABLE", detail: `SAOS_${reply.status}` };
    const data = ((await reply.json()) as { data?: { textContent?: string; judgmentDate?: string; division?: { court?: { name?: string } }; courtType?: string } }).data ?? {};
    const text = plainText(data.textContent ?? "").replace(/\s+/gu, " ").trim();
    if (!text) return { signature, status: "NOT_FOUND", detail: "NO_TEXT" };
    return { signature, status: "FOUND", url: exact[0]!.href.replace("/api/judgments/", "/judgments/"), court: data.division?.court?.name ?? (data.courtType === "SUPREME" ? "Sąd Najwyższy" : ""), date: data.judgmentDate ?? "", text };
  } catch (error) {
    return { signature, status: "UNAVAILABLE", detail: error instanceof Error ? error.message.slice(0, 120) : "SAOS_FAILED" };
  }
}

/** `quotes`: what the case file quotes from each ruling (its passages go to the model first); `budget`: characters per ruling. */
export function saosPrefetchPrompt(results: readonly SaosText[], quotes: Record<string, string[]> = {}, budget = CASE_TEXT_BUDGET): string {
  const lines = results.map((result) =>
    result.status === "FOUND"
      ? `- ${result.signature} (${result.court}${result.date ? `, ${result.date}` : ""}): tekst z SAOS (${result.url}; RZĄD 3 — treść do odczytu i cytatu, status orzeczenia potwierdza baza urzędowa sądu). Tekst:\n${excerptFor(result.signature, result.url, result.text, quotes[result.signature] ?? [], budget)}`
      : `- ${result.signature}: SAOS — ${result.status === "NOT_FOUND" ? "brak dokładnego trafienia" : "niedostępny"} (${result.detail}).`
  );
  return ["# ORZECZENIA Z AKT SPRAWY — TEKST POBRANY PRZEZ APLIKACJĘ Z SAOS (ustalone przez aplikację)", "Cytuj tylko z tych tekstów; sprawdź, czy cytaty z dokumentów sprawy są w nich dosłownie.", ...lines].join("\n");
}
