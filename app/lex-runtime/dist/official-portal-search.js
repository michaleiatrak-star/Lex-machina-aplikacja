import { interpretationSignaturesInLine } from "./interpretation-verifier.js";
import { signaturesIn } from "./court-of-signature.js";
import { assertPublicWebSearchQuery, classifyWebSearchHits, hostOf } from "./web-search.js";
const CASE_LAW = /(?<![\p{L}])(?:orzecznictw\p{L}*|orzecze\p{L}*|orzeczeń|wyrok\p{L}*|uchwał\p{L}*\s+(?:SN|NSA|składu|siedmiu|pełnego)|postanowieni\p{L}*\s+(?:SN|NSA|sądu)|sygnatur\p{L}*|lini\p{L}*\s+orzecznicz\p{L}*|precedens\p{L}*|jak\s+(?:orzekaj\p{L}*|rozstrzygaj\p{L}*|interpretuj\p{L}*)\s+sądy)(?![\p{L}])/iu;
const INTERPRETATION = /(?<![\p{L}])(?:interpretacj\p{L}*|objaśnieni\p{L}*\s+podatkow\p{L}*|KIS|Krajow\p{L}*\s+Informacj\p{L}*\s+Skarbow\p{L}*|stanowisk\p{L}*\s+(?:organu|ministra|MF|ZUS)|wiążąc\p{L}*\s+informacj\p{L}*\s+stawkow\p{L}*|WIS)(?![\p{L}])/u;
const AUTHORITY = /(?<![\p{L}])(?:decyzj\p{L}*\s+(?:Prezesa\s+)?(?:UODO|UOKiK|URE|UKE|KNF)|UODO|UOKiK|KIO|Krajow\p{L}*\s+Izb\p{L}*\s+Odwoławcz\p{L}*|Trybunał\p{L}*\s+Konstytucyjn\p{L}*|TK)(?![\p{L}])/u;
export const PORTALS = {
    CASE_LAW: ["orzeczenia.ms.gov.pl", "sn.pl", "orzeczenia.nsa.gov.pl"],
    INTERPRETATION: ["eureka.mf.gov.pl", "zus.pl", "podatki.gov.pl"],
    AUTHORITY: ["uodo.gov.pl", "uokik.gov.pl", "orzeczenia.uzp.gov.pl", "ipo.trybunal.gov.pl"]
};
/** Which kinds of documents the question asks about (none: no search). */
export function portalTopics(question) {
    const topics = [];
    if (CASE_LAW.test(question))
        topics.push("CASE_LAW");
    if (INTERPRETATION.test(question))
        topics.push("INTERPRETATION");
    if (AUTHORITY.test(question))
        topics.push("AUTHORITY");
    return topics;
}
// Words that carry no legal topic; the query keeps the legal phrase of the question.
const FILLER = new Set("a albo ale aby bo by być co czy dla do gdy i ich iż jak jaki jakie jakiego jakim je jego jej jest już ktoś która które którego który lub ma mam mi mnie mogę może można moja moje mój na nad nam nas nie o od oraz po pod proszę przez przy się są ta tak także tam te tego tej ten to tu tym w we wszystko z za ze że żeby podaj znajdź wyszukaj poszukaj wskaż przytocz sprawdź orzecznictwo orzeczenia orzeczeń wyroki wyrok wyroku interpretacje interpretacja interpretacji temat dotyczące dotyczący dotycząca sprawie sprawy"
    .split(" "));
