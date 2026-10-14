// Kotwica do jednostki redakcyjnej w oficjalnym tekście ELI: link źródła wskazuje
// konkretny artykuł/§/ust./pkt, a nie sam akt. Reguły wyboru jednostki jak w
// shared/tools/eli_art_extract.py (część „Tekst jednolity", przytoczenia pomijane,
// kilka kandydatów = brak kotwicy). Brak pewnej kotwicy = link bez kotwicy.
const UNIT_KIND = {
    "art": "arti",
    "§": "para",
    "ust": "pass",
    "pkt": "pint",
    "lit": "lett"
};
// Numer artykułu z indeksem górnym: PDF Dz.U. zapisuje „Art. 11¹.” jako „Art. 11[1].”
// (pdf.js: „Art. 11 [1] .”), HTML jako <sup>; klucz kopii to zapis z cytatu: „11¹”, „151⁹a”.
const TO_SUPERSCRIPT = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];
/**
 * Nagłówek artykułu. Indeks górny w PDF Dz.U.: „Art. 11[1].” / „Art. 11 [1] .” (pdf.js),
 * „Art. 6 1 .” (cyfry indeksu oddzielone spacją, kropka po spacji — inne PDF), w HTML
 * „Art. 300[71]a.” (litera za indeksem). Zakres „Art. 133–142. (pominięte)”. „Artykuł 5” w umowach.
 */
