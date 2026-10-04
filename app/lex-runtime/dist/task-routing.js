import { provisionsForDetection } from "./legal-act-abbreviations.js";
const ROW = /^###\s+\[(\d{1,2})\]\s+(.+)$/u;
export function parseRoutingTable(router) {
    const section = /## KROK 2 — ROUTING \[1\]–\[11\][\s\S]*?(?=\n## )/u.exec(router)?.[0] ?? "";
    const routes = [];
    let current = null;
    let pending = null;
    const addPhrases = (raw) => current.phrases.push(...raw
        .split(/\s+\/\s+|^\/\s+|\s+\/$/u)
        .map((phrase) => phrase.replace(/["„”`]/gu, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pl"))
        .filter((phrase) => phrase.length >= 3));
    for (const line of section.split("\n")) {
        const row = ROW.exec(line);
        if (row) {
            if (current?.primary)
                routes.push(current);
            current = { id: row[1], title: row[2].trim(), phrases: [], primary: "", secondary: [] };
            pending = null;
            continue;
        }
        if (!current)
            continue;
        const trimmed = line.trim();
        // The phrase list is one backtick span, possibly over several lines.
        if (pending !== null) {
            const end = trimmed.indexOf("`");
            if (end < 0) {
                pending += ` ${trimmed}`;
                continue;
            }
            addPhrases(`${pending} ${trimmed.slice(0, end)}`);
            pending = null;
            continue;
        }
        if (!current.phrases.length && trimmed.startsWith("`") && !trimmed.startsWith("``")) {
            const end = trimmed.indexOf("`", 1);
            if (end < 0)
                pending = trimmed.slice(1);
            else
                addPhrases(trimmed.slice(1, end));
            continue;
        }
        const primary = /→\s*PRIMARY:\s*`view\s+([a-z0-9-]+)\/SKILL\.md`/u.exec(line);
        if (primary)
            current.primary = primary[1];
        const secondary = /→\s*SECONDARY:\s*(.+)$/u.exec(line);
        if (secondary)
            current.secondary = [...secondary[1].matchAll(/`([a-z0-9-]+)`/gu)].map((match) => match[1]);
    }
    if (current?.primary)
        routes.push(current);
    return routes;
}
const ARTICLE = /\bart\.?\s*\d+|§\s*\d+/iu;
function stemPhrase(phrase) {
    if (phrase === "art. x")
        return ARTICLE;
    if (phrase === "§ y")
        return null;
    // Word starts: "wyrok" matches "wyroku", "apelacja" matches "apelację".
    const words = phrase
        .split(/\s+/u)
        .map((word) => word.replace(/[^\p{L}\p{N}.-]/gu, ""))
        .filter(Boolean)
        .map((word) => (word.length >= 8 ? word.slice(0, word.length - 2) : word.length >= 5 ? word.slice(0, word.length - 1) : word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!words.length)
        return null;
    return new RegExp(`(?<![\\p{L}])${words.join("\\p{L}*\\s+")}`, "iu");
}
/**
 * The route whose phrases match the question best (longest matched phrases win;
 * [10] is the domain router, already in the context, and does not name an
 * executive skill). Null when no executive route matches.
 */
export function classifyTask(routes, rawQuestion) {
    // "233 kk" is "art. 233 KK" for the article row.
    const question = provisionsForDetection(rawQuestion);
    let best = null;
    for (const route of routes) {
        if (route.primary === "prawo-polskie-v2")
            continue;
        const matched = route.phrases.filter((phrase) => stemPhrase(phrase)?.test(question));
        if (!matched.length)
            continue;
        const score = matched.reduce((sum, phrase) => sum + phrase.length, 0);
        if (!best || score > best.score)
            best = { route, matched, score };
    }
    return best ? { route: best.route, matched: best.matched } : null;
}
export function parseActivationMatrix(markdown) {
    const section = /## MACIERZ AKTYWACJI[\s\S]*?(?=\n## )/u.exec(markdown)?.[0] ?? "";
    const rules = [];
    for (const line of section.split("\n")) {
        const cells = line.split("|").map((cell) => cell.trim());
        if (cells.length < 4 || !cells[2].includes("`"))
            continue;
        const signal = cells[1];
        const skills = [...cells[2].matchAll(/`([a-z0-9-]+)`/gu)].map((match) => match[1]);
        if (!skills[0] || !/-v\d|min90/.test(skills[0]))
            continue;
        const phrases = [...signal.matchAll(/"([^"]+)"/gu)].flatMap((match) => match[1].split(/\s*\/\s*/u).map((phrase) => phrase.trim().toLocaleLowerCase("pl")).filter((phrase) => phrase.length >= 3));
        // "napisz pozew / apelację / zażalenie" in quotes is one verb with alternatives.
        const expanded = phrases.flatMap((phrase, index) => {
            const head = phrases[0].split(/\s+/u)[0];
            return index > 0 && !phrase.includes(" ") && phrases[0].includes(" ") ? [`${head} ${phrase}`] : [phrase];
        });
        const deliveryText = /dostarcz\p{L}*\s+([^|]+)/iu.exec(signal)?.[1] ?? (/\+\s*dostarczone\s+(\p{L}+)/iu.exec(signal)?.[1] ?? "");
        const delivers = deliveryText
            .replace(/\(.*?\)/gu, "")
            .split(/\s*\/\s*|\s+bez\s+/u)
            .map((item) => item.trim().toLocaleLowerCase("pl"))
            .filter((item) => item.length >= 3 && item !== "pisma");
        const pleadingTask = /pismo\s+procesowe\s*\+/iu.test(signal);
        rules.push({
            signal,
            phrases: expanded,
            delivers: pleadingTask ? ["akta"] : delivers,
            withoutPleading: /bez\s+pisma/iu.test(signal),
            primary: skills[0],
            then: skills[1] && /→/u.test(cells[2]) ? skills[1] : null
        });
    }
    return rules;
}
// What a delivered document counts as in the matrix's words.
function deliveryWords(material) {
    switch (material.category) {
        case "ORZECZENIE":
            return ["akta", "wyrok", material.label];
        case "PISMO_PROCESOWE":
            return ["akta", "pismo przeciwnika", material.label];
        default:
            return material.evidence ? ["dowody", material.label] : [material.label];
    }
}
/**
 * Entry point for the task: the activation matrix first (phrases of the question
 * and the materials delivered), then the router table on the question and the
 * kinds of the delivered documents.
 */
export function decideTask(routes, matrix, rawQuestion, materials = []) {
    // The user pressed "continue" on a pipeline step: that skill, explicitly.
    const known = new Set([...routes.map((route) => route.primary), ...matrix.flatMap((rule) => [rule.primary, rule.then ?? ""])]);
    const handoff = explicitHandoff(rawQuestion, (skill) => known.has(skill));
    if (handoff)
        return { source: "MATRIX", primary: handoff, then: null, reason: "następny etap pipeline'u wskazany przez użytkownika" };
    const question = provisionsForDetection(rawQuestion);
    const delivered = new Set(materials.flatMap(deliveryWords));
    const pleadingDelivered = materials.some((material) => material.category === "ORZECZENIE" || material.category === "PISMO_PROCESOWE");
    const routerPick = classifyTask(routes, rawQuestion);
    const pleadingTask = routerPick?.route.primary === "pisma-procesowe-v3";
    let best = null;
    for (const rule of matrix) {
        const phrases = rule.phrases.filter((phrase) => stemPhrase(phrase)?.test(question));
        const deliveredHits = rule.delivers.filter((word) => delivered.has(word));
        if (rule.withoutPleading && pleadingDelivered)
            continue;
        // "pismo procesowe + dostarczone akta": a pleading task with case files.
        if (/pismo\s+procesowe\s*\+/iu.test(rule.signal) && !(pleadingTask && deliveredHits.length))
            continue;
        if (!phrases.length && !deliveredHits.length)
            continue;
        const score = phrases.reduce((sum, phrase) => sum + phrase.length, 0) + deliveredHits.length * 25 + (rule.then ? 30 : 0);
        if (!best || score > best.score) {
            best = { rule, score, why: [...phrases.map((phrase) => `fraza „${phrase}”`), ...deliveredHits.map((word) => `dostarczono: ${word}`)] };
        }
    }
    if (best) {
        return { source: "MATRIX", primary: best.rule.primary, then: best.rule.then, reason: `macierz aktywacji: ${best.rule.signal} (${best.why.join(", ")})` };
    }
    // No matrix row: the router table on the question and the kinds of the documents.
    const byDocuments = routerPick ?? classifyTask(routes, `${rawQuestion}\n${materials.map((material) => material.label).join(" / ")}`);
    return byDocuments
        ? { source: "ROUTER", primary: byDocuments.route.primary, then: null, reason: `routing [${byDocuments.route.id}] ${byDocuments.route.title} (${byDocuments.matched.join(", ")})`, route: byDocuments.route }
        : null;
}
export function parseCombinations(markdown) {
    const section = /## KOMBINACJE SKILLI[\s\S]*?(?=\n## |$)/u.exec(markdown)?.[0] ?? "";
    const rows = [];
    for (const line of section.split("\n")) {
        const cells = line.split("|").map((cell) => cell.trim());
        if (cells.length < 4 || !cells[2] || !/[a-z]-v\d|min90/.test(cells[2]))
            continue;
        const entry = /([a-z0-9-]+-v\d+(?:-min90)?)/u.exec(cells[2])?.[1];
        // "→ a → b": the following skills; "← x (źródło)" is a data source, not a next step.
        const next = cells[3].trim().startsWith("→")
            ? [...cells[3].matchAll(/([a-z0-9-]+-v\d+(?:-min90)?)/gu)].map((match) => match[1])
            : [];
        if (entry)
            rows.push({ matter: cells[1], entry, next });
    }
    return rows;
}
export const PIPELINE_HANDOFF = "Następny etap pipeline'u:";
/** The next skill after this one: the matrix's own "→", else the first combination it enters. */
export function pipelineNext(skill, then, combinations) {
    if (then)
        return { skill: then, reason: "macierz aktywacji (wejście → następny etap)" };
    const combination = combinations.find((row) => row.entry === skill && row.next.length);
    return combination ? { skill: combination.next[0], reason: `kombinacja skilli: ${combination.matter}` } : null;
}
/** "Następny etap pipeline'u: <skill>" sent by the app's own continue button. */
export function explicitHandoff(question, known) {
    const skill = new RegExp(`${PIPELINE_HANDOFF.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([a-z0-9-]+)`, "u").exec(question)?.[1];
    return skill && known(skill) ? skill : null;
}
