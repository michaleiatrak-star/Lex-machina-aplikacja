// Readers of national legislation from the official sources whose answers carry the text
// (checked live 2026-11-08). Each reader turns one answer into articles: unit, heading, text
// and, where the source prints them, the amending acts with their dates in force. A PDF with a
// text layer is read; a scan (no text layer) is not guessed at: it becomes a candidate for OCR
// and the RAG index, never a verified wording.
import { LocalPdfTextExtractor } from "../pdf-text-extractor.js";

export type NationalArticle = {
  unit: string;
  heading: string;
  text: string;
  // Amending acts the source names at the article, with their date in force (YYYY-MM-DD).
  amendments: Array<{ act: string; inForce?: string }>;
};

export type NationalReading = {
  country: string;
  source: string;
  title?: string;
  // How the source publishes the consolidated text (registry: shared/TEMPORAL-LAW-CHECK.md).
  version?: string;
  articles: NationalArticle[];
  // The source's own note on legal force ("tekst bez mocy prawnej", "tekst nieurzędowy").
  status: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/giu, "")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h\d|tr)>/giu, "\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&(#\d+|#x[\da-f]+|\w+);/giu, (whole, code: string) =>
      code.startsWith("#x") || code.startsWith("#X")
        ? String.fromCodePoint(parseInt(code.slice(2), 16))
        : code.startsWith("#")
          ? String.fromCodePoint(Number(code.slice(1)))
          : ENTITIES[code.toLowerCase()] ?? decodeNamed(code) ?? whole
    )
    .replace(/ /gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n[ \n]*/gu, "\n")
    .trim();
}

