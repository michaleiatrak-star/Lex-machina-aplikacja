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

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", sect: "§", deg: "°", ordm: "º", ordf: "ª", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", middot: "·", para: "¶" };

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
 * Turkey, Mevzuat Bilgi Sistemi: the HTML of an act (…/anasayfa/MevzuatFihristDetayIframe?MevzuatTur=1&MevzuatNo=4721&MevzuatTertip=5)
 * carries the text in force with the amendment notes, as the PDF does. An article opens with
 * "Madde N -" in bold; a paragraph that is all bold and is not an article or a note is a
 * heading of a section ("B. Hukukî ilişkilerin kapsamı") and ends the article before it.
 * "(Değişik|Ek|Mülga …: DD/MM/YYYY-KANUN/MADDE md.)" names the amending law and the date it was adopted.
 * The provisions of the amending laws printed after the last article are not read.
 */
export function readTurkey(html: string, source: string): NationalReading {
  const articles: NationalArticle[] = [];
  let open = false;
  for (const [, inner] of html.replace(/\s+/gu, " ").matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)) {
    const text = plainText(inner!).trim();
    if (!text) continue;
    const head = /^(?:Geçici\s+)?Madde\s+(\d+(?:\/[A-Z])?)\s*[-–]\s*/u.exec(text);
    const outsideBold = inner!.replace(/<b\b[^>]*>[\s\S]*?<\/b>/giu, "");
    const allBold = /<b\b/iu.test(inner!) && !plainText(outsideBold).trim();
    if (head && !/^Geçici/u.test(text)) {
      // After the last article the page prints provisions of the amending laws with their own
      // numbering ("Madde 36 - Bu Kanunla değiştirilen …"): a number lower than the last one ends the act.
      if (articles.length && parseInt(head[1]!, 10) < parseInt(articles.at(-1)!.unit, 10)) break;
      articles.push({ unit: head[1]!, heading: `Madde ${head[1]}`, text, amendments: [] });
      open = true;
    } else if (head) {
      open = false;
    } else if (allBold && !/^\((?:Değişik|Ek|Mülga)/u.test(text)) {
      open = false;
    } else if (open) {
      articles.at(-1)!.text += `\n${text}`;
    }
  }
  for (const article of articles) {
    for (const match of article.text.matchAll(/\(((?:Değişik|Ek|Mülga)[^:()]*):\s*(\d{2})\/(\d{2})\/(\d{4})-(\d+)\/(\d+)\s*md\.\)/gu)) {
      // The date is the adoption of the amending law, not its entry into force: kept in the act's name.
      article.amendments.push({ act: `${match[1]}: ${match[4]}-${match[3]}-${match[2]}, Kanun ${match[5]} md. ${match[6]}` });
    }
  }
  return { country: "TR", source, articles, version: "metin yürürlükteki (Mevzuat Bilgi Sistemi, z adnotacjami zmian)", status: "tekst Mevzuat Bilgi Sistemi (Cumhurbaşkanlığı); urzędowy jest tekst w Resmî Gazete" };
}

/**
 * Slovakia, Slov-Lex static portal (no JavaScript): static.slov-lex.sk/static/SK/ZZ/{year}/{number}/ lists
 * every version with its dates in force (data-ucinnostod / data-ucinnostdo) and the amending act;
 * {YYYYMMDD}.html is the consolidated text in force from that day. A § is div#paragraf-{n}.
 */
export type SlovakVersion = { file: string; from: string; to?: string; amendments: string[] };

