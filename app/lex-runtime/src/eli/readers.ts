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

const GERMAN_MONTHS: Record<string, string> = { jan: "01", feb: "02", "mär": "03", mar: "03", apr: "04", mai: "05", juni: "06", jun: "06", juli: "07", jul: "07", aug: "08", sept: "09", sep: "09", okt: "10", nov: "11", dez: "12" };

/** "1. Jan. 2000" -> "2000-01-01" (Fedlex notes in German). */
function germanDate(value: string): string | undefined {
  const match = /(\d{1,2})\.\s*([A-Za-zäÄ]+)\.?\s*(\d{4})/u.exec(value);
  const month = match ? GERMAN_MONTHS[match[2]!.toLowerCase().slice(0, match[2]!.toLowerCase().startsWith("ju") ? 4 : 3)] ?? GERMAN_MONTHS[match[2]!.toLowerCase()] : undefined;
  return match && month ? `${match[3]}-${month}-${match[1]!.padStart(2, "0")}` : undefined;
}

/**
 * Switzerland, Fedlex (Akoma Ntoso XML of the consolidated version, one file per date in force:
 * …/filestore/fedlex.data.admin.ch/eli/cc/{id}/{YYYYMMDD}/{lang}/xml/…xml, found by SPARQL from
 * the work's consolidations). Each change is an authorialNote naming the amending act (an ELI
 * link to the Official Compilation AS) and "in Kraft seit …". The text has legal force (SR).
 */
export function readSwitzerland(xml: string, source: string): NationalReading {
  const title = plainText(/<docTitle>([\s\S]*?)<\/docTitle>/u.exec(xml)?.[1] ?? "");
  const articles = [...xml.matchAll(/<article eId="([^"]+)">([\s\S]*?)<\/article>/gu)].map(([, , body]): NationalArticle => {
    const heading = plainText(/<num>([\s\S]*?)<\/num>/u.exec(body!)?.[1] ?? "");
    const notes = [...body!.matchAll(/<authorialNote>([\s\S]*?)<\/authorialNote>/gu)].map((match) => match[1]!);
    const amendments = notes.flatMap((note) => {
      const act = /<ref href="(https:\/\/fedlex\.data\.admin\.ch\/eli\/oc\/[^"]+)"/u.exec(note)?.[1];
      if (!act) return [];
      const inForce = germanDate(/in Kraft seit ([^(;]+)/u.exec(plainText(note))?.[1] ?? "");
      return [{ act, ...(inForce ? { inForce } : {}) }];
    });
    const text = plainText(body!.replace(/<authorialNote>[\s\S]*?<\/authorialNote>/gu, "").replace(/<num>[\s\S]*?<\/num>/u, ""));
    return { unit: heading.replace(/^Art\.\s*/u, ""), heading, text, amendments };
  });
  return { country: "CH", source, ...(title ? { title } : {}), articles, version: "wersja skonsolidowana z datą (eli/cc/{id}/{RRRRMMDD})", status: "tekst urzędowy (Fedlex, SR)" };
}

/**
 * Czech Republic, e-Sbírka public cache (the portal's own JSON, no key; the REST API needs one):
 * …/sbr-cache/dokumenty-sbirky/{encoded staleUrl}/fragmenty?cisloStranky=N lists the fragments of
 * a dated version (/sb/{year}/{number}/{YYYY-MM-DD}); a "Clanek" or "Paragraf" fragment opens an
 * article (ELI …/cl_N or …/par_N), the fragments under its ELI carry the text (xhtml). The metadata
 * (…/dokumenty-sbirky/{staleUrl}) gives the version's date and the amending acts (novely).
 */
export function readCzech(
  fragments: Array<{ eli: string; kodTypuFragmentu: string; xhtml?: string }>,
  meta: { nazev?: string; datumUcinnostiZneniOd?: string; typZneni?: string; novely?: Array<{ kodDokumentuSbirky?: string }> },
  source: string
): NationalReading {
  const amendments = (meta.novely ?? []).map((item) => item.kodDokumentuSbirky).filter((item): item is string => Boolean(item)).map((act) => ({ act }));
  const heads = fragments.filter((fragment) => fragment.kodTypuFragmentu === "Clanek" || fragment.kodTypuFragmentu === "Paragraf");
  const articles = heads.map((head): NationalArticle => {
    const heading = plainText(head.xhtml ?? "");
    const body = fragments.filter((fragment) => fragment.eli.startsWith(`${head.eli}/`)).map((fragment) => plainText(fragment.xhtml ?? "")).filter(Boolean);
    return { unit: heading.replace(/^(?:Čl\.|§)\s*/u, ""), heading, text: body.join("\n"), amendments };
  });
  return {
    country: "CZ",
    source,
    ...(meta.nazev ? { title: plainText(meta.nazev) } : {}),
    version: `znění od ${meta.datumUcinnostiZneniOd ?? "?"} (${meta.typZneni ?? ""})`.trim(),
    articles,
    status: "tekst z e-Sbírki (publiczny cache portalu; oficjalne REST API wymaga klucza)"
  };
}

