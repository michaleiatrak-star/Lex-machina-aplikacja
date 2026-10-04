import fs from "node:fs";
const MAP_HEADING = /MODUŁ|MODUL|WCZYT|REFERENCES|LAZY|MAPA/iu;
const RESOURCE = /(?:shared|references|modules|assets|templates)\/[A-Za-z0-9._\-/]+?\.md\b|[a-z0-9-]+-v\d+(?:-min90)?\/(?:references|modules)\/[A-Za-z0-9._\-/]+?\.md\b/g;
const STAGE = /\b(W[1-6])(?:\.\d+[a-z]?)?\b/u;
const STOP = new Set(["umowa", "umowy", "każdy", "każda", "wczytaj", "moduł", "ścieżka", "sprawa", "sprawy", "gdy", "przed", "pismo", "pisma", "zawsze", "obowiązkowe"]);
const cache = new Map();
export function moduleMap(registry, skill) {
    const record = registry.get(skill);
    if (!record)
        return [];
    let body;
    try {
        body = fs.readFileSync(record.skillFile, "utf8");
    }
    catch {
        return [];
    }
    const key = `${record.skillFile}:${body.length}`;
    if (cache.has(key))
        return cache.get(key);
    const entries = [];
    let heading = "";
    let inMap = false;
    let mapLevel = 0;
    const lines = body.split("\n");
    for (const [index, line] of lines.entries()) {
        const title = /^(#{1,5})\s+(.*)$/.exec(line);
        if (title) {
            const level = title[1].length;
            if (inMap && level <= mapLevel && !MAP_HEADING.test(title[2]))
                inMap = false;
            if (MAP_HEADING.test(title[2])) {
                inMap = true;
                mapLevel = level;
            }
            heading = title[2].trim();
            continue;
        }
        if (!inMap)
            continue;
        for (const match of line.matchAll(RESOURCE)) {
            const raw = match[0];
            const resource = raw.startsWith("shared/") || raw.startsWith(`${skill}/`) || /-v\d+(?:-min90)?\//.test(raw) ? raw : `${skill}/${raw}`;
            if (!registry.resolveResource(skill, resource))
                continue;
            // Condition: the table's first cell, or the text around the path (and the
            // indented continuation lines of a code block entry).
            const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
            let condition = cells.length >= 3 ? cells[0] : line.replace(raw, " ").replace(/`|view|\*\*/g, " ");
            for (let next = index + 1; next < lines.length && /^\s{20,}\S/.test(lines[next]) && !RESOURCE.test(lines[next]); next += 1) {
                condition += ` ${lines[next].trim()}`;
            }
            RESOURCE.lastIndex = 0;
            condition = condition.replace(/\s+/g, " ").replace(/[()]/g, " ").trim();
            const stage = STAGE.exec(heading)?.[1] ?? null;
            // "zawsze" / "OBOWIĄZKOWE" without a condition; "OBOWIĄZKOWE gdy ..." stays conditional.
            entries.push({ resource, condition, heading, stage, always: /\bzawsze\b|ZAWSZE|OBOWIĄZKOW/iu.test(condition) && !/\bgdy\b|\bprzy\b/iu.test(condition) });
        }
    }
    const unique = entries.filter((entry, position) => entries.findIndex((other) => other.resource === entry.resource && other.stage === entry.stage) === position);
    cache.set(key, unique);
    return unique;
}
// One group of variants per condition word ("najem" -> "naj", "najm").
function stems(text) {
    return [...new Set(text.toLocaleLowerCase("pl").match(/\p{L}{5,}/gu) ?? [])]
        .filter((word) => !STOP.has(word))
        .map((word) => {
        const base = word.slice(0, Math.max(4, word.length - 2));
        // "najem" -> "najm" (najmu), "pozew" -> "pozw" (pozwu)
        const dropped = /e[a-ząćęłńóśźż]$/u.test(word) ? word.slice(0, -2) + word.slice(-1) : null;
        return [base, ...(dropped && dropped.length >= 4 ? [dropped] : [])].map((stem) => new RegExp(`(?<![\\p{L}])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "iu"));
    });
}
/** Entries that apply: the stage (if any) and "always", or a condition the case text meets. */
export function triggeredModules(entries, args) {
    const result = [];
    for (const entry of entries) {
        if (entry.stage && entry.stage !== args.stage)
            continue;
        if (entry.always) {
            result.push({ ...entry, why: entry.stage ? `etap ${entry.stage}: zawsze` : "zawsze" });
            continue;
        }
        // A long condition needs two of its words in the case text, a short one one.
        // "gdy <trigger> — <explanation>": the trigger clause alone decides.
        const trigger = /\bgdy:?\s+([^—–;(]+)/iu.exec(entry.condition)?.[1];
        const conditionStems = stems(trigger ?? entry.condition);
        const hits = conditionStems.filter((variants) => variants.some((stem) => stem.test(args.text))).length;
        if (hits >= (!trigger && conditionStems.length >= 5 ? 2 : 1))
            result.push({ ...entry, why: `warunek: ${entry.condition.slice(0, 80)}` });
    }
    return result.filter((entry, position) => result.findIndex((other) => other.resource === entry.resource) === position);
}
export const MODULE_BUDGET_CHARS = 40_000;
/** Loads the triggered modules within the budget; the rest the model reads itself. */
export function loadModules(registry, skill, modules, inContext, budget = MODULE_BUDGET_CHARS) {
    const loaded = [];
    const toRead = [];
    let left = budget;
    for (const module of modules) {
        if (inContext.has(module.resource))
            continue;
        const file = registry.resolveResource(skill, module.resource);
        let content = "";
        try {
            content = file ? fs.readFileSync(file, "utf8") : "";
        }
        catch {
            content = "";
        }
        if (!content.trim())
            continue;
        if (content.length > left) {
            toRead.push({ resource: module.resource, why: module.why });
            continue;
        }
        left -= content.length;
        loaded.push({ resource: module.resource, why: module.why, content });
    }
    return { loaded, toRead };
}
export function modulesPrompt(skill, result) {
    return [
        `# MODUŁY SKILLA ${skill} WYZWOLONE W TEJ SPRAWIE (aplikacja, z mapy modułów w SKILL.md)`,
        ...result.loaded.map((item) => `- ${item.resource} — ${item.why} (wczytany poniżej)`),
        ...result.toRead.map((item) => `- ${item.resource} — ${item.why} (wczytaj sam narzędziem korpusu; aplikacja to sprawdza)`),
        "Pozostałe moduły z mapy wczytuj, gdy ich warunek pojawi się w toku pracy.",
        ...result.loaded.map((item) => `## MODUŁ: ${item.resource}\n\n${item.content}`)
    ].join("\n\n");
}