export function slovakVersions(html: string): SlovakVersion[] {
  return [...html.matchAll(/<tr class="effectivenessHistoryItem"[^>]*data-vyhlasene="0"[^>]*data-ucinnostod="([\d-]*)"[^>]*data-ucinnostdo="([\d-]*)"[^>]*>([\s\S]*?)<\/tr>/gu)]
    .filter((match) => match[1])
    .map(([, from, to, row]) => ({
      file: /href="(\d{8}\.html)"/u.exec(row!)?.[1] ?? `${from!.replace(/-/gu, "")}.html`,
      from: from!,
      ...(to ? { to } : {}),
      amendments: [...row!.matchAll(/<a href="\.\.\/[^"]+">([^<]+)<\/a>/gu)].map((match) => plainText(match[1]!))
    }));
}

/** The version in force on the day (YYYY-MM-DD); the newest that has started when no day is given. */
export function slovakVersionOn(versions: SlovakVersion[], day: string): SlovakVersion | null {
  return versions.filter((version) => version.from <= day && (!version.to || version.to >= day)).at(-1) ?? null;
}

export function readSlovakia(html: string, source: string, version?: SlovakVersion): NationalReading {
  const starts = [...html.matchAll(/<div class="paragraf Skupina\s*" id="paragraf-([0-9a-z]+)">/gu)];
  const articles = starts.map((match, index): NationalArticle => {
    let body = html.slice(match.index!, starts[index + 1]?.index ?? html.length);
    // A heading of the next part, chapter or section belongs to what follows.
    const heading = /<div class="(?:cast|hlava|diel|oddiel)(?:Oznacenie|Nadpis)?[\s"]/u.exec(body.slice(1));
    if (heading) body = body.slice(0, heading.index + 1);
    return { unit: match[1]!, heading: `§ ${match[1]}`, text: plainText(body), amendments: version ? version.amendments.map((act) => ({ act, inForce: version.from })) : [] };
  });
  return { country: "SK", source, articles, version: version ? `znenie účinné od ${version.from}${version.to ? ` do ${version.to}` : ""}` : "znenie z adresu", status: "tekst Slov-Lex (Ministerstvo spravodlivosti SR, wersja statyczna portalu)" };
}

/**
 * Croatia, Narodne novine (official gazette): narodne-novine.nn.hr/clanci/sluzbeni/{YYYY}_{MM}_{issue}_{id}.html is the
 * text as published; amendments are separate acts of the gazette (no consolidated text there).
 * "Članak N." is a p.Clanak; a bold title paragraph (class …fett) begins the next article.
 */