/**
 * Austria, RIS OGD (data.bka.gv.at/ris/api/v2.6, no key): the norm found by Titel and
 * Abschnitt (§ or Art.) has an XML at ogd.ris.bka.gv.at; its metadata name the last amending act
 * ("zuletzt geändert durch") and the date in force, the text follows the "Text" heading. RIS
 * consolidated federal law is official for the RIS documents marked authentic; otherwise informative.
 */
export function readAustria(xml: string, source: string): NationalReading {
  const field = (ct: string): string => plainText(new RegExp(`<absatz[^>]*ct="${ct}"[^>]*>([\\s\\S]*?)<\\/absatz>`, "u").exec(xml)?.[1] ?? "");
  const unit = plainText(/<gldsym>([\s\S]*?)<\/gldsym>/u.exec(xml)?.[1] ?? "").replace(/\.$/u, "");
  const textStart = xml.search(/<ueberschrift[^>]*>Text<\/ueberschrift>/u);
  const body = textStart >= 0 ? xml.slice(textStart).replace(/<ueberschrift[^>]*>Text<\/ueberschrift>/u, "") : "";
  const text = plainText(body.replace(/<\/(?:absatz|listelem)>/gu, "\n"));
  // "JGS Nr. 946/1811 zuletzt geändert durch BGBl. Nr. 275/1992" (field Kundmachungsorgan).
  const changed = /zuletzt geändert durch\s+(.+)$/u.exec(field("kundmachungsorgan"))?.[1]?.trim() ?? "";
  const inForce = field("ikra");
  const date = /^(\d{2})\.(\d{2})\.(\d{4})$/u.exec(inForce);
  const heading = (text.split("\n")[0] ?? "").split(/\s/u).slice(0, 2).join(" ");
  return {
    country: "AT",
    source,
    ...(field("kurztitel") ? { title: field("kurztitel") } : {}),
    version: `wersja od ${date ? `${date[3]}-${date[2]}-${date[1]}` : inForce || "?"}`,
    articles: text ? [{ unit: (unit || heading).replace(/^(?:§|Art\.)\s*/u, "").replace(/\.$/u, ""), heading: unit || heading, text, amendments: changed ? [{ act: changed, ...(date ? { inForce: `${date[3]}-${date[2]}-${date[1]}` } : {}) }] : [] }] : [],
    status: "RIS Bundesrecht konsolidiert (OGD)"
  };
}

/** Monaco, Legimonaco: section.art (data-title "Article N"), aside.histo with the amending law and its date, div.text. */
export function readMonaco(html: string, source: string): NationalReading {
  const articles = [...html.matchAll(/<section class="section art"[^>]*data-title="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gu)].map(([, title, body]): NationalArticle => {
    const amendments = [...body!.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*>\s*<span>([^<]+)<\/span>/gu)].map((match) => ({ act: plainText(match[2]!), inForce: match[1]! }));
    const text = plainText(/<div class="text\s*">([\s\S]*?)<\/div>/u.exec(body!)?.[1] ?? "");
    return { unit: title!.replace(/^Article\s+/u, ""), heading: title!, text, amendments };
  });
  return { country: "MC", source, articles, version: "wersja obowiązująca (Legimonaco)", status: "tekst Legimonaco (Direction des affaires juridiques)" };
}

