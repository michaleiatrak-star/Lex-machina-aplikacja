// Codes of professional ethics a case file cites ("§ 16 zd. 3 KEA"): not acts of the Journal of
// Laws (not in ELI), published by the profession's own council. RD 121/26 (2026-11-12): the
// central norm of the case, § 16 KEA, was never read by the application, while the chat read it
// from the consolidated text of the Bar's council. The application reads the cited paragraphs
// before the model answers.
import { readLegislationPdf } from "../eli/readers.js";

export type EthicsCode = {
  key: "KEA";
  name: string;
  // The consolidated text in force, as the council publishes it (newest first).
  sources: Array<{ url: string; label: string }>;
  // How a case file names the code.
  names: RegExp;
};

export const ETHICS_CODES: readonly EthicsCode[] = [
  {
    key: "KEA",
    name: "Zbiór Zasad Etyki Adwokackiej i Godności Zawodu (Kodeks Etyki Adwokackiej)",
    sources: [
      {
        url: "https://www.adwokatura.pl/admin/wgrane_pliki/file-zal-do-uchwaly-prezydium-nra-nr-1742026kodeksetykiadwokackiejtekst-jednolity-44572.pdf",
        label: "tekst jednolity — załącznik do uchwały nr 174/2026 Prezydium NRA z 23 czerwca 2026 r."
      }
    ],
    names: /\bKEA\b|Kodeks\p{L}*\s+Etyki\s+Adwokackiej|Zbi\p{L}+\s+Zasad\s+Etyki\s+Adwokackiej|ZZEAiGZ/u
  }
];

/** Paragraphs of a code the text cites: "§ 16 zd. 3 KEA", "§ 16 Kodeksu Etyki Adwokackiej", "§§ 16 i 17 KEA". */
export function citedEthicsParagraphs(text: string): Array<{ code: EthicsCode; paragraphs: string[] }> {
  const found: Array<{ code: EthicsCode; paragraphs: string[] }> = [];
  for (const code of ETHICS_CODES) {
    const paragraphs = new Set<string>();
    for (const sentence of text.split(/(?<=[.;])\s+(?=[\p{Lu}„(])|\n/u)) {
      if (!code.names.test(sentence)) continue;
      for (const match of sentence.matchAll(/§§?\s*(\d{1,3}[a-z]?)(?:\s*(?:i|oraz|,)\s*(\d{1,3}[a-z]?))?/gu)) {
        paragraphs.add(match[1]!);
        if (match[2]) paragraphs.add(match[2]);
      }
    }
    if (paragraphs.size) found.push({ code, paragraphs: [...paragraphs].slice(0, 8) });
  }
  return found;
}

/** The paragraph "§ N" of a code's text: from its heading line to the next paragraph or chapter. */
export function ethicsParagraph(text: string, paragraph: string): string | null {
  const start = new RegExp(`(?:^|\\n)\\s*§\\s*${paragraph}\\s*\\n`, "u").exec(text);
  if (!start) return null;
  const rest = text.slice(start.index + start[0].length);
  const next = /\n\s*(?:§\s*\d{1,3}[a-z]?\s*\n|Rozdział\s|ROZDZIAŁ\s)/u.exec(rest);
  const body = rest.slice(0, next ? next.index : 4_000).replace(/\s*\n\s*/gu, " ").trim();
  return body ? `§ ${paragraph}. ${body}` : null;
}

export type EthicsReading =
  | { status: "FOUND"; code: EthicsCode; source: { url: string; label: string }; paragraphs: Array<{ paragraph: string; text: string | null }> }
  | { status: "UNAVAILABLE"; code: EthicsCode; detail: string };

export type EthicsFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

const cache = new Map<string, string>();

export async function readEthicsParagraphs(code: EthicsCode, paragraphs: readonly string[], fetchImpl: EthicsFetch = fetch as unknown as EthicsFetch): Promise<EthicsReading> {
  for (const source of code.sources) {
    try {
      let text = cache.get(source.url);
      if (!text) {
        const reply = await fetchImpl(source.url, { headers: { accept: "application/pdf" }, signal: AbortSignal.timeout(60_000) });
        if (!reply.ok) continue;
        const reading = await readLegislationPdf(new Uint8Array(await reply.arrayBuffer()));
        if (reading.kind === "SKAN") continue;
        text = reading.text;
        cache.set(source.url, text);
      }
      return { status: "FOUND", code, source, paragraphs: paragraphs.map((paragraph) => ({ paragraph, text: ethicsParagraph(text!, paragraph) })) };
    } catch {
      // The next source, if any.
    }
  }
  return { status: "UNAVAILABLE", code, detail: "ETHICS_CODE_SOURCE_UNAVAILABLE" };
}

export function ethicsPrompt(readings: readonly EthicsReading[]): string {
  const lines = readings.flatMap((reading) =>
    reading.status === "FOUND"
      ? [
          `${reading.code.name} — ${reading.source.label} (${reading.source.url}); źródło urzędowe samorządu zawodowego, odczytane przez aplikację w tej turze:`,
          ...reading.paragraphs.map((item) => (item.text ? `- ${item.text}` : `- § ${item.paragraph}: brak takiego paragrafu w tekście jednolitym — nie przypisuj mu treści.`))
        ]
      : [`${reading.code.name}: tekst niedostępny (${reading.detail}) — oznacz powołania jako niezweryfikowane.`]
  );
  return [
    "# KODEKS ETYKI ZAWODOWEJ Z AKT SPRAWY — BRZMIENIE ODCZYTANE PRZEZ APLIKACJĘ (ustalone przez aplikację)",
    "Gdy sprawa dotyczy przewinienia dyscyplinarnego, normą centralną jest naruszona zasada etyki (np. § 16 KEA), a nie przepis karny przywołany w piśmie; cytuj brzmienie wyłącznie z tekstu poniżej.",
    ...lines
  ].join("\n");
}
