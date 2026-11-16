// Common courts' rulings on the procedural setting of the case, read before the model answers
// (RD 121/26, 2026-11-16): the chat read SO Warszawa XII Kp 176/20 on a refusal to open
// proceedings on incomplete material; the application only listed portal links. The courts' own
// portal ("sp" connector) is searched with the setting's phrase, the rulings it lists and the
// common-court pages the portal search found are read, and the passages on the issue are given.
import { currentCommonCourtsReader, currentCommonCourtsSearch, type CommonCourtsReader, type CommonCourtsSearch } from "../case-law-search.js";
import { relevantPassages } from "../legal-federation-tool-runtime.js";
import { signaturesIn } from "../court-of-signature.js";

export type CommonCourtRuling = { url: string; signature: string | null; court: string | null; date: string | null; passages: string; text: string };

/** A ruling page of the common courts' portals (orzeczenia.ms.gov.pl, orzeczenia.<court>.gov.pl). */
export function commonCourtPage(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return /^orzeczenia\.(?:[a-z0-9-]+\.)*gov\.pl$/u.test(host) && host !== "orzeczenia.nsa.gov.pl" && /\/(?:details|content)\//u.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export async function commonCourtRulingsByIssue(
  phrases: readonly string[],
  options: { portalUrls?: readonly string[]; focus?: string; limit?: number; search?: CommonCourtsSearch | null; read?: CommonCourtsReader | null } = {}
): Promise<CommonCourtRuling[]> {
  const search = options.search === undefined ? currentCommonCourtsSearch() : options.search;
  const read = options.read === undefined ? currentCommonCourtsReader() : options.read;
  if (!read) return [];
  const limit = options.limit ?? 3;
  const listed = search ? await Promise.all(phrases.map((phrase) => search(phrase, 5).catch(() => null))) : [];
  const urls = [...new Set([...(options.portalUrls ?? []).filter(commonCourtPage), ...listed.flatMap((result) => result?.candidates.map((candidate) => candidate.sourceUrl).filter((url): url is string => Boolean(url)) ?? [])])];
  const question = [options.focus ?? "", ...phrases].join("\n");
  const read_ = await Promise.all(
    urls.slice(0, limit + 3).map(async (url) => {
      const page = await read(url).catch(() => null);
      if (!page) return null;
      const focused = relevantPassages(page.text, question);
      if (!focused.passages) return null;
      const signature = page.signature ?? signaturesIn(page.text.slice(0, 3000))[0]?.signature ?? null;
      return { url, signature, court: page.court ?? null, date: page.date ?? null, passages: focused.text, text: page.text } satisfies CommonCourtRuling;
    })
  );
  return read_.filter((item): item is CommonCourtRuling => Boolean(item)).slice(0, limit);
}

export function commonCourtIssuePrompt(rulings: readonly CommonCourtRuling[]): string {
  if (!rulings.length) return "";
  return [
    "# ORZECZENIA SĄDÓW POWSZECHNYCH WEDŁUG ZAGADNIENIA — PORTAL ORZECZEŃ (ustalone przez aplikację)",
    "Tekst odczytany z portalu orzeczeń sądów powszechnych (źródło urzędowe). Poniżej fragmenty związane z zagadnieniem sprawy. Powołuj orzeczenie (sąd, data, sygnatura) tylko gdy fragment wspiera tezę; cytuj wyłącznie z niego; orzeczenie sądu powszechnego to argument pomocniczy, nie wiążąca wykładnia.",
    ...rulings.map((ruling) => `## ${[ruling.court, ruling.date, ruling.signature].filter(Boolean).join(", ") || "orzeczenie"} (${ruling.url})\n${ruling.passages}`)
  ].join("\n\n");
}