export function articleHeadingPattern() {
    return /(?:^|\n)\s*(?:Art\.\s*(?<num>\d+[a-z]{0,4})(?:\s*\[\s*(?<sup>\d+)\s*(?<supIn>[a-z]{0,4})\s*\]\s*(?<supAfter>[a-z]{0,4})|\s+(?<supSpaced>\d{1,3})(?<supSpacedLetters>[a-z]{0,4})(?=\s+\.))?\s*\.|Artykuł\s+(?<treaty>\d+[a-z]{0,4})\.?|Art\.\s*(?<from>\d+)\s*[–—-]\s*(?<to>\d+)\s*\.)(?=\s)/gu;
}
// Zakres dłuższy niż to jest raczej błędem odczytu niż jednym wpisem t.j.
const MAX_RANGE = 500;
/** Numery artykułów z nagłówka; zakres „Art. 133–142.” daje każdy numer z zakresu. */
export function articleIdsFromHeading(match) {
    const group = match.groups ?? {};
    if (group.from && group.to) {
        const from = Number(group.from);
        const to = Number(group.to);
        if (to <= from || to - from > MAX_RANGE)
            return [`${group.from}–${group.to}`];
        return Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
    }
    if (group.treaty)
        return [group.treaty];
    const digits = group.sup ?? group.supSpaced ?? "";
    const sup = [...digits].map((digit) => TO_SUPERSCRIPT[Number(digit)]).join("");
    // Litera w nawiasie („[71a]”, PDF) albo za nim („<sup>71</sup>a”, HTML).
    return [`${group.num}${sup}${group.supIn || group.supAfter || group.supSpacedLetters || ""}`];
}
/** „11^1”, „11[1]”, „11 [1a]”, „art. 11¹” -> „11¹” / „11¹a”; inny zapis bez zmian (małe litery). */
export function normalizeArticleId(raw) {
    const value = raw.replace(/^art\.?\s*/iu, "").replace(/\s+/gu, "").toLocaleLowerCase("pl");
    const marked = /^(\d+[a-z]{0,4})(?:\[(\d+)([a-z]{0,4})\]|\^(\d+)([a-z]{0,4}))$/u.exec(value);
    if (!marked)
        return value;
    const digits = marked[2] ?? marked[4];
    const letters = marked[3] ?? marked[5] ?? "";
    return `${marked[1]}${[...digits].map((digit) => TO_SUPERSCRIPT[Number(digit)]).join("")}${letters}`;
}
const SUPERSCRIPT = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9"
};
function numberIds(value) {
    const match = value
        .replace(/\s+/gu, "")
        .match(/^(\d+)([⁰¹²³⁴⁵⁶⁷⁸⁹]*)([a-z]*)$/iu);
    if (!match)
        return [];
    const base = match[1];
    const sup = [...(match[2] ?? "")].map((char) => SUPERSCRIPT[char] ?? "").join("");
    const letters = (match[3] ?? "").toLocaleLowerCase("pl");
    const parts = [base, ...(sup ? [sup] : []), ...(letters ? [letters] : [])];
    const ids = [parts.join("_")];
    if (letters && !sup)
        ids.push(base + letters);
    return ids;
}
/** 'art. 22 § 1¹ pkt 2 lit. a KP' -> ścieżka jednostek ELI; null gdy nie zaczyna się od art. */
export function statuteUnitPath(claim) {
    const pattern = /(?<!\p{L})(art\.?|§|ust\.?|pkt|lit\.?)\s*([0-9]+[⁰¹²³⁴⁵⁶⁷⁸⁹]*[a-z]{0,2}(?![a-z])|[a-z]{1,2}\)?(?![a-z]))/giu;
    const steps = [];
    for (const match of claim.matchAll(pattern)) {
        const kind = UNIT_KIND[match[1].toLocaleLowerCase("pl").replace(/\.$/u, "")];
        if (!kind)
            continue;
        const raw = match[2];
        const ids = kind === "lett"
            ? [raw.replace(/\)$/u, "").toLocaleLowerCase("pl")]
            : numberIds(raw);
        if (ids.length === 0)
            break;
        steps.push({ kind, ids });
    }
    return steps[0]?.kind === "arti" ? steps : null;
}
function attribute(tag, name) {
    return tag.match(new RegExp(`\\s${name}="([^"]*)"`, "u"))?.[1];
}
function htmlUnits(html) {
    const units = [];
    for (const match of html.matchAll(/<div\b[^>]*>/giu)) {
        const tag = match[0];
        if (!/\bclass="[^"]*\bunit\b/u.test(tag))
            continue;
        const id = attribute(tag, "id");
        const dataId = attribute(tag, "data-id");
        if (id && dataId)
            units.push({ id, dataId, index: match.index });
    }
    return units;
}
// Obwieszczenie t.j.: część 1 przytacza przepisy ustaw zmieniających z ich numeracją,
// tekst aktu jest w części oznaczonej „Tekst jednolity".
function actTextRange(html) {
    const sections = [...html.matchAll(/<section\b[^>]*\bid="(part_\d+)"[^>]*>/giu)].map((match) => match.index);
    if (sections.length === 0)
        return { start: 0, end: html.length };
    const ranges = sections.map((start, index) => {
        const end = sections[index + 1] ?? html.length;
        const heading = html.slice(start, end).match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/iu)?.[1] ?? "";
        const label = heading
            .replace(/<[^>]+>/gu, " ")
            .replace(/&nbsp;|&#160;/giu, " ")
            .replace(/\s+/gu, " ")
            .toLocaleLowerCase("pl");
        return { start, end, label };
    });
    return (ranges.find((range) => range.label.includes("tekst jednolity")) ??
        ranges.find((range) => !range.label.startsWith("treść obwieszczenia")) ??
        { start: 0, end: html.length });
}
function parseHtml(html) {
    return { units: htmlUnits(html), range: actTextRange(html) };
}
function unitFragment(parsed, path) {
    const articleIds = new Set(path[0].ids.map((id) => `arti_${id}`));
    const inPart = parsed.units.filter((unit) => articleIds.has(unit.dataId) &&
        unit.index >= parsed.range.start &&
        unit.index < parsed.range.end);
    // Artykuł zagnieżdżony w ust./pkt to przytoczenie innej ustawy.
    const main = inPart.filter((unit) => !/(^|-)(pass|pint)_[^-]+-.*arti_/u.test(unit.id));
    const candidates = main.length > 0 ? main : inPart;
    if (candidates.length !== 1)
        return undefined;
    let target = candidates[0];
    for (const step of path.slice(1)) {
        const dataIds = new Set(step.ids.map((id) => `${step.kind}_${id}`));
        const child = parsed.units
            .filter((unit) => unit.id.startsWith(target.id + "-") && dataIds.has(unit.dataId))
            .sort((a, b) => a.id.length - b.id.length)[0];
        // Głębsza jednostka nieznaleziona: kotwica na najgłębszej znalezionej.
        if (!child)
            break;
        target = child;
    }
    return target.id;
}
/** Identyfikator elementu HTML jednostki (do użycia jako #kotwica) albo undefined. */
export function htmlUnitFragment(html, claim) {
    const path = statuteUnitPath(claim);
    return path ? unitFragment(parseHtml(html), path) : undefined;
}
/** Kotwice artykułów całego aktu (numer artykułu -> id elementu), jedno parsowanie HTML. */
export function htmlArticleAnchors(html, articles) {
    const parsed = parseHtml(html);
    const anchors = {};
    for (const article of articles) {
        const path = statuteUnitPath(`art. ${article}`);
        const fragment = path ? unitFragment(parsed, path) : undefined;
        if (fragment)
            anchors[article] = fragment;
    }
    return anchors;
}
/** Kotwice stron PDF artykułów (numer -> "page=N"): strona pierwszego nagłówka, jak w splitArticles. */
export function pdfArticleAnchors(pageTexts) {
    const anchors = {};
    pageTexts.forEach((page, index) => {
        for (const match of page.matchAll(articleHeadingPattern())) {
            for (const article of articleIdsFromHeading(match))
                anchors[article] ??= `page=${index + 1}`;
        }
    });
    return anchors;
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&");
}
/** Numer strony PDF (od 1) z nagłówkiem artykułu; pierwsze wystąpienie, jak przy wyciąganiu treści. */
export function pdfArticlePage(pageTexts, claim) {
    const article = claim.match(/\bart\.?\s+(\d+[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]*)/iu)?.[1];
    if (!article)
        return undefined;
    const token = escapeRegExp(article);
    const strict = new RegExp(`(?:^|\\n)\\s*Art(?:\\.|ykuł)?\\s*${token}(?=\\s*(?:\\.|§|$))`, "iu");
    const loose = new RegExp(`\\bArt\\.?\\s+${token}(?=\\s*(?:\\.|§|$))`, "u");
    for (const pattern of [strict, loose]) {
        const index = pageTexts.findIndex((page) => pattern.test(page));
        if (index >= 0)
            return index + 1;
    }
    return undefined;
}
/** Kotwica strony PDF (#page=N), obsługiwana przez przeglądarkowe czytniki PDF. */
export function pageFragment(page) {
    return page && Number.isInteger(page) && page > 0 ? `page=${page}` : undefined;
}
export function anchoredUrl(sourceUrl, fragment) {
    if (!fragment || !/^[A-Za-z0-9_=-]+$/u.test(fragment))
        return undefined;
    return `${sourceUrl.replace(/#.*$/u, "")}#${fragment}`;
}
/** Link źródła do pokazania: z kotwicą do jednostki, gdy jest i dotyczy tego samego adresu. */
export function verificationSourceLink(record) {
    const base = record.sourceUrl?.trim();
    if (!base)
        return undefined;
    const anchored = record.sourceAnchorUrl?.trim();
    return anchored && anchored.startsWith(base.replace(/#.*$/u, "") + "#") ? anchored : base;
}
/** Znacznik ✅ [VER: …] rekordu VERIFIED, z linkiem do jednostki gdy to możliwe. */
export function verificationMarker(record) {
    const link = verificationSourceLink(record);
    if (record.status !== "VERIFIED" || !link || !record.fetchedAt?.trim())
        return null;
    return [
        "✅ [VER: ",
        link,
        ", ",
        record.fetchedAt.slice(0, 10),
        record.asOf ? `, STAN NA ${record.asOf}` : "",
        // Interpretacja istnieje, ale EUREKA nie podaje jej jako aktualnej.
        record.interpretationStatus && record.interpretationStatus !== "Aktualna"
            ? `, EUREKA: ${record.interpretationStatus.toLocaleUpperCase("pl")}`
            : "",
        "]"
    ].join("");
}
