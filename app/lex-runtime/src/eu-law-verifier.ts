import { claimedUnitState, superscriptsAsCaret } from "./legal-source-verifier.js";
import type { VerificationRecord } from "./verification-ledger.js";

// EU law (regulations, directives) at its official source: the act by CELEX in Cellar, in force
// or not, its newest consolidated version applicable on the checked date, the cited article's
// Polish text from that version. Before, "art. 6 RODO" was DENIED (UNKNOWN_LEGAL_ACT) and the
// EUR-Lex connector gave metadata only, no article text (legal-cite-pl returns the article).

export type EuFetch = (input: string, init?: RequestInit) => Promise<Response>;

export type EuAct = { celex: string; name: string };

const ALIASES: Array<[string, string, string[]]> = [
  ["32016R0679", "Rozporządzenie (UE) 2016/679 (RODO)", ["rodo", "gdpr", "ogólne rozporządzenie o ochronie danych"]],
  ["32022R2065", "Rozporządzenie (UE) 2022/2065 (DSA)", ["dsa", "akt o usługach cyfrowych"]],
  ["32022R1925", "Rozporządzenie (UE) 2022/1925 (DMA)", ["dma", "akt o rynkach cyfrowych"]],
  ["32024R1689", "Rozporządzenie (UE) 2024/1689 (AI Act)", ["ai act", "aia", "akt o sztucznej inteligencji"]],
  ["32022L2555", "Dyrektywa (UE) 2022/2555 (NIS2)", ["nis2", "nis 2"]],
  ["32022R0868", "Rozporządzenie (UE) 2022/868 (DGA)", ["dga", "akt w sprawie zarządzania danymi"]],
  ["32022R2554", "Rozporządzenie (UE) 2022/2554 (DORA)", ["dora"]],
  ["32023R2854", "Rozporządzenie (UE) 2023/2854 (Data Act)", ["data act", "akt w sprawie danych"]],
  ["32014R0910", "Rozporządzenie (UE) nr 910/2014 (eIDAS)", ["eidas"]],
  ["32008L0048", "Dyrektywa 2008/48/WE (kredyt konsumencki)", ["ccd"]],
  ["32023L2225", "Dyrektywa (UE) 2023/2225 (kredyt konsumencki)", ["ccd2", "ccd 2"]],
  ["31993L0013", "Dyrektywa 93/13/EWG (nieuczciwe warunki w umowach konsumenckich)", ["dyrektywa 93/13"]],
  ["32008R0593", "Rozporządzenie (WE) nr 593/2008 (Rzym I)", ["rzym i", "rome i"]],
  ["32007R0864", "Rozporządzenie (WE) nr 864/2007 (Rzym II)", ["rzym ii", "rome ii"]],
  ["32012R1215", "Rozporządzenie (UE) nr 1215/2012 (Bruksela I bis)", ["bruksela i bis", "brussels i bis"]]
];

const fold = (value: string) => value.toLocaleLowerCase("pl").replace(/\s+/gu, " ").trim();

/**
 * The EU act a reference names: an abbreviation (RODO, AI Act, DSA…), a CELEX number, or a
 * regulation/directive by its number ("rozporządzenie (UE) 2016/679", "dyrektywy 2008/48/WE",
 * "rozporządzenia (WE) nr 593/2008"). null for anything else (Polish acts stay with ELI).
 */
export function euAct(reference: string): EuAct | null {
  const text = fold(reference);
  const celex = /\b([0-9]\d{4}[RLD]\d{4})\b/iu.exec(reference)?.[1]?.toUpperCase();
  if (celex && celex.startsWith("3")) return { celex, name: ALIASES.find(([id]) => id === celex)?.[1] ?? `CELEX ${celex}` };
  for (const [id, name, names] of ALIASES) {
    if (names.some((alias) => new RegExp(`(?<![\\p{L}\\d])${alias.replace(/[.*+?^$()|[\]\\]/gu, "\\$&")}(?![\\p{L}\\d])`, "u").test(text))) return { celex: id, name };
  }
  const numbered = /(rozporządz\p{L}*|dyrektyw\p{L}*|decyzj\p{L}*)[^0-9]{0,80}?(?:\((?:ue|we|ewg|euratom)\)\s*)?(?:nr\s*)?(\d{2,4})\/(\d{1,4})(?:\/(?:ue|we|ewg))?/u.exec(text);
  if (!numbered) return null;
  const type = numbered[1]!.startsWith("rozporządz") ? "R" : numbered[1]!.startsWith("dyrektyw") ? "L" : "D";
  const [first, second] = [numbered[2]!, numbered[3]!];
  // 2016/679 and 2008/48 (year first); nr 593/2008 and 1215/2012 (number first); 93/13 (two-digit year).
  const yearFirst = first.length === 4 && Number(first) >= 1958 && !(second.length === 4 && Number(second) >= 1958);
  const year = yearFirst ? Number(first) : second.length === 4 ? Number(second) : first.length === 2 ? 1900 + Number(first) : NaN;
  const number = yearFirst ? second : second.length === 4 ? first : second;
  if (!Number.isFinite(year) || year < 1958) return null;
  const id = `3${year}${type}${number.padStart(4, "0")}`;
  return { celex: id, name: ALIASES.find(([alias]) => alias === id)?.[1] ?? reference.trim().slice(0, 120) };
}