/** Latvia, likumi.lv: paragraphs p.TV213; an article opens with "N. pants." or, in the Civil Law, with its number "N.". */
export function readLatvia(html: string, source: string): NationalReading {
  // A centred paragraph is a heading of a chapter ("3. Laulāto mantas kopība"), not an article.
  const paragraphs = [...html.matchAll(/<p class="TV213[^"]*">([\s\S]*?)<\/p>/gu)].filter((match) => !/<center>/iu.test(match[1]!)).map((match) => plainText(match[1]!)).filter(Boolean);
  const articles: NationalArticle[] = [];
  for (const paragraph of paragraphs) {
    const head = /^(\d+(?:\.\d+)?)\.\s*(?:pants\.\s*)?/u.exec(paragraph);
    // "1. Vispārīgi noteikumi": a short line without a sentence is a heading of a part, not an article.
    if (head && paragraph.length < 70 && !/[.;:]\s*\S/u.test(paragraph.slice(head[0].length))) continue;
    if (head) articles.push({ unit: head[1]!, heading: `${head[1]}.`, text: paragraph, amendments: [] });
    else if (articles.length) articles.at(-1)!.text += `\n${paragraph}`;
  }
  return { country: "LV", source, articles, version: "wersja obowiązująca (likumi.lv)", status: "tekst urzędowy (Latvijas Vēstnesis, likumi.lv)" };
}

/**
 * Sweden, Riksdagen open data (no key): data.riksdagen.se/dokument/sfs-{year}-{number}.text is the
 * consolidated text from Regeringskansliet/Lagrummet ("Ändrad: t.o.m. SFS …"). A section opens
 * with "N §" (or "N a §"); chapters ("N kap.") restart the numbering in some acts, so the unit is
 * "N kap. M §" there and "M" elsewhere. "Lag (YYYY:NNN)." closing a section names its amending act.
 */
export function readSweden(text: string, source: string): NationalReading {
  const lines = text.replace(/\r/gu, "").split("\n");
  const title = lines[0]?.trim() ?? "";
  const changed = /Ändrad:\s*t\.o\.m\.\s*SFS\s*(\d{4}:\d+)/u.exec(text)?.[1];
  type Raw = { chapter?: string; number: string; lines: string[] };
  const sections: Raw[] = [];
  let chapter: string | undefined;
  for (const line of lines) {
    const kap = /^(\d+\s?[a-z]?)\s+kap\.\s/u.exec(line);
    if (kap) { chapter = kap[1]!.replace(/\s/gu, ""); continue; }
    const head = /^(\d+\s?[a-z]?)\s+§\s/u.exec(line);
    if (head) sections.push({ ...(chapter ? { chapter } : {}), number: head[1]!.replace(/\s/gu, ""), lines: [line] });
    else if (sections.length) sections.at(-1)!.lines.push(line);
  }
  const numbers = sections.map((section) => section.number);
  const restarts = new Set(numbers).size < numbers.length;
  const articles = sections.map((section): NationalArticle => {
    const body = section.lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
    // "… konsumentförhållanden. Lag (1994:1513)." closing a paragraph of the section.
    const amendments = [...body.matchAll(/\b(?:Lag|Förordning)\s*\((\d{4}:\d+)\)\.(?=\s*(?:\n|$))/gu)].map((match) => ({ act: `SFS ${match[1]}` }));
    const unit = restarts && section.chapter ? `${section.chapter} kap. ${section.number}` : section.number;
    return { unit, heading: `${restarts && section.chapter ? `${section.chapter} kap. ` : ""}${section.number} §`, text: body, amendments };
  });
  return { country: "SE", source, title, version: changed ? `ujednolicony do SFS ${changed}` : "ujednolicony (Lagrummet)", articles, status: "tekst ujednolicony Regeringskansliet (Riksdagen öppna data); moc ma SFS" };
}

/**
 * Luxembourg, Legilux (Akoma Ntoso XML of the Journal officiel, legal value "officiel"; the file
 * found by SPARQL: jolux:isEmbodiedBy → jolux:isExemplifiedBy). An amending act quotes the new
 * provisions inside <quotedText>: those are text of the article that quotes them, not articles.
 */
export function readLuxembourg(xml: string, source: string): NationalReading {
  const quoted: Array<[number, number]> = [...xml.matchAll(/<quotedText>[\s\S]*?<\/quotedText>/gu)].map((match) => [match.index!, match.index! + match[0].length]);
  const inside = (at: number) => quoted.some(([from, to]) => at > from && at < to);
  const starts = [...xml.matchAll(/<article id="([^"]+)">/gu)].filter((match) => !inside(match.index!));
  const articles = starts.map((match, index): NationalArticle => {
    const end = index + 1 < starts.length ? starts[index + 1]!.index! : xml.indexOf("</body>", match.index!) > 0 ? xml.indexOf("</body>", match.index!) : xml.length;
    const block = xml.slice(match.index!, end);
    const heading = plainText(/<num>([\s\S]*?)<\/num>/u.exec(block)?.[1] ?? "");
    return { unit: heading.replace(/^Art\.\s*/u, "").replace(/\.$/u, "").replace(/^1er$/u, "1er"), heading, text: plainText(block.replace(/<num>[\s\S]*?<\/num>/u, "")), amendments: [] };
  });
  const title = plainText(/<docTitle>([\s\S]*?)<\/docTitle>/u.exec(xml)?.[1] ?? "");
  return { country: "LU", source, ...(title ? { title } : {}), articles, version: "publikacja w Journal officiel (Mémorial A)", status: "tekst urzędowy Legilux (legalValue: officiel)" };
}

/**
 * Finland, Finlex open data (Akoma Ntoso, no key): /akn/fi/act/statute-consolidated/{year}/{number}
 * answers every expression of the act (Finnish and Swedish, the newest versions); the reader keeps
 * the Finnish one with the highest version number (the amending act it is consolidated to). The
 * consolidated text has no legal force (FRBRauthoritative false): the Statute Book (statute/…) has.
 * A section changed by an amendment carries finlex:originalVersionLabel ("17.12.1982/956").
 */
export function readFinland(xml: string, source: string, language = "fin"): NationalReading {
  const docs = xml.split(/<akomaNtoso\b/u).slice(1);
  const own = docs.filter((doc) => new RegExp(`<FRBRlanguage language="${language}"`, "u").test(doc));
  const versionOf = (doc: string) => /<FRBRversionNumber value="(\d+)"/u.exec(doc)?.[1] ?? "";
  const doc = (own.length ? own : docs).sort((a, b) => versionOf(b).localeCompare(versionOf(a)))[0] ?? xml;
  const authoritative = /<FRBRauthoritative value="true"/u.test(doc);
  const consolidated = /statute-consolidated/u.test(/<FRBRuri value="([^"]+)"/u.exec(doc)?.[1] ?? "");
  const chapters = [...doc.matchAll(/<chapter eId="[^"]+"[^>]*>\s*<num>([^<]*)<\/num>/gu)].map((match) => ({ at: match.index!, number: match[1]!.replace(/\s*luku\s*$/iu, "").replace(/\s+/gu, "").toLowerCase() }));
  type Raw = { chapter?: string; number: string; heading: string; body: string; label?: string };
  const sections: Raw[] = [];
  for (const match of doc.matchAll(/<section eId="[^"]+"([^>]*)>\s*<num>([^<]*)<\/num>/gu)) {
    const end = doc.indexOf("</section>", match.index!);
    const block = doc.slice(match.index!, end > 0 ? end : undefined);
    const chapter = chapters.filter((item) => item.at < match.index!).at(-1)?.number;
    const label = /finlex:originalVersionLabel="([^"]+)"/u.exec(match[1]!)?.[1];
    const heading = plainText(/<heading[^>]*>([\s\S]*?)<\/heading>/u.exec(block)?.[1] ?? "");
    sections.push({ ...(chapter ? { chapter } : {}), number: match[2]!.replace(/\s*§\s*$/u, "").replace(/\s+/gu, " ").trim(), heading, body: plainText(block.replace(/<num>[\s\S]*?<\/num>/u, "").replace(/<heading[^>]*>[\s\S]*?<\/heading>/u, "")), ...(label ? { label } : {}) });
  }
  const numbers = sections.map((section) => section.number);
  const restarts = new Set(numbers).size < numbers.length;
  const articles = sections.map((section): NationalArticle => {
    const prefix = restarts && section.chapter ? `${section.chapter} luku ` : "";
    return { unit: `${prefix}${section.number}`, heading: `${prefix}${section.number} §${section.heading ? ` ${section.heading}` : ""}`, text: section.body, amendments: section.label ? [{ act: section.label }] : [] };
  });
  const title = plainText(/<docTitle>([\s\S]*?)<\/docTitle>/u.exec(doc)?.[1] ?? "");
  const version = versionOf(doc);
  return {
    country: "FI",
    source,
    ...(title ? { title } : {}),
    version: consolidated ? (version ? `ujednolicony do ${version.slice(0, 4)}/${Number(version.slice(4))}` : "ujednolicony (Finlex)") : "tekst pierwotny (Suomen säädöskokoelma)",
    articles,
    status: authoritative ? "tekst urzędowy Suomen säädöskokoelma (Finlex)" : "tekst ujednolicony Finlex (ajantasainen lainsäädäntö), bez mocy urzędowej; moc ma Suomen säädöskokoelma"
  };
}

