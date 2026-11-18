// What an amending act in force does to one article of the amended act, read from its own text
// (user, 2026-11-17: the t.j. may still be the same while an amendment already changed the
// article; the amendment must be read and its wording applied, not only flagged). The amending
// part is split into its points ("1) art. 12 otrzymuje brzmienie: „…”;", "2) w art. 13: a) § 1 …"),
// quote-aware so the points of a quoted new wording are not taken for the act's own points.
import { amendmentMentionsArticle } from "./temporal-source-freshness.js";
/** The amending act's text on one line: hyphenated line breaks joined, Dz.U. page headers out. */
export function amendmentTextLine(text) {
    return text
        .replace(/Dziennik Ustaw\s+[–—-]\s*\d+\s*[–—-]\s+Poz\.\s*\d+/gu, " ")
        .replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2")
        .replace(/\s+/gu, " ")
        .trim();
}
// Top-level points of a part: "1) …; 2) …" outside quotes. Quotes nest („ … » … « … ”), and
// a quoted wording has points of its own.
function topLevelPoints(part) {
    const points = [];
    let depth = 0;
    let start = -1;
    let end = part.length;
    for (let at = 0; at < part.length; at++) {
        const char = part[at];
        if (char === "„" || char === "»")
            depth++;
        else if ((char === "”" || char === "«") && depth > 0)
            depth--;
        else if (depth === 0) {
            const rest = part.slice(at, at + 12);
            // The next unit of the amending act ("Art. 2. Ustawa wchodzi w życie …") ends the points.
            if (start >= 0 && /^Art\.\s*\d+[a-z]*\.\s/u.test(rest) && /\s$/u.test(part.slice(0, at))) {
                end = at;
                break;
            }
            if (/^\d+[a-z]*\)\s/u.test(rest) && (at === 0 || /[:;]\s*$/u.test(part.slice(Math.max(0, at - 3), at)))) {
                if (start >= 0)
                    points.push(part.slice(start, at).trim());
                start = at;
            }
        }
    }
    if (depth !== 0)
        return null;
    if (start >= 0)
        points.push(part.slice(start, end).trim());
    return points;
}
// A single-change unit ends where the amending act's next unit begins outside quotes ("… „…”.
// Art. 2. Ustawa wchodzi w życie …").
function untilNextUnit(text) {
    let depth = 0;
    for (let at = 1; at < text.length; at++) {
        const char = text[at];
        if (char === "„" || char === "»")
            depth++;
        else if ((char === "”" || char === "«") && depth > 0)
            depth--;
        else if (depth === 0 && /\s/u.test(text[at - 1]) && /^Art\.\s*\d+[a-z]*\.\s/u.test(text.slice(at, at + 12)))
            return text.slice(0, at).trim();
    }
    return text;
}
// The point's own words, its quoted wordings out: they name other articles ("o której mowa w art. 8").
const head = (point) => point.replace(/„[^]*?”/gu, "„…”");
// "647^1" also as the PDF prints it without the superscript ("6471").
const articleRe = (article) => article.replace(/\^/gu, "\\^?");
/**
 * The changes an amending part (the act's unit amending this act, cased) makes to the article.
 * null when the part cannot be read with certainty (unbalanced quotes); [] when no point of
 * it is about the article (it is named only inside another article's new wording).
 */
