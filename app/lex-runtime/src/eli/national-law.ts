// One entry point to the national readers: the URL of an act at a country's official source
// goes to that country's reader; only the official hosts below are fetched (no other address
// leaves the app through this path). The answer is the article(s) asked for, with the source's
// own status (official / without legal force / unofficial) and the amending acts it names.
import { BLOCKED_JURISDICTION_CODE, isBlockedCountry, isBlockedHost } from "../blocked-jurisdictions.js";
import { boeArticle, boeVersionOn } from "./es-boe.js";
import { legiLookup } from "./fr-legi.js";
import { readAustria, readBelgium, readCzech, readLatvia, readTurkey, readCroatia, readParagraf, readRwandaLii, irishJudgmentPage, judgmentParagraphs, readUnitedKingdom, readIreland, readCyprus, readUsCode, readUkJudgment, readCapCase, readMatsne, matsneVersions, readSlovenia, readPisrs, pisrsCard, readFaroe, readCanonLaw, readSlovakia, slovakVersions, slovakVersionOn, readKosovo, readIceland, readEstonia, readFinland, readLuxembourg, readMonaco, readSweden, readDenmark, readGermany, readItaly, readLegislationPdf, readNetherlands, readSwitzerland, type NationalArticle, type NationalReading } from "./readers.js";

type HostReader = { country: string; hosts: RegExp; read: (body: string, url: string) => NationalReading; accept?: string; address?: (url: URL) => string };

const READERS: HostReader[] = [
  { country: "DK", hosts: /^(?:www\.)?retsinformation\.dk$/u, read: readDenmark, accept: "application/xml" },
  { country: "NL", hosts: /^wetten\.overheid\.nl$/u, read: readNetherlands },
  { country: "BE", hosts: /^(?:www\.)?ejustice\.just\.fgov\.be$/u, read: readBelgium },
  { country: "IT", hosts: /^(?:www\.)?normattiva\.it$/u, read: readItaly },
  { country: "DE", hosts: /^(?:www\.)?gesetze-im-internet\.de$/u, read: readGermany },
  { country: "CH", hosts: /^fedlex\.data\.admin\.ch$/u, read: readSwitzerland, accept: "application/xml" },
  { country: "MC", hosts: /^legimonaco\.mc$/u, read: readMonaco },
  { country: "LV", hosts: /^likumi\.lv$/u, read: readLatvia },
  // HTML of the act (MevzuatFihristDetayIframe); …/MevzuatMetin/*.pdf goes to the PDF branch by its type.
  { country: "TR", hosts: /^(?:www\.)?mevzuat\.gov\.tr$/u, read: readTurkey },
  { country: "HR", hosts: /^narodne-novine\.nn\.hr$/u, read: readCroatia },
  { country: "SI", hosts: /^(?:www\.)?uradni-list\.si$/u, read: readSlovenia },
  { country: "FO", hosts: /^(?:www\.)?logir\.fo$/u, read: readFaroe },
  // Common law: statutes and judgments (family "common-law" in the register; Cyprus is mixed).
  { country: "GB", hosts: /^(?:www\.)?legislation\.gov\.uk$/u, read: readUnitedKingdom, accept: "application/xml", address: (url) => (/\/data\.xml$/u.test(url.pathname) ? url.href : `${url.origin}${url.pathname.replace(/\/$/u, "")}/data.xml`) },
  { country: "GB", hosts: /^caselaw\.nationalarchives\.gov\.uk$/u, read: readUkJudgment, accept: "application/xml", address: (url) => (/\/data\.xml$/u.test(url.pathname) ? url.href : `${url.origin}${url.pathname.replace(/\/$/u, "")}/data.xml`) },
  { country: "IE", hosts: /^(?:www\.)?irishstatutebook\.ie$/u, read: readIreland },
  { country: "CY", hosts: /^(?:www\.)?cylaw\.org$/u, read: readCyprus },
  { country: "RW", hosts: /^(?:www\.)?rwandalii\.org$/u, read: readRwandaLii },
  { country: "US", hosts: /^(?:www\.)?govinfo\.gov$/u, read: readUsCode },
  { country: "US", hosts: /^static\.case\.law$/u, read: readCapCase, accept: "application/json" },
  // Unofficial consolidated texts (Paragraf Lex) where the official gazette cannot be read.
  { country: "RS", hosts: /^(?:www\.)?paragraf\.rs$/u, read: (body, url) => readParagraf(body, url, "RS") },
  { country: "ME", hosts: /^(?:www\.)?paragraf\.me$/u, read: (body, url) => readParagraf(body, url, "ME") },
  { country: "BA", hosts: /^(?:www\.)?paragraf\.ba$/u, read: (body, url) => readParagraf(body, url, "BA") },
  // Canon law (Codex Iuris Canonici): the Holy See's site, for every chosen country (see CANON_HOSTS).
  { country: "VA", hosts: /^(?:www\.)?vatican\.va$/u, read: readCanonLaw }
];