/**
 * Estonia, Riigi Teataja (public API, no key): the XML of a consolidated text version
 * (…/public-api/api/v1/akt/{globaalID}/blob-xml, schema tyviseadus): paragrahv with its
 * lõiked, the amending act of each lõige (muutmismarge: RT reference and date in force).
 */
export function readEstonia(xml: string, source: string): NationalReading {
  const title = plainText(/<aktinimi>\s*<nimi>\s*<pealkiri>([\s\S]*?)<\/pealkiri>/u.exec(xml)?.[1] ?? /<pealkiri>([\s\S]*?)<\/pealkiri>/u.exec(xml)?.[1] ?? "");
  const from = /<kehtivuseAlgus>(\d{4}-\d{2}-\d{2})/u.exec(xml)?.[1];
  const to = /<kehtivuseLopp>(\d{4}-\d{2}-\d{2})/u.exec(xml)?.[1];
  const articles = [...xml.matchAll(/<paragrahv\b[^>]*>([\s\S]*?)<\/paragrahv>/gu)].map((match): NationalArticle => {
    const block = match[1]!;
    const number = /<paragrahvNr>([^<]+)<\/paragrahvNr>/u.exec(block)?.[1]?.trim() ?? "";
    const heading = plainText(/<paragrahvPealkiri>([\s\S]*?)<\/paragrahvPealkiri>/u.exec(block)?.[1] ?? "");
    const amendments = [...block.matchAll(/<muutmismarge>([\s\S]*?)<\/muutmismarge>/gu)].map((change) => {
      const rt = /<RTosa>([^<]+)<\/RTosa>[\s\S]*?<aktViide>([^<]+)<\/aktViide>/u.exec(change[1]!);
      const inForce = /<joustumine>(\d{4}-\d{2}-\d{2})/u.exec(change[1]!)?.[1];
      return { act: rt ? `${rt[1]}, ${rt[2]}` : plainText(change[1]!), ...(inForce ? { inForce } : {}) };
    });
    const text = plainText(block.replace(/>\s+</gu, "><").replace(/<\/(loige|alampunkt)>/gu, "\n</$1>").replace(/<muutmismarge>[\s\S]*?<\/muutmismarge>/gu, "").replace(/<paragrahvNr>[\s\S]*?<\/paragrahvNr>/u, "").replace(/<paragrahvPealkiri>[\s\S]*?<\/paragrahvPealkiri>/u, "").replace(/<(?:loigeNr|alampunktNr)>[^<]*<\/(?:loigeNr|alampunktNr)>/gu, "").replace(/<kuvatavNr><!\[CDATA\[§[^\]]*\]\]><\/kuvatavNr>/u, "").replace(/<kuvatavNr><!\[CDATA\[([^\]]*)\]\]><\/kuvatavNr>\s*/gu, "$1 "));
    return { unit: number, heading: `§ ${number}.${heading ? ` ${heading}` : ""}`, text, amendments };
  });
  return {
    country: "EE",
    source,
    ...(title ? { title } : {}),
    version: from ? `wersja od ${from}${to ? ` do ${to}` : ""}` : "tekst ujednolicony (Riigi Teataja)",
    articles,
    status: "tekst ujednolicony Riigi Teataja (terviktekst, urzędowy)"
  };
}