const SPARQL = "https://publications.europa.eu/webapi/rdf/sparql";
const CELLAR = "http://publications.europa.eu/resource/celex/";
const TIMEOUT_MS = 40_000;

async function sparql(fetcher: EuFetch, query: string): Promise<Array<Record<string, { value: string }>>> {
  const response = await fetcher(SPARQL, {
    method: "POST",
    headers: { Accept: "application/sparql-results+json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ query }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`CELLAR_SPARQL_HTTP_${response.status}`);
  const data = (await response.json()) as { results?: { bindings?: Array<Record<string, { value: string }>> } };
  return data.results?.bindings ?? [];
}

export type EuActState = {
  inForce: boolean | null;
  endOfValidity: string | null;
  title: string | null;
  // Consolidated versions by their date (02016R0679-20160504 -> 2016-05-04), oldest first.
  consolidated: Array<{ celex: string; date: string }>;
};

export async function euActState(fetcher: EuFetch, celex: string): Promise<EuActState | null> {
  if (!/^3\d{4}[RLD]\d{4}$/u.test(celex)) return null;
  const base = await sparql(
    fetcher,
    `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
SELECT (SAMPLE(?f) AS ?inforce) (SAMPLE(?e) AS ?end) (SAMPLE(?t) AS ?title) WHERE {
  ?work cdm:resource_legal_id_celex "${celex}"^^xsd:string .
  OPTIONAL { ?work cdm:resource_legal_in-force ?f . }
  OPTIONAL { ?work cdm:resource_legal_date_end-of-validity ?e . }
  OPTIONAL { ?x cdm:expression_belongs_to_work ?work ;
    cdm:expression_uses_language <http://publications.europa.eu/resource/authority/language/POL> ;
    cdm:expression_title ?t . }
}`
  );
  const row = base[0];
  if (!row || (!row.inforce && !row.title && !row.end)) return null;
  const versions = await sparql(
    fetcher,
    `PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?c WHERE { ?w cdm:resource_legal_id_celex ?c . FILTER(STRSTARTS(STR(?c), "0${celex.slice(1)}-")) } LIMIT 200`
  );
  const consolidated = versions
    .map((item) => item.c?.value ?? "")
    .map((value) => /^(0\d{4}[RLD]\d{4})-(\d{4})(\d{2})(\d{2})$/u.exec(value))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ celex: match[0], date: `${match[2]}-${match[3]}-${match[4]}` }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const end = row.end?.value && !row.end.value.startsWith("9999") ? row.end.value.slice(0, 10) : null;
  const inForce = row.inforce?.value === "true" || row.inforce?.value === "1" ? true : row.inforce?.value === "false" || row.inforce?.value === "0" ? false : null;
  return { inForce, endOfValidity: end, title: row.title?.value ?? null, consolidated };
}

function readable(html: string): string {
  return superscriptsAsCaret(html)
    .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
    .replace(/<\s*(?:br\b[^>]*|\/?(?:p|div|li|tr|td|th|h[1-6]|table)\b[^>]*)>/giu, "\n")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .normalize("NFKC")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}

// The article's element ("<div class=\"eli-subdivision\" id=\"art_6\">") up to its matching end.
// Older consolidated texts have no such element: the article runs from its title paragraph
// ("<p class=\"title-article-norm\">Artykuł 25</p>") to the next article's title or an annex.
const ARTICLE_TITLE = /<p\b[^>]*class="(?:title-article-norm|ti-art|oj-ti-art)"[^>]*>\s*Artykuł\s+(\d+[a-z]*)\s*<\/p>/giu;

function articleByTitle(html: string, article: string): string | null {
  const titles = [...html.matchAll(ARTICLE_TITLE)];
  const index = titles.findIndex((match) => match[1]!.toLowerCase() === article);
  if (index < 0) return null;
  const start = titles[index]!.index!;
  const next = titles[index + 1]?.index ?? html.length;
  const annex = html.slice(start, next).search(/<p\b[^>]*class="(?:title-annex-1|doc-ti|oj-doc-ti)"/u);
  return readable(html.slice(start, annex > 0 ? start + annex : next)).slice(0, 12_000);
}

export function euArticle(html: string, article: string): string | null {
  const start = html.search(new RegExp(`<div\\b[^>]*\\bid="art_${article.replace(/[^\da-z]/giu, "")}"`, "u"));
  if (start < 0) return articleByTitle(html, article.toLowerCase());
  let depth = 0;
  const tags = /<\/?div\b[^>]*>/giu;
  tags.lastIndex = start;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return readable(html.slice(start, tag.index + tag[0].length)).slice(0, 12_000);
  }
  return null;
}

// The act's rule on entry into force and application ("stosuje się od … z wyjątkiem …",
// AI Act art. 113): an article cited from such an act may apply only from a later date.
export function euApplicationRule(html: string): string | null {
  const subdivisions = [...html.matchAll(/<div\b[^>]*class="eli-subdivision"[^>]*\bid="art_(\d+[a-z]*)"/gu)].map((match) => match[1]!);
  const ids = subdivisions.length ? subdivisions : [...html.matchAll(ARTICLE_TITLE)].map((match) => match[1]!);
  for (const id of ids.slice(-3).reverse()) {
    const text = euArticle(html, id);
    if (text && /wejście w życie/iu.test(text) && /stosuje się od/iu.test(text) && /(?:z wyjątkiem|jednak|stosuje się od dnia \d)/iu.test(text)) {
      return text.slice(0, 2_000);
    }
  }
  return null;
}

// A version's text does not change (a new consolidation is a new CELEX): kept for the session,
// a few acts at a time (the AI Act alone is ~1 MB and takes tens of seconds to fetch).
const TEXTS = new Map<string, Promise<string>>();

function actText(fetcher: EuFetch, version: string): Promise<string> {
  const hit = TEXTS.get(version);
  if (hit) return hit;
  const text = (async () => {
    const response = await fetcher(`${CELLAR}${version}`, {
      headers: { Accept: "application/xhtml+xml", "Accept-Language": "pol" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS * 2)
    });
    if (!response.ok) throw new Error(`CELLAR_TEXT_HTTP_${response.status}`);
    return response.text();
  })();
  TEXTS.set(version, text);
  text.catch(() => TEXTS.delete(version));
  while (TEXTS.size > 6) TEXTS.delete(TEXTS.keys().next().value!);
  return text;
}

export type EuVerification = {
  record: VerificationRecord;
  act: EuAct;
  version: string;
  applicationRule: string | null;
  laterVersions: string[];
};

/** The cited article of an EU act, verified at Cellar/EUR-Lex on `today`. */
export async function verifyEuArticle(args: {
  fetcher: EuFetch;
  claim: string;
  act: EuAct;
  toolCallId: string;
  today: string;
  now: string;
}): Promise<EuVerification> {
  const article = /\bart(?:ykuł\p{L}*|\.)?\s*(\d+[a-z]*)/iu.exec(superscriptsAsCaret(args.claim))?.[1]?.toLowerCase() ?? null;
  const state = await euActState(args.fetcher, args.act.celex);
  const applicable = (state?.consolidated ?? []).filter((version) => version.date <= args.today);
  const version = applicable.at(-1)?.celex ?? args.act.celex;
  const laterVersions = (state?.consolidated ?? []).filter((item) => item.date > args.today).map((item) => item.celex);
  const sourceUrl = `https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:${version}`;
  const base = {
    claim: args.claim,
    kind: "statute" as const,
    sourceUrl,
    sourceTier: "R1" as const,
    fetchedAt: args.now,
    toolCallId: args.toolCallId,
    verificationMethod: "web_fetch" as const,
    sourceFormat: "TEXT" as const
  };
  const unverified = (evidence: string): EuVerification => ({
    record: { ...base, status: "UNVERIFIED", evidence },
    act: args.act,
    version,
    applicationRule: null,
    laterVersions
  });
  if (!state) return unverified(`Cellar nie zna aktu CELEX ${args.act.celex}.`);
  if (state.inForce === false) return unverified(`Akt nie obowiązuje${state.endOfValidity ? ` (koniec obowiązywania ${state.endOfValidity})` : ""}: nie powołuj go jako prawa obowiązującego.`);
  if (!article) return unverified("Powołanie nie wskazuje artykułu.");
  const html = await actText(args.fetcher, version);
  const text = euArticle(html, article);
  if (!text) return unverified(`W tekście ${version} nie ma artykułu ${article}.`);
  const unit = claimedUnitState(args.claim.replace(/\bust\.?\s*(\d)/u, "ust. $1"), text, []);
  if (/^\s*Artykuł\s+\S+\s*\(?(?:uchylony|skreślony)/iu.test(text)) return unverified(`Artykuł ${article} jest uchylony.\n${text.slice(0, 400)}`);
  if (unit.state === "MISSING") return unverified(`Artykuł ${article} nie ma powołanej jednostki.\n${text.slice(0, 600)}`);
  const header = version.startsWith("0")
    ? `[Wersja skonsolidowana ${version} (EUR-Lex/Cellar); tekst skonsolidowany ma charakter dokumentacyjny, wiążący jest tekst w Dz.U. UE.]`
    : `[Tekst ogłoszony ${version} (EUR-Lex/Cellar); brak wersji skonsolidowanej na ten dzień.]`;
  return {
    record: { ...base, status: "VERIFIED", evidence: `${header}\n${text}`.slice(0, 12_000) },
    act: args.act,
    version,
    applicationRule: euApplicationRule(html),
    laterVersions
  };
}
