import { interpretationSignaturesInLine } from "./interpretation-verifier.js";
import { signaturesIn } from "./court-of-signature.js";
import { assertPublicWebSearchQuery, classifyWebSearchHits, hostOf, type ClassifiedWebSearchHit, type WebSearchHit } from "./web-search.js";

/**
 * Searching the official portals before the model answers (user 2026-11-15): a question about
 * case law, interpretations or an authority's decisions sends, in parallel with SAOS and sn.pl,
 * 2–3 queries aimed at the courts' and the authorities' own portals (site:orzeczenia.ms.gov.pl,
 * site:sn.pl, site:orzeczenia.nsa.gov.pl; site:eureka.mf.gov.pl, site:zus.pl; site:uodo.gov.pl,
 * …) and one open query. A hit on an official portal points straight at the official document;
 * commentary, law firms and portals are leads: their signatures go to the registries to check.
 */

export type PortalTopic = "CASE_LAW" | "CONSTITUTIONAL" | "DISCIPLINARY" | "INTERPRETATION" | "AUTHORITY";

export type PortalQuery = { topic: PortalTopic; query: string; site: string | null };

const TOPIC_SIGNALS: Record<PortalTopic, RegExp> = {
  CASE_LAW:
    /(?<![\p{L}])(?:orzecznictw\p{L}*|orzecze\p{L}*|orzeczeń|wyrok\p{L}*|uchwał\p{L}*\s+(?:SN|NSA|składu|siedmiu|pełnego)|postanowieni\p{L}*\s+(?:SN|NSA|sądu)|sygnatur\p{L}*|lini\p{L}*\s+orzecznicz\p{L}*|precedens\p{L}*|jak\s+(?:orzekaj\p{L}*|rozstrzygaj\p{L}*|interpretuj\p{L}*)\s+sądy)(?![\p{L}])/iu,
  CONSTITUTIONAL: /(?<![\p{L}])(?:TK|Trybunał\p{L}*\s+Konstytucyjn\p{L}*|[Nn]iekonstytucyjn\p{L}*|[Nn]iezgodn\p{L}*\s+z\s+Konstytucj\p{L}*|[Ss]karg\p{L}*\s+konstytucyjn\p{L}*)(?![\p{L}])/u,
  DISCIPLINARY: /(?<![\p{L}])(?:dyscyplinarn\p{L}*|odpowiedzialnoś\p{L}*\s+zawodow\p{L}*|etyk\p{L}*\s+(?:zawod|adwokack|radc|lekarsk)\p{L}*|sąd\p{L}*\s+lekarsk\p{L}*|rzeczni\p{L}*\s+(?:dyscyplinarn|odpowiedzialności)\p{L}*|WSD|OSD)(?![\p{L}])/iu,
  INTERPRETATION:
    /(?<![\p{L}])(?:[Ii]nterpretacj\p{L}*|[Oo]bjaśnieni\p{L}*|KIS|Krajow\p{L}*\s+Informacj\p{L}*\s+Skarbow\p{L}*|[Ss]tanowisk\p{L}*\s+(?:organu|ministra|MF|ZUS|PIP|UZP|GUNB)|[Oo]pini\p{L}*\s+prawn\p{L}*\s+(?:UZP|Prezesa)|[Ww]iążąc\p{L}*\s+informacj\p{L}*|WIS|WIA|WIT)(?![\p{L}])/u,
  AUTHORITY:
    /(?<![\p{L}])(?:[Dd]ecyzj\p{L}*|[Kk]ar\p{L}*\s+(?:nałożon|administracyjn|pieniężn)\p{L}*|UODO|UOKiK|URE|UKE|KNF|KRRiT|KIO|RIO|RPO|UTK|GIF|PIP|Rzeczni\p{L}*\s+(?:Finansow|Praw\s+Obywatelskich)\p{L}*|Krajow\p{L}*\s+Izb\p{L}*\s+Odwoławcz\p{L}*|[Rr]ozstrzygnięci\p{L}*\s+nadzorcz\p{L}*)(?![\p{L}])/u
};

/**
 * The portals of each kind (checked 2026-11-15; trybunal.gov.pl, decyzje.uokik.gov.pl, krrit.gov.pl,
 * gov.pl/web/… do not answer from the test environment but are the authorities' own addresses).
 * "when": the portal is chosen first when the question names its field; the rest fill up to three.
 */
