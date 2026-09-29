import { resolveActByTitle } from "./core-law-verification.js";
import { eliLinks } from "./core-law-index.js";
import { searchStems } from "./core-law-search.js";
/**
 * Akt spoza rejestru KC/KPC/KK/KPK jako deskryptor dla weryfikacji w źródle (Sejm ELI):
 * ELI z map DR (lokalna kopia), z "Dz.U. RRRR poz. N" albo z wyszukiwarki ELI po tytule
 * (tylko jednoznaczne trafienie). Akt bazowy z relacji "Tekst jednolity dla aktu", żeby
 * kontrola aktualności sama znalazła najnowszy t.j. i nowelizacje po nim — także gdy
 * lokalna kopia jest starsza.
 */
const ELI_ACTS = "https://api.sejm.gov.pl/eli/acts";
const REQUEST_TIMEOUT_MS = 20_000;
const TITLE_MATCH_MIN = 0.75;
async function eliJson(fetcher, path) {
    const response = await fetcher(`${ELI_ACTS}/${path}`, {
        headers: {
            Accept: "application/json",
            "User-Agent": "LexMachina-eli-act-descriptor/1.0"
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok)
        throw new Error(`ELI_HTTP_${response.status}`);
    return response.json();
}
function journalEli(text) {
    const match = /\bDz\.?\s*U\.?\s*(?:z\s+)?(\d{4})\s*r?\.?\s*(?:nr\s*\d+\s*,?\s*)?poz\.?\s*(\d+)/iu.exec(text);
    return match ? `DU/${match[1]}/${Number(match[2])}` : null;
}
// "Ustawa z dnia 26 października 1982 r. o wychowaniu ..." -> "o wychowaniu ...";
// "Ustawa z dnia 20 maja 1971 r. - Kodeks wykroczeń" -> "Kodeks wykroczeń".
export function shortActTitle(title) {
    return title
        .replace(/^\s*(?:ustawa|rozporządzenie[^]*?|dekret)?\s*z\s+dnia\s+\d{1,2}\s+\S+\s+\d{4}\s*r\.?\s*/iu, "")
        .replace(/^[\s–—-]+/u, "")
        .trim();
}
function stems(value) {
    return new Set(searchStems(value).filter((stem) => !/^\d+$/.test(stem) && !["ustawa", "ustaw", "ustawy", "dnia"].includes(stem)));
}
async function searchByTitle(fetcher, act) {
    const query = act.replace(/^\s*ustaw[a-yąę]*\s+/iu, "").trim();
    if (query.length < 4)
        return null;
    const found = (await eliJson(fetcher, `search?publisher=DU&title=${encodeURIComponent(query)}&limit=100`));
    const wanted = stems(query);
    if (wanted.size === 0)
        return null;
    const scored = (found.items ?? [])
        .filter((item) => typeof item.ELI === "string" &&
        typeof item.title === "string" &&
        String(item.status ?? "").toLocaleLowerCase("pl").includes("obowiązując") &&
        !/^obwieszczenie/iu.test(String(item.title)))
        .map((item) => {
        const title = stems(String(item.title));
        const shared = [...wanted].filter((stem) => title.has(stem)).length;
        return { eli: String(item.ELI), query: shared / wanted.size, title: title.size ? shared / title.size : 0 };
    })
        .filter((item) => item.query >= TITLE_MATCH_MIN)
        .sort((a, b) => b.query - a.query || b.title - a.title);
    const [best, second] = scored;
    if (!best)
        return null;
    if (second && second.query === best.query && second.title === best.title)
        return null;
    return best.eli;
}
export async function describeEliAct(args) {
    const eli = args.index?.resolve(args.act)?.eli ??
        (args.index ? resolveActByTitle(args.index, args.act) : null) ??
        journalEli(args.act) ??
        journalEli(args.claim) ??
        (await searchByTitle(args.fetcher, args.act));
    if (!eli)
        return null;
    // Pozycja z mapy bywa obwieszczeniem t.j.: aktem bazowym jest akt, dla którego ogłoszono tekst.
    const references = await eliJson(args.fetcher, `${eli}/references`);
    const baseEli = eliLinks(references, (key) => /jednolit\S* dla/i.test(key))[0]?.eli ?? eli;
    const base = (await eliJson(args.fetcher, baseEli));
    const title = shortActTitle(typeof base.title === "string" ? base.title : "");
    if (title.length < 4)
        return null;
    return {
        id: "ELI",
        title,
        eli,
        baseEli,
        sourceUrl: `${ELI_ACTS}/${eli}/text.html`,
        sourceKind: "consolidated_text",
        registryAsOf: args.today
    };
}