// Official PDFs with a text layer (Liechtenstein, Malta): read as text, scans flagged.
const PDF_HOSTS: Array<{ country: string; hosts: RegExp }> = [
  { country: "LI", hosts: /^(?:www\.)?gesetze\.li$/u },
  { country: "MT", hosts: /^(?:www\.)?legislation\.mt$/u },
  // Portugal: the Diário da República's own PDFs (files.diariodarepublica.pt; the portal needs JavaScript).
  { country: "PT", hosts: /^files\.diariodarepublica\.pt$/u },
  // Laws of the Vatican City State (Governatorato): PDF downloads of vaticanstate.va.
  { country: "VA", hosts: /^(?:www\.)?vaticanstate\.va$/u }
];

// `country`: the chosen legal system (jurisdiction.ts); another country's source is refused.
export type NationalLawRequest = { url: string; unit?: string; date?: string; country?: string };

// The country of each official host this module reads (the readers below and the API branches).
const HOST_COUNTRIES: Array<[RegExp, string]> = [
  [/^(?:www\.)?boe\.es$/u, "ES"],
  [/^(?:www\.|ogd\.|data\.)?(?:ris\.)?bka\.gv\.at$/u, "AT"],
  [/^(?:data\.|www\.)?riksdagen\.se$/u, "SE"],
  [/^(?:data\.|www\.)?legilux\.public\.lu$/u, "LU"],
  [/^(?:www\.)?e-sbirka\.(?:gov\.)?cz$/u, "CZ"],
  [/^(?:www\.|data\.|opendata\.)?finlex\.fi$/u, "FI"],
  [/^(?:www\.)?legifrance\.gouv\.fr$/u, "FR"],
  [/^(?:www\.)?riigiteataja\.ee$/u, "EE"],
  [/^static\.slov-lex\.sk$/u, "SK"],
  [/^gzk\.rks-gov\.net$/u, "XK"],
  [/^(?:www\.)?pisrs\.si$/u, "SI"],
  [/^matsne\.gov\.ge$/u, "GE"],
  [/^judgments\.courts\.ie$/u, "IE"],
  [/^(?:www\.)?althingi\.is$/u, "IS"],
  [/^raw\.githubusercontent\.com$/u, "IS"]
];

// Canon law binds Catholics in every country: its source is read whatever legal system is chosen.
const CANON_HOSTS = /^(?:www\.)?vatican\.va$/u;

/** The country whose official source the address is, or null for a host this module does not read. */
export function nationalLawCountry(host: string): string | null {
  const name = host.toLowerCase();
  return HOST_COUNTRIES.find(([pattern]) => pattern.test(name))?.[1] ?? READERS.find((item) => item.hosts.test(name))?.country ?? PDF_HOSTS.find((item) => item.hosts.test(name))?.country ?? null;
}

export type NationalLawAnswer = {
  country: string;
  url: string;
  status: string;
  title?: string;
  version?: string;
  articles: NationalArticle[];
  // A PDF without a text layer: what to do instead of quoting it.
  note?: string;
};

export type NationalFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

/** The hosts this reader fetches, for the tool's description and the policy. */
export const NATIONAL_LAW_HOSTS = [...READERS.map((item) => item.country), ...PDF_HOSTS.map((item) => item.country), "ES", "AT", "SE", "LU", "CZ", "FI", "FR", "EE", "SK", "XK", "IS", "SI", "GE", "IE"];

function unitMatches(article: NationalArticle, unit: string): boolean {
  const wanted = unit
    // Longer words first: "art" would cut "Article 2" to "icle 2".
    .replace(/^(?:article|artículo|artikel|articolo|artigo|art\.?|madde|მუხლი|članak|člen|neni|canon|kanon|can\.?|section|sec\.|s\.|paragraph|para\.?|čl\.?|§)\s*/iu, "")
    .replace(/\.?\s*(?:člen|gr)\.?$|\.$/iu, "")
    .replace(/^\[(\w+)\]$/u, "$1")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  const own = article.unit.replace(/^(?:artikel|art\.?|§)\s*/iu, "").replace(/\s+/gu, " ").trim().toLowerCase();
  return own === wanted;
}

