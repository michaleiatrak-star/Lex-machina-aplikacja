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
function sameStem(a, b) {
    if (a === b)
        return true;
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common])
        common += 1;
    return common >= 4 && common >= Math.min(a.length, b.length) - 1;
}
function stems(value) {
    return new Set(searchStems(value).filter((stem) => !/^\d+$/.test(stem) && !["ustawa", "ustaw", "ustawy", "dnia"].includes(stem)));
}
async function searchByTitle(fetcher, act) {
    const query = shortActTitle(act.replace(/^\s*ustaw[a-yąę]*\s+/iu, "")).trim();
    if (query.length < 4)
        return null;
    // ELI searches a substring of the title: the inflected name ("Prawa o adwokaturze") finds
    // nothing, so the search goes by the stem of its longest word and the stems pick the act.
    const longest = [...query.matchAll(/\p{L}{5,}/gu)].map((match) => match[0]).sort((a, b) => b.length - a.length)[0];
    const term = longest ? longest.slice(0, Math.max(5, longest.length - 2)) : query;
    const found = (await eliJson(fetcher, `search?publisher=DU&title=${encodeURIComponent(term)}&limit=500`));
    const wanted = stems(query);
    if (wanted.size === 0)
        return null;
    // A statute named as one ("ustawy …", "Prawo …", "Kodeks …") is not an ordinance's title.
    const statute = /^\s*(?:ustaw|praw[aoe]?\s|kodeks)/iu.test(act);
    const scored = (found.items ?? [])
        .filter((item) => typeof item.ELI === "string" &&
        typeof item.title === "string" &&
        // A base act with a consolidated text is in force ("akt posiada tekst jednolity").
        /obowiązując|tekst jednolity/u.test(String(item.status ?? "").toLocaleLowerCase("pl")) &&
        !/^obwieszczenie/iu.test(String(item.title)) &&
        (!statute || /^ustawa/iu.test(String(item.title))))
        .map((item) => {
        const title = stems(String(item.title));
        // Inflection ("Prawa"/"Prawo", "adwokaturze"/"adwokatury"): a shared prefix of the stems.
        const shared = [...wanted].filter((stem) => [...title].some((candidate) => sameStem(stem, candidate))).length;
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
// Codes named by their usual abbreviation or title, when the local copy does not know them and
// a title search is ambiguous (every amending act is "o zmianie ustawy – Kodeks pracy").
const CODES = [
    ["DU/1974/141", ["kp", "kodeks pracy"]],
    ["DU/2000/1037", ["ksh", "kodeks spółek handlowych"]],
    ["DU/1964/59", ["kro", "kriop", "krio", "kodeks rodzinny i opiekuńczy"]],
    ["DU/1960/168", ["kpa", "kodeks postępowania administracyjnego"]],
    ["DU/1997/557", ["kkw", "kodeks karny wykonawczy"]],
    ["DU/1999/930", ["kks", "kodeks karny skarbowy"]],
    ["DU/1971/114", ["kw", "kodeks wykroczeń"]],
    ["DU/2001/1148", ["kpw", "kpow", "kodeks postępowania w sprawach o wykroczenia"]],
    ["DU/2002/1270", ["ppsa", "prawo o postępowaniu przed sądami administracyjnymi"]]
];
export function codeEli(act) {
    const key = act.toLocaleLowerCase("pl").replace(/[.\s]+/gu, " ").replace(/ (?=\S( |$))/gu, "").replace(/\s+/gu, " ").trim();
    const compact = key.replace(/\s+/gu, "");
    for (const [eli, names] of CODES) {
        if (names.some((name) => name === key || name.replace(/\s+/gu, "") === compact))
            return eli;
    }
    return null;
}
export async function describeEliAct(args) {
    const offline = (act) => args.index?.resolve(act)?.eli ?? (args.index ? resolveActByTitle(args.index, act) : null) ?? codeEli(act);
    // An act named in running text may carry the rest of its sentence ("Kodeks pracy pracownik jest
    // …", "Prawa o adwokaturze przez stwierdzenie …"): shorter word prefixes of the name, down to two words.
    const words = args.act.trim().split(/\s+/u);
    const prefixes = words.length > 2 ? Array.from({ length: Math.min(words.length - 2, 6) }, (_, cut) => words.slice(0, words.length - 1 - cut).join(" ")) : [];
    let eli = offline(args.act) ??
        journalEli(args.act) ??
        journalEli(args.claim) ??
        prefixes.map(offline).find(Boolean) ??
        (await searchByTitle(args.fetcher, args.act));
    for (const prefix of prefixes) {
        if (eli)
            break;
        eli = await searchByTitle(args.fetcher, prefix);
    }
    if (!eli)
        return null;
    // Pozycja z mapy bywa obwieszczeniem t.j.: aktem bazowym jest akt, dla którego ogłoszono tekst.
    const references = await eliJson(args.fetcher, `${eli}/references`);
    const baseEli = eliLinks(references, (key) => /jednolit\S* dla/i.test(key))[0]?.eli ?? eli;
    const base = (await eliJson(args.fetcher, baseEli));
    const title = shortActTitle(typeof base.title === "string" ? base.title : "");
    if (title.length < 4)
        return null;
    // The act named by its own Dz.U. (a code, "Dz.U. 1974 poz. 141"): its text is the newest
    // consolidated text in force, not the promulgated one (the freshness check refused that as stale).
    const pinned = eli === baseEli
        ? eliLinks(references, (key) => /tekście jednolitym/i.test(key))
            .filter((link) => /obowiązując/iu.test(link.status))
            .sort((a, b) => b.year - a.year || b.pos - a.pos)[0]?.eli ?? eli
        : eli;
    return {
        id: "ELI",
        title,
        eli: pinned,
        baseEli,
        sourceUrl: `${ELI_ACTS}/${pinned}/text.html`,
        sourceKind: "consolidated_text",
        registryAsOf: args.today
    };
}