// Latin letters with accents written as HTML entities (Normattiva: &Egrave;, &agrave;).
function decodeNamed(code: string): string | undefined {
  const match = /^([A-Za-z])(acute|grave|circ|uml|tilde|cedil)$/u.exec(code);
  if (!match) return undefined;
  const mark = { acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧" }[match[2] as "acute"];
  return (match[1]! + mark).normalize("NFC");
}

const dmy = (value: string): string => value.replace(/^(\d{2})-(\d{2})-(\d{4})$/u, "$3-$2-$1");

/** Denmark, Retsinformation XML (LexDania): § with its Stk. LBK = consolidated text, a separate act. */
export function readDenmark(xml: string, source: string): NationalReading {
  const title = plainText(/<DocumentTitle>([\s\S]*?)<\/DocumentTitle>/u.exec(xml)?.[1] ?? "");
  const type = /<DocumentType>([^<#\s]+)/u.exec(xml)?.[1];
  const articles = [...xml.matchAll(/<Paragraf\b[^>]*>([\s\S]*?)<\/Paragraf>/gu)].map((match): NationalArticle => {
    const body = match[1]!;
    const heading = plainText(/<Explicatus>([\s\S]*?)<\/Explicatus>/u.exec(body)?.[1] ?? "");
    return { unit: heading.replace(/\.$/u, ""), heading, text: plainText(body.replace(/<\/Linea>/gu, "\n")), amendments: [] };
  });
  const version = type === "LBK" ? "LBK (lovbekendtgørelse: tekst skonsolidowany jako osobny akt)" : type;
  return { country: "DK", source, title, ...(version ? { version } : {}), articles, status: "tekst urzędowy (Retsinformation)" };
}

/** Netherlands, wetten.overheid.nl: div.artikel with its h4 heading; the page is the version of the date in its address. */
export function readNetherlands(html: string, source: string): NationalReading {
  const blocks = html.split(/<div class="artikel" id="[^"]*"[^>]*>/u).slice(1);
  const articles = blocks.map((block): NationalArticle => {
    const heading = plainText(/<h4\b[^>]*>([\s\S]*?)<\/h4>/u.exec(block)?.[1] ?? "");
    // The action list (relations, permalink…) is not the article's text.
    const body = block.replace(/<ul role="list"[\s\S]*?<\/ul>/gu, "").replace(/<h4\b[\s\S]*?<\/h4>/u, "");
    return { unit: heading.replace(/^Artikel\s+/u, "").trim(), heading, text: plainText(body), amendments: [] };
  });
  return { country: "NL", source, articles, version: "wersja z datą (adres …/{data}/0)", status: "tekst urzędowy (wetten.overheid.nl, BWB)" };
}

/** Belgium, Justel: "Art. N." anchors; amendments as "<L 2021-07-11/08, art. 17, 027; En vigueur : 06-10-2022>". */
export function readBelgium(html: string, source: string): NationalReading {
  const parts = html.split(/<A NAME='Art\.([^']+)'[^>]*>/iu);
  const articles: NationalArticle[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const unit = parts[index]!;
    const raw = parts[index + 1] ?? "";
    const amendments = [...raw.matchAll(/&lt;L\s*(?:<A [^>]*>)?(\d{4}-\d{2}-\d{2}\/\d+)(?:<\/A>)?,[^;]*;\s*En vigueur\s*:\s*(\d{2}-\d{2}-\d{4})/giu)].map((match) => ({ act: `L ${match[1]}`, inForce: dmy(match[2]!) }));
    articles.push({ unit, heading: `Art. ${unit}`, text: plainText(raw), amendments: [...new Map(amendments.map((item) => [`${item.act}|${item.inForce}`, item])).values()] });
  }
  return { country: "BE", source, articles, version: "justel (wersja skonsolidowana)", status: "tekst bez mocy prawnej (Justel); moc ma publikacja w Moniteur belge" };
}

/** Italy, Normattiva (Akoma Ntoso HTML): h2.article-num-akn with the text after it; codes in annexes load separately. */
export function readItaly(html: string, source: string): NationalReading {
  const parts = html.split(/<h2 class="article-num-akn" id="([^"]+)">/u);
  const articles: NationalArticle[] = [];
  for (let index = 1; index < parts.length; index += 2) {
    const raw = parts[index + 1] ?? "";
    const heading = plainText(raw.slice(0, raw.indexOf("</h2>")));
    const body = raw.slice(raw.indexOf("</h2>") + 5).split(/<h2 class="(?!article-num-akn)/u)[0]!;
    // "AGGIORNAMENTO" notes name the amending acts (title line of each note).
    const updated = [...body.matchAll(/class="art_aggiornamento_testo-akn"[^>]*>([\s\S]*?)<\/(?:div|span)>/gu)]
      .map((match) => ({ act: plainText(match[1]!).replace(/\s+/gu, " ").slice(0, 200) }))
      .filter((item) => item.act);
    articles.push({ unit: heading.replace(/^Art\.\s*/u, ""), heading, text: plainText(body), amendments: updated });
  }
  return { country: "IT", source, articles, version: "wersja z datą (Normattiva, vigenza)", status: "tekst urzędowy (Normattiva); artykuły kodeksów z załączników ładowane osobno" };
}

/**
 * Germany, gesetze-im-internet.de (BMJ/BfJ): one norm per page (…/bgb/__433.html), § in
 * span.jnenbez, title in span.jnentitel, paragraphs (Absätze) in div.jurAbsatz. The text is
 * consolidated but not official ("Nichtamtliches Inhaltsverzeichnis"); the official text is the
 * BGBl. promulgation (recht.bund.de) and, for the acts it holds, NeuRIS (rechtsinformationen.bund.de).
 */
export function readGermany(html: string, source: string): NationalReading {
  const title = plainText(/<h1>([\s\S]*?)<br/u.exec(html)?.[1] ?? "");
  const unit = plainText(/<span class="jnenbez">([\s\S]*?)<\/span>/u.exec(html)?.[1] ?? "");
  const heading = plainText(/<span class="jnentitel">([\s\S]*?)<\/span>/u.exec(html)?.[1] ?? "");
  const paragraphs = [...html.matchAll(/<div class="jurAbsatz">([\s\S]*?)<\/div>/gu)].map((match) => plainText(match[1]!));
  const articles = unit ? [{ unit, heading: `${unit} ${heading}`.trim(), text: paragraphs.join("\n"), amendments: [] }] : [];
  return { country: "DE", source, title, articles, version: "wersja obowiązująca (bez daty w adresie)", status: "tekst nieurzędowy (gesetze-im-internet.de); urzędowy: BGBl. (recht.bund.de)" };
}

export type PdfReading =
  | { kind: "TEKST"; text: string; pages: number }
  | { kind: "SKAN"; pages: number; note: string }
  | { kind: "MIESZANY"; text: string; pages: number; pagesWithoutText: number[]; note: string };

const RAG_NOTE = "skan bez warstwy tekstowej: kandydat do OCR i indeksu RAG, nie brzmienie zweryfikowane";

/** A legislation PDF: its text layer is read; pages without one are named for OCR/RAG. */
export async function readLegislationPdf(data: Uint8Array): Promise<PdfReading> {
  const result = await new LocalPdfTextExtractor(undefined, { lines: true, allowEmpty: true }).extract(data);
  const pages = result.pageTexts ?? [result.text];
  const empty = pages.map((page, index) => (page.replace(/\s+/gu, "").length < 20 ? index + 1 : 0)).filter(Boolean);
  if (empty.length === pages.length) return { kind: "SKAN", pages: pages.length, note: RAG_NOTE };
  if (empty.length) return { kind: "MIESZANY", text: result.text, pages: pages.length, pagesWithoutText: empty, note: `strony ${empty.join(", ")}: ${RAG_NOTE}` };
  return { kind: "TEKST", text: result.text, pages: pages.length };
}

export const NATIONAL_READERS = { DK: readDenmark, NL: readNetherlands, BE: readBelgium, IT: readItaly, DE: readGermany } as const;
