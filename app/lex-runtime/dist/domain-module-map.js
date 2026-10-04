import fs from "node:fs";
import path from "node:path";
import { provisionsForDetection } from "./legal-act-abbreviations.js";
// Lowercase without diacritics: module names are ASCII ("zasilek-pogrzebowy").
export function fold(text) {
    return text
        .toLocaleLowerCase("pl")
        .replace(/ł/g, "l")
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
}
const STOP = new Set([
    "ustawa", "ustawy", "ustawie", "akt", "aktu", "akty", "zakres", "przepisy", "przepisow", "przepis", "prawo", "prawa",
    "modul", "current", "state", "uzupelnienie", "pokrycia", "routing", "inne", "pozostale", "dzial", "rozdzial", "rozdzialy",
    "oraz", "albo", "przez", "jako", "dotyczy", "wlasciwe", "wlasciwy", "biezace", "aktualne", "brzmienie", "indeks", "calego",
    "framework", "rodzina", "modulow", "lub", "dla", "the", "and", "nowe", "nowy", "zmiany", "przyp", "jw",
    "czy", "sie", "po", "za", "mi", "jak", "nie", "do", "od", "na", "ze", "co", "to", "gdy", "kiedy", "jest", "oraz"
]);
// Words of four letters and more, and abbreviations written in capitals (KP, ZUS, VAT).
function words(text) {
    return [
        ...new Set((text.match(/[\p{L}0-9]{2,}/gu) ?? [])
            .filter((word) => word.length >= 4 || /^[\p{Lu}]{2,}$/u.test(word))
            .map(fold)
            .filter((word) => !STOP.has(word) && !/^\d+$/.test(word) && !/^(?:prze|przy|przez|przed)$/.test(word)))
    ];
}
// A short word (an abbreviation: KP, ZUS, RODO) matches whole; a longer one by its stem.
function stemOf(word) {
    return word.length <= 4 ? `=${word}` : word.slice(0, Math.max(4, word.length - 2));
}
function hit(stem, tokens) {
    return stem.startsWith("=") ? tokens.includes(stem.slice(1)) : tokens.some((token) => token.startsWith(stem));
}
// What a module says it covers: its headings and its "Zakres:" paragraph.
function moduleHead(file) {
    if (!file)
        return "";
    let head = "";
    try {
        head = fs.readFileSync(file, "utf8").slice(0, 2_500);
    }
    catch {
        return "";
    }
    const headings = head
        .split("\n")
        .filter((line) => /^#{1,3}\s/.test(line) && !/HARD GATE|ALERT|ZAKAZ|CZYTAJ|CHANGELOG|STATUS/iu.test(line))
        .map((line) => line.replace(/^#+\s*/, "").replace(/\.md\b/g, ""));
    const scope = /\*\*Zakres:?\*\*:?\s*([\s\S]{0,400}?)(?:\n\s*\n|$)/u.exec(head)?.[1] ?? "";
    return [...headings, scope.replace(/\(art[^)]*\)/g, " ")].join(" ");
}
function tokens(text) {
    return fold(provisionsForDetection(text)).match(/[a-z0-9]{2,}/g) ?? [];
}
export function parseFlashRouting(markdown) {
    const section = /## Routing błyskawiczny[\s\S]*?(?=\n## |$)/u.exec(markdown)?.[0] ?? "";
    const rows = [];
    for (const line of section.split("\n")) {
        const cells = line.split("|").map((cell) => cell.trim());
        const skill = /`(dr-\d{2}-[^`]+)`/u.exec(cells[2] ?? "")?.[1];
        if (!skill)
            continue;
        rows.push({ skill: skill.toLowerCase(), phrases: cells[1].split(",").map((phrase) => phrase.trim()).filter(Boolean) });
    }
    return rows;
}
/** Domains whose flash-routing phrases the text contains, best first. */
export function flashDomains(rows, text) {
    const have = tokens(text);
    return rows
        .map((row) => ({
        skill: row.skill,
        matched: row.phrases.filter((phrase) => {
            const stems = words(phrase).map(stemOf);
            return stems.length > 0 && stems.every((stem) => hit(stem, have));
        })
    }))
        .filter((row) => row.matched.length > 0)
        .sort((a, b) => b.matched.length - a.matched.length);
}
export function parseActMap(markdown, skill) {
    const entries = [];
    let moduleColumn = -1;
    for (const line of markdown.split("\n")) {
        if (!line.trim().startsWith("|")) {
            moduleColumn = -1;
            continue;
        }
        const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
        const header = cells.findIndex((cell) => /^Moduł/u.test(cell));
        if (header >= 0) {
            moduleColumn = header;
            continue;
        }
        if (moduleColumn < 0 || /^:?-+/.test(cells[0] ?? ""))
            continue;
        const cell = cells[moduleColumn] ?? "";
        const resources = [
            ...cell.matchAll(/`((?:dr-\d{2}-[a-z0-9-]+\/modules\/)?mod-[A-Za-z0-9._-]+?)(?:\.md)?`/g)
        ].map((match) => (match[1].startsWith("dr-") ? `${match[1]}.md` : `${skill}/modules/${match[1]}.md`));
        if (resources.length)
            entries.push({ scope: cells[0].replace(/\*\*/g, ""), resources });
    }
    return entries;
}
// A module named without its domain ("mod-KPA-..." in DR-04's map lives in DR-05).
function locate(registry, skill, resource) {
    if (registry.resolveResource(skill, resource))
        return resource;
    const name = path.basename(resource);
    for (const other of registry.skills.values()) {
        if (!other.name.startsWith("dr-") || other.name === skill)
            continue;
        const candidate = `${other.name}/modules/${name}`;
        if (registry.resolveResource(other.name, candidate))
            return candidate;
    }
    return null;
}
const cache = new Map();
function actIndex(registry, skill) {
    const record = registry.get(skill);
    if (!record)
        return { index: [], df: new Map() };
    const file = path.join(record.directory, "MAPA-AKTOW.md");
    let body = "";
    try {
        body = fs.readFileSync(file, "utf8");
    }
    catch {
        return { index: [], df: new Map() };
    }
    const key = `${file}:${body.length}`;
    if (cache.has(key))
        return cache.get(key);
    const index = parseActMap(body, skill)
        .map((entry) => ({ ...entry, resources: entry.resources.map((resource) => locate(registry, skill, resource)).filter((resource) => resource !== null) }))
        .filter((entry) => entry.resources.length > 0)
        .map((entry) => {
        // What the module is about: the act or scope, and the module's own name.
        const names = entry.resources.map((resource) => path.basename(resource, ".md").replace(/^mod-/, "").replace(/-/g, " "));
        const heads = entry.resources.map((resource) => moduleHead(registry.resolveResource(resource.split("/")[0], resource)));
        return { entry, stems: [...new Set(words([entry.scope, ...names, ...heads].join(" ")).map(stemOf))] };
    });
    const df = new Map();
    for (const item of index)
        for (const stem of item.stems)
            df.set(stem, (df.get(stem) ?? 0) + 1);
    const value = { index, df };
    cache.set(key, value);
    return value;
}
/** The domain's act modules the case text points to (rarer words weigh more). */
export function suggestDomainModules(registry, skill, text, limit = 3) {
    const { index, df } = actIndex(registry, skill);
    const have = tokens(text);
    const scored = index
        .map((item) => {
        const matched = item.stems.filter((stem) => hit(stem, have));
        const score = matched.reduce((sum, stem) => sum + 1 / (df.get(stem) ?? 1), 0);
        return { item, matched, score };
    })
        // One specific word (in at most two rows) or two common ones.
        // A specific word (in at most two rows): a long one alone, a short stem only with another word.
        .filter((row) => row.score >= 0.5 &&
        row.matched.some((stem) => (df.get(stem) ?? 1) <= 2 && (stem.length >= 5 || row.matched.length >= 2)))
        .sort((a, b) => b.score - a.score);
    const result = [];
    for (const row of scored) {
        for (const resource of row.item.entry.resources) {
            if (result.length >= limit || result.some((item) => item.resource === resource))
                continue;
            result.push({ resource, why: `MAPA-AKTOW: ${row.item.entry.scope.slice(0, 90)}`, score: Number(row.score.toFixed(2)), matched: row.matched });
        }
    }
    return result;
}
/**
 * The domains for this text: the flash-routing rows it names, else the domains
 * whose act maps it points to most (one specific act or scope).
 */
export function rankDomains(registry, rows, text, limit = 2) {
    const flash = flashDomains(rows, text)
        .filter((row) => registry.get(row.skill))
        .map((row) => ({ ...row, modules: suggestDomainModules(registry, row.skill, text) }))
        .sort((a, b) => b.matched.length - a.matched.length || (b.modules[0]?.score ?? 0) - (a.modules[0]?.score ?? 0))
        .slice(0, limit);
    if (flash.length)
        return flash;
    return [...registry.skills.values()]
        .filter((skill) => /^dr-\d{2}-/.test(skill.name))
        .map((skill) => ({ skill: skill.name, modules: suggestDomainModules(registry, skill.name, text) }))
        .filter((row) => (row.modules[0]?.score ?? 0) >= 1)
        .sort((a, b) => b.modules[0].score - a.modules[0].score)
        .slice(0, limit)
        .map((row) => ({ skill: row.skill, matched: [`mapa aktów: ${row.modules[0].why.replace(/^MAPA-AKTOW: /, "")}`], modules: row.modules }));
}
export function domainHintPrompt(domains) {
    return [
        "# DZIEDZINA I MODUŁ AKTU — WSKAZÓWKA APLIKACJI (prawo-polskie-v2: routing błyskawiczny, MAPA-AKTOW dziedziny)",
        ...domains.map((domain) => `- ${domain.skill}: sygnały ${domain.matched.map((phrase) => `„${phrase}”`).join(", ")}` +
            (domain.modules.length ? `; moduły aktu dla tej sprawy: ${domain.modules.map((module) => `${module.resource} (${module.why})`).join("; ")}` : "")),
        "Ścieżka prawo-polskie-v2: SKILL.md właściwej dziedziny, potem moduł aktu prawnego z jej MAPA-AKTOW. Gdy treść sprawy wskazuje inną dziedzinę lub inny moduł, powiedz to wprost i wczytaj właściwy."
    ].join("\n");
}
