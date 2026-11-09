// One entry point to the national readers: the URL of an act at a country's official source
// goes to that country's reader; only the official hosts below are fetched (no other address
// leaves the app through this path). The answer is the article(s) asked for, with the source's
// own status (official / without legal force / unofficial) and the amending acts it names.
import { boeArticle, boeVersionOn } from "./es-boe.js";
import { legiLookup } from "./fr-legi.js";
import { readAustria, readBelgium, readCzech, readLatvia, readEstonia, readFinland, readLuxembourg, readMonaco, readSweden, readDenmark, readGermany, readItaly, readLegislationPdf, readNetherlands, readSwitzerland } from "./readers.js";
const READERS = [
    { country: "DK", hosts: /^(?:www\.)?retsinformation\.dk$/u, read: readDenmark, accept: "application/xml" },
    { country: "NL", hosts: /^wetten\.overheid\.nl$/u, read: readNetherlands },
    { country: "BE", hosts: /^(?:www\.)?ejustice\.just\.fgov\.be$/u, read: readBelgium },
    { country: "IT", hosts: /^(?:www\.)?normattiva\.it$/u, read: readItaly },
    { country: "DE", hosts: /^(?:www\.)?gesetze-im-internet\.de$/u, read: readGermany },
    { country: "CH", hosts: /^fedlex\.data\.admin\.ch$/u, read: readSwitzerland, accept: "application/xml" },
    { country: "MC", hosts: /^legimonaco\.mc$/u, read: readMonaco },
    { country: "LV", hosts: /^likumi\.lv$/u, read: readLatvia }
];
// Official PDFs with a text layer (Liechtenstein, Malta, Turkey): read as text, scans flagged.
const PDF_HOSTS = [
    { country: "LI", hosts: /^(?:www\.)?gesetze\.li$/u },
    { country: "MT", hosts: /^(?:www\.)?legislation\.mt$/u },
    { country: "TR", hosts: /^(?:www\.)?mevzuat\.gov\.tr$/u }
];
// The country of each official host this module reads (the readers below and the API branches).
const HOST_COUNTRIES = [
    [/^(?:www\.)?boe\.es$/u, "ES"],
    [/^(?:www\.|ogd\.|data\.)?(?:ris\.)?bka\.gv\.at$/u, "AT"],
    [/^(?:data\.|www\.)?riksdagen\.se$/u, "SE"],
    [/^(?:data\.|www\.)?legilux\.public\.lu$/u, "LU"],
    [/^(?:www\.)?e-sbirka\.(?:gov\.)?cz$/u, "CZ"],
    [/^(?:www\.|data\.|opendata\.)?finlex\.fi$/u, "FI"],
    [/^(?:www\.)?legifrance\.gouv\.fr$/u, "FR"],
    [/^(?:www\.)?riigiteataja\.ee$/u, "EE"]
];
/** The country whose official source the address is, or null for a host this module does not read. */
export function nationalLawCountry(host) {
    const name = host.toLowerCase();
    return HOST_COUNTRIES.find(([pattern]) => pattern.test(name))?.[1] ?? READERS.find((item) => item.hosts.test(name))?.country ?? PDF_HOSTS.find((item) => item.hosts.test(name))?.country ?? null;
}
/** The hosts this reader fetches, for the tool's description and the policy. */
export const NATIONAL_LAW_HOSTS = [...READERS.map((item) => item.country), ...PDF_HOSTS.map((item) => item.country), "ES", "AT", "SE", "LU", "CZ", "FI", "FR", "EE"];
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
    const sourceCountry = nationalLawCountry(host);
    if (!sourceCountry)
        throw new Error("NATIONAL_LAW_HOST_NOT_SUPPORTED");
    // Only the chosen legal system's sources: the other countries are off (user, 2026-11-08).
    if (request.country && request.country !== sourceCountry)
        throw new Error(`NATIONAL_LAW_COUNTRY_DISABLED:${sourceCountry}`);
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
    // Sweden: Riksdagen open data, the act by its SFS number (…/dokument/sfs-1915-218 or any URL naming "1915:218").
    if (/^(?:data\.)?riksdagen\.se$/u.test(host) || /^(?:www\.)?riksdagen\.se$/u.test(host)) {
        const sfs = /sfs-(\d{4})-(\d+)/iu.exec(url.href) ?? /(\d{4}):(\d+)/u.exec(decodeURIComponent(url.href));
        if (!sfs)
            throw new Error("NATIONAL_LAW_SE_SFS_REQUIRED");
        const textUrl = `https://data.riksdagen.se/dokument/sfs-${sfs[1]}-${sfs[2]}.text`;
        const reply = await fetchImpl(textUrl, { headers: { accept: "text/plain" }, signal: AbortSignal.timeout(60_000) });
        if (!reply.ok)
            throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
        const reading = readSweden(new TextDecoder().decode(await reply.arrayBuffer()), textUrl);
        const wanted = request.unit?.replace(/§/gu, "").replace(/\s+/gu, " ").trim();
        const articles = wanted ? reading.articles.filter((article) => article.unit === wanted || article.unit === wanted.replace(/\s+(?=[a-z]$)/u, "")) : reading.articles.slice(0, 20);
        return { country: "SE", url: textUrl, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
    }
    // Luxembourg: Legilux ELI of an act of the Journal officiel (…/eli/etat/leg/loi/2016/05/23/n2/jo):
    // SPARQL gives the Akoma Ntoso file of its French expression.
    if (/^(?:data\.|www\.)?legilux\.public\.lu$/u.test(host)) {
        const eli = /\/eli\/etat\/[^?#]+/u.exec(url.pathname)?.[0]?.replace(/\/(?:fr|de)(?:\/(?:html|pdf|xml|docx))?$/u, "");
        if (!eli)
            throw new Error("NATIONAL_LAW_LU_ELI_REQUIRED");
        const manifestation = `http://data.legilux.public.lu${eli}/fr/xml`;
        const query = `SELECT ?file WHERE { <${manifestation}> <http://data.legilux.public.lu/resource/ontology/jolux#isExemplifiedBy> ?file } LIMIT 1`;
        const sparql = await fetchImpl(`https://data.legilux.public.lu/sparqlendpoint?query=${encodeURIComponent(query)}`, { headers: { accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(60_000) });
        if (!sparql.ok)
            throw new Error(`NATIONAL_LAW_SOURCE_${sparql.status}`);
        const file = JSON.parse(new TextDecoder().decode(await sparql.arrayBuffer())).results?.bindings?.[0]?.file?.value;
        if (!file || !/^https?:\/\/data\.legilux\.public\.lu\/filestore\//u.test(file))
            return { country: "LU", url: manifestation, status: "Legilux: brak pliku XML tego aktu", articles: [] };
        const doc = await fetchImpl(file.replace(/^http:/u, "https:"), { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(60_000) });
        if (!doc.ok)
            throw new Error(`NATIONAL_LAW_SOURCE_${doc.status}`);
        const reading = readLuxembourg(new TextDecoder().decode(await doc.arrayBuffer()), file);
        const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit)) : reading.articles.slice(0, 20);
        return { country: "LU", url: file, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
    }
    // France: Légifrance blocks automated reads and its API needs a PISTE key; the codes are read
    // from the local index of DILA's LEGI dump (built once, see fr-legi.ts) by LEGITEXT/LEGIARTI id.
    if (/^(?:www\.)?legifrance\.gouv\.fr$/u.test(host)) {
        const cid = /LEGITEXT\d{12}/u.exec(url.href)?.[0];
        const articleId = /LEGIARTI\d{12}/u.exec(url.href)?.[0];
        if (!cid && !articleId)
            throw new Error("NATIONAL_LAW_FR_LEGI_ID_REQUIRED");
        const answer = await legiLookup({ ...(cid ? { cid } : {}), ...(articleId ? { articleId } : {}), ...(request.unit ? { num: request.unit } : {}), ...(request.date ? { date: request.date } : {}) });
        if (!answer)
            return { country: "FR", url: url.href, status: "indeks LEGI nie jest zbudowany", articles: [], note: "Francja czytana z lokalnego indeksu zrzutu LEGI (DILA, 1,2 GB, bez klucza): administrator buduje go w Ustawienia > Aplikacja > Prawo francuskie (LEGI); do tego czasu artykuł nie jest zweryfikowany" };
        if (!answer.code)
            return { country: "FR", url: url.href, status: "LEGI: kodeksu nie ma w indeksie (indeks obejmuje kodeksy obowiązujące)", articles: [] };
        const version = answer.version;
        return {
            country: "FR",
            url: `https://www.legifrance.gouv.fr/codes/article_lc/${version?.id ?? articleId ?? ""}`,
            status: `tekst skonsolidowany Légifrance (zrzut LEGI DILA z ${answer.built?.slice(0, 10) ?? "?"}), bez mocy urzędowej; moc ma Journal officiel`,
            title: answer.code.title,
            ...(version ? { version: `wersja ${version.state} od ${version.from}${version.to < "2999" ? ` do ${version.to}` : ""}` } : { version: "brak wersji tego artykułu na tę datę" }),
            articles: version ? [{ unit: version.num, heading: `Article ${version.num}`, text: version.text, amendments: version.links.map((act) => ({ act })) }] : [],
            ...(answer.others.length ? { note: `inne wersje: ${answer.others.map((item) => `${item.from}–${item.to < "2999" ? item.to : "…"} (${item.state})`).join("; ")}` } : {})
        };
    }
    // Estonia: Riigi Teataja public API (no key). The act by its id (…/akt/{globaalID}) or by its title
    // (…/akt?pealkiri=Võlaõigusseadus): the search lists every version with its validity; the one in
    // force on the date (today by default) is read as XML.
    if (/^(?:www\.)?riigiteataja\.ee$/u.test(host)) {
        const json = async (address) => {
            const reply = await fetchImpl(address, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
            if (!reply.ok)
                throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
            return JSON.parse(new TextDecoder().decode(await reply.arrayBuffer()));
        };
        let id = /\/akt\/(\d{6,})/u.exec(url.pathname)?.[1];
        const title = url.searchParams.get("pealkiri")?.trim();
        const date = request.date ?? new Date().toISOString().slice(0, 10);
        if (title) {
            const hits = [];
            for (let page = 1; page <= 10; page += 1) {
                const search = new URL("https://www.riigiteataja.ee/api/oigusakt_otsing/1/otsi");
                search.search = new URLSearchParams({ pealkiri: title, leht: String(page), limiit: "100" }).toString();
                const data = await json(search.href);
                const list = data.aktid ?? [];
                hits.push(...list);
                const meta = data.metaandmed;
                if (!list.length || hits.length >= Number(meta?.kokku ?? 0))
                    break;
            }
            const exact = hits.filter((hit) => hit.pealkiri.toLocaleLowerCase("et") === title.toLocaleLowerCase("et") && hit.tekst === "terviktekst");
            const inForce = exact.filter((hit) => hit.kehtivus.algus <= date && (!hit.kehtivus.lopp || date <= hit.kehtivus.lopp));
            id = String((inForce.find((hit) => !hit.mitteJoustunud) ?? inForce[0])?.globaalID ?? "") || undefined;
            if (!id)
                return { country: "EE", url: url.href, status: "Riigi Teataja: brak wersji aktu obowiązującej w tym dniu", articles: [] };
        }
        if (!id)
            throw new Error("NATIONAL_LAW_EE_ACT_REQUIRED");
        const xmlUrl = `https://www.riigiteataja.ee/public-api/api/v1/akt/${id}/blob-xml`;
        const reply = await fetchImpl(xmlUrl, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(120_000) });
        if (!reply.ok)
            throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
        const reading = readEstonia(new TextDecoder().decode(await reply.arrayBuffer()), xmlUrl);
        const wanted = request.unit?.replace(/§/gu, "").replace(/\.$/u, "").trim();
        const articles = wanted ? reading.articles.filter((article) => article.unit === wanted) : reading.articles.slice(0, 20);
        return { country: "EE", url: `https://www.riigiteataja.ee/akt/${id}`, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
    }
    // Finland: Finlex open data (no key), the act by year and number from any Finlex address
    // (…/eli/sd/1929/228/ajantasa, …/statute-consolidated/1889/39-001, finlex.fi/fi/laki/ajantasa/1929/19290228).
    if (/^(?:www\.|data\.|opendata\.)?finlex\.fi$/u.test(host)) {
        const path = decodeURIComponent(url.pathname);
        const act = /\/(?:sd|statute(?:-consolidated)?|ajantasa|alkup|lainsaadanto(?:\/[a-z]+)?|laki\/[a-z]+)\/(\d{4})\/(\d{1,8}(?:-\d{3})?)(?:\/(fin|swe)@(\d{8})?)?/u.exec(path);
        if (!act)
            throw new Error("NATIONAL_LAW_FI_ACT_REQUIRED");
        const year = act[1];
        // The old Finlex page address writes the number as year + zero-padded number (19290228).
        const number = act[2].length === 8 && act[2].startsWith(year) ? String(Number(act[2].slice(4))) : act[2];
        const original = /\/alkup\b|\/statute\//u.test(path);
        const base = `https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/${original ? "statute" : "statute-consolidated"}/${year}/`;
        const explicit = act[4] ? `/fin@${act[4]}` : original ? "/fin@" : "";
        // Old acts in parts answer only under "-001"/"-000" (Rikoslaki 1889/39-001).
        const candidates = number.includes("-") ? [number] : [number, `${number}-001`, `${number}-000`];
        let xml = "";
        let used = "";
        for (const candidate of candidates) {
            used = `${base}${candidate}${explicit}`;
            const reply = await fetchImpl(used, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(120_000) });
            if (!reply.ok && reply.status !== 404)
                throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
            if (!reply.ok)
                continue;
            xml = new TextDecoder().decode(await reply.arrayBuffer());
            if (/<akomaNtoso\b/u.test(xml))
                break;
            xml = "";
        }
        if (!xml)
            return { country: "FI", url: used, status: "Finlex: aktu nie znaleziono", articles: [] };
        const reading = readFinland(xml, used);
        const wanted = request.unit?.toLowerCase().replace(/§|pykälä|pykälän/gu, "").replace(/^(\d+\s?[a-z]?)\s*:\s*/u, "$1 luku ").replace(/\s+/gu, " ").trim();
        const articles = wanted ? reading.articles.filter((article) => article.unit === wanted || article.unit.replace(/^\S+ luku /u, "") === wanted) : reading.articles.slice(0, 20);
        const note = request.date && !act[4] ? "Finlex podaje najnowszą wersję ujednoliconą; wersję na dzień zdarzenia wskaż numerem wersji w adresie (…/fin@RRRRNNNN)" : undefined;
        return { country: "FI", url: used, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles, ...(note ? { note } : {}) };
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
