// Rulings of the Bar's disciplinary courts by the legal issue, not by a signature (RD 121/26,
// 2026-11-16): the chat found WSD 113/22, 77/22, 128/17 and SDI 9/12 on the threat of criminal
// prosecution (§ 16 KEA), while the application only checked signatures already in the file.
// The register of wsd.adwokatura.pl files every ruling under the issues it decides ("Tagi",
// /rejestry/listHasla, e.g. "groźba spowodowania postępowania karnego lub dyscyplinarnego"):
// the issue's words choose the tags, the tags list the rulings, and each ruling page is read.
import { plainText } from "../eli/readers.js";
import { pageRenderer } from "../browser-render.js";
import { WSD_PORTAL } from "./wsd-portal.js";
// Words that name no issue (a tag "prawo dyscyplinarne procesowe" is not chosen by "prawo").
const STOP = new Set("a albo ani bez by czy dla do i jako jest lub na nad nie o od oraz po pod przez przy się sprawa sprawy w we z za ze że prawo prawa adwokat adwokata adwokatów adwokacki adwokackiej zasady zasad etyki etyka godności godność zawodu wolno może".split(" "));
const fold = (word) => word
    .toLocaleLowerCase("pl")
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/ł/gu, "l");
// Common beginnings ("prze-", "proc-", "post-") say nothing alone: such words keep seven letters.
const LONG_STEM = /^(?:prze|przy|proc|post|pods|spra|wyst|zast|odpo|nale|pows|wszc|ustaw|zawi|praw)/u;
// Every tag of a disciplinary court's register is "disciplinary": the word chooses none of them.
const GENERIC_STEM = new Set(["dysc"]);
/** The issue words as stems ("groźba", "grozić" -> "groz"; "karnego", "karnym" -> "karn"; "procesowy" -> "procesow"). */
export function issueStems(text) {
    const stems = new Set();
    for (const word of text.split(/[^\p{L}]+/u)) {
        if (word.length < 4 || STOP.has(word.toLocaleLowerCase("pl")))
            continue;
        const folded = fold(word);
        const stem = folded.slice(0, LONG_STEM.test(folded) ? 7 : 4);
        if (!GENERIC_STEM.has(stem))
            stems.add(stem);
    }
    return stems;
}
/** The register's issue list (name and address of each tag). */
export function wsdTags(html) {
    const tags = new Map();
    for (const match of html.matchAll(/href=["']((?:https:\/\/wsd\.adwokatura\.pl)?\/?rejestry\/listHaslaTag\/[^"'#?]+)["'][^>]*?(?:title=["']([^"']+)["'])?[^>]*>([\s\S]*?)<\/a>/gu)) {
        const path = match[1].replace(/^https:\/\/wsd\.adwokatura\.pl/u, "").replace(/^\/?/u, "/");
        const name = (match[2] ?? plainText(match[3] ?? "")).replace(/\s+/gu, " ").trim();
        if (name)
            tags.set(path, { name, url: `${WSD_PORTAL}${path}` });
    }
    return [...tags.values()];
}
/**
 * Tags whose words the issue names: at least two of them and half of the tag's words. A word that
 * many tags share ("procesowy") weighs less than a rare one ("groźba"), so the tag of the issue
 * itself comes before tags that only share its setting.
 */
