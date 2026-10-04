// A skill's catalogue of document schemas ("SCHEMATY PISM (ładuj TYLKO odpowiedni
// schemat)" in pisma-proste-v2): one row per kind of document with its schema file.
// The application picks the one row the request names and loads only that schema
// (with the files the row says to read first).
const SECTION = /^(#{2,4})\s+SCHEMATY\b.*$/mu;
const FUNCTION_WORDS = new Set([
    "wniosek", "wniosku", "pismo", "pisma", "przez", "oraz", "albo", "lub", "dla", "nad", "pod", "art", "ust",
    "kpc", "kpa", "przed", "po", "do", "od", "na", "o", "w", "z", "ze", "się", "nie", "bez", "jako", "typ", "sekcja"
]);
// One word per stem ("wezwanie", "wezwaniu" -> one).
function keyWords(text) {
    const seen = new Set();
    return (text.match(/\p{L}{3,}/gu) ?? [])
        .map((word) => word.toLocaleLowerCase("pl"))
        .filter((word) => !FUNCTION_WORDS.has(word))
        .filter((word) => {
        const stem = word.slice(0, Math.max(4, word.length - 2));
        if (seen.has(stem))
            return false;
        seen.add(stem);
        return true;
    });
}
export function parseSchemaCatalog(markdown, skill) {
    const start = SECTION.exec(markdown);
    if (!start)
        return [];
    const level = start[1].length;
    const rest = markdown.slice(start.index + start[0].length);
    const end = new RegExp(`^#{1,${level}}\\s`, "mu").exec(rest);
    const section = end ? rest.slice(0, end.index) : rest;
    const entries = [];
    for (const line of section.split("\n")) {
        const cells = line.split("|").map((cell) => cell.trim());
        if (cells.length < 5)
            continue;
        const code = /\*\*\s*(SP[A-Z](?:-[A-Z])?)\b/u.exec(cells[1])?.[1];
        if (!code)
            continue;
        const own = [...cells[2].matchAll(/(?:references|modules|assets|templates)\/[A-Za-z0-9._\-/]+?\.md\b/g)].map((match) => `${skill}/${match[0]}`);
        // "UWAGA: wczytaj najpierw <dr-.../modules/...md>": read before the schema.
        const first = [...cells[3].matchAll(/[a-z0-9-]+-v?\d*[a-z0-9-]*\/(?:modules|references)\/[A-Za-z0-9._\-/]+?\.md\b/g)].map((match) => match[0]);
        const kind = cells[3].split(/\s+—\s+\*\*UWAGA|\*\*UWAGA/u)[0].replace(/\([^)]*\)/g, " ").replace(/\*\*/g, " ");
        const alternatives = kind
            .split(/,|\s\/\s/u)
            .map((part) => keyWords(part))
            .filter((words) => words.length > 0);
        // "Skarga na czynności komornika / na zaniechanie": a one-word part qualifies the first, it is no row of its own.
        const named = alternatives.length > 1 ? alternatives.filter((words) => words.length > 1) : alternatives;
        if (!own.length || !named.length)
            continue;
        entries.push({ code, label: kind.replace(/\s+/g, " ").trim(), resources: [...first, ...own], alternatives: named });
    }
    return entries;
}
function wordPattern(word) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (word.length <= 4)
        return new RegExp(`(?<![\\p{L}])${escape(word)}(?![\\p{L}])`, "iu");
    const base = word.slice(0, Math.max(4, word.length - 2));
    // "wezwanie" -> "wezwani"; "pozew" -> "pozw"
    const dropped = /e[a-ząćęłńóśźż]$/u.test(word) ? word.slice(0, -2) + word.slice(-1) : null;
    const stems = [base, ...(dropped && dropped.length >= 4 ? [dropped.slice(0, Math.max(4, dropped.length - 1))] : [])];
    return new RegExp(`(?<![\\p{L}])(?:${stems.map(escape).join("|")})`, "iu");
}
/** The single schema the text names (most words of one alternative), or null. */
export function matchSchema(entries, text) {
    let best = null;
    for (const entry of entries) {
        for (const words of entry.alternatives) {
            const matched = words.filter((word) => wordPattern(word).test(text));
            if (matched.length < Math.min(words.length, 2))
                continue;
            // The word naming the kind of letter ("sprzeciw", "zarzuty", "wezwanie") must be
            // there: "nakaz zapłaty" alone is no "sprzeciw od nakazu zapłaty". A verbal noun
            // ("nadanie klauzuli") may be left out, and so may one word of a long name.
            const head = words[0];
            if (!matched.includes(head) && !/(?:anie|enie|cie)$/u.test(head) && !(words.length >= 4 && matched.length >= 3))
                continue;
            const ratio = matched.length / words.length;
            if (!best || matched.length > best.hits || (matched.length === best.hits && ratio > best.ratio)) {
                best = { entry, hits: matched.length, ratio, words: matched };
            }
        }
    }
    return best ? { ...best.entry, why: `schemat ${best.entry.code}: ${best.entry.label} (${best.words.join(", ")})` } : null;
}
const DRAFT = /(?<![\p{L}])(?:napisz|przygotuj|sporządź|zredaguj|wygeneruj|stwórz|opracuj|utwórz|zrób|wyślij|złóż|wnieś|projekt\p{L}*|wzór|wzoru|szablon\p{L}*)(?![\p{L}])/iu;
const REVIEW = /(?<![\p{L}])(?:przeanalizuj|analiz\p{L}*|oceń|ocen\p{L}*|sprawdź|zweryfikuj|zbadaj|wyjaśnij|zasadn\p{L}*|dostałe?m|dostałam|otrzymałe?m|otrzymałam|przyszł\p{L}*|czy\s+(?:muszę|mam|jest|są|należy|powinien\p{L}*|trzeba)|co\s+(?:mam\s+)?(?:zrobić|robić))(?![\p{L}])/iu;
const REPLY_TO_DEMAND = /(?<![\p{L}])odpow\p{L}*\s+na\s+(?:\p{L}+\s+)?wezwani/iu;
/**
 * The schema to draft with, only when the user asks to draft that letter: a
 * question about a received letter ("przeanalizuj to wezwanie", "dostałem
 * wezwanie, czy muszę płacić?") is an analysis, and a reply to a payment demand
 * is not the creditor's demand (SPE).
 */
export function draftingSchema(entries, text, delivered = {}) {
    const schema = matchSchema(entries, text);
    if (!schema)
        return null;
    const demand = schema.code === "SPE" || schema.code === "SPE-O";
    if (demand && REPLY_TO_DEMAND.test(text))
        return null;
    if (DRAFT.test(text))
        return schema;
    // No drafting verb: a question about the letter, or the same letter delivered, is analysis.
    if (REVIEW.test(text) || (demand && delivered.demand))
        return null;
    return schema;
}
export function asksToDraft(text) {
    return DRAFT.test(text);
}
/** A question about a letter (received or one's own), not a request to draft it. */
export function asksAbout(text) {
    return REVIEW.test(text) && !DRAFT.test(text);
}
export function repliesToDemand(text) {
    return REPLY_TO_DEMAND.test(text);
}