export type Portal = { site: string; topic: PortalTopic; when?: RegExp };

export const PORTALS: Portal[] = [
  { topic: "CASE_LAW", site: "orzeczenia.ms.gov.pl" },
  { topic: "CASE_LAW", site: "sn.pl" },
  { topic: "CASE_LAW", site: "orzeczenia.nsa.gov.pl" },
  { topic: "CONSTITUTIONAL", site: "ipo.trybunal.gov.pl" },
  { topic: "CONSTITUTIONAL", site: "trybunal.gov.pl" },
  // Disciplinary courts of the professions: their own registers (DR-12, odpowiedzialność dyscyplinarna zawodów).
  { topic: "DISCIPLINARY", site: "wsd.adwokatura.pl", when: /adwokat|WSD/iu },
  { topic: "DISCIPLINARY", site: "kirp.pl", when: /radc|OSD|OIRP|KIRP/iu },
  { topic: "DISCIPLINARY", site: "sn.pl", when: /sędzi|prokurator|kasacj|SN|Sąd\p{L}*\s+Najwyższ/iu },
  { topic: "DISCIPLINARY", site: "nil.org.pl", when: /lekar|lekarsk/iu },
  { topic: "DISCIPLINARY", site: "komornik.pl", when: /komorni/iu },
  { topic: "DISCIPLINARY", site: "krn.org.pl", when: /notariu/iu },
  { topic: "DISCIPLINARY", site: "pibr.org.pl", when: /biegł\p{L}*\s+rewident/iu },
  { topic: "DISCIPLINARY", site: "piib.org.pl", when: /inżynier|budownictw/iu },
  { topic: "DISCIPLINARY", site: "izbaarchitektow.pl", when: /architekt/iu },
  { topic: "DISCIPLINARY", site: "kidp.pl", when: /doradc\p{L}*\s+podatkow/iu },
  { topic: "DISCIPLINARY", site: "nipip.pl", when: /pielęgniar|położn/iu },
  { topic: "DISCIPLINARY", site: "nia.gov.pl", when: /aptekar|farmaceut/iu },
  { topic: "DISCIPLINARY", site: "vetpol.org.pl", when: /weteryn/iu },
  // Interpretations, explanations and opinions of the authorities.
  { topic: "INTERPRETATION", site: "eureka.mf.gov.pl", when: /podat|VAT|PIT|CIT|KIS|akcyz|ordynacj/iu },
  { topic: "INTERPRETATION", site: "gov.pl/web/finanse", when: /podat|VAT|PIT|CIT|objaśnieni|interpretacj\p{L}*\s+ogóln/iu },
  { topic: "INTERPRETATION", site: "podatki.gov.pl", when: /podat|VAT|PIT|CIT/iu },
  { topic: "INTERPRETATION", site: "zus.pl", when: /ZUS|składk|emerytur|rent|zasiłk|ubezpieczeni\p{L}*\s+społeczn/iu },
  { topic: "INTERPRETATION", site: "puesc.gov.pl", when: /cł|celn|WIS|WIA|WIT|taryf/iu },
  { topic: "INTERPRETATION", site: "pip.gov.pl", when: /PIP|prac(?:y|ownik|odawc)|BHP|czas\p{L}*\s+pracy/iu },
  { topic: "INTERPRETATION", site: "gov.pl/web/uzp", when: /UZP|zamówie|PZP|przetarg/iu },
  { topic: "INTERPRETATION", site: "gov.pl/web/gunb", when: /budowlan|GUNB|pozwoleni\p{L}*\s+na\s+budow/iu },
  { topic: "INTERPRETATION", site: "uodo.gov.pl", when: /RODO|danych\s+osobow|UODO/iu },
  { topic: "INTERPRETATION", site: "knf.gov.pl", when: /KNF|bank|ubezpiecz|kredyt|inwestycyjn/iu },
  { topic: "INTERPRETATION", site: "ure.gov.pl", when: /URE|energ|ciepł|gaz|paliw/iu },
  { topic: "INTERPRETATION", site: "uke.gov.pl", when: /UKE|telekomunik|poczt/iu },
  { topic: "INTERPRETATION", site: "rf.gov.pl", when: /Rzeczni\p{L}*\s+Finansow|reklamacj/iu },
  // Decisions of the authorities and appeal bodies.
  { topic: "AUTHORITY", site: "uodo.gov.pl", when: /UODO|RODO|danych\s+osobow/iu },
  { topic: "AUTHORITY", site: "decyzje.uokik.gov.pl", when: /UOKiK|konsument|konkurencj|klauzul/iu },
  { topic: "AUTHORITY", site: "uokik.gov.pl", when: /UOKiK|konsument|konkurencj/iu },
  { topic: "AUTHORITY", site: "orzeczenia.uzp.gov.pl", when: /KIO|Izb\p{L}*\s+Odwoławcz|zamówie|PZP|przetarg/iu },
  { topic: "AUTHORITY", site: "ure.gov.pl", when: /URE|energ|ciepł|gaz|paliw|taryf/iu },
  { topic: "AUTHORITY", site: "bip.uke.gov.pl", when: /UKE|telekomunik|poczt/iu },
  { topic: "AUTHORITY", site: "knf.gov.pl", when: /KNF|bank|ubezpiecz|inwestycyjn/iu },
  { topic: "AUTHORITY", site: "krrit.gov.pl", when: /KRRiT|nadawc|radi|telewizj/iu },
  { topic: "AUTHORITY", site: "rio.gov.pl", when: /RIO|Regionaln\p{L}*\s+Izb\p{L}*\s+Obrachunkow|rozstrzygnięci\p{L}*\s+nadzorcz|uchwał\p{L}*\s+(?:rady|budżetow)/iu },
  { topic: "AUTHORITY", site: "bip.brpo.gov.pl", when: /RPO|Rzeczni\p{L}*\s+Praw\s+Obywatelskich/iu },
  { topic: "AUTHORITY", site: "rf.gov.pl", when: /Rzeczni\p{L}*\s+Finansow/iu },
  { topic: "AUTHORITY", site: "utk.gov.pl", when: /UTK|kolej|transport\p{L}*\s+kolejow/iu },
  { topic: "AUTHORITY", site: "gif.gov.pl", when: /GIF|lek(?:i|ów|u)|farmaceut|apte/iu },
  { topic: "AUTHORITY", site: "pip.gov.pl", when: /PIP|inspekc\p{L}*\s+prac/iu }
];