export function articleChanges(part, article) {
    const line = amendmentTextLine(part);
    const intro = /wprowadza się następujące zmiany:\s*/iu.exec(line);
    const points = intro ? topLevelPoints(line.slice(intro.index + intro[0].length)) : [untilNextUnit(line.replace(/^.*?\bw ustawie\b[^„]*?\)+\s*/iu, ""))];
    if (!points)
        return null;
    const changes = [];
    const wanted = articleRe(article);
    for (const point of points) {
        const own = head(point);
        if (amendmentMentionsArticle(own.toLocaleLowerCase("pl"), article) !== true)
            continue;
        // "po art. 12 dodaje się art. 12a": a new article, not a change of art. 12.
        if (new RegExp(`^(?:\\d+[a-z]*\\)\\s*)?po\\s+art\\.\\s*${wanted}\\s+dodaje\\s+się\\s+art\\.`, "iu").test(own))
            continue;
        const instruction = point.replace(/[;.]\s*$/u, "").slice(0, 4_000);
        // The amending act's own unit ("Art. 1. Uchyla się …") and the point number are not the instruction.
        const bare = own.replace(/^\d+[a-z]*\)\s*/u, "").replace(/^Art\.\s*\d+[a-z]*\.\s+/u, "");
        // The whole article repealed, alone or in a list or range ("uchyla się art. 188–192").
        const unitFree = "(?:(?!§|ust\\.|pkt|lit\\.|zdani|zd\\.)[^„])";
        if (new RegExp(`^(?:uchyla\\s+się\\s+art\\.${unitFree}*$|art\\.${unitFree}*?\\s+uchyla\\s+się\\s*[;.,]?\\s*$)`, "iu").test(bare.trim())) {
            changes.push({ kind: "REPEALED", instruction });
            continue;
        }
        // A wording or words given without the quoted text: the point was not read whole.
        if (/brzmieni|wyraz/iu.test(own) && !point.includes("„"))
            return null;
        const text = point.replace(/^\d+[a-z]*\)\s*/u, "").replace(/^Art\.\s*\d+[a-z]*\.\s+/u, "");
        const whole = new RegExp(`^art\\.\\s*${wanted}\\s+otrzymuje\\s+brzmienie:\\s*„([^]*)”`, "iu").exec(text);
        if (whole) {
            changes.push({ kind: "REPLACED", instruction, wording: whole[1].trim() });
            continue;
        }
        // "art. 189, 190a i 191 otrzymują brzmienie: „Art. 189. … Art. 190a. … Art. 191. …”".
        const several = /^art\.[^§„:]*otrzymują\s+brzmienie:\s*„([^]*)”/iu.exec(text);
        const ownWording = several ? new RegExp(`(?:^|\\s)(Art\\.\\s*${wanted}\\.\\s[^]*?)(?=\\sArt\\.\\s*\\d+[^\\s]*\\.\\s|$)`, "u").exec(several[1]) : null;
        if (ownWording) {
            changes.push({ kind: "REPLACED", instruction, wording: ownWording[1].trim() });
            continue;
        }
        const substitutions = [...point.matchAll(/wyraz\p{L}*\s+„([^”]+)”\s+zastępuje\s+się\s+wyraz\p{L}*\s+„([^”]+)”/gu)].map((match) => ({ from: match[1], to: match[2] }));
        changes.push({ kind: "CHANGED", instruction, ...(substitutions.length ? { substitutions } : {}) });
    }
    return changes;
}
/**
 * The article's wording after the changes, applied in order: a new wording replaces it, a word
 * substitution is applied where the replaced words occur exactly once. `applied` is false when a
 * change could not be applied mechanically (a unit replaced or added, an ambiguous substitution):
 * the instructions then go to the model next to the consolidated text.
 */
export function applyArticleChanges(consolidated, changes) {
    let text = consolidated;
    let applied = true;
    for (const change of changes) {
        if (change.kind === "REPLACED" && change.wording) {
            text = change.wording;
            continue;
        }
        if (change.kind === "CHANGED" && change.substitutions?.length && !/otrzymuj\p{L}*\s+brzmienie|dodaje\s+się|uchyla\s+się/iu.test(head(change.instruction))) {
            for (const substitution of change.substitutions) {
                const count = text.split(substitution.from).length - 1;
                if (count === 1)
                    text = text.replace(substitution.from, substitution.to);
                else
                    applied = false;
            }
            continue;
        }
        applied = false;
    }
    return { text, applied };
}
