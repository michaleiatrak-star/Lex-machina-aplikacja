import fs from "node:fs";
import path from "node:path";
import { provisionsForDetection } from "./legal-act-abbreviations.js";
import { criminalMatter } from "./matter-signals.js";
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
// Words of four letters and more, and abbreviations written in capitals (KP, ZUS, VAT),
// these marked "=" (they match whole).
function words(text) {
    return [
        ...new Set((text.match(/[\p{L}0-9]{2,}/gu) ?? [])
            .filter((word) => word.length >= 4 || /^[\p{Lu}]{2,}$/u.test(word))
            .map((word) => (/^[\p{Lu}0-9]{2,}$/u.test(word) && word.length <= 5 ? `=${fold(word)}` : fold(word)))
            .filter((word) => !STOP.has(word.replace(/^=/, "")) && !/^=?(?:\d{1,3}|(?:19|20)\d\d)$/.test(word) && !/^(?:prze|przy|przez|przed)$/.test(word)))
    ];
}
// Words of a flash-routing phrase: each word of three letters and more counts
// ("prawo właściwe", "sąd pracy"); only function words are dropped.
const FUNCTION_WORDS = new Set(["dla", "nie", "sie", "przez", "oraz", "albo", "lub", "the", "and", "jak", "czy", "pod", "nad", "bez"]);
function phraseWords(phrase) {
    return [
        ...new Set((phrase.match(/[\p{L}0-9]{2,}/gu) ?? [])
            .filter((word) => word.length >= 3 || /^[\p{Lu}0-9]{2,}$/u.test(word))
            .map((word) => (/^[\p{Lu}0-9]{2,}$/u.test(word) && word.length <= 5 ? `=${fold(word)}` : fold(word)))
            .filter((word) => !FUNCTION_WORDS.has(word)))
    ];
}
// Inflectional endings (folded, longest first): "danych" and "dane" share "dan".
const ENDINGS = ["owie", "ach", "ami", "ych", "ich", "ego", "emu", "owi", "ow", "om", "em", "ie", "ek", "a", "e", "i", "y", "u", "o"];
// An abbreviation (KP, ZUS, RODO) matches whole; a word by its stem without the
// ending, a long one shorter still ("przetwarzanie" -> "przetwarz").
function stemOf(word) {
    if (word.startsWith("="))
        return word;
    const ending = ENDINGS.find((end) => word.endsWith(end) && word.length - end.length >= 3);
    const base = ending ? word.slice(0, -ending.length) : word;
    return base.length >= 8 ? base.slice(0, -2) : base;
}
// A short stem is an ending away from its word, not the start of another one
// ("powi" of "powiat" is not "powierzenia").
// A stem's test for one token, built once ("=kp" whole, else its forms by prefix).
const stemTests = new Map();
function stemTest(stem) {
    let test = stemTests.get(stem);
    if (!test)
        stemTests.set(stem, (test = buildStemTest(stem)));
    return test;
}
function buildStemTest(stem) {
    if (stem.startsWith("=")) {
        const whole = stem.slice(1);
        return (token) => token === whole;
    }
    const forms = alternations(stem);
    return (token) => forms.some((form) => token.startsWith(form) && (form.length > 4 || token.length <= form.length + (form.length <= 3 ? 3 : 6)));
}
function hit(stem, tokens) {
    return tokens.some(stemTest(stem));
}
/**
 * The words of a phrase in one place of the text, not scattered over a story: "umowa o
 * pracę" is not "bez umowy ... kolega z pracy", "sąd pracy" is not "sądu ... po pracy"
 * (benchmark 2026-10-10, 1000 kazusów). Words may stand in any order, a few words apart.
 */