export type PdfReading =
  | { kind: "TEKST"; text: string; pages: number }
  | { kind: "SKAN"; pages: number; note: string }
  | { kind: "MIESZANY"; text: string; pages: number; pagesWithoutText: number[]; note: string };

const RAG_NOTE = "skan bez warstwy tekstowej: kandydat do OCR i indeksu RAG, nie brzmienie zweryfikowane";

/** A legislation PDF: its text layer is read; pages without one are named for OCR/RAG. */
export async function readLegislationPdf(data: Uint8Array): Promise<PdfReading> {
  // A code is longer than a case document (Liechtenstein's PGR, Malta's Civil Code: over 600 pages).
  const result = await new LocalPdfTextExtractor({ maxBytes: 64 * 1024 * 1024, maxPages: 4000, maxTextChars: 40_000_000 }, { lines: true, allowEmpty: true }).extract(data);
  const pages = result.pageTexts ?? [result.text];
  const empty = pages.map((page, index) => (page.replace(/\s+/gu, "").length < 20 ? index + 1 : 0)).filter(Boolean);
  if (empty.length === pages.length) return { kind: "SKAN", pages: pages.length, note: RAG_NOTE };
  if (empty.length) return { kind: "MIESZANY", text: result.text, pages: pages.length, pagesWithoutText: empty, note: `strony ${empty.join(", ")}: ${RAG_NOTE}` };
  return { kind: "TEKST", text: result.text, pages: pages.length };
}

export const NATIONAL_READERS = { DK: readDenmark, NL: readNetherlands, BE: readBelgium, IT: readItaly, DE: readGermany, CH: readSwitzerland } as const;