export function readCroatia(html: string, source: string): NationalReading {
  const articles: NationalArticle[] = [];
  let open = false;
  for (const [, cls, inner] of html.replace(/\s+/gu, " ").matchAll(/<p\b[^>]*class=["']?([\w-]+)[^>]*>([\s\S]*?)<\/p>/giu)) {
    const text = plainText(inner!).trim();
    if (!text) continue;
    const head = /^Članak\s+(\d+[a-z]?)\.?$/u.exec(text);
    if (head) {
      articles.push({ unit: head[1]!, heading: `Članak ${head[1]}.`, text, amendments: [] });
      open = true;
    } else if (/fett|naslov|glava|dio/iu.test(cls!)) open = false;
    else if (open) articles.at(-1)!.text += `\n${text}`;
  }
  return { country: "HR", source, articles, version: "tekst ogłoszony (Narodne novine); zmiany w osobnych aktach NN", status: "tekst urzędowy (Narodne novine, wydanie urzędowe)" };
}

/**
 * Kosovo, Gazeta Zyrtare: ActDocumentDetail.aspx?ActID={id} is the act's text (lines with <br>), "Neni N" alone on a
 * line opens an article; ActDetail.aspx?ActID={id} carries the status (repealed: "I shfuqizuar") and
 * the amending acts ("Ndryshohet/Plotësohet nga …", "Shfuqizuar nga …").
 */
export function readKosovo(html: string, source: string, detail?: string): NationalReading {
  const lines = plainText(html.replace(/\s+/gu, " ").replace(/<br\s*\/?>/giu, "\n")).split("\n").map((line) => line.trim()).filter(Boolean);
  const articles: NationalArticle[] = [];
  let open = false;
  for (const line of lines) {
    const head = /^(?:Neni|Član|Article)\s+(\d+[a-z]?)$/u.exec(line);
    if (head) {
      articles.push({ unit: head[1]!, heading: line, text: line, amendments: [] });
      open = true;
    } else if (/^(?:KAPITULLI|PJESA|POGLAVLJE|DEO|CHAPTER|PART)\b/u.test(line)) open = false;
    else if (open) articles.at(-1)!.text += `\n${line}`;
  }
  let status = "tekst aktu z Gazeta Zyrtare (bez zmian późniejszych)";
  if (detail) {
    const info = plainText(detail.replace(/\s+/gu, " ")).replace(/\s+/gu, " ");
    const changes = [...info.matchAll(/(Ndryshohet\/Plotësohet nga|Shfuqizuar nga)\s+(.+?)\s+Data e publikimit:\s*(\d{2})\.(\d{2})\.(\d{4})/gu)]
      .map((match) => ({ act: `${match[1]} ${match[2]}`, inForce: `${match[5]}-${match[4]}-${match[3]}` }));
    for (const article of articles) article.amendments = changes;
    if (/\bI shfuqizuar\b/u.test(info)) status = "AKT UCHYLONY (I shfuqizuar) — tekst historyczny z Gazeta Zyrtare";
    else if (changes.length) status = "tekst pierwotny z Gazeta Zyrtare; akt zmieniany (lista zmian przy artykułach)";
  }
  return { country: "XK", source, articles, version: "tekst ogłoszony", status };
}

/**
 * Slovenia, Uradni list RS archive (issues until 28.2.2026; later ones only in PISRS):
 * uradni-list.si/glasilo-uradni-list-rs/vsebina/{YYYY}-01-{nr} is the text as published, "N. člen" in div.esegment_h4.
 */
export function readSlovenia(html: string, source: string): NationalReading {
  const articles: NationalArticle[] = [];
  let open = false;
  for (const [, cls, inner] of html.replace(/\s+/gu, " ").matchAll(/<div class="(esegment_[\w]+)">([\s\S]*?)<\/div>/gu)) {
    const text = plainText(inner!).trim();
    if (!text) continue;
    const head = /^(\d+[a-z]?)\. člen$/u.exec(text);
    if (head) {
      articles.push({ unit: head[1]!, heading: text, text, amendments: [] });
      open = true;
    } else if (/esegment_(?:h[1-3]|c\d)/u.test(cls!)) open = false;
    else if (open) articles.at(-1)!.text += `\n${text}`;
  }
  return { country: "SI", source, articles, version: "tekst ogłoszony (Uradni list RS, archiwum); tekst jednolity tylko w PISRS", status: "tekst urzędowy (Uradni list RS)" };
}

/**
 * Slovenia, PISRS (pisrs.si, all acts including those after 28.2.2026): the act's card
 * …/api/rezultat/zbirka/id/{ZAKOnnnn} lists its versions (Osnovni, NPB 1…n) with an HTML file each;
 * …/api/datoteke/integracije/{file id} is that text: p.clen "N. člen" (its title is a p.clen before it),
 * p.odstavek the paragraphs. NPB = neuradno prečiščeno besedilo (consolidated, without legal force).
 */
export type PisrsCard = { title: string; state?: string; versions: Array<{ name: string; html?: number }> };

export function pisrsCard(json: string): PisrsCard {
  const data = (JSON.parse(json) as { data?: { evidencniPodatki?: { naslov?: string; semafor?: { naziv?: string } }; datoteke?: Array<{ npbVerzija?: { naziv?: string }; datoteke?: Array<{ tip?: string; id?: number }> }> } }).data ?? {};
  const order = (name: string): number => (name === "Osnovni" ? 0 : Number(/NPB\s*(\d+)/u.exec(name)?.[1] ?? -1));
  const versions = (data.datoteke ?? [])
    .map((entry) => ({ name: entry.npbVerzija?.naziv ?? "", ...(entry.datoteke?.find((file) => file.tip === "HTML_DOCUMENT")?.id ? { html: entry.datoteke.find((file) => file.tip === "HTML_DOCUMENT")!.id! } : {}) }))
    .sort((a, b) => order(a.name) - order(b.name));
  return { title: data.evidencniPodatki?.naslov ?? "", ...(data.evidencniPodatki?.semafor?.naziv ? { state: data.evidencniPodatki.semafor.naziv } : {}), versions };
}

export function readPisrs(html: string, source: string, card?: PisrsCard, version?: string): NationalReading {
  const articles: NationalArticle[] = [];
  let open = false;
  for (const [, cls, inner] of html.replace(/\s+/gu, " ").matchAll(/<p class="([^"]*)">([\s\S]*?)<\/p>/gu)) {
    const text = plainText(inner!).trim();
    if (!text) continue;
    const head = /^(\d+[a-z]?)\. člen$/u.exec(text);
    if (head && /\bclen\b/u.test(cls!)) {
      articles.push({ unit: head[1]!, heading: text, text, amendments: [] });
      open = true;
    } else if (/\b(?:clen|del|poglavje|oddelek|pododdelek|naslov)\b/u.test(cls!)) open = false;
    else if (open) articles.at(-1)!.text += `\n${text}`;
  }
  const legal = version === "Osnovni" ? "tekst ogłoszony (Uradni list RS)" : "tekst jednolity nieurzędowy (NPB, PISRS) — moc prawną ma Uradni list RS";
  return { country: "SI", source, ...(card?.title ? { title: card.title } : {}), articles, version: `${version ?? "?"}${card?.state ? `; ${card.state}` : ""}`, status: legal };
}

/**
 * Iceland: the Law Collection (althingi.is/lagas) refuses automated clients; lagasafn-xml (althingi-net,
 * built from the Althingi's own HTML, one folder per edition, e.g. 158a) carries <art nr> with <sen>,
 * and the amending laws with their date in force in <minister-clause>. Unofficial: the wording is to be
 * confirmed at althingi.is.
 */
export function readIceland(xml: string, source: string, edition?: string): NationalReading {
  const clause = plainText(/<minister-clause>([\s\S]*?)<\/minister-clause>/u.exec(xml)?.[1]?.replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&amp;/gu, "&") ?? "");
  const months: Record<string, string> = { janúar: "01", febrúar: "02", mars: "03", apríl: "04", maí: "05", júní: "06", júlí: "07", ágúst: "08", september: "09", október: "10", nóvember: "11", desember: "12" };
  const amendments = [...clause.matchAll(/L\.\s*(\d+\/\d{4})\s*\(tók[iu]? gildi (\d{1,2})\.\s*([a-záéíóúýþæö]+)\s+(\d{4})\)/gu)]
    .map((match) => ({ act: `L. ${match[1]}`, ...(months[match[3]!] ? { inForce: `${match[4]}-${months[match[3]!]}-${match[2]!.padStart(2, "0")}` } : {}) }));
  const articles = [...xml.matchAll(/<art nr="([^"]+)"[^>]*>([\s\S]*?)<\/art>/gu)].map(([, nr, body]): NationalArticle => {
    const title = plainText(/<nr-title>([\s\S]*?)<\/nr-title>/u.exec(body!)?.[1] ?? `${nr}. gr.`);
    const paragraphs = [...body!.matchAll(/<paragraph\b[^>]*>([\s\S]*?)<\/paragraph>/gu)].map((match) => [...match[1]!.matchAll(/<sen\b[^>]*>([\s\S]*?)<\/sen>/gu)].map((sen) => plainText(sen[1]!)).join(" "));
    return { unit: nr!, heading: title, text: [title, ...paragraphs].join("\n"), amendments };
  });
  const name = plainText(/<name>([\s\S]*?)<\/name>/u.exec(xml)?.[1] ?? "");
  return { country: "IS", source, ...(name ? { title: name } : {}), articles, version: `lagasafn ${edition ?? "?"} (wydanie zbioru ustaw Althingi)`, status: "kopia nieurzędowa (lagasafn-xml z HTML Althingi) — brzmienie potwierdź w althingi.is/lagas" };
}