const phraseTests = new Map();
function phraseHit(phrase, have) {
    let tests = phraseTests.get(phrase);
    if (!tests) {
        tests = phraseWords(phrase).map((word) => {
            const test = stemTest(stemOf(word));
            const other = FALSE_FRIENDS[word];
            return other ? (token) => !other.test(token) && test(token) : test;
        });
        phraseTests.set(phrase, tests);
    }
    if (!tests.length)
        return false;
    // Cheap test first: most phrases have a word the text lacks.
    if (!tests.every((test) => have.some(test)))
        return false;
    if (tests.length === 1)
        return true;
    const positions = tests.map((test) => have.flatMap((token, index) => (test(token) ? [index] : [])));
    const span = 2 * tests.length + 2;
    return positions[0].some((anchor) => positions.slice(1).every((list) => list.some((index) => Math.abs(index - anchor) <= span)));
}
// Polish vowel alternation inside the stem, after folding: "urzędu"/"urząd" ("urzed"/"urzad"),
// "męża"/"mąż" ("mez"/"maz"). The stem's last vowel e <-> a, for stems of four letters and more.
function alternations(stem) {
    const match = /^(.{2,}?)([ae])([^aeiouy]+)$/u.exec(stem);
    if (!match || stem.length < 4)
        return [stem];
    return [stem, `${match[1]}${match[2] === "e" ? "a" : "e"}${match[3]}`];
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
    // "**Hasła spraw:** ..." — the words a client uses for this module's matters.
    const keywords = /\*\*Hasła spraw:?\*\*:?\s*([^\n]{0,600})/u.exec(head)?.[1] ?? "";
    return [...headings, scope.replace(/\(art[^)]*\)/g, " "), keywords].join(" ");
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
// Words a phrase word's stem or vowel alternation reaches but which are other words
// ("praca" -> "precedens", "prąd" -> "prędkość", "obywatelstwo" -> "obywatelskie").
// Found by matching every phrase word against the words of all routing corpora.
const FALSE_FRIENDS = {
    praca: /^prec/, pracy: /^prec/, prace: /^prec/, czas: /^czes/, pies: /^pias/, plan: /^plen/, szef: /^szaf/,
    prad: /^pred/, pradu: /^pred/, powiat: /^powiet/, powiatowa: /^powiet/, dzial: /^dziel/, dlug: /^dlugo/,
    udzielenie: /^udzial/, obywatelstwo: /^obywatelsk/, przychod: /^przychod[nz]/, przychodnia: /^przychod(?!n)/,
    kamieniolom: /^kamienic/, powierzenie: /^powierzch/, referendum: /^referendar/, niedziele: /^niedzial/,
    niedzialanie: /^niedziel/, sprzeciw: /^sprzeczn/, wspolnik: /^wspoln(?!ik)/, wspolnota: /^wspoln(?!ot)/,
    aplikant: /^aplikac/, dyrektywa: /^dyrektor/, szkolenia: /^szkol(?!en)/, przeglad: /^przeglos/,
    orzeczenie: /^orzeczni/, orzeczenia: /^orzeczni/, uzytkowanie: /^uzytkowni/
};
/** Domains whose flash-routing phrases the text contains, best first. */
export function flashDomains(rows, text, generic = () => false) {
    const have = tokens(text);
    return rows
        .map((row) => {
        const matched = row.phrases.filter((phrase) => phraseHit(phrase, have));
        // A phrase of two words ("umowa o pracę", "monitoring wizyjny") says more than
        // one word of it ("umowa"), which then does not count again.
        const sets = matched.map((phrase) => phraseWords(phrase).map(stemOf));
        const weight = sets
            .filter((set, index) => !sets.some((other, at) => at !== index && other.length > set.length && set.every((stem) => other.includes(stem))))
            // One word many domains' act maps use ("odszkodowanie", "umowa") weighs half.
            .reduce((sum, set) => sum + (set.length === 1 && generic(set[0]) ? 0.5 : set.length), 0);
        return { skill: row.skill, matched, weight };
    })
        .filter((row) => row.matched.length > 0)
        .sort((a, b) => b.weight - a.weight);
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
export function locate(registry, skill, resource) {
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
// Words of the request itself, not of its matter ("pełna analiza prawna sprawy: podstawy,
// ryzyka, rekomendacje"): in an act map they named DR-01 and DR-13 for any question.
const REQUEST_STEMS = new Set(["prawn", "prawnej", "praw", "spraw", "podstaw", "analiz", "ryzyk", "rekomenda", "szans", "peln", "pelnej", "=pelna"]);
/** Znacznik zmiany pliku (mtime i rozmiar) dla cache czytanych map; "-" gdy brak pliku. */
export function fileStamp(file) {
    try {
        const stat = fs.statSync(file);
        return `${stat.mtimeMs}:${stat.size}`;
    }
    catch {
        return "-";
    }
}
// Jeden wpis na mapę; klucz z mtime i rozmiaru, plik czytany tylko po zmianie.
const cache = new Map();
function actIndex(registry, skill) {
    const record = registry.get(skill);
    if (!record)
        return { index: [], df: new Map() };
    const file = path.join(record.directory, "MAPA-AKTOW.md");
    const key = fileStamp(file);
    const cached = cache.get(file);
    if (cached?.key === key)
        return cached.value;
    let body = "";
    try {
        body = fs.readFileSync(file, "utf8");
    }
    catch {
        return { index: [], df: new Map() };
    }
    const mapped = parseActMap(body, skill)
        .map((entry) => ({ ...entry, resources: entry.resources.map((resource) => locate(registry, skill, resource)).filter((resource) => resource !== null) }))
        .filter((entry) => entry.resources.length > 0);
    // Modules of the domain the act map does not list: indexed by their own headings
    // and "Zakres:", marked as such (they cannot be suggested otherwise).
    const listed = new Set(mapped.flatMap((entry) => entry.resources));
    let files = [];
    try {
        files = fs.readdirSync(path.join(record.directory, "modules")).filter((file) => /^mod-.*\.md$/.test(file));
    }
    catch {
        files = [];
    }
    const unlisted = files
        .map((file) => `${skill}/modules/${file}`)
        .filter((resource) => !listed.has(resource))
        .map((resource) => ({ scope: `poza MAPA-AKTOW: ${path.basename(resource, ".md").replace(/^mod-/, "")}`, resources: [resource] }));
    const index = [...mapped, ...unlisted]
        .map((entry) => {
        // What the module is about: the act or scope, and the module's own name.
        const names = entry.resources.map((resource) => path.basename(resource, ".md").replace(/^mod-/, "").replace(/-/g, " "));
        const heads = entry.resources.map((resource) => moduleHead(registry.resolveResource(resource.split("/")[0], resource)));
        return { entry, stems: [...new Set(words([entry.scope, ...names, ...heads].join(" ")).map(stemOf))].filter((stem) => !REQUEST_STEMS.has(stem)) };
    });
    const df = new Map();
    for (const item of index)
        for (const stem of item.stems)
            df.set(stem, (df.get(stem) ?? 0) + 1);
    const value = { index, df };
    cache.set(file, { key, value });
    return value;
}
// In how many domains' act maps a stem appears: a word of four domains and more is generic.
const GENERIC_DOMAINS = 4;
const spread = new Map();
function domainSpread(registry) {
    const domains = [...registry.skills.keys()].filter((name) => /^dr-\d{2}-/.test(name)).sort();
    const key = `${registry.root}:${domains.join(",")}`;
    const cached = spread.get(key);
    if (cached)
        return cached;
    const counts = new Map();
    for (const domain of domains) {
        for (const stem of new Set(actIndex(registry, domain).index.flatMap((item) => item.stems)))
            counts.set(stem, (counts.get(stem) ?? 0) + 1);
    }
    spread.set(key, counts);
    return counts;
}
// How many different words of the question the matched stems stand for ("pozwol" and
// "pozwole" are one word; a three-letter stem counts for none).
function distinctWords(stems, have) {
    return new Set(have.filter((token) => stems.some((stem) => stem.replace(/^=/, "").length >= 4 && hit(stem, [token])))).size;
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
        // A specific word (in at most two rows): a long one alone, a short stem only with another word.
        // Or two words of the same row ("kontrola" + "podatkowa"), each common alone.
        .filter((row) => (row.score >= 0.5 && row.matched.some((stem) => (df.get(stem) ?? 1) <= 2 && (stem.length >= 5 || row.matched.length >= 2))) ||
        (row.score >= 0.25 && row.matched.filter((stem) => stem.length >= 5).length >= 2))
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
// A foreign element (another country, its court or law, "za granicą"): the matter
// always raises jurisdiction and the applicable law (DR-14), whatever else it is.
const FOREIGN_ELEMENT = new RegExp("(?<![a-z])(?:" +
    [
        "za granic", "zagraniczn", "z zagranicy", "transgraniczn", "miedzynarodow", "panstw(?:a|ie|em|o|ach) trzeci", "konsul(?:a|em|owi|ie|at|atu|acie)?\\b", "azj(?:a|i|ii)\\b", "azjatyck",
        "niemc", "niemiec", "francj", "francusk", "we wloszech", "wloch(?:y|ow|ami)?\\b", "wlosk(?:i|a|ie|iego|iej|im)\\b(?! orzech| kapust| koper)", "hiszpan", "portugal", "irland", "norweg", "norwe", "holand", "niderland",
        "belgi", "austri", "szwajcar", "szwec", "szwedz", "danii\\b", "dunsk", "finlandi", "czech(?:y|ach|ami|om)?\\b", "czesk", "slowac", "wegr", "wegier",
        "litw", "lotw", "estoni", "ukrain", "bialorus", "rosj", "rosyjsk", "rumuni", "bulgar", "grecj", "greck", "chorwac",
        "wielkiej brytanii", "wielka brytani", "brytyjsk", "anglii\\b", "angli[ia]\\b", "szkocj", "stanach zjednoczonych", "usa\\b", "amerykansk",
        "kanad", "australi", "chin(?:y|ach|ami)?\\b", "chinsk", "japoni", "indii\\b", "indyjsk", "turcj", "tureck", "izrael",
        "strasburg", "luksemburg", "monachium", "berlin", "londyn", "paryz", "wiedni", "w pradze\\b", "wilni", "kijow"
    ].join("|") +
    ")", "u");
const CONFLICT_QUESTION = /(?<![a-z])(?:praw\w* (?:ktorego|jakiego) (?:kraju|panstwa)|(?:wedlug|wg|na podstawie) (?:jakiego|ktorego) prawa|jakie prawo (?:bedzie |jest |sie )?(?:stosowan|wlasciw|zastosowan)|prawo\w* wlasciw\w*|(?:ktory|jaki) sad (?:bedzie |jest )?wlasciw|przed (?:ktorym|jakim) sadem|w (?:ktorym|jakim) kraju|jurysdykcj\w*|uznani\w* (?:wyroku|orzeczeni|rozwodu)|wykonani\w* (?:jego |tego )?(?:w polsce|wyroku|orzeczeni)|europejsk\w* (?:postepowani\w* w sprawie drobnych|nakaz\w* zaplaty|poswiadczeni\w* spadkow)|uprowadz\w*|konwencj\w* haask\w*|ekstradyc\w*|wybor\w* prawa|arbitraz\w*|skarg\w* (?:do etpc|miedzynarodow)|odzyskac (?:corke|syna|dziecko)|dziecko? (?:wrocil|wrocila) do polski|corka wrocila|syn wrocil)/u;
// "Dania" (kraj) bez polskich znaków to też "dania" (potrawy): kraj tylko w formach
// jednoznacznych ("Danię", "Danią") albo wielką literą wewnątrz zdania.
const DENMARK_FORMS = /(?<![\p{L}])dani[ęą](?![\p{L}])/iu;
const DENMARK_NAME = /(?<=[\p{Ll}\d,;:]\s{1,3})Dania(?![\p{L}])/u;
export function foreignElement(text) {
    return FOREIGN_ELEMENT.test(fold(text)) || DENMARK_FORMS.test(text) || DENMARK_NAME.test(text);
}
export function rankDomains(registry, rows, text, limit = 2) {
    // A domain the case adds by its kind (criminal, foreign element) is one more, not one
    // instead of the matter's second domain ("monitoring w pracy" stays with "co grozi").
    const phrased = rankByPhrases(registry, rows, text, limit);
    const ranked = withForeignElement(registry, text, phrased, limit);
    const room = (list) => limit + (list.some((row) => !phrased.some((own) => own.skill === row.skill)) ? 1 : 0);
    // A criminal matter (the application already requires the qualifier): DR-03 first,
    // or second when another domain has a phrase of its own ("mandat posła" after a conviction).
    const criminal = [...registry.skills.keys()].find((name) => name.startsWith("dr-03-"));
    if (!criminal || !criminalMatter(text) || ranked[0]?.skill === criminal)
        return ranked.slice(0, room(ranked)).map(withStrength);
    const own = ranked.find((row) => row.skill === criminal);
    const marked = { ...(own ?? { skill: criminal, matched: [], modules: suggestDomainModules(registry, criminal, text), weight: 0 }) };
    marked.matched = ["sprawa karna (kwalifikator)", ...marked.matched];
    const others = ranked.filter((row) => row.skill !== criminal);
    const order = (others[0]?.weight ?? 0) >= 2 ? [others[0], marked, ...others.slice(1)] : [marked, ...others];
    return order.slice(0, room(order)).map(withStrength);
}
// A domain named by the kind of the case (criminal, foreign element) or by a phrase of two
// words and more; one word ("umowa", "sąd", "sąsiad") names a domain only possibly involved.
const MARKER = /^(?:sprawa karna \(kwalifikator\)|element zagraniczny)/u;
function withStrength({ weight, ...row }) {
    return { ...row, strong: weight >= 2 || MARKER.test(row.matched[0] ?? "") };
}
// DR-14 named for a foreign element of a legal matter: second after the matter's own
// domain. Alone only when its act map names a module of the case ("firma z Czech nie
// zapłaciła za dostawę"); a country alone ("wakacje w Grecji") names no matter.
function withForeignElement(registry, text, ranked, limit) {
    const international = [...registry.skills.keys()].find((name) => name.startsWith("dr-14-"));
    if (!international || !foreignElement(text))
        return ranked;
    // The question is the conflict itself (which law, which court, a foreign judgment, a child
    // taken abroad): DR-14 first, the matter second (benchmark series 3, 2026-10-10).
    const conflict = CONFLICT_QUESTION.test(fold(text));
    if (!conflict && ranked.slice(0, limit).some((row) => row.skill === international))
        return ranked;
    const own = ranked.find((row) => row.skill === international);
    const marked = { ...(own ?? { skill: international, matched: [], modules: suggestDomainModules(registry, international, text), weight: 0 }) };
    if (!own)
        marked.matched = ["element zagraniczny (jurysdykcja, prawo właściwe)", ...marked.matched];
    const others = ranked.filter((row) => row.skill !== international);
    if (others.length)
        return conflict ? [marked, ...others] : [others[0], marked, ...others.slice(1)];
    if (own)
        return ranked;
    return marked.modules.length ? [marked] : [];
}
// Words of the procedure, not of the matter: an administrative decision, a court, a judge,
// a lawyer, court fees. A building permit appealed to the WSA is DR-09 first, a child taken
// abroad heard by a judge is DR-14 first (benchmark 2026-10-10, 1000 kazusów: such words
// put DR-05 or DR-12 first in 61 full case descriptions).
const PROCEDURE = {
    "dr-05": new Set([
        "KPA", "decyzja urzędu", "decyzja administracyjna", "SKO", "WSA", "NSA", "bezczynność", "przewlekłość", "Samorządowe kolegium odwoławcze",
        "postępowanie administracyjne", "interes prawny", "zaświadczenie", "ponaglenie", "organ administracji", "sąd administracyjny",
        "wojewódzki sąd administracyjny", "skarga kasacyjna", "skarga kasacyjna do NSA", "decyzja wojewody", "wojewoda odmówił", "odwołanie od decyzji",
        "decyzja ostateczna", "organ pierwszej instancji", "organ drugiej instancji", "urzędnik", "urząd nie odpowiada", "uchylenie decyzji",
        "przywrócenie terminu do wniesienia odwołania", "nie rozpatruje wniosku", "rozpatrzenie wniosku", "skarga do sądu administracyjnego",
        "odrzucenie skargi", "stwierdzenie nieważności decyzji", "wznowienie postępowania administracyjnego", "braki wniosku",
        "uzupełnienie braków wniosku", "wszczęcie postępowania administracyjnego", "zawiadomienie o wszczęciu postępowania", "skarga na bezczynność",
        "kara administracyjna", "administracyjna kara pieniężna", "starostwo", "oględziny", "decyzja o zwrocie"
    ].map((phrase) => phrase.toLocaleLowerCase("pl"))),
    "dr-12": new Set([
        "Sąd", "adwokat", "radca", "radca prawny", "sędzia", "pełnomocnik z urzędu", "adwokat z urzędu", "kancelaria adwokacka", "prezes sądu",
        "nie wyznaczył rozprawy", "wyznaczenie rozprawy", "biegły sądowy", "koszty zastępstwa procesowego", "koszty pozwu", "koszty sądowe",
        "opłata sądowa", "opłata od pozwu", "opłata od apelacji", "zwolnienie od kosztów sądowych", "referendarz", "mediacja", "mediator", "notariusz"
    ].map((phrase) => phrase.toLocaleLowerCase("pl")))
};
function substanceFirst(ranked) {
    const top = ranked[0];
    const words = top ? PROCEDURE[top.skill.slice(0, 5)] : undefined;
    if (!top || !words || !top.matched.every((phrase) => words.has(phrase.toLocaleLowerCase("pl"))))
        return ranked;
    const matter = ranked.find((row) => row !== top && !PROCEDURE[row.skill.slice(0, 5)] && row.weight >= Math.max(2, top.weight * 0.75));
    return matter ? [matter, ...ranked.filter((row) => row !== matter)] : ranked;
}
function rankByPhrases(registry, rows, text, limit) {
    const flash = substanceFirst(flashDomains(rows, text, (stem) => domainSpread(registry).get(stem) >= GENERIC_DOMAINS)
        .filter((row) => registry.get(row.skill))
        .map((row) => ({ ...row, modules: suggestDomainModules(registry, row.skill, text) }))
        .sort((a, b) => b.weight - a.weight || (b.modules[0]?.score ?? 0) - (a.modules[0]?.score ?? 0))).slice(0, limit);
    if (flash.length)
        return flash;
    const have = tokens(text);
    return [...registry.skills.values()]
        .filter((skill) => /^dr-\d{2}-/.test(skill.name))
        .map((skill) => ({ skill: skill.name, modules: suggestDomainModules(registry, skill.name, text) }))
        // Without a flash-routing phrase: two words of one act-map row, not one shared word
        // ("odpowiedzi" is not a data subject request).
        .filter((row) => (row.modules[0]?.score ?? 0) >= 1 && distinctWords(row.modules[0].matched, have) >= 2)
        .sort((a, b) => b.modules[0].score - a.modules[0].score)
        // Without a flash-routing phrase a second domain is named only when its act map
        // fits nearly as well (one shared word is not a second matter).
        .filter((row, index, rows) => index === 0 || row.modules[0].score >= 0.75 * rows[0].modules[0].score)
        .slice(0, limit)
        .map((row) => ({ skill: row.skill, matched: [`mapa aktów: ${row.modules[0].why.replace(/^MAPA-AKTOW: /, "")}`], modules: row.modules, weight: 0 }));
}
export function domainHintPrompt(domains) {
    // Several domains of one case: the ones its kind or a phrase of its own names are read
    // (or set aside in a sentence); one shared word only lets the model reach for a domain.
    const secondary = domains.slice(1);
    const required = secondary.filter((domain) => domain.strong === true).map((domain) => domain.skill);
    const possible = secondary.filter((domain) => domain.strong === false).map((domain) => domain.skill);
    return [
        "# DZIEDZINA I MODUŁ AKTU — WSKAZÓWKA APLIKACJI (prawo-polskie-v2: routing błyskawiczny, MAPA-AKTOW dziedziny)",
        ...domains.map((domain) => `- ${domain.skill}: sygnały ${domain.matched.map((phrase) => `„${phrase}”`).join(", ")}` +
            (domain.modules.length ? `; moduły aktu dla tej sprawy: ${domain.modules.map((module) => `${module.resource} (${module.why})`).join("; ")}` : "")),
        "Ścieżka prawo-polskie-v2: SKILL.md właściwej dziedziny, potem moduł aktu prawnego z jej MAPA-AKTOW. Gdy treść sprawy wskazuje inną dziedzinę lub inny moduł, powiedz to wprost i wczytaj właściwy.",
        ...(required.length
            ? [
                `Sprawa wielodziedzinowa: oprócz ${domains[0].skill} przeczytaj SKILL.md ${required.join(", ")} i moduł aktu dla ich części sprawy, zanim odpowiesz. Dziedzinę, która nie dotyczy tej sprawy, pomiń, mówiąc w jednym zdaniu dlaczego.`
            ]
            : []),
        ...(possible.length
            ? [`Dziedzina możliwa (jedno wspólne słowo): ${possible.join(", ")} — wczytaj ją tylko, gdy pytanie dotyczy jej części sprawy.`]
            : [])
    ].join("\n");
}