export async function readNationalLaw(request: NationalLawRequest, fetchImpl: NationalFetch = fetch as unknown as NationalFetch): Promise<NationalLawAnswer> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw new Error("NATIONAL_LAW_URL_INVALID");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && /legilux|dre\.pt/u.test(url.hostname))) throw new Error("NATIONAL_LAW_URL_INVALID");
  const host = url.hostname.toLowerCase();
  if (isBlockedHost(host) || isBlockedCountry(request.country)) throw new Error(BLOCKED_JURISDICTION_CODE);
  const sourceCountry = nationalLawCountry(host);
  if (!sourceCountry) throw new Error("NATIONAL_LAW_HOST_NOT_SUPPORTED");
  // Only the chosen legal system's sources: the other countries are off (user, 2026-11-08).
  if (request.country && !CANON_HOSTS.test(host) && request.country !== sourceCountry) throw new Error(`NATIONAL_LAW_COUNTRY_DISABLED:${sourceCountry}`);

  // Slovakia: Slov-Lex static portal. …/static/SK/ZZ/{year}/{number}/ is the history of versions: the one in
  // force on `date` (today when not given) is read; …/{YYYYMMDD}.html names a version directly.
  if (/^static\.slov-lex\.sk$/u.test(host)) {
    const act = /^\/static\/SK\/ZZ\/(\d{4})\/(\d+)\/(?:(\d{8})\.html)?$/u.exec(url.pathname);
    if (!act) throw new Error("NATIONAL_LAW_SK_ACT_REQUIRED");
    const base = `https://static.slov-lex.sk/static/SK/ZZ/${act[1]}/${act[2]}/`;
    const text = async (address: string): Promise<string> => {
      const reply = await fetchImpl(address, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(60_000) });
      if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
      return new TextDecoder().decode(await reply.arrayBuffer());
    };
    const versions = slovakVersions(await text(base));
    const day = request.date ?? (act[3] ? `${act[3].slice(0, 4)}-${act[3].slice(4, 6)}-${act[3].slice(6)}` : new Date().toISOString().slice(0, 10));
    const version = slovakVersionOn(versions, day);
    if (!version) return { country: "SK", url: base, status: "Slov-Lex: brak wersji obowiązującej w tym dniu", articles: [] };
    const reading = readSlovakia(await text(base + version.file), base + version.file, version);
    const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!)) : reading.articles.slice(0, 20);
    return { country: "SK", url: reading.source, status: reading.status, ...(reading.version ? { version: reading.version } : {}), articles };
  }

  // Slovenia: PISRS API. The act by its register id (…/pregledPredpisa?id=ZAKO1263 or …/api/rezultat/zbirka/id/ZAKO1263):
  // the newest consolidated version (NPB n), or the version named in the address (&npb=NPB 3, "Osnovni" = as published).
  if (/^(?:www\.)?pisrs\.si$/u.test(host)) {
    const id = url.searchParams.get("id") ?? /\/zbirka\/id\/([A-Z]+\d+)/u.exec(url.pathname)?.[1];
    if (!id || !/^[A-Z]{3,8}\d{1,8}$/u.test(id)) throw new Error("NATIONAL_LAW_SI_ID_REQUIRED");
    const get = async (address: string, accept: string): Promise<string> => {
      const reply = await fetchImpl(address, { headers: { accept }, signal: AbortSignal.timeout(60_000) });
      if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
      return new TextDecoder().decode(await reply.arrayBuffer());
    };
    const card = pisrsCard(await get(`https://pisrs.si/api/rezultat/zbirka/id/${id}`, "application/json"));
    const wanted = url.searchParams.get("npb");
    const version = (wanted ? card.versions.find((item) => item.name === wanted) : card.versions.filter((item) => item.html).at(-1)) ?? null;
    if (!version?.html) return { country: "SI", url: url.href, status: "PISRS: brak tekstu HTML tej wersji", title: card.title, articles: [] };
    const address = `https://pisrs.si/api/datoteke/integracije/${version.html}`;
    const reading = readPisrs(await get(address, "text/html"), address, card, version.name);
    const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!)) : reading.articles.slice(0, 20);
    return { country: "SI", url: address, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
  }

  // Georgia: Matsne. The act's page (…/ka/document/view/{id}); with `date` the consolidated publication of that day or the
  // last one before it (the sidebar lists them), else the publication in the address or the newest.
  if (/^matsne\.gov\.ge$/u.test(host)) {
    const id = /\/document\/view\/(\d+)/u.exec(url.pathname)?.[1];
    const language = /^\/en\//u.test(url.pathname) ? "en" : "ka";
    if (!id) throw new Error("NATIONAL_LAW_GE_DOCUMENT_REQUIRED");
    const page = async (publication?: string): Promise<string> => {
      const reply = await fetchImpl(`https://matsne.gov.ge/${language}/document/view/${id}${publication ? `?publication=${publication}` : ""}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(60_000) });
      if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
      return new TextDecoder().decode(await reply.arrayBuffer());
    };
    let html = await page(url.searchParams.get("publication") ?? undefined);
    const versions = matsneVersions(html);
    let version = versions.find((item) => item.publication === url.searchParams.get("publication")) ?? versions[0];
    if (request.date) {
      const chosen = versions.filter((item) => item.date <= request.date!).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (!chosen) return { country: "GE", url: url.href, status: "Matsne: brak publikacji skonsolidowanej na ten dzień", articles: [] };
      if (chosen.publication !== version?.publication) html = await page(chosen.publication);
      version = chosen;
    }
    const address = `https://matsne.gov.ge/${language}/document/view/${id}${version ? `?publication=${version.publication}` : ""}`;
    const reading = readMatsne(html, address, version);
    const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!)) : reading.articles.slice(0, 20);
    return { country: "GE", url: address, status: reading.status, ...(reading.version ? { version: reading.version } : {}), articles };
  }

  // Ireland, judgments: the page (court, judge, neutral citation, date) and the judgment's PDF, numbered paragraphs.
  if (/^judgments\.courts\.ie$/u.test(host)) {
    const id = /\/judgments\/(\d+)/u.exec(url.pathname)?.[1];
    if (!id) throw new Error("NATIONAL_LAW_IE_JUDGMENT_REQUIRED");
    const page = await fetchImpl(`https://judgments.courts.ie/judgments/${id}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(60_000) });
    if (!page.ok) throw new Error(`NATIONAL_LAW_SOURCE_${page.status}`);
    const meta = irishJudgmentPage(new TextDecoder().decode(await page.arrayBuffer()));
    if (!meta.pdf) return { country: "IE", url: url.href, status: "Courts Service: brak PDF orzeczenia", title: meta.title, articles: [] };
    const pdfUrl = `https://judgments.courts.ie${meta.pdf}`;
    const document = await fetchImpl(pdfUrl, { headers: { accept: "application/pdf" }, signal: AbortSignal.timeout(60_000) });
    if (!document.ok) throw new Error(`NATIONAL_LAW_SOURCE_${document.status}`);
    const reading = await readLegislationPdf(new Uint8Array(await document.arrayBuffer()));
    const title = `${meta.title}${meta.citation ? ` ${meta.citation}` : ""}`;
    const version = [meta.court, meta.judge, meta.delivered].filter(Boolean).join(", ");
    if (reading.kind === "SKAN") return { country: "IE", url: pdfUrl, status: "orzeczenie: PDF bez warstwy tekstowej", title, version, articles: [], note: reading.note };
    const all = judgmentParagraphs(reading.text);
    const articles = request.unit ? all.filter((article) => unitMatches(article, request.unit!)) : all.slice(0, 20);
    return { country: "IE", url: pdfUrl, status: "orzeczenie, tekst urzędowy (Courts Service of Ireland)", title, version, articles };
  }

  // Kosovo: Gazeta Zyrtare, the act by ActID: its text (ActDocumentDetail) and its status and amendments (ActDetail).
  if (/^gzk\.rks-gov\.net$/u.test(host)) {
    const id = /ActID=(\d+)/iu.exec(url.search)?.[1];
    if (!id) throw new Error("NATIONAL_LAW_XK_ACTID_REQUIRED");
    const get = async (page: string): Promise<string> => {
      const reply = await fetchImpl(`https://gzk.rks-gov.net/${page}.aspx?ActID=${id}`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(60_000) });
      if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
      return new TextDecoder().decode(await reply.arrayBuffer());
    };
    const reading = readKosovo(await get("ActDocumentDetail"), `https://gzk.rks-gov.net/ActDocumentDetail.aspx?ActID=${id}`, await get("ActDetail"));
    const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!)) : reading.articles.slice(0, 20);
    return { country: "XK", url: reading.source, status: reading.status, ...(reading.version ? { version: reading.version } : {}), articles };
  }

  // Iceland: the Law Collection refuses automated clients; the act ({year}.{nr}, or althingi.is/lagas/nuna/{YYYY}{NNN}.html)
  // is read from lagasafn-xml (unofficial, built from the Althingi's HTML), newest edition first.
  if (/^(?:www\.)?althingi\.is$/u.test(host) || /^raw\.githubusercontent\.com$/u.test(host)) {
    if (/^raw\./u.test(host) && !/^\/althingi-net\/lagasafn-xml\//u.test(url.pathname)) throw new Error("NATIONAL_LAW_HOST_NOT_SUPPORTED");
    const named = /(\d{4})\.(\d+)\.xml$/u.exec(url.pathname) ?? /\/(\d{4})(\d{3})\.html$/u.exec(url.pathname);
    if (!named) throw new Error("NATIONAL_LAW_IS_ACT_REQUIRED");
    const law = `${named[1]}.${Number(named[2])}`;
    const first = new Date().getUTCFullYear() - 1866;
    for (let session = first; session >= first - 4; session -= 1) {
      for (const letter of ["d", "c", "b", "a"]) {
        const address = `https://raw.githubusercontent.com/althingi-net/lagasafn-xml/master/data/xml/${session}${letter}/${law}.xml`;
        const reply = await fetchImpl(address, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(30_000) });
        if (!reply.ok) continue;
        const reading = readIceland(new TextDecoder().decode(await reply.arrayBuffer()), address, `${session}${letter}`);
        const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!.replace(/\.?\s*gr\.?$/u, ""))) : reading.articles.slice(0, 20);
        return { country: "IS", url: address, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
      }
    }
    return { country: "IS", url: url.href, status: "lagasafn-xml: ustawy nie znaleziono w ostatnich wydaniach", articles: [] };
  }

  // Spain: the BOE API by identifier and block ("BOE-A-2015-10565" + "a28").
  if (/^(?:www\.)?boe\.es$/u.test(host)) {
    // An ELI address (…/eli/es/l/2015/10/01/39/con) names no BOE id: the act's page does.
    let id = /BOE-[A-Z]-\d{4}-\d{1,6}/u.exec(url.href)?.[0];
    if (!id && /^\/eli\//u.test(url.pathname)) {
      const page = await fetchImpl(url.href, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(60_000) });
      if (page.ok) id = /BOE-[A-Z]-\d{4}-\d{1,6}/u.exec(new TextDecoder().decode(await page.arrayBuffer()))?.[0];
    }
    const block = request.unit ? `a${request.unit.replace(/\D+/gu, "")}` : /bloque\/([a-z0-9_-]+)/iu.exec(url.href)?.[1];
    if (!id || !block) throw new Error("NATIONAL_LAW_BOE_ID_AND_ARTICLE_REQUIRED");
    const article = await boeArticle(id, block, fetchImpl as never);
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
    if (!title || !request.unit) throw new Error("NATIONAL_LAW_AT_TITLE_AND_UNIT_REQUIRED");
    const number = request.unit.replace(/^(?:§|art\.?|artikel)\s*/iu, "").trim();
    const kind = /^art/iu.test(request.unit) ? "Artikel" : "Paragraph";
    const search = new URL("https://data.bka.gv.at/ris/api/v2.6/Bundesrecht");
    search.search = new URLSearchParams({ Applikation: "BrKons", Titel: title, "Abschnitt.Von": number, "Abschnitt.Bis": number, "Abschnitt.Typ": kind, ...(request.date ? { FassungVom: request.date } : {}) }).toString();
    const found = await fetchImpl(search.href, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    if (!found.ok) throw new Error(`NATIONAL_LAW_SOURCE_${found.status}`);
    const data = JSON.parse(new TextDecoder().decode(await found.arrayBuffer())) as { OgdSearchResult?: { OgdDocumentResults?: { OgdDocumentReference?: unknown } } };
    const raw = data.OgdSearchResult?.OgdDocumentResults?.OgdDocumentReference;
    const refs = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<{ Data?: { Dokumentliste?: { ContentReference?: { Urls?: { ContentUrl?: Array<{ DataType: string; Url: string }> } } } } }>;
    const xmlUrl = refs[0]?.Data?.Dokumentliste?.ContentReference?.Urls?.ContentUrl?.find((item) => item.DataType === "Xml")?.Url;
    if (!xmlUrl || !/^https:\/\/ogd\.ris\.bka\.gv\.at\//u.test(xmlUrl)) return { country: "AT", url: search.href, status: "RIS: normy nie znaleziono", articles: [] };
    const doc = await fetchImpl(xmlUrl, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(60_000) });
    if (!doc.ok) throw new Error(`NATIONAL_LAW_SOURCE_${doc.status}`);
    const reading = readAustria(new TextDecoder().decode(await doc.arrayBuffer()), xmlUrl);
    return { country: "AT", url: xmlUrl, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles: reading.articles };
  }

  // Sweden: Riksdagen open data, the act by its SFS number (…/dokument/sfs-1915-218 or any URL naming "1915:218").
  if (/^(?:data\.)?riksdagen\.se$/u.test(host) || /^(?:www\.)?riksdagen\.se$/u.test(host)) {
    const sfs = /sfs-(\d{4})-(\d+)/iu.exec(url.href) ?? /(\d{4}):(\d+)/u.exec(decodeURIComponent(url.href));
    if (!sfs) throw new Error("NATIONAL_LAW_SE_SFS_REQUIRED");
    const textUrl = `https://data.riksdagen.se/dokument/sfs-${sfs[1]}-${sfs[2]}.text`;
    const reply = await fetchImpl(textUrl, { headers: { accept: "text/plain" }, signal: AbortSignal.timeout(60_000) });
    if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
    const reading = readSweden(new TextDecoder().decode(await reply.arrayBuffer()), textUrl);
    const wanted = request.unit?.replace(/§/gu, "").replace(/\s+/gu, " ").trim();
    const articles = wanted ? reading.articles.filter((article) => article.unit === wanted || article.unit === wanted.replace(/\s+(?=[a-z]$)/u, "")) : reading.articles.slice(0, 20);
    return { country: "SE", url: textUrl, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
  }

  // Luxembourg: Legilux ELI of an act of the Journal officiel (…/eli/etat/leg/loi/2016/05/23/n2/jo):
  // SPARQL gives the Akoma Ntoso file of its French expression.
  if (/^(?:data\.|www\.)?legilux\.public\.lu$/u.test(host)) {
    const eli = /\/eli\/etat\/[^?#]+/u.exec(url.pathname)?.[0]?.replace(/\/(?:fr|de)(?:\/(?:html|pdf|xml|docx))?$/u, "");
    if (!eli) throw new Error("NATIONAL_LAW_LU_ELI_REQUIRED");
    const manifestation = `http://data.legilux.public.lu${eli}/fr/xml`;
    const query = `SELECT ?file WHERE { <${manifestation}> <http://data.legilux.public.lu/resource/ontology/jolux#isExemplifiedBy> ?file } LIMIT 1`;
    const sparql = await fetchImpl(`https://data.legilux.public.lu/sparqlendpoint?query=${encodeURIComponent(query)}`, { headers: { accept: "application/sparql-results+json" }, signal: AbortSignal.timeout(60_000) });
    if (!sparql.ok) throw new Error(`NATIONAL_LAW_SOURCE_${sparql.status}`);
    const file = (JSON.parse(new TextDecoder().decode(await sparql.arrayBuffer())) as { results?: { bindings?: Array<{ file?: { value: string } }> } }).results?.bindings?.[0]?.file?.value;
    if (!file || !/^https?:\/\/data\.legilux\.public\.lu\/filestore\//u.test(file)) return { country: "LU", url: manifestation, status: "Legilux: brak pliku XML tego aktu", articles: [] };
    const doc = await fetchImpl(file.replace(/^http:/u, "https:"), { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(60_000) });
    if (!doc.ok) throw new Error(`NATIONAL_LAW_SOURCE_${doc.status}`);
    const reading = readLuxembourg(new TextDecoder().decode(await doc.arrayBuffer()), file);
    const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!)) : reading.articles.slice(0, 20);
    return { country: "LU", url: file, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
  }

  // France: Légifrance blocks automated reads and its API needs a PISTE key; the codes are read
  // from the local index of DILA's LEGI dump (built once, see fr-legi.ts) by LEGITEXT/LEGIARTI id.
  if (/^(?:www\.)?legifrance\.gouv\.fr$/u.test(host)) {
    const cid = /LEGITEXT\d{12}/u.exec(url.href)?.[0];
    const articleId = /LEGIARTI\d{12}/u.exec(url.href)?.[0];
    if (!cid && !articleId) throw new Error("NATIONAL_LAW_FR_LEGI_ID_REQUIRED");
    const answer = await legiLookup({ ...(cid ? { cid } : {}), ...(articleId ? { articleId } : {}), ...(request.unit ? { num: request.unit } : {}), ...(request.date ? { date: request.date } : {}) });
    if (!answer) return { country: "FR", url: url.href, status: "indeks LEGI nie jest zbudowany", articles: [], note: "Francja czytana z lokalnego indeksu zrzutu LEGI (DILA, 1,2 GB, bez klucza): administrator buduje go w Ustawienia > Aplikacja > Prawo francuskie (LEGI); do tego czasu artykuł nie jest zweryfikowany" };
    if (!answer.code) return { country: "FR", url: url.href, status: "LEGI: kodeksu nie ma w indeksie (indeks obejmuje kodeksy obowiązujące)", articles: [] };
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
    const json = async (address: string) => {
      const reply = await fetchImpl(address, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
      return JSON.parse(new TextDecoder().decode(await reply.arrayBuffer())) as Record<string, unknown>;
    };
    let id = /\/akt\/(\d{6,})/u.exec(url.pathname)?.[1];
    const title = url.searchParams.get("pealkiri")?.trim();
    const date = request.date ?? new Date().toISOString().slice(0, 10);
    if (title) {
      type Hit = { globaalID: number; pealkiri: string; tekst: string; mitteJoustunud: boolean; kehtivus: { algus: string; lopp: string | null } };
      const hits: Hit[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const search = new URL("https://www.riigiteataja.ee/api/oigusakt_otsing/1/otsi");
        search.search = new URLSearchParams({ pealkiri: title, leht: String(page), limiit: "100" }).toString();
        const data = await json(search.href);
        const list = (data.aktid as Hit[] | undefined) ?? [];
        hits.push(...list);
        const meta = data.metaandmed as { kokku?: number } | undefined;
        if (!list.length || hits.length >= Number(meta?.kokku ?? 0)) break;
      }
      const exact = hits.filter((hit) => hit.pealkiri.toLocaleLowerCase("et") === title.toLocaleLowerCase("et") && hit.tekst === "terviktekst");
      const inForce = exact.filter((hit) => hit.kehtivus.algus <= date && (!hit.kehtivus.lopp || date <= hit.kehtivus.lopp));
      id = String((inForce.find((hit) => !hit.mitteJoustunud) ?? inForce[0])?.globaalID ?? "") || undefined;
      if (!id) return { country: "EE", url: url.href, status: "Riigi Teataja: brak wersji aktu obowiązującej w tym dniu", articles: [] };
    }
    if (!id) throw new Error("NATIONAL_LAW_EE_ACT_REQUIRED");
    const xmlUrl = `https://www.riigiteataja.ee/public-api/api/v1/akt/${id}/blob-xml`;
    const reply = await fetchImpl(xmlUrl, { headers: { accept: "application/xml" }, signal: AbortSignal.timeout(120_000) });
    if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
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
    if (!act) throw new Error("NATIONAL_LAW_FI_ACT_REQUIRED");
    const year = act[1]!;
    // The old Finlex page address writes the number as year + zero-padded number (19290228).
    const number = act[2]!.length === 8 && act[2]!.startsWith(year) ? String(Number(act[2]!.slice(4))) : act[2]!;
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
      if (!reply.ok && reply.status !== 404) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
      if (!reply.ok) continue;
      xml = new TextDecoder().decode(await reply.arrayBuffer());
      if (/<akomaNtoso\b/u.test(xml)) break;
      xml = "";
    }
    if (!xml) return { country: "FI", url: used, status: "Finlex: aktu nie znaleziono", articles: [] };
    const reading = readFinland(xml, used);
    const wanted = request.unit?.toLowerCase().replace(/§|pykälä|pykälän/gu, "").replace(/^(\d+\s?[a-z]?)\s*:\s*/u, "$1 luku ").replace(/\s+/gu, " ").trim();
    const articles = wanted ? reading.articles.filter((article) => article.unit === wanted || article.unit.replace(/^\S+ luku /u, "") === wanted) : reading.articles.slice(0, 20);
    const note = request.date && !act[4] ? "Finlex podaje najnowszą wersję ujednoliconą; wersję na dzień zdarzenia wskaż numerem wersji w adresie (…/fin@RRRRNNNN)" : undefined;
    return { country: "FI", url: used, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles, ...(note ? { note } : {}) };
  }

  // Czech Republic: e-Sbírka's public cache (no key): metadata of the version, then its fragments.
  if (/^(?:www\.)?e-sbirka\.(?:gov\.)?cz$/u.test(host)) {
    const act = /\/sb\/(\d{4})\/(\d+)(?:\/(\d{4}-\d{2}-\d{2}))?/u.exec(url.pathname);
    if (!act) throw new Error("NATIONAL_LAW_CZ_ACT_REQUIRED");
    const base = "https://e-sbirka.gov.cz/sbr-cache/dokumenty-sbirky/";
    const json = async (path: string) => {
      const reply = await fetchImpl(base + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      if (!reply.ok) throw new Error(`NATIONAL_LAW_SOURCE_${reply.status}`);
      return JSON.parse(new TextDecoder().decode(await reply.arrayBuffer())) as Record<string, unknown>;
    };
    const asked = `/sb/${act[1]}/${act[2]}${request.date ? `/${request.date}` : act[3] ? `/${act[3]}` : ""}`;
    const meta = await json(encodeURIComponent(asked));
    const version = typeof meta.staleUrl === "string" ? meta.staleUrl : asked;
    const fragments: Array<{ eli: string; kodTypuFragmentu: string; xhtml?: string }> = [];
    for (let page = 0; page < 40; page += 1) {
      const chunk = await json(`${encodeURIComponent(version)}/fragmenty?cisloStranky=${page}`);
      fragments.push(...((chunk.seznam as typeof fragments | undefined) ?? []));
      if (page + 1 >= Number(chunk.pocetStranek ?? 1)) break;
    }
    const reading = readCzech(fragments, meta as never, `https://e-sbirka.gov.cz${version}`);
    const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!)) : reading.articles.slice(0, 20);
    return { country: "CZ", url: reading.source, status: reading.status, ...(reading.title ? { title: reading.title } : {}), ...(reading.version ? { version: reading.version } : {}), articles };
  }

  const reader = READERS.find((item) => item.hosts.test(host));
  const pdf = PDF_HOSTS.find((item) => item.hosts.test(host));
  if (!reader && !pdf) throw new Error("NATIONAL_LAW_HOST_NOT_SUPPORTED");
  const ask = () => fetchImpl(reader?.address ? reader.address(url) : url.href, { headers: { accept: reader?.accept ?? "text/html, application/xml, application/pdf;q=0.9", "user-agent": "LexMachina/0.1 (legal research)" }, signal: AbortSignal.timeout(60_000) });
  let response = await ask();
  // A busy portal (gesetze-im-internet.de and narodne-novine.nn.hr answered 503 once and 200 right after,
  // vaticanstate.va 522 through Cloudflare): one retry.
  if ([429, 502, 503, 504, 522].includes(response.status)) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    response = await ask();
  }
  if (!response.ok) throw new Error(`NATIONAL_LAW_SOURCE_${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";

  if (pdf || /pdf/u.test(type) || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
    const reading = await readLegislationPdf(bytes);
    const country = pdf?.country ?? reader!.country;
    if (reading.kind === "SKAN") return { country, url: url.href, status: "PDF bez warstwy tekstowej", articles: [], note: reading.note };
    const text = reading.text;
    // The article asked for, by its heading in the text ("Art. 12", "Madde 12", "12."): the passage up to the next one.
    const articles: NationalArticle[] = [];
    if (request.unit) {
      const number = request.unit.replace(/^(?:article|articolo|artikel|artículo|artigo|art\.?|madde|članak|neni)\s*/iu, "").trim().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const heads = "Art\\.|Articolo|Artikel|Article|Artículo|Artigo|MADDE|Madde|Članak|Neni";
      const start = new RegExp(`(?:^|\\n)\\s*(?:${heads})\\s*${number}\\b`, "u").exec(text);
      if (start) {
        const rest = text.slice(start.index + start[0].length);
        const next = new RegExp(`\\n\\s*(?:${heads})\\s*\\d`, "u").exec(rest);
        articles.push({ unit: request.unit, heading: start[0].trim(), text: (start[0] + rest.slice(0, next ? next.index : 6000)).trim(), amendments: [] });
      } else if (/^\d+[A-Z]?$/u.test(number)) {
        // Articles numbered "74. Save as …" without a word before the number (Malta, Ireland), possibly after a
        // marginal note on the same line ("Language of Laws. 74. Save …"), up to the next number.
        // A table of contents also lists "74. Language of Laws.": of all the places, the longest passage is the article.
        const following = /^\d+$/u.test(number) ? String(Number(number) + 1) : "";
        const passages = [...text.matchAll(new RegExp(`(?:^|\\n)(?:[^\\n]{0,80}\\.[ \\t]+)?${number}\\.[ \\t]+\\S`, "gu"))].map((bare) => {
          const rest = text.slice(bare.index);
          const next = following ? new RegExp(`\\n(?:[^\\n]{0,80}\\.[ \\t]+)?${following}\\.[ \\t]+\\S`, "u").exec(rest.slice(1)) : null;
          return rest.slice(0, next ? next.index + 1 : 6000).trim();
        });
        const best = passages.sort((a, b) => b.length - a.length)[0];
        if (best) articles.push({ unit: request.unit, heading: `${number}.`, text: best.slice(0, 6000), amendments: [] });
      }
    }
    return { country, url: url.href, status: "tekst z urzędowego PDF", articles, ...(reading.kind === "MIESZANY" ? { note: reading.note } : {}), ...(request.unit && !articles.length ? { note: "artykułu nie znaleziono w tekście PDF" } : {}) };
  }

  // The page's charset: the header, else its <meta> (pages served as a bare "text/html").
  const declared = /charset=([\w-]+)/iu.exec(type)?.[1] ?? /charset=["']?([\w-]+)/iu.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 2048)))?.[1] ?? "utf-8";
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(/iso-8859-1/iu.test(declared) ? "latin1" : declared);
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  const body = decoder.decode(bytes);
  const reading = reader!.read(body, url.href);
  // RwandaLII: some acts (the Constitution) have no text on the page, only the source PDF.
  if (reader!.country === "RW" && !reading.articles.length && /\/source\.pdf"/u.test(body) && !/\/source\.pdf$/u.test(url.pathname)) {
    return readNationalLaw({ ...request, url: `${url.origin}${url.pathname.replace(/\/$/u, "")}/source.pdf` }, fetchImpl);
  }
  const articles = request.unit ? reading.articles.filter((article) => unitMatches(article, request.unit!)) : reading.articles.slice(0, 20);
  return {
    country: reading.country,
    url: url.href,
    status: reading.status,
    ...(reading.title ? { title: reading.title } : {}),
    ...(reading.version ? { version: reading.version } : {}),
    articles
  };
}