export function matchingTags(tags, issue, limit = 3) {
    const stems = issueStems(issue);
    const words = new Map(tags.map((tag) => [tag, [...issueStems(tag.name)]]));
    const frequency = new Map();
    for (const list of words.values())
        for (const stem of list)
            frequency.set(stem, (frequency.get(stem) ?? 0) + 1);
    return tags
        .map((tag) => {
        const list = words.get(tag);
        const hits = list.filter((stem) => stems.has(stem));
        const weight = hits.reduce((sum, stem) => sum + 1 / (frequency.get(stem) ?? 1), 0);
        return { ...tag, score: weight, share: list.length ? hits.length / list.length : 0, hit: hits.length };
    })
        .filter((tag) => tag.hit >= 2 && tag.share >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(({ hit: _hit, share: _share, ...tag }) => tag);
}
export function wsdRulingLinks(html) {
    const links = new Set();
    for (const match of html.matchAll(/href=["']((?:https:\/\/wsd\.adwokatura\.pl)?\/?rejestry\/show\/[^"'#?]+)["']/gu)) {
        links.add(`${WSD_PORTAL}${match[1].replace(/^https:\/\/wsd\.adwokatura\.pl/u, "").replace(/^\/?/u, "/")}`);
    }
    return [...links];
}
/** A ruling page of the register: its title, signature, tags and text (null for another page). */
export function wsdRulingPage(html, url) {
    const article = /<article\b[\s\S]*?<\/article>/u.exec(html)?.[0] ?? html;
    const text = plainText(article).replace(/[ \t]+/gu, " ").replace(/\n{3,}/gu, "\n\n").trim();
    const signature = /Sygnatura:\s*([A-ZŁŚŻ]{2,5}\s+\d{1,5}\/\d{2,4})/u.exec(text.replace(/\s+/gu, " "))?.[1] ?? null;
    if (!signature)
        return null;
    const title = plainText(/<h1\b[^>]*>([\s\S]*?)<\/h1>/u.exec(html)?.[1] ?? /<title>([\s\S]*?)<\/title>/u.exec(html)?.[1] ?? "").replace(/\s+/gu, " ").trim();
    const tags = wsdTags(html).map((tag) => tag.name);
    // The page's navigation ("Strona główna / Orzecznictwo / ..") and the title before the ruling's text.
    const at = title ? text.indexOf(title) : -1;
    const body = (at >= 0 ? text.slice(at + title.length) : text.replace(/^[\s\S]*?\/\s*\.\.\s*/u, "")).trim();
    return { url, title, signature, tags, text: body.slice(0, 40_000) };
}
async function page(url, fetchImpl, timeoutMs) {
    const reply = await fetchImpl(url, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(timeoutMs) }).catch(() => null);
    if (reply?.ok)
        return reply.text();
    // Refused (bot check, 403): the browser on this computer or server (Chromium in Docker).
    const rendered = await pageRenderer()?.render(url).catch(() => null);
    return rendered ? `<article>${rendered.text.replace(/</gu, "&lt;")}</article>` : "";
}
/**
 * Rulings of the register filed under the tags the issue names (up to `limit`), and ruling pages
 * found otherwise (official portal search hits on wsd.adwokatura.pl) read the same way.
 */
