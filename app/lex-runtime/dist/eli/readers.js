// Readers of national legislation from the official sources whose answers carry the text
// (checked live 2026-11-08). Each reader turns one answer into articles: unit, heading, text
// and, where the source prints them, the amending acts with their dates in force. A PDF with a
// text layer is read; a scan (no text layer) is not guessed at: it becomes a candidate for OCR
// and the RAG index, never a verified wording.
import { LocalPdfTextExtractor } from "../pdf-text-extractor.js";
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function plainText(html) {
    return html
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/giu, "")
        .replace(/<br\s*\/?>|<\/(?:p|div|li|h\d|tr)>/giu, "\n")
        .replace(/<[^>]+>/gu, "")
        .replace(/&(#\d+|#x[\da-f]+|\w+);/giu, (whole, code) => code.startsWith("#x") || code.startsWith("#X")
        ? String.fromCodePoint(parseInt(code.slice(2), 16))
        : code.startsWith("#")
            ? String.fromCodePoint(Number(code.slice(1)))
            : ENTITIES[code.toLowerCase()] ?? decodeNamed(code) ?? whole)
        .replace(/ /gu, " ")
        .replace(/[ \t]+/gu, " ")
        .replace(/ *\n[ \n]*/gu, "\n")
        .trim();
}
// Latin letters with accents written as HTML entities (Normattiva: &Egrave;, &agrave;).
function decodeNamed(code) {
    const match = /^([A-Za-z])(acute|grave|circ|uml|tilde|cedil)$/u.exec(code);
    if (!match)
        return undefined;
    const mark = { acute: "́", grave: "̀", circ: "̂", uml: "̈", tilde: "̃", cedil: "̧" }[match[2]];
    return (match[1] + mark).normalize("NFC");
}
const dmy = (value) => value.replace(/^(\d{2})-(\d{2})-(\d{4})$/u, "$3-$2-$1");
/** Denmark, Retsinformation XML (LexDania): § with its Stk. LBK = consolidated text, a separate act. */
export function readDenmark(xml, source) {
    const title = plainText(/<DocumentTitle>([\s\S]*?)<\/DocumentTitle>/u.exec(xml)?.[1] ?? "");
    const type = /<DocumentType>([^<#\s]+)/u.exec(xml)?.[1];
    const articles = [...xml.matchAll(/<Paragraf\b[^>]*>([\s\S]*?)<\/Paragraf>/gu)].map((match) => {
        const body = match[1];
        const heading = plainText(/<Explicatus>([\s\S]*?)<\/Explicatus>/u.exec(body)?.[1] ?? "");
        return { unit: heading.replace(/\.$/u, ""), heading, text: plainText(body.replace(/<\/Linea>/gu, "\n")), amendments: [] };
    });
    const version = type === "LBK" ? "LBK (lovbekendtgørelse: tekst skonsolidowany jako osobny akt)" : type;
    return { country: "DK", source, title, ...(version ? { version } : {}), articles, status: "tekst urzędowy (Retsinformation)" };
}
/** Netherlands, wetten.overheid.nl: div.artikel with its h4 heading; the page is the version of the date in its address. */
export function readNetherlands(html, source) {
    const blocks = html.split(/<div class="artikel" id="[^"]*"[^>]*>/u).slice(1);
    const articles = blocks.map((block) => {
        const heading = plainText(/<h4\b[^>]*>([\s\S]*?)<\/h4>/u.exec(block)?.[1] ?? "");
        // The action list (relations, permalink…) is not the article's text.
        const body = block.replace(/<ul role="list"[\s\S]*?<\/ul>/gu, "").replace(/<h4\b[\s\S]*?<\/h4>/u, "");
        return { unit: heading.replace(/^Artikel\s+/u, "").trim(), heading, text: plainText(body), amendments: [] };
    });
    return { country: "NL", source, articles, version: "wersja z datą (adres …/{data}/0)", status: "tekst urzędowy (wetten.overheid.nl, BWB)" };
}
/** Belgium, Justel: "Art. N." anchors; amendments as "<L 2021-07-11/08, art. 17, 027; En vigueur : 06-10-2022>". */
export function readBelgium(html, source) {
    const parts = html.split(/<A NAME='Art\.([^']+)'[^>]*>/iu);
    const articles = [];
    for (let index = 1; index < parts.length; index += 2) {
        const unit = parts[index];
        const raw = parts[index + 1] ?? "";
        const amendments = [...raw.matchAll(/&lt;L\s*(?:<A [^>]*>)?(\d{4}-\d{2}-\d{2}\/\d+)(?:<\/A>)?,[^;]*;\s*En vigueur\s*:\s*(\d{2}-\d{2}-\d{4})/giu)].map((match) => ({ act: `L ${match[1]}`, inForce: dmy(match[2]) }));
        articles.push({ unit, heading: `Art. ${unit}`, text: plainText(raw), amendments: [...new Map(amendments.map((item) => [`${item.act}|${item.inForce}`, item])).values()] });
    }
    return { country: "BE", source, articles, version: "justel (wersja skonsolidowana)", status: "tekst bez mocy prawnej (Justel); moc ma publikacja w Moniteur belge" };
}
/** Italy, Normattiva (Akoma Ntoso HTML): h2.article-num-akn with the text after it; codes in annexes load separately. */
export function readItaly(html, source) {
    const parts = html.split(/<h2 class="article-num-akn" id="([^"]+)">/u);
    const articles = [];
    for (let index = 1; index < parts.length; index += 2) {
        const raw = parts[index + 1] ?? "";
        const heading = plainText(raw.slice(0, raw.indexOf("</h2>")));
        const body = raw.slice(raw.indexOf("</h2>") + 5).split(/<h2 class="(?!article-num-akn)/u)[0];
        // "AGGIORNAMENTO" notes name the amending acts (title line of each note).
        const updated = [...body.matchAll(/class="art_aggiornamento_testo-akn"[^>]*>([\s\S]*?)<\/(?:div|span)>/gu)]
            .map((match) => ({ act: plainText(match[1]).replace(/\s+/gu, " ").slice(0, 200) }))
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
export function readGermany(html, source) {
    const title = plainText(/<h1>([\s\S]*?)<br/u.exec(html)?.[1] ?? "");
    const unit = plainText(/<span class="jnenbez">([\s\S]*?)<\/span>/u.exec(html)?.[1] ?? "");
    const heading = plainText(/<span class="jnentitel">([\s\S]*?)<\/span>/u.exec(html)?.[1] ?? "");
    const paragraphs = [...html.matchAll(/<div class="jurAbsatz">([\s\S]*?)<\/div>/gu)].map((match) => plainText(match[1]));
    const articles = unit ? [{ unit, heading: `${unit} ${heading}`.trim(), text: paragraphs.join("\n"), amendments: [] }] : [];
    return { country: "DE", source, title, articles, version: "wersja obowiązująca (bez daty w adresie)", status: "tekst nieurzędowy (gesetze-im-internet.de); urzędowy: BGBl. (recht.bund.de)" };
}
const GERMAN_MONTHS = { jan: "01", feb: "02", "mär": "03", mar: "03", apr: "04", mai: "05", juni: "06", jun: "06", juli: "07", jul: "07", aug: "08", sept: "09", sep: "09", okt: "10", nov: "11", dez: "12" };
/** "1. Jan. 2000" -> "2000-01-01" (Fedlex notes in German). */
function germanDate(value) {
    const match = /(\d{1,2})\.\s*([A-Za-zäÄ]+)\.?\s*(\d{4})/u.exec(value);
    const month = match ? GERMAN_MONTHS[match[2].toLowerCase().slice(0, match[2].toLowerCase().startsWith("ju") ? 4 : 3)] ?? GERMAN_MONTHS[match[2].toLowerCase()] : undefined;
    return match && month ? `${match[3]}-${month}-${match[1].padStart(2, "0")}` : undefined;
}
/**
 * Switzerland, Fedlex (Akoma Ntoso XML of the consolidated version, one file per date in force:
 * …/filestore/fedlex.data.admin.ch/eli/cc/{id}/{YYYYMMDD}/{lang}/xml/…xml, found by SPARQL from
 * the work's consolidations). Each change is an authorialNote naming the amending act (an ELI
 * link to the Official Compilation AS) and "in Kraft seit …". The text has legal force (SR).
 */
export function readSwitzerland(xml, source) {
    const title = plainText(/<docTitle>([\s\S]*?)<\/docTitle>/u.exec(xml)?.[1] ?? "");
    const articles = [...xml.matchAll(/<article eId="([^"]+)">([\s\S]*?)<\/article>/gu)].map(([, , body]) => {
        const heading = plainText(/<num>([\s\S]*?)<\/num>/u.exec(body)?.[1] ?? "");
        const notes = [...body.matchAll(/<authorialNote>([\s\S]*?)<\/authorialNote>/gu)].map((match) => match[1]);
        const amendments = notes.flatMap((note) => {
            const act = /<ref href="(https:\/\/fedlex\.data\.admin\.ch\/eli\/oc\/[^"]+)"/u.exec(note)?.[1];
            if (!act)
                return [];
            const inForce = germanDate(/in Kraft seit ([^(;]+)/u.exec(plainText(note))?.[1] ?? "");
            return [{ act, ...(inForce ? { inForce } : {}) }];
        });
        const text = plainText(body.replace(/<authorialNote>[\s\S]*?<\/authorialNote>/gu, "").replace(/<num>[\s\S]*?<\/num>/u, ""));
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
export function readCzech(fragments, meta, source) {
    const amendments = (meta.novely ?? []).map((item) => item.kodDokumentuSbirky).filter((item) => Boolean(item)).map((act) => ({ act }));
    const heads = fragments.filter((fragment) => fragment.kodTypuFragmentu === "Clanek" || fragment.kodTypuFragmentu === "Paragraf");
    const articles = heads.map((head) => {
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
export function readAustria(xml, source) {
    const field = (ct) => plainText(new RegExp(`<absatz[^>]*ct="${ct}"[^>]*>([\\s\\S]*?)<\\/absatz>`, "u").exec(xml)?.[1] ?? "");
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
export function readMonaco(html, source) {
    const articles = [...html.matchAll(/<section class="section art"[^>]*data-title="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gu)].map(([, title, body]) => {
        const amendments = [...body.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*>\s*<span>([^<]+)<\/span>/gu)].map((match) => ({ act: plainText(match[2]), inForce: match[1] }));
        const text = plainText(/<div class="text\s*">([\s\S]*?)<\/div>/u.exec(body)?.[1] ?? "");
        return { unit: title.replace(/^Article\s+/u, ""), heading: title, text, amendments };
    });
    return { country: "MC", source, articles, version: "wersja obowiązująca (Legimonaco)", status: "tekst Legimonaco (Direction des affaires juridiques)" };
}
/** Latvia, likumi.lv: paragraphs p.TV213; an article opens with "N. pants." or, in the Civil Law, with its number "N.". */
export function readLatvia(html, source) {
    // A centred paragraph is a heading of a chapter ("3. Laulāto mantas kopība"), not an article.
    const paragraphs = [...html.matchAll(/<p class="TV213[^"]*">([\s\S]*?)<\/p>/gu)].filter((match) => !/<center>/iu.test(match[1])).map((match) => plainText(match[1])).filter(Boolean);
    const articles = [];
    for (const paragraph of paragraphs) {
        const head = /^(\d+(?:\.\d+)?)\.\s*(?:pants\.\s*)?/u.exec(paragraph);
        // "1. Vispārīgi noteikumi": a short line without a sentence is a heading of a part, not an article.
        if (head && paragraph.length < 70 && !/[.;:]\s*\S/u.test(paragraph.slice(head[0].length)))
            continue;
        if (head)
            articles.push({ unit: head[1], heading: `${head[1]}.`, text: paragraph, amendments: [] });
        else if (articles.length)
            articles.at(-1).text += `\n${paragraph}`;
    }
    return { country: "LV", source, articles, version: "wersja obowiązująca (likumi.lv)", status: "tekst urzędowy (Latvijas Vēstnesis, likumi.lv)" };
}
/**
 * Sweden, Riksdagen open data (no key): data.riksdagen.se/dokument/sfs-{year}-{number}.text is the
 * consolidated text from Regeringskansliet/Lagrummet ("Ändrad: t.o.m. SFS …"). A section opens
 * with "N §" (or "N a §"); chapters ("N kap.") restart the numbering in some acts, so the unit is
 * "N kap. M §" there and "M" elsewhere. "Lag (YYYY:NNN)." closing a section names its amending act.
 */
export function readSweden(text, source) {
    const lines = text.replace(/\r/gu, "").split("\n");
    const title = lines[0]?.trim() ?? "";
    const changed = /Ändrad:\s*t\.o\.m\.\s*SFS\s*(\d{4}:\d+)/u.exec(text)?.[1];
    const sections = [];
    let chapter;
    for (const line of lines) {
        const kap = /^(\d+\s?[a-z]?)\s+kap\.\s/u.exec(line);
        if (kap) {
            chapter = kap[1].replace(/\s/gu, "");
            continue;
        }
        const head = /^(\d+\s?[a-z]?)\s+§\s/u.exec(line);
        if (head)
            sections.push({ ...(chapter ? { chapter } : {}), number: head[1].replace(/\s/gu, ""), lines: [line] });
        else if (sections.length)
            sections.at(-1).lines.push(line);
    }
    const numbers = sections.map((section) => section.number);
    const restarts = new Set(numbers).size < numbers.length;
    const articles = sections.map((section) => {
        const body = section.lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
        // "… konsumentförhållanden. Lag (1994:1513)." closing a paragraph of the section.
        const amendments = [...body.matchAll(/\b(?:Lag|Förordning)\s*\((\d{4}:\d+)\)\.(?=\s*(?:\n|$))/gu)].map((match) => ({ act: `SFS ${match[1]}` }));
        const unit = restarts && section.chapter ? `${section.chapter} kap. ${section.number}` : section.number;
        return { unit, heading: `${restarts && section.chapter ? `${section.chapter} kap. ` : ""}${section.number} §`, text: body, amendments };
    });
    return { country: "SE", source, title, version: changed ? `ujednolicony do SFS ${changed}` : "ujednolicony (Lagrummet)", articles, status: "tekst ujednolicony Regeringskansliet (Riksdagen öppna data); moc ma SFS" };
}
const RAG_NOTE = "skan bez warstwy tekstowej: kandydat do OCR i indeksu RAG, nie brzmienie zweryfikowane";
/** A legislation PDF: its text layer is read; pages without one are named for OCR/RAG. */
export async function readLegislationPdf(data) {
    // A code is longer than a case document (Liechtenstein's PGR, Malta's Civil Code: over 600 pages).
    const result = await new LocalPdfTextExtractor({ maxBytes: 64 * 1024 * 1024, maxPages: 4000, maxTextChars: 40_000_000 }, { lines: true, allowEmpty: true }).extract(data);
    const pages = result.pageTexts ?? [result.text];
    const empty = pages.map((page, index) => (page.replace(/\s+/gu, "").length < 20 ? index + 1 : 0)).filter(Boolean);
    if (empty.length === pages.length)
        return { kind: "SKAN", pages: pages.length, note: RAG_NOTE };
    if (empty.length)
        return { kind: "MIESZANY", text: result.text, pages: pages.length, pagesWithoutText: empty, note: `strony ${empty.join(", ")}: ${RAG_NOTE}` };
    return { kind: "TEKST", text: result.text, pages: pages.length };
}
export const NATIONAL_READERS = { DK: readDenmark, NL: readNetherlands, BE: readBelgium, IT: readItaly, DE: readGermany, CH: readSwitzerland };