/** The query phrase: the question's legal words, without fillers, PII tokens, amounts and dates. */
export function portalPhrase(question) {
    const words = question
        .replace(/\[PII:[^\]]*\]|\{\{[^}]*\}\}/gu, " ")
        .replace(/\d(?:[\d.,]|\s(?=\d))*\s*(?:zł|złotych|pln|eur|euro|usd|%)/giu, " ")
        .replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/gu, " ")
        .split(/[^\p{L}\d.§/-]+/u)
        .map((word) => word.replace(/^[.,/-]+|[.,/-]+$/gu, ""))
        .filter((word) => word.length > 1 && !FILLER.has(word.toLocaleLowerCase("pl")));
    return words.slice(0, 10).join(" ");
}
/** 2–3 portal queries per topic (the topic's portals, at most 3 in all per topic) and one open query. */
export function portalQueries(question, limit = 6) {
    const topics = portalTopics(question);
    const phrase = portalPhrase(question);
    if (!topics.length || phrase.split(" ").length < 2)
        return [];
    const queries = [];
    for (const topic of topics)
        for (const site of PORTALS[topic].slice(0, 3))
            queries.push({ topic, site, query: `${phrase} site:${site}` });
    // Commentary, law firms and portals name signatures the registries then confirm (user 2026-11-15).
    queries.push({ topic: topics[0], site: null, query: phrase });
    return queries
        .filter((item) => {
        try {
            assertPublicWebSearchQuery(item.query);
            return true;
        }
        catch {
            return false;
        }
    })
        .slice(0, limit);
}
const OFFICIAL_HOSTS = new Set(Object.values(PORTALS).flat());
export function officialHost(url) {
    const host = hostOf(url);
    return [...OFFICIAL_HOSTS].some((official) => host === official || host.endsWith(`.${official}`)) || /\.gov\.pl$/u.test(host);
}
/** The queries in parallel; hits on official portals first, the same address once. */
export async function searchOfficialPortals(question, search, timeoutMs = 20_000) {
    const queries = portalQueries(question);
    if (!queries.length)
        return { queries, hits: [] };
    const answered = await Promise.all(queries.map(async (item) => {
        try {
            const hits = await Promise.race([
                search(item.query, 8),
                new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs))
            ]);
            return classifyWebSearchHits(hits).map((hit) => ({ ...hit, topic: item.topic, official: officialHost(hit.url) }));
        }
        catch {
            return [];
        }
    }));
    const seen = new Set();
    const hits = answered
        .flat()
        .filter((hit) => !seen.has(hit.url) && Boolean(seen.add(hit.url)))
        .sort((a, b) => Number(b.official) - Number(a.official));
    return { queries, hits: hits.slice(0, 24) };
}
/** Signatures of rulings and interpretations the hits name (title, snippet, address). */
export function portalSignatures(hits) {
    const text = hits.map((hit) => `${hit.title}\n${hit.snippet}\n${decodeURIComponent(hit.url)}`).join("\n");
    const cases = [...new Set(signaturesIn(text).map((item) => item.signature))];
    const interpretations = [...new Set(text.split("\n").flatMap((line) => interpretationSignaturesInLine(line)))];
    return { cases: cases.slice(0, 12), interpretations: interpretations.slice(0, 8) };
}
/** The section for the model: official hits first, then leads, each with what to verify. */
export function portalSearchPrompt(result) {
    if (!result.hits.length)
        return "";
    const line = (hit) => {
        const signatures = hit.leads?.signatures?.map((item) => `${item.signature} → ${item.verifyWith}`).join("; ");
        return `- ${hit.title} — ${hit.url}${hit.snippet ? `\n  ${hit.snippet.replace(/\s+/g, " ").slice(0, 300)}` : ""}${signatures ? `\n  Sygnatury do sprawdzenia: ${signatures}` : ""}`;
    };
    const official = result.hits.filter((hit) => hit.official);
    const leads = result.hits.filter((hit) => !hit.official);
    return [
        "[WYSZUKIWANIE NA PORTALACH URZĘDOWYCH — aplikacja przed odpowiedzią]",
        `Zapytania: ${result.queries.map((item) => item.query).join(" | ")}`,
        ...(official.length ? ["Trafienia na portalach sądów i organów (adres urzędowego dokumentu; treść i tezę potwierdź narzędziem rejestru przed powołaniem):", ...official.map(line)] : []),
        ...(leads.length ? ["Tropy (komentarze, kancelarie, portale — tylko sygnatury i daty do sprawdzenia w rejestrach, nigdy źródło tezy):", ...leads.map(line)] : []),
        "[Sygnatura niepotwierdzona w rejestrze pozostaje ⚠️ [NIEWERYFIKOWANE]; tezy i cytaty wyłącznie z odczytanego tekstu urzędowego.]"
    ].join("\n");
}
// The search the server configures (http/server.ts); none in tests and validations: no queries.
let configured = null;
export function configurePortalSearch(search) {
    configured = search;
}
export function currentPortalSearch() {
    if (["off", "0", "false"].includes((process.env.LEX_PORTAL_SEARCH ?? "").trim().toLowerCase()))
        return null;
    return configured;
}
