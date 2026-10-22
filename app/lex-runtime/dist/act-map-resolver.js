import { compactForModel } from "./skill-sections.js";
import fs from "node:fs";
import path from "node:path";
import { provisionsForDetection } from "./legal-act-abbreviations.js";
import { fileStamp, fold, locate } from "./domain-module-map.js";
const CODES = {
    KK: /kodeks\s+karny(?!\s+(?:skarbowy|wykonawczy))/iu,
    KW: /kodeks\s+wykrocze/iu,
    KC: /kodeks\s+cywilny/iu,
    KP: /kodeks\s+pracy/iu,
    KPC: /kodeks\s+postępowania\s+cywilnego/iu,
    KPK: /kodeks\s+postępowania\s+karnego/iu,
    KPA: /kodeks\s+postępowania\s+administracyjnego/iu,
    KRO: /kodeks\s+rodzinny/iu,
    KSH: /kodeks\s+spółek\s+handlowych/iu,
    KKS: /kodeks\s+karny\s+skarbowy/iu,
    KKW: /kodeks\s+karny\s+wykonawczy/iu,
    KPW: /kodeks\s+postępowania\s+w\s+sprawach\s+o\s+wykrocz/iu,
    OP: /ordynacj\p{L}*\s+podatkow/iu,
    PPSA: /postępowani\p{L}*\s+przed\s+sądami\s+administracyjnymi/iu
};
const CODE_TOKEN = new RegExp(`(?<![\\p{L}])(${Object.keys(CODES).join("|")})(?![\\p{L}])`, "gu");
// Words that never make a row's phrase on their own.
const GENERIC = new Set([
    "ustawa", "ustawy", "kodeks", "prawo", "przepisy", "indeks", "current", "state", "całego", "kodeksu", "aktu", "moduł", "główny",
    "framework", "ogólny", "szczegółowy", "pozostałe", "części", "routing", "oraz", "właściwe", "akty", "wykonawcze", "zakres",
    "przekrojowy", "uzupełnienie", "pokrycia", "rozdziały", "działy", "inne", "ogólne", "sprawy", "sprawach",
    // Too general to select a module alone (single-word map phrases).
    "podstawa", "podstawy", "zdrowie", "terminy", "sankcje", "nadzorca", "nadzór", "lotniczy", "morski", "obrona", "opieka",
    "układ", "media", "plany", "zwrot", "umowy", "umowa", "osoba", "obrót", "norma", "mienie", "zapłata", "poczta", "obwody",
    "zabezpieczenie", "zabezpieczenia", "wykonanie"
]);
function parseNumber(value) {
    const match = /^(\d+)([a-z]*)$/u.exec(value) ?? ["", "0", ""];
    return [Number(match[1]), match[2] ?? ""];
}
function compare(a, b) {
    return a[0] - b[0] || a[1].localeCompare(b[1]);
}
// "(art. 270-277d, 310 KK)" in the module's own heading: its declared scope.
function declaredRanges(registry, resource) {
    let head = "";
    try {
        const file = registry.resolveResource(resource.split("/")[0], resource);
        head = file ? fs.readFileSync(file, "utf8").split("\n").find((line) => /^#\s/.test(line)) ?? "" : "";
    }
    catch {
        return null;
    }
    const list = /\(art\.\s*([^)]*?)\s+(?:KK|KW|KC|KP|KPC|KPK|KPA|KRO|KSH|KKS|KKW|KPW)\b/u.exec(head)?.[1];
    if (!list)
        return null;
    const result = [];
    for (const part of list.split(/,|\bi\b/u)) {
        const match = /(\d+[a-z]*)(?:\s*[–-]\s*(\d+[a-z]*))?/u.exec(part.trim());
        if (match)
            result.push({ from: parseNumber(match[1]), to: parseNumber(match[2] ?? match[1]) });
    }
    return result.length ? result : null;
}
function ranges(text) {
    const result = [];
    for (const match of text.matchAll(/art\.?\s*(\d+[a-z]*)(?:\s*[–-]\s*(\d+[a-z]*))?/giu)) {
        result.push({ from: parseNumber(match[1]), to: parseNumber(match[2] ?? match[1]) });
    }
    // "mod-KK-art148-162-...", "mod-KW-art70-118-..."
    for (const match of text.matchAll(/-art(\d+[a-z]?)(?:-(\d+[a-z]?))?-/gu)) {
        result.push({ from: parseNumber(match[1]), to: parseNumber(match[2] ?? match[1]) });
    }
    return result;
}
function stemPattern(word) {
    const lower = fold(word);
    const stem = lower.length <= 4 ? lower : lower.slice(0, Math.max(4, lower.length - 2));
    return `${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*`;
}
// Parts of the label with at least three distinctive words, as a set of stems.
function bags(label) {
    return label
        .replace(/\([^)]*\)/g, " ")
        .split(/\s+—\s+|\s*\/\s*|\s*\+\s*|,|;/u)
        .map((part) => (part.match(/\p{L}{4,}/gu) ?? []).filter((word) => !GENERIC.has(word.toLocaleLowerCase("pl")) && !(CODE_TOKEN.lastIndex = 0, CODE_TOKEN.test(word))))
        .filter((words) => words.length >= 3)
        .map((words) => words.map((word) => new RegExp(`(?<![a-z])${stemPattern(word)}`, "u")));
}
// The row's phrases: each part of the label ("Prawo łowieckie — szkody łowieckie",
// "Wycinka / odpady niebezpieczne") as a sequence of word stems.
function phrases(label) {
    const result = [];
    const single = [];
    const tail = [];
    const segments = label
        .replace(/\([^)]*\)/g, " ")
        .replace(/\bart\.?\s*\d+[a-z]*(?:\s*[–-]\s*\d+[a-z]*)?/giu, " ")
        .split(/\s+—\s+/u);
    // Parts after the head ("KP — praca zdalna"): only with a head, i.e. a label with " — ".
    const parts = segments.flatMap((segment, index) => segment.split(/\s*\/\s*|\s*\+\s*|,|;/u).map((part) => ({ part, tail: segments.length > 1 && index > 0 })));
    for (const { part, tail: inTail } of parts) {
        const words = (part.match(/\p{L}{3,}/gu) ?? []).filter((word) => !CODE_TOKEN.test(word) && (CODE_TOKEN.lastIndex = 0, true));
        const significant = words.filter((word) => !GENERIC.has(word.toLocaleLowerCase("pl")));
        if (!significant.length)
            continue;
        // One word only when long and specific ("kłusownictwo", "patostreaming").
        if (words.length === 1 && (words[0].length < 7 || GENERIC.has(words[0].toLocaleLowerCase("pl"))))
            continue;
        const stems = words.map((word) => {
            const lower = fold(word);
            const stem = lower.length <= 4 ? lower : lower.slice(0, Math.max(4, lower.length - 2));
            return `${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[a-z]*`;
        });
        const pattern = new RegExp(`(?<![a-z])${stems.join("(?:\\s+[a-z]+){0,1}\\s+")}`, "u");
        if (words.length === 1) {
            // One word: its stem with a short ending only ("zachowek", "zachowku", not "zachowanie").
            const folded = fold(words[0]);
            const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const stems = [folded.slice(0, Math.max(5, folded.length - 1))];
            // Mobile e: "zachowek" -> "zachowku", "kupiec" -> "kupca".
            if (/e[a-z]$/.test(folded))
                stems.push(folded.slice(0, -2) + folded.slice(-1));
            single.push(new RegExp(`(?<![a-z])(?:${stems.map(escape).join("|")})[a-z]{0,3}(?![a-z])`, "u"));
        }
        else {
            (inTail ? tail : result).push(pattern);
        }
    }
    return { multi: result, single, tail };
}
// "KC — zachowek / dział": the part before " — ". An abbreviation ("KC", "VAT", "PrUp") is
// matched as written, words by their stems.
function headOf(label) {
    const parts = label.replace(/\([^)]*\)/g, " ").split(/\s+—\s+/u);
    if (parts.length < 2)
        return null;
    const head = parts[0].replace(/[⛔✅⚠️🟢🟨\uFE0F*]/gu, " ").replace(/\bart\.?\s*\d+[a-z]*(?:\s*[–-]\s*\d+[a-z]*)?/giu, " ").trim();
    const tokens = head.match(/\p{L}+/gu) ?? [];
    const abbreviations = tokens.filter((token) => token.length <= 6 && /\p{Lu}/u.test(token.slice(1) || token) && token !== token.toLocaleLowerCase("pl"));
    if (abbreviations.length) {
        return new RegExp(`(?<![\\p{L}])(?:${abbreviations.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}])`, "u");
    }
    const words = tokens.filter((token) => token.length >= 4 && !GENERIC.has(token.toLocaleLowerCase("pl")));
    return words.length ? new RegExp(`(?<![a-z])${words.map(stemPattern).join("(?:\\s+[a-z]+){0,1}\\s+")}`, "u") : null;
}
// Jeden wpis na katalog skilli; klucz z mtime i rozmiaru map (edycja tej samej długości
// też unieważnia indeks), pliki czytane tylko po zmianie.
const cache = new Map();
const RARE_IN_MODULES = 10;
const GENERAL_MODULES = 30;
const GENERAL_DOMAINS = 8;
function actRows(registry) {
    const skills = [...registry.skills.values()].filter((skill) => /^dr-\d{2}-/.test(skill.name)).sort((a, b) => a.name.localeCompare(b.name));
    const files = skills.map((skill) => path.join(skill.directory, "MAPA-AKTOW.md"));
    const key = files.map((file) => `${file}=${fileStamp(file)}`).join(",");
    const cached = cache.get(registry.root);
    if (cached?.key === key)
        return cached.rows;
    const bodies = files.map((file) => {
        try {
            return fs.readFileSync(file, "utf8");
        }
        catch {
            return "";
        }
    });
    const rows = [];
    skills.forEach((skill, position) => {
        let moduleColumn = -1;
        let basisColumn = -1;
        let previousBasis = "";
        for (const line of bodies[position].split("\n")) {
            if (!line.trim().startsWith("|")) {
                moduleColumn = -1;
                continue;
            }
            const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
            const header = cells.findIndex((cell) => /^Moduł/u.test(cell));
            if (header >= 0) {
                moduleColumn = header;
                basisColumn = cells.findIndex((cell, index) => index > 0 && index !== header && /podstaw|źródło|Dz\.U/iu.test(cell));
                continue;
            }
            if (moduleColumn < 0 || /^:?-+/.test(cells[0] ?? ""))
                continue;
            const resources = [...(cells[moduleColumn] ?? "").matchAll(/`((?:dr-\d{2}-[a-z0-9-]+\/modules\/)?mod-[A-Za-z0-9._-]+?)(?:\.md)?`/g)]
                .map((match) => (match[1].startsWith("dr-") ? `${match[1]}.md` : `${skill.name}/modules/${match[1]}.md`))
                .map((resource) => locate(registry, skill.name, resource))
                .filter((resource) => resource !== null);
            if (!resources.length)
                continue;
            const label = (cells[0] ?? "").replace(/\*\*/g, "");
            const codes = new Set();
            for (const match of label.matchAll(CODE_TOKEN))
                codes.add(match[1]);
            for (const [code, name] of Object.entries(CODES))
                if (name.test(label))
                    codes.add(code);
            if (codes.has("KKS") || codes.has("KKW"))
                codes.delete("KK");
            rows.push({
                skill: skill.name,
                label,
                // "jw." repeats the act of the row above.
                basis: (() => {
                    const cell = basisColumn >= 0 ? cells[basisColumn] ?? "" : "";
                    if (/^jw\.?/iu.test(cell))
                        return previousBasis;
                    previousBasis = cell;
                    return cell;
                })(),
                resources,
                codes: [...codes],
                // The module's declared scope first; else the row's label and the module's name.
                ranges: resources.map((resource) => declaredRanges(registry, resource)).find((declared) => declared !== null) ??
                    ranges([label, ...resources.map((resource) => path.basename(resource))].join(" ")),
                index: /indeks|current-state|moduł\s+główny/iu.test(label) || resources.some((resource) => /current-state-COV/.test(resource)),
                ...(() => {
                    const found = phrases(label);
                    return { phrases: found.multi, singles: found.single, tailPhrases: found.tail };
                })(),
                rareSingles: [],
                bags: bags(label),
                unique: [],
                head: headOf(label)
            });
        }
    });
    // A one-word part stands alone when no other row's label holds it and few DR
    // modules use it at all: "zachowek" yes, "odszkodowania" (115 of 455 modules) no.
    const labels = rows.map((row) => fold(row.label));
    const moduleTexts = skills.flatMap((skill) => {
        const dir = path.join(skill.directory, "modules");
        try {
            return fs.readdirSync(dir).filter((name) => name.endsWith(".md")).map((name) => fold(fs.readFileSync(path.join(dir, name), "utf8")));
        }
        catch {
            return [];
        }
    });
    // General vocabulary of the whole corpus (many modules across many domains):
    // „działalność gospodarcza” 75 modules in 13 domains, „wynagrodzenie” 116 in 15;
    // a domain's own phrase stays specific („czas pracy” 15 in 4).
    const domainOf = skills.flatMap((skill) => {
        try {
            return fs.readdirSync(path.join(skill.directory, "modules")).filter((name) => name.endsWith(".md")).map(() => skill.name);
        }
        catch {
            return [];
        }
    });
    const rare = (pattern) => {
        const hits = moduleTexts.flatMap((text, index) => (pattern.test(text) ? [domainOf[index]] : []));
        return hits.length < GENERAL_MODULES || new Set(hits).size < GENERAL_DOMAINS;
    };
    for (const row of rows) {
        // A tail phrase rare in the corpus names the act on its own ("szkody łowieckie");
        // a common one ("działalność gospodarcza", 14 cases of contracts) needs the head.
        const standalone = row.tailPhrases.filter(rare);
        row.phrases = [...row.phrases, ...standalone];
        row.tailPhrases = row.tailPhrases.filter((pattern) => !standalone.includes(pattern));
        row.rareSingles = row.singles.filter(rare);
    }
    for (const [position, row] of rows.entries()) {
        row.unique = row.singles.filter((pattern) => labels.every((label, other) => other === position || !pattern.test(label)) &&
            moduleTexts.filter((text) => pattern.test(text)).length <= RARE_IN_MODULES);
    }
    cache.set(registry.root, { key, rows });
    return rows;
}
function dzuPairs(text) {
    const pairs = [];
    for (const match of text.matchAll(/Dz\.\s?U\.\s*(?:z\s*)?(\d{4})\s*(?:r\.)?\s*,?\s*(?:Nr\s*\d+\s*,?\s*)?poz\.\s*(\d+)/giu))
        pairs.push([match[1], match[2]]);
    for (const match of text.matchAll(/\bDU\/(\d{4})\/(\d+)\b/gu))
        pairs.push([match[1], match[2]]);
    return pairs;
}
// The row's distinctive word (the longest one that is not generic): a module covering
// the act names it ("elektromobilność", "łowieckie", "zachowek").
function distinctive(label) {
    const words = (label.replace(/\([^)]*\)/g, " ").match(/\p{L}{5,}/gu) ?? [])
        .filter((word) => !GENERIC.has(word.toLocaleLowerCase("pl")) && !/^(?:ustaw|kodeks|przepis)/iu.test(word))
        .sort((a, b) => b.length - a.length);
    if (!words.length)
        return null;
    const folded = fold(words[0]);
    const stem = folded.slice(0, Math.max(5, folded.length - 3));
    return new RegExp(`(?<![a-z])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u");
}
/**
 * The DR whose modules hold the resource: a row of one map may route to another DR's module
 * (DR-04 „KPA — sprawy administracyjne świadczeń” → DR-05 mod-KPA-current-state-COV).
 */
function ownerOf(registry, skill, resource) {
    const qualified = /^(dr-\d{2}-[a-z0-9-]+)\//u.exec(resource)?.[1];
    if (qualified)
        return qualified;
    const file = `${path.basename(resource).replace(/\.md$/u, "")}.md`;
    if (fs.existsSync(path.join(registry.root, skill, "modules", file)))
        return skill;
    return [...registry.skills.keys()].find((name) => name.startsWith("dr-") && fs.existsSync(path.join(registry.root, name, "modules", file))) ?? skill;
}
function moduleText(registry, resource) {
    try {
        const file = registry.resolveResource(resource.split("/")[0], resource);
        return file ? fs.readFileSync(file, "utf8") : "";
    }
    catch {
        return "";
    }
}
/** The act modules the case points to unambiguously, in the order of the rules. */
export function resolveActModules(registry, text, limit = 4) {
    return resolveActModulesWithChecks(registry, text, limit).modules;
}
/**
 * Also checks each module against its map row: a module chosen by the act's
 * Dz.U. number or name must mention that act; otherwise the map row points to
 * the wrong module and the module is not loaded (reported instead).
 */
export function resolveActModulesWithChecks(registry, text, limit = 4) {
    const rows = actRows(registry);
    const found = [];
    const rejected = [];
    const add = (row, rule, why, mention) => {
        for (const resource of row.resources) {
            if (found.length >= limit || found.some((item) => item.resource === resource) || rejected.some((item) => item.resource === resource))
                continue;
            if (mention && !mention.test(fold(moduleText(registry, resource)))) {
                rejected.push({ skill: row.skill, resource, rule, why, reason: `moduł nie wymienia aktu z wiersza mapy („${row.label}”) — rozbieżność MAPA-AKTOW ${row.skill}` });
                continue;
            }
            found.push({ skill: ownerOf(registry, row.skill, resource), resource, rule, why, ...(row.basis ? { basis: row.basis } : {}) });
        }
    };
    // DZU: the basis column holds the same Dz.U. year and position.
    for (const [year, position] of dzuPairs(text)) {
        const pattern = new RegExp(`Dz\\.\\s?U\\.\\s*(?:z\\s*)?${year}\\s*(?:r\\.)?\\s*,?\\s*poz\\.\\s*${position}(?!\\d)`, "u");
        for (const row of rows.filter((item) => pattern.test(item.basis) || pattern.test(item.label))) {
            // The row may list several acts: the module must carry this one (number or the row's phrase).
            const word = distinctive(row.label);
            const mention = new RegExp(`${year}\\s*(?:r\\.)?\\s*,?\\s*poz\\.\\s*${position}(?!\\d)|${year}\\/${position}(?!\\d)${word ? `|${word.source}` : ""}`, "u");
            add(row, "DZU", `Dz.U. ${year} poz. ${position} → ${row.label}`, mention);
        }
    }
    // PRZEPIS: art. N of a code; the narrowest range holding N, else the code's index row.
    const provisions = provisionsForDetection(text);
    for (const match of provisions.matchAll(/\bart\.?\s*(\d+[a-z]*)(?:\s*§\s*\d+[a-z]*)?(?:\s*(?:pkt|ust\.)\s*\d+[a-z]*)?\s+(KK|KW|KC|KP|KPC|KPK|KPA|KRO|KSH|KKS|KKW|KPW|OP|PPSA)\b/gu)) {
        const article = parseNumber(match[1]);
        const code = match[2];
        const ofCode = rows.filter((row) => row.codes.includes(code));
        const holding = ofCode
            .flatMap((row) => row.ranges.filter((range) => compare(range.from, article) <= 0 && compare(article, range.to) <= 0).map((range) => ({ row, width: range.to[0] - range.from[0] })))
            .sort((a, b) => a.width - b.width);
        // Every row whose range holds the article, the narrowest first (art. 291 KK: paserstwo in 278–295 and 291–293).
        for (const item of holding)
            add(item.row, "PRZEPIS", `art. ${match[1]} ${code} → ${item.row.label}`);
        if (holding.length)
            continue;
        {
            // No index row (KSH): the code's own row, named by the code itself.
            const index = ofCode.find((row) => row.index) ?? ofCode.find((row) => CODES[code]?.test(row.label)) ?? ofCode[0];
            if (index)
                add(index, "PRZEPIS", `art. ${match[1]} ${code} → ${index.label} (brak wiersza z tym artykułem)`);
        }
    }
    // NAZWA: a phrase of the row's label in the case.
    const folded = fold(text);
    const sentences = folded.split(/[.!?\n]+/u);
    for (const row of rows) {
        const singles = row.singles.filter((pattern) => pattern.test(folded));
        const headed = row.head ? (row.head.flags.includes("u") && /\\p\{L\}/u.test(row.head.source) ? row.head.test(text) : row.head.test(folded)) : false;
        // Two common words of one row („wynagrodzenie”, „świadczenie” in any contract) are not the act.
        const rareTwo = singles.length >= 2 && singles.some((pattern) => row.rareSingles.includes(pattern));
        const phrase = row.phrases.find((pattern) => pattern.test(folded)) ??
            (headed ? row.tailPhrases.find((pattern) => pattern.test(folded)) : undefined) ??
            row.bags.find((bag) => sentences.some((sentence) => bag.every((stem) => stem.test(sentence))))?.[0] ??
            (singles.length && (headed || rareTwo) ? singles[0] : undefined) ??
            row.unique.find((pattern) => pattern.test(folded));
        if (phrase)
            add(row, "NAZWA", `„${row.label}” w treści sprawy`, distinctive(row.label) ?? undefined);
    }
    return { modules: found, rejected };
}
export const ACT_MODULES_BUDGET_CHARS = 45_000;
export function loadActModules(registry, modules, inContext, budget = ACT_MODULES_BUDGET_CHARS) {
    const loaded = [];
    const toRead = [];
    let left = budget;
    for (const module of modules) {
        if (inContext.has(module.resource))
            continue;
        let content = "";
        try {
            const file = registry.resolveResource(module.skill, module.resource);
            content = file ? fs.readFileSync(file, "utf8") : "";
        }
        catch {
            content = "";
        }
        if (!content.trim())
            continue;
        content = compactForModel(content).text;
        if (content.length > left) {
            toRead.push(module);
            continue;
        }
        left -= content.length;
        loaded.push({ ...module, content });
    }
    return { loaded, toRead };
}
export function actModulesPrompt(result) {
    return [
        "# MODUŁY AKTÓW WSKAZANE MECHANICZNIE (MAPA-AKTOW dziedzin; aplikacja)",
        "Reguły: DZU — numer Dz.U. ze sprawy = podstawa w mapie; PRZEPIS — artykuł kodeksu w zakresie wiersza mapy; NAZWA — akt lub zakres z mapy wymieniony w sprawie.",
        ...result.loaded.map((item) => `- ${item.resource} [${item.rule}] ${item.why} (wczytany poniżej)`),
        ...result.toRead.map((item) => `- ${item.resource} [${item.rule}] ${item.why} (WYMAGANY: wczytaj narzędziem korpusu; aplikacja to sprawdza)`),
        "Te moduły są obowiązkowe dla tej sprawy. Brzmienie przepisów i tak weryfikujesz w ELI.",
        ...result.loaded.map((item) => `## MODUŁ AKTU: ${item.resource}\n\n${item.content}`)
    ].join("\n\n");
}