// A topic's own portals when the question names none of its fields.
const DEFAULT_SITES: Record<PortalTopic, string[]> = {
  CASE_LAW: ["orzeczenia.ms.gov.pl", "sn.pl", "orzeczenia.nsa.gov.pl"],
  CONSTITUTIONAL: ["ipo.trybunal.gov.pl", "trybunal.gov.pl"],
  DISCIPLINARY: ["sn.pl", "wsd.adwokatura.pl", "kirp.pl"],
  INTERPRETATION: ["eureka.mf.gov.pl", "gov.pl/web/finanse", "zus.pl"],
  AUTHORITY: ["uodo.gov.pl", "decyzje.uokik.gov.pl", "orzeczenia.uzp.gov.pl"]
};

/** Which kinds of documents the question asks about (none: no search). */
export function portalTopics(question: string): PortalTopic[] {
  return (Object.keys(TOPIC_SIGNALS) as PortalTopic[]).filter((topic) => TOPIC_SIGNALS[topic].test(question));
}

/** Up to three portals of a topic: those whose field the question names first, then the topic's own. */
export function portalSites(topic: PortalTopic, question: string): string[] {
  const named = PORTALS.filter((portal) => portal.topic === topic && portal.when?.test(question)).map((portal) => portal.site);
  return [...new Set([...named, ...DEFAULT_SITES[topic]])].slice(0, 3);
}

// Words that carry no legal topic; the query keeps the legal phrase of the question.
const FILLER = new Set(
  "a albo ale aby bo by być co czy dla do gdy i ich iż jak jaki jakie jakiego jakim je jego jej jest już ktoś która które którego który lub ma mam mi mnie mogę może można moja moje mój na nad nam nas nie o od oraz po pod proszę przez przy się są ta tak także tam te tego tej ten to tu tym w we wszystko z za ze że żeby podaj znajdź wyszukaj poszukaj wskaż przytocz sprawdź orzecznictwo orzeczenia orzeczeń wyroki wyrok wyroku interpretacje interpretacja interpretacji temat dotyczące dotyczący dotycząca sprawie sprawy"
    .split(" ")
);