export async function wsdRulingsByIssue(issue, options = {}) {
    const fetchImpl = options.fetchImpl ?? fetch;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const limit = options.limit ?? 6;
    const tagList = wsdTags(await page(`${WSD_PORTAL}/rejestry/listHasla`, fetchImpl, timeoutMs));
    const chosen = matchingTags(tagList, issue);
    const listed = await Promise.all(chosen.map(async (tag) => ({ tag, links: wsdRulingLinks(await page(tag.url, fetchImpl, timeoutMs)) })));
    // The ruling pages: portal hits first (they matched the issue's own words), then the best tag's
    // rulings before the next tag's, the newest first (the year is in the page's address).
    const year = (url) => Number(/-(\d{4})-?r?-\d+$/u.exec(url)?.[1] ?? /(?:19|20)\d{2}/u.exec(url)?.[0] ?? 0);
    const queue = (options.extraUrls ?? []).map((url) => ({ url, viaTag: null }));
    for (const item of listed)
        for (const url of [...item.links].sort((a, b) => year(b) - year(a)))
            queue.push({ url, viaTag: item.tag.name });
    const seen = new Set();
    const unique = queue.filter((item) => !seen.has(item.url) && Boolean(seen.add(item.url))).slice(0, limit + 4);
    const read = await Promise.all(unique.map(async (item) => {
        const ruling = wsdRulingPage(await page(item.url, fetchImpl, timeoutMs), item.url);
        return ruling ? { ...ruling, viaTag: item.viaTag } : null;
    }));
    const bySignature = new Set();
    const rulings = read.filter((item) => Boolean(item) && !bySignature.has(item.signature) && Boolean(bySignature.add(item.signature))).slice(0, limit);
    return { tags: chosen.map((tag) => tag.name), rulings };
}
/** For the model: the rulings with their text; the tag says what they decide, the text whether it fits. */
export function wsdTopicPrompt(result, perRuling = 3_500) {
    if (!result.rulings.length)
        return "";
    return [
        "# ORZECZNICTWO DYSCYPLINARNE WEDŁUG ZAGADNIENIA — REJESTR WSD ADWOKATURY (ustalone przez aplikację)",
        `Zagadnienia rejestru dobrane do sprawy: ${result.tags.join("; ") || "trafienia wyszukiwania na portalu WSD"}. Strony orzeczeń odczytane z wsd.adwokatura.pl (publikacja samorządu, źródło urzędowe).`,
        "Powołuj orzeczenie (sąd, data, sygnatura) tylko wtedy, gdy jego tekst poniżej wspiera tezę pisma; cytuj wyłącznie z tego tekstu. Linia orzecznicza (kilka orzeczeń w tym samym kierunku) jest mocniejsza niż jedno orzeczenie — wskaż ją, gdy występuje.",
        ...result.rulings.map((ruling) => `## ${ruling.signature} — ${ruling.title} (${ruling.url})${ruling.tags.length ? `\nTagi: ${ruling.tags.join(", ")}` : ""}\n${ruling.text.slice(0, perRuling)}`)
    ].join("\n\n");
}
/** Signatures of the bar's disciplinary rulings a ruling's text cites (WSD 128/17, SDI 9/12, DSI 3/20). */
export function citedDisciplinarySignatures(text) {
    return [...new Set([...text.normalize("NFKC").matchAll(/\b(WSD|SDI|DSI)\s+(\d{1,5}\/\d{2,4})\b/gu)].map((match) => `${match[1]} ${match[2]}`))];
}
/**
 * The second round, as a lawyer reads on (RD 121/26): the rulings the first ones cite, looked up in
 * the register, and, when the first round found little, the register's own wording of the issue
 * (its tags) asked of the portal search.
 */
export async function wsdSecondRound(first, options) {
    const known = new Set(first.rulings.map((ruling) => ruling.signature));
    const cited = first.rulings.flatMap((ruling) => citedDisciplinarySignatures(ruling.text).map((signature) => ({ signature, by: ruling.signature }))).filter((item) => !known.has(item.signature));
    const unique = [...new Map(cited.map((item) => [item.signature, item])).values()].slice(0, options.limit ?? 4);
    const found = await Promise.all(unique.map(async (item) => {
        const result = await options.find(item.signature).catch(() => null);
        return result?.status === "FOUND" && result.url && result.text
            ? { url: result.url, title: result.title ?? "", signature: item.signature, tags: [], text: result.text, viaTag: `powołane w ${item.by}` }
            : null;
    }));
    const chained = found.filter((item) => Boolean(item));
    if (first.rulings.length + chained.length >= 3 || !options.search || !first.tags.length)
        return chained;
    const hits = (await Promise.all(first.tags.slice(0, 2).map((tag) => options.search(`"${tag}" site:wsd.adwokatura.pl`, 8).catch(() => [])))).flat();
    const urls = [...new Set(hits.map((hit) => hit.url).filter((url) => /^https:\/\/wsd\.adwokatura\.pl\/rejestry\/show\//u.test(url)))];
    const more = await wsdRulingsByIssue("", { extraUrls: urls.slice(0, 4), limit: 4, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }).catch(() => ({ tags: [], rulings: [] }));
    const seen = new Set([...known, ...chained.map((ruling) => ruling.signature)]);
    return [...chained, ...more.rulings.filter((ruling) => !seen.has(ruling.signature))];
}