/**
 * Faroe Islands, Lógasavnið (logir.fo, Løgmansskrivstovan): the act's page carries the text in
 * P.Afsnitsnummer ("§ N") and the paragraphs after it; the act's status (Gildisstøða) is printed under it.
 */
export function readFaroe(html: string, source: string): NationalReading {
  const articles: NationalArticle[] = [];
  let open = false;
  for (const [, cls, inner] of html.replace(/\s+/gu, " ").matchAll(/<p\b[^>]*class=["']?([\w-]+)[^>]*>([\s\S]*?)<\/p>/giu)) {
    const text = plainText(inner!).trim();
    if (!text) continue;
    if (/^Afsnitsnummer$/iu.test(cls!) && /^§\s*\d+[a-z]?\.?$/u.test(text)) {
      const unit = text.replace(/[§.\s]/gu, "");
      articles.push({ unit, heading: text, text, amendments: [] });
      open = true;
    } else if (/kapitel|overskrift|MsoNormal|MsoTitle/iu.test(cls!)) open = false;
    else if (open) articles.at(-1)!.text += `\n${text}`;
  }
  const title = plainText(/<h1[^>]*>([\s\S]*?)<\/h1>/u.exec(html)?.[1] ?? "");
  // The act's own status is printed after its text ("Um rættarregluna … Gildisstøða: Í komi"); the search form above has the same word.
  const about = plainText(html).split("Um rættarregluna").slice(1).join(" ");
  const state = /Gildisstøða:\s*([^\n]+?)(?:\s{2,}|\n|$)/u.exec(about)?.[1]?.trim();
  return { country: "FO", source, ...(title ? { title } : {}), articles, version: state ? `Gildisstøða: ${state}` : "tekst z Lógasavnið", status: "tekst urzędowy zbioru Lógasavnið (Løgmansskrivstovan)" };
}

/**
 * Canon law, Codex Iuris Canonici 1983 (authentic Latin text on vatican.va, one page per book:
 * …/cod-iuris-canonici/latin/documents/cic_liber{I…VII}_la.html; Liber VI in the 2021 wording of Pascite gregem Dei).
 * "Can. N" opens a canon; a centred paragraph (PARS, TITULUS, CAPUT) is a heading and ends it.
 */
export function readCanonLaw(html: string, source: string): NationalReading {
  const body = html.replace(/\s+/gu, " ").replace(/<p align="center">[\s\S]*?<\/p>/giu, "\n§HEADING§\n");
  const text = plainText(body);
  const articles: NationalArticle[] = [];
  const marks = [...text.matchAll(/(?:^|\n|\s)Can\.\s+(\d+)\s*[—–-]\s*/gu)];
  marks.forEach((match, index) => {
    let piece = text.slice(match.index! + match[0].length, marks[index + 1]?.index ?? text.length);
    piece = piece.split("§HEADING§")[0]!.replace(/\s*\n\s*/gu, "\n").trim();
    articles.push({ unit: match[1]!, heading: `Can. ${match[1]}`, text: `Can. ${match[1]} — ${piece}`, amendments: [] });
  });
  return { country: "VA", source, articles, version: "Codex Iuris Canonici 1983, tekst łaciński (autentyczny) z vatican.va; zmiany motu proprio: vatican.va/archive/cdc/index.htm", status: "tekst autentyczny (Stolica Apostolska, vatican.va)" };
}

/**
 * Georgia, Matsne (Legislative Herald of Georgia): …/{ka|en}/document/view/{id}?publication={n}. The Georgian text
 * is the official one (English: translation). The sidebar lists the consolidated publications with their dates;
 * an article opens with a bold "მუხლი N." (ka) or "Article N –" (en).
 */
export function matsneVersions(html: string): Array<{ publication: string; date: string }> {
  return [...html.matchAll(/href="\/(?:ka|en)\/document\/view\/\d+\?publication=(\d+)"\s*class="[^"]*list-group-item">\s*(\d{2})\/(\d{2})\/(\d{4})/gu)]
    .map(([, publication, day, month, year]) => ({ publication: publication!, date: `${year}-${month}-${day}` }));
}

export function readMatsne(html: string, source: string, version?: { publication: string; date: string }): NationalReading {
  const articles: NationalArticle[] = [];
  let open = false;
  for (const [, attributes, inner] of html.replace(/\s+/gu, " ").matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/giu)) {
    const text = plainText(inner!).trim();
    if (!text) continue;
    const head = /^(?:მუხლი|Article)\s+(\d+[¹²³⁴⁵⁶⁷⁸⁹⁰]*)\s*[.–-]/u.exec(text);
    // Georgian pages mark the heading with p.muxlixml, the English ones with bold.
    if (head && (/class="muxlixml"/u.test(attributes!) || /<b\b/iu.test(inner!))) {
      articles.push({ unit: head[1]!, heading: text, text, amendments: [] });
      open = true;
    } else if (open) articles.at(-1)!.text += `\n${text}`;
  }
  const georgian = /\/ka\//u.test(source) || /მუხლი/u.test(html);
  return {
    country: "GE",
    source,
    articles,
    version: version ? `publikacja skonsolidowana z ${version.date} (publication=${version.publication})` : "wersja z adresu",
    status: georgian ? "tekst urzędowy (Matsne, wersja gruzińska)" : "tłumaczenie angielskie Matsne — wiąże tekst gruziński"
  };
}

/**
 * Serbia, Montenegro, Bosnia and Herzegovina: Paragraf Lex (paragraf.rs, paragraf.me, paragraf.ba), consolidated
 * texts kept by a publisher — unofficial, for finding the article; the official gazettes need JavaScript or refuse
 * automated clients. p.clan "Član N" opens an article; a title paragraph (…naslov…) ends it.
 */
export function readParagraf(html: string, source: string, country: string): NationalReading {
  const articles: NationalArticle[] = [];
  let open = false;
  for (const [, cls, inner] of html.replace(/\s+/gu, " ").matchAll(/<p class="([^"]*)">([\s\S]*?)<\/p>/gu)) {
    const text = plainText(inner!).trim();
    if (!text) continue;
    const head = /^Član\s+(\d+[a-z]?)\.?$/u.exec(text);
    if (cls === "clan" && head) {
      articles.push({ unit: head[1]!, heading: text, text, amendments: [] });
      open = true;
    } else if (cls === "clan" || /naslov/u.test(cls!)) open = false;
    else if (open) articles.at(-1)!.text += `\n${text}`;
  }
  return { country, source, articles, version: "tekst jednolity wydawcy (Paragraf Lex)", status: "tekst nieurzędowy (Paragraf Lex) — tylko do odnalezienia przepisu; brzmienie potwierdź w dzienniku urzędowym" };
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