/** The query phrase: the question's legal words, without fillers, PII tokens, amounts and dates. */
export function portalPhrase(question: string): string {
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
export function portalQueries(question: string, limit = 8): PortalQuery[] {
  const topics = portalTopics(question);
  const phrase = portalPhrase(question);
  if (!topics.length || phrase.split(" ").length < 2) return [];
  const queries: PortalQuery[] = [];
  for (const topic of topics) for (const site of portalSites(topic, question)) queries.push({ topic, site, query: `${phrase} site:${site}` });
  // The same portal once (sn.pl for case law and for a disciplinary question); the topics the
  // question names first take the places; one open query always: commentary, law firms and portals
  // name signatures the registries then confirm (user 2026-11-15).
  const seenSites = new Set<string>();
  const sites = queries.filter((item) => !seenSites.has(item.site!) && Boolean(seenSites.add(item.site!))).slice(0, limit - 1);
  return [...sites, { topic: topics[0]!, site: null, query: phrase }].filter((item) => {
    try {
      assertPublicWebSearchQuery(item.query);
      return true;
    } catch {
      return false;
    }
  });
}

export type PortalHit = ClassifiedWebSearchHit & { topic: PortalTopic; official: boolean };

const OFFICIAL_HOSTS = new Set(PORTALS.map((portal) => portal.site.split("/")[0]!));

export function officialHost(url: string): boolean {
  const host = hostOf(url);
  return [...OFFICIAL_HOSTS].some((official) => host === official || host.endsWith(`.${official}`)) || /\.gov\.pl$/u.test(host);
}

export type PortalSearch = (query: string, maxResults: number) => Promise<WebSearchHit[]>;

/** The queries in parallel; hits on official portals first, the same address once. */
export async function searchOfficialPortals(
  question: string,
  search: PortalSearch,
  timeoutMs = 20_000,
  // Queries made from the case's legal issue (case-issue.ts), asked before the question's own.
  issueQueries: readonly PortalQuery[] = []
): Promise<{ queries: PortalQuery[]; hits: PortalHit[] }> {
  const own = portalQueries(question).filter((item) => !issueQueries.some((issue) => issue.query === item.query));
  const queries = [...issueQueries, ...own].slice(0, 10);
  if (!queries.length) return { queries, hits: [] };
  const answered = await Promise.all(
    queries.map(async (item) => {
      try {
        const hits = await Promise.race([
          search(item.query, 8),
          new Promise<WebSearchHit[]>((resolve) => setTimeout(() => resolve([]), timeoutMs))
        ]);
        return classifyWebSearchHits(hits).map((hit) => ({ ...hit, topic: item.topic, official: officialHost(hit.url) }));
      } catch {
        return [] as PortalHit[];
      }
    })
  );
  const seen = new Set<string>();
  const hits = answered
    .flat()
    .filter((hit) => !seen.has(hit.url) && Boolean(seen.add(hit.url)))
    .sort((a, b) => Number(b.official) - Number(a.official));
  return { queries, hits: hits.slice(0, 30) };
}

/** Signatures of rulings and interpretations the hits name (title, snippet, address). */
export function portalSignatures(hits: readonly PortalHit[]): { cases: string[]; interpretations: string[] } {
  const text = hits.map((hit) => `${hit.title}\n${hit.snippet}\n${decodeURIComponent(hit.url)}`).join("\n");
  const cases = [...new Set(signaturesIn(text).map((item) => item.signature))];
  const interpretations = [...new Set(text.split("\n").flatMap((line) => interpretationSignaturesInLine(line)))];
  return { cases: cases.slice(0, 12), interpretations: interpretations.slice(0, 8) };
}

/** The section for the model: official hits first, then leads, each with what to verify. */
export function portalSearchPrompt(result: { queries: PortalQuery[]; hits: PortalHit[] }): string {
  if (!result.hits.length) return "";
  const line = (hit: PortalHit) => {
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
let configured: PortalSearch | null = null;

export function configurePortalSearch(search: PortalSearch | null): void {
  configured = search;
}

export function currentPortalSearch(): PortalSearch | null {
  if (["off", "0", "false"].includes((process.env.LEX_PORTAL_SEARCH ?? "").trim().toLowerCase())) return null;
  return configured;
}
