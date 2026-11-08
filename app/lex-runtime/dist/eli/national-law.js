// One entry point to the national readers: the URL of an act at a country's official source
// goes to that country's reader; only the official hosts below are fetched (no other address
// leaves the app through this path). The answer is the article(s) asked for, with the source's
// own status (official / without legal force / unofficial) and the amending acts it names.
import { boeArticle, boeVersionOn } from "./es-boe.js";
import { readAustria, readBelgium, readCzech, readDenmark, readGermany, readItaly, readLegislationPdf, readNetherlands, readSwitzerland } from "./readers.js";
const READERS = [
    { country: "DK", hosts: /^(?:www\.)?retsinformation\.dk$/u, read: readDenmark, accept: "application/xml" },
    { country: "NL", hosts: /^wetten\.overheid\.nl$/u, read: readNetherlands },
    { country: "BE", hosts: /^(?:www\.)?ejustice\.just\.fgov\.be$/u, read: readBelgium },
    { country: "IT", hosts: /^(?:www\.)?normattiva\.it$/u, read: readItaly },
    { country: "DE", hosts: /^(?:www\.)?gesetze-im-internet\.de$/u, read: readGermany },
    { country: "CH", hosts: /^fedlex\.data\.admin\.ch$/u, read: readSwitzerland, accept: "application/xml" }
];
// Official PDFs with a text layer (Liechtenstein, Malta, Turkey): read as text, scans flagged.
const PDF_HOSTS = [
    { country: "LI", hosts: /^(?:www\.)?gesetze\.li$/u },
    { country: "MT", hosts: /^(?:www\.)?legislation\.mt$/u },
    { country: "TR", hosts: /^(?:www\.)?mevzuat\.gov\.tr$/u }
];
/** The hosts this reader fetches, for the tool's description and the policy. */
export const NATIONAL_LAW_HOSTS = [...READERS.map((item) => item.country), ...PDF_HOSTS.map((item) => item.country), "ES"];
function unitMatches(article, unit) {
    const wanted = unit.replace(/^(?:art\.?|artikel|article|artículo|čl\.?|§)\s*/iu, "").replace(/\s+/gu, " ").trim().toLowerCase();
    const own = article.unit.replace(/^(?:art\.?|artikel|§)\s*/iu, "").replace(/\s+/gu, " ").trim().toLowerCase();
    return own === wanted;
}
export async function readNationalLaw(request, fetchImpl = fetch) {
    let url;
    try {
        url = new URL(request.url);
    }
    catch {
        throw new Error("NATIONAL_LAW_URL_INVALID");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && /legilux|dre\.pt/u.test(url.hostname)))
        throw new Error("NATIONAL_LAW_URL_INVALID");
    const host = url.hostname.toLowerCase();
    // Spain: the BOE API by identifier and block ("BOE-A-2015-10565" + "a28").
    if (/^(?:www\.)?boe\.es$/u.test(host)) {
        // An ELI address (…/eli/es/l/2015/10/01/39/con) names no BOE id: the act's page does.
        let id = /BOE-[A-Z]-\d{4}-\d{1,6}/u.exec(url.href)?.[0];
        if (!id && /^\/eli\//u.test(url.pathname)) {
            const page = await fetchImpl(url.href, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(60_000) });
            if (page.ok)
                id = /BOE-[A-Z]-\d{4}-\d{1,6}/u.exec(new TextDecoder().decode(await page.arrayBuffer()))?.[0];
        }
        const block = request.unit ? `a${request.unit.replace(/\D+/gu, "")}` : /bloque\/([a-z0-9_-]+)/iu.exec(url.href)?.[1];
        if (!id || !block)
            throw new Error("NATIONAL_LAW_BOE_ID_AND_ARTICLE_REQUIRED");
        const article = await boeArticle(id, block, fetchImpl);
        const version = request.date ? boeVersionOn(article, request.date) : article.versions.at(-1) ?? null;
        return {
            country: "ES",
            url: article.apiUrl,
            status: "tekst urzędowy (BOE, legislación consolidada)",
            version: version ? `wersja od ${version.inForce} (${version.act})` : "brak wersji na tę datę",
            articles: version ? [{ unit: block.replace(/^a/u, ""), heading: article.title, text: version.text, amendments: article.versions.filter((item) => item.act !== id).map((item) => ({ act: item.act, inForce: item.inForce })) }] : []
        };
    }
    // Austria: RIS OGD API (no key): the norm by short title or abbreviation ("ABGB") and § / Art.
    // The address names the act: …/ris/api/v2.6/Bundesrecht?Titel=ABGB, or any ris.bka.gv.at URL with Titel=.
    if (/^(?:www\.|ogd\.|data\.)?(?:ris\.)?bka\.gv\.at$/u.test(host)) {
        const title = url.searchParams.get("Titel") ?? url.searchParams.get("Kurztitel");
        if (!title || !request.unit)
            throw new Error("NATIONAL_LAW_AT_TITLE_AND_UNIT_REQUIRED");
        const number = request.unit.replace(/^(?:§|art\.?|artikel)\s*/iu, "").trim();
        const kind = /^art/iu.test(request.unit) ? "Artikel" : "Paragraph";
        const search = new URL("https://data.bka.gv.at/ris/api/v2.6/Bundesrecht");
        search.search = new URLSearchParams({ Applikation: "BrKons", Titel: title, "Abschnitt.Von": number, "Abschnitt.Bis": number, "Abschnitt.Typ": kind, ...(request.date ? { FassungVom: request.date } : {}) }).toString();
        const found = await fetchImpl(search.href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
        if (!found.ok)
            throw new Error(`NATIONAL_LAW_SOURCE_${found.status}`);
        const data = JSON.parse(new TextDecoder().decode(await found.arrayBuffer()));
        const raw = data.OgdSearchResult?.OgdDocumentResults?.OgdDocumentReference;
        const refs = (Array.isArray(raw) ? raw : raw ? [raw] : []);
        const xmlUrl = refs[0]?.Data?.Dokumentliste?.ContentReference?.Urls?.ContentUrl?.find((item) => item.DataType === "Xml")?.Url;
        if (!xmlUrl || !/^https:\/\/ogd\.ris\.bka\.gv\.at\//u.test(xmlUrl))
            return { country: "AT", url: search.href, status: "RIS: normy nie znaleziono", articles: [] };
        const doc = await fetchImpl(xmlUrl, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(60_000) });
        if (!doc.ok)
            throw new Error(`NATIONAL_LAW_SOURCE_${doc.status}`);
        const reading = readAustria(new TextDecoder().decode(await doc.arrayBuffer()), xmlUrl);
        return { country: "AT", url: xmlUrl, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles: reading.articles };
    }
    // Czech Republic: e-Sbírka's public cache (no key): metadata of the version, then its fragments.
    if (/^(?:www\.)?e-sbirka\.(?:gov\.)?cz$/u.test(host)) {
        const act = /\/sb\/(\d{4})\/(\d+)(?:\/(\d{4}-\d{2}-\d{2}))?/u.exec(url.pathname);
        if (!act)
            throw new Error("NATIONAL_LAW_CZ_ACT_REQUIRED");
        const base = "https://e-sbirka.gov.cz/sbr-cache/dokumenty-sbirky/";
        const json = async (path) => {
            const reply = await fetchImpl(base + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
            if (!reply.ok)
                throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
            return JSON.parse(new TextDecoder().decode(await reply.arrayBuffer()));
        };
        const asked = `/sb/${act[1]}/${act[2]}${request.date ? `/${request.date}` : act[3] ? `/${act[3]}` : ""}`;
        const meta = await json(encodeURIComponent(asked));
        const version = typeof meta.staleUrl === "string" ? meta.staleUrl : asked;
        const fragments = [];
        for (let page = 0; page < 40; page += 1) {
            const chunk = await json(`${encodeURIComponent(version)}/fragmenty?cisloStranky=${page}`);
            fragments.push(...(chunk.seznam ?? []));
            if (page + 1 >= Number(chunk.pocetStranek ?? 1))
                break;
        }
        const reading = readCzech(fragments, meta, `https://e-sbirka.gov.cz${version}`);
        const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit)) : reading.articles.slice(0, 20);
        return { country: "CZ", url: reading.source, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
    }
    const reader = READERS.find((item) => item.hosts.test(host));
    const pdf = PDF_HOSTS.find((item) => item.hosts.test(host));
    if (!reader && !pdf)
        throw new Error("NATIONAL_LAW_HOST_NOT_SUPPORTED");
    const ask = () => fetchImpl(url.href, { headers: { accept: reader?.accept ?? "text/html, application/xml, application/pdf;q=0.9", "user-agent": "LexMachina/0.1 (legal research)" }, signal: AbortSignal.timeout(60_000) });
    let response = await ask();
    // A busy portal (gesetze-im-internet.de answered 503 once and 200 right after): one retry.
    if (response.status === 503 || response.status === 429) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        response = await ask();
    }
    if (!response.ok)
        throw new Error(`NATIONAL_LAW_SOURCE_${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const type = response.headers.get("content-type") ?? "";
    if (pdf || /pdf/u.test(type) || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
        const reading = await readLegislationPdf(bytes);
        const country = pdf?.country ?? reader.country;
        if (reading.kind === "SKAN")
            return { country, url: url.href, status: "PDF bez warstwy tekstowej", articles: [], note: reading.note };
        const text = reading.text;
        // The article asked for, by its heading in the text ("Art. 12", "Madde 12", "12."): the passage up to the next one.
        const articles = [];
        if (request.unit) {
            const number = request.unit.replace(/^(?:art\.?|madde|article)\s*/iu, "").trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
            const start = new RegExp(`(?:^|\\n)\\s*(?:Art\\.|Artikel|Article|MADDE|Madde)\\s*${number}\\b`, "u").exec(text);
            if (start) {
                const rest = text.slice(start.index + start[0].length);
                const next = /\n\s*(?:Art\.|Artikel|Article|MADDE|Madde)\s*\d/u.exec(rest);
                articles.push({ unit: request.unit, heading: start[0].trim(), text: (start[0] + rest.slice(0, next ? next.index : 6000)).trim(), amendments: [] });
            }
        }
        return { country, url: url.href, status: "tekst z urzędowego PDF", articles, ...(reading.kind === "MIESZANY" ? { note: reading.note } : {}), ...(request.unit && !articles.length ? { note: "artykułu nie znaleziono w tekście PDF" } : {}) };
    }
    const reading = reader.read(new TextDecoder(/iso-8859-1/iu.test(type) ? "latin1" : "utf-8").decode(bytes), url.href);
    const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit)) : reading.articles.slice(0, 20);
    return {
        country: reading.country,
        url: url.href,
        status: reading.status,
        ...(reading.title ? { title: reading.title } : {}),
        ...(reading.version ? { version: reading.version } : {}),
        articles
    };
}
