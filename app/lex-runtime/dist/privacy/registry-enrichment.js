import { firmFragments } from "./firm-names.js";
import { detectIdentifiers } from "./identifiers.js";
const LEGAL_FORM_TAIL = /[\s,]*(?:spółka\s+z\s+ograniczoną\s+odpowiedzialnością(?:\s+spółka\s+komandytowa)?|spółka\s+(?:akcyjna|komandytowa|komandytowo-akcyjna|jawna|partnerska|cywilna)|sp\.\s?z\s?o\.\s?o\.(?:\s?sp\.\s?k\.)?|s\.\s?a\.|sp\.\s?k\.(?:\s?a\.)?|sp\.\s?j\.|sp\.\s?p\.|s\.\s?c\.)\s*(?:w\s+(?:likwidacji|upadłości|restrukturyzacji))?\s*$/iu;
// Words that alone are no firm name ("ZAKŁAD", "POLSKA" left after stripping the form).
const TOO_GENERIC = new Set([
    "polska", "polski", "firma", "spółka", "zakład", "przedsiębiorstwo", "usługi", "handel", "transport", "grupa", "group",
    "centrum", "biuro", "serwis", "service", "invest", "development", "holding", "consulting", "trade", "budownictwo"
]);
const STREET_PREFIX = /^(?:ul\.?|ulica|al\.?|aleja|aleje|pl\.?|plac|os\.?|osiedle|rondo)\s+/iu;
const ROMAN = /^[IVXLC]+$/u;
const LOWER_WORDS = new Set(["i", "z", "w", "na", "do", "od", "dla", "pod", "nad", "przy", "oraz"]);
function text(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
/** "JANA PAWŁA II" -> "Jana Pawła II", "SKŁODOWSKIEJ-CURIE" -> "Skłodowskiej-Curie". */
export function titleCase(value) {
    return value
        .toLocaleLowerCase("pl")
        .split(/(\s+)/u)
        .map((word, index) => {
        if (/^\s+$/u.test(word) || !word)
            return word;
        const upper = word.toLocaleUpperCase("pl");
        if (ROMAN.test(upper.replace(/[.,]$/u, "")))
            return upper;
        // A house number keeps its letter: "7A/12".
        if (/^\d/u.test(word))
            return upper;
        if (index > 0 && LOWER_WORDS.has(word))
            return word;
        return word.replace(/(^|[-'’„"(])(\p{L})/gu, (_, before, letter) => before + letter.toLocaleUpperCase("pl"));
    })
        .join("");
}
function spellings(value) {
    return [...new Set([value, value.toLocaleUpperCase("pl"), titleCase(value)])];
}
// Letters OCR confuses or drops: diacritics ("Michal" for "Michał"), i/l/1, o/0.
const OCR_CONFUSABLE = {
    a: "aą", ą: "aą", c: "cć", ć: "cć", e: "eę", ę: "eę", l: "lłiI1|", ł: "lłiI1|", n: "nń", ń: "nń",
    o: "oó0", ó: "oó0", s: "sś", ś: "sś", z: "zźż", ź: "zźż", ż: "zźż", i: "iIlł1|", "1": "1iIlł|", "0": "0oO"
};
/** A register form as OCR may have read it; null when the form is too short to match loosely. */
export function ocrTolerantPattern(value) {
    if (value.replace(/\s+/gu, "").length < 6)
        return null;
    return [...value]
        .map((char) => {
        if (/\s/u.test(char))
            return "\\s+";
        const lower = char.toLocaleLowerCase("pl");
        const set = OCR_CONFUSABLE[lower];
        if (!set)
            return char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        const letters = new Set([...set].flatMap((letter) => [letter, char === lower ? letter : letter.toLocaleUpperCase("pl")]));
        return `[${[...letters].join("").replace(/[\]\\^-]/gu, "\\$&")}]`;
    })
        .join("");
}
/** The firm's own name without its legal form, in the spellings a pleading uses. */
export function firmNameForms(name) {
    const clean = name.replace(/[„”"«»]/gu, "").replace(/\s+/gu, " ").trim();
    const legal = LEGAL_FORM_TAIL.exec(clean);
    const core = (legal ? clean.slice(0, legal.index) : clean).replace(/[\s,]+$/u, "");
    const legalForm = legal ? legal[0].replace(/^[\s,]+/u, "") : undefined;
    if (core.length < 3 || TOO_GENERIC.has(core.toLocaleLowerCase("pl")))
        return [];
    if (!/\s/u.test(core) && core.length < 4)
        return [];
    // The whole name, then its parts of two or more words (one element: "Park" of "Human Park
    // Global" is the firm's, never a person's).
    return [core, ...firmFragments(titleCase(core))]
        .flatMap(spellings)
        .filter((form, index, all) => all.indexOf(form) === index)
        .map((form) => ({ text: form, kind: "PERSON", organization: legalForm ? { legalForm } : {} }));
}
/** A natural person from the register: "Jan Kowalski", "KOWALSKI Jan" and the capitals. */
export function personForms(first, last) {
    if (!last)
        return [];
    const surname = titleCase(last);
    const given = first ? titleCase(first) : undefined;
    if (!given)
        return [];
    const forms = [`${given} ${surname}`, `${surname} ${given}`, `${surname.toLocaleUpperCase("pl")} ${given}`];
    return [...new Set(forms.flatMap(spellings))].map((form) => ({ text: form, kind: "PERSON" }));
}
/** "UL. DŁUGA 5/3, 25-001 KIELCE" -> street with number (with and without its type) and code with town. */
export function addressForms(address) {
    if (!address)
        return [];
    const forms = [];
    // "UL. DŁUGA 5, 25-001 KIELCE" (white list) and "ul. Długa 5/3 25-001 Kielce" (CEIDG).
    const parts = address.split(",").flatMap((item) => item.split(/\s+(?=\d{2}-\d{3}\s)/u));
    for (const part of parts.map((item) => item.trim()).filter(Boolean)) {
        const postal = /^(\d{2}-\d{3})\s+(.+)$/u.exec(part);
        if (postal) {
            forms.push(`${postal[1]} ${titleCase(postal[2])}`, `${postal[1]} ${postal[2].toLocaleUpperCase("pl")}`);
            continue;
        }
        if (!/\d/u.test(part))
            continue;
        const street = titleCase(part);
        const bare = street.replace(STREET_PREFIX, "");
        // A street name before the house number ("Kolorowa 12", "Długa 5/3", "Polna 7A"), not a bare number.
        if (bare.replace(/\s*\d+\p{L}?(?:\s*\/\s*\d+\p{L}?)?$/u, "").trim().length < 3)
            continue;
        forms.push(street, bare, part, part.replace(STREET_PREFIX, ""), part.toLocaleUpperCase("pl"), part.toLocaleUpperCase("pl").replace(STREET_PREFIX, ""));
        // A street named after a person, written in a letter by the surname only: the register
        // has "JÓZEFA NOWAKOWSKIEGO 15", the letter "ul. Nowakowskiego 15".
        const named = /^((?:\p{L}+[\s.-]+)+)(\p{L}{4,})\s+(\d+\p{L}?(?:\s*\/\s*\d+\p{L}?)?)$/u.exec(bare);
        if (named && !ROMAN.test(named[2].toLocaleUpperCase("pl"))) {
            const short = `${named[2]} ${named[3]}`;
            forms.push(short, short.toLocaleUpperCase("pl"));
        }
    }
    return [...new Set(forms)].map((form) => ({ text: form, kind: "ADDRESS" }));
}
export function whiteListForms(reply) {
    const row = reply && typeof reply === "object" ? reply : {};
    if (row.status !== "FOUND" || !row.result || typeof row.result !== "object")
        return [];
    const result = row.result;
    const persons = Array.isArray(result.osoby) ? result.osoby : [];
    return [
        ...firmNameForms(text(result.tytul_lub_nazwa) ?? ""),
        ...addressForms(text(result.adres)),
        ...addressForms(text(result.adres_zamieszkania)),
        ...persons.flatMap((person) => text(person.nazwa_firmy) ? firmNameForms(text(person.nazwa_firmy)) : personForms(text(person.imie), text(person.nazwisko)))
    ];
}
export function krsForms(reply) {
    const row = reply && typeof reply === "object" ? reply : {};
    if (row.status !== "FOUND" || !row.result || typeof row.result !== "object")
        return [];
    const result = row.result;
    return [...firmNameForms(text(result.tytul_lub_nazwa) ?? ""), ...addressForms(text(result.adres))];
}
// Case endings a masked name may take in a sentence ("Juneyounga Parka", "Wiśniewskiego").
const NAME_ENDINGS = "(?:a|owi|em|iem|u|ie|ą|ej|y|i|ę|ego|emu|m)?";
const MASK = /^\p{Lu}\*+(?:\s+\p{Lu}\*+)+$/u;
function maskWord(word) {
    const rest = word.length - 1;
    return `${word[0]}(?:\\p{Ll}{${rest}}${NAME_ENDINGS}|\\p{Lu}{${rest}})`;
}
/**
 * Members of the board, proxies and the supervisory board from KRS. The public extract
 * masks their names ("J******** P***"); the first letter and the length of every word are
 * enough to find "Juneyoung Park" in a letter signed by him, in either order.
 */
export function krsPersonForms(reply) {
    const row = reply && typeof reply === "object" ? reply : {};
    if (row.status !== "FOUND" || !row.result || typeof row.result !== "object")
        return [];
    const representation = row.result.reprezentacja;
    if (!representation || typeof representation !== "object")
        return [];
    const groups = ["sklad", "prokurenci", "organ_nadzoru"].flatMap((key) => {
        const value = representation[key];
        return Array.isArray(value) ? value : [];
    });
    const masks = new Set();
    for (const item of groups) {
        const mask = typeof item === "string" ? item : item && typeof item === "object" ? text(item.osoba_maska) : undefined;
        if (mask && MASK.test(mask.trim()))
            masks.add(mask.trim().replace(/\s+/gu, " "));
    }
    const forms = [];
    for (const mask of masks) {
        const words = mask.split(" ");
        // Short masks ("J* K**") fit too many words; every word at least three letters.
        if (words.some((word) => word.length < 3))
            continue;
        const surname = words[words.length - 1];
        const given = words.slice(0, -1);
        const orders = [[...given, surname], [surname, ...given], ...(given.length > 1 ? [[given[0], surname], [surname, given[0]]] : [])];
        for (const order of orders) {
            // A short pattern ("S*** P***") fits ordinary words ("Spis Prac"): at least ten letters.
            if (order.join("").length < 10)
                continue;
            forms.push({
                text: order.join(" "),
                kind: "PERSON",
                pattern: order.map(maskWord).join("\\s+"),
                uncertain: `osoba z KRS (${mask}) - potwierdź, że to ona`
            });
        }
    }
    return forms;
}
/** A sole trader in CEIDG: business name, owner and business address. */
export function ceidgForms(reply) {
    const row = reply && typeof reply === "object" ? reply : {};
    if (row.status !== "FOUND" || !row.result || typeof row.result !== "object")
        return [];
    const result = row.result;
    const owner = text(result.wlasciciel)?.split(/\s+/u) ?? [];
    return [
        ...firmNameForms(text(result.tytul_lub_nazwa) ?? ""),
        ...(owner.length >= 2 ? personForms(owner.slice(0, -1).join(" "), owner.at(-1)) : []),
        ...addressForms(text(result.adres_dzialalnosci))
    ];
}
/** Identifiers in the text to look up: NIP (VAT white list, then CEIDG) and KRS numbers. */
export function registryKeys(value) {
    const keys = new Map();
    for (const span of detectIdentifiers(value)) {
        if (span.kind === "NIP") {
            const id = span.value.replace(/\D/gu, "");
            keys.set(`nip:${id}`, { source: "nip", id });
        }
        else if (span.kind === "KRS") {
            keys.set(`krs:${span.value}`, { source: "krs", id: span.value });
        }
    }
    return [...keys.values()];
}
// A connector not installed (no CEIDG key) is asked again after this time: the key may be added in the settings.
const UNAVAILABLE_TTL_MS = 10 * 60_000;
export class RegistryEnrichment {
    call;
    options;
    cache = new Map();
    // The latest lookups (no identifiers): which register answered and how many forms it gave.
    events = [];
    constructor(call, options = {}) {
        this.call = call;
        this.options = options;
    }
    async forms(value) {
        const keys = registryKeys(value).slice(0, this.options.maxLookups ?? 12);
        const found = await Promise.all(keys.map((key) => this.within(this.lookup(key.source, key.id), key.source)));
        const unique = new Map();
        for (const form of found.flat())
            if (!unique.has(`${form.kind}\u0000${form.text}`))
                unique.set(`${form.kind}\u0000${form.text}`, form);
        return [...unique.values()];
    }
    record(event) {
        this.events.push(event);
        if (this.events.length > 100)
            this.events.shift();
    }
    now() {
        return this.options.now ? this.options.now() : Date.now();
    }
    // A slow register (CEIDG answers in 20-40 s) does not hold the text: it goes on without the
    // forms, and the answer, kept in the cache, protects the next text with the same number.
    async within(pending, source) {
        let timer;
        const timeout = new Promise((resolve) => {
            timer = setTimeout(() => resolve("TIMEOUT"), this.options.timeoutMs ?? 6000);
        });
        try {
            const result = await Promise.race([pending, timeout]);
            if (result !== "TIMEOUT")
                return result;
            this.record({ source: source === "nip" ? "wl" : "krs", status: "TIMEOUT", forms: 0 });
            return [];
        }
        finally {
            clearTimeout(timer);
        }
    }
    lookup(source, id) {
        const key = `${source}:${id}`;
        const cached = this.cache.get(key);
        if (cached && cached.expires > this.now())
            return cached.pending;
        const entry = { pending: Promise.resolve([]), expires: Number.POSITIVE_INFINITY };
        entry.pending = this.resolve(source, id).then(({ forms, retry }) => {
            if (retry === 0)
                this.cache.delete(key);
            else
                entry.expires = this.now() + retry;
            return forms;
        }, () => {
            this.cache.delete(key);
            return [];
        });
        this.cache.delete(key);
        this.cache.set(key, entry);
        if (this.cache.size > (this.options.cacheSize ?? 500))
            this.cache.delete(this.cache.keys().next().value);
        return entry.pending;
    }
    /** Forms of one number and how long they hold (0: ask again next time). */
    async resolve(source, id) {
        if (source === "krs") {
            const krs = await this.ask("krs", "krs_lookup", { numerKrs: id });
            const forms = [...krsForms(krs.row), ...(await this.board(id))];
            this.record({ source: "krs", status: krs.status === "UNAVAILABLE" ? "ERROR" : krs.status, forms: forms.length });
            return { forms, retry: this.retryAfter([krs]) };
        }
        const list = await this.ask("wl", "wl_sprawdz_nip", { nip: id });
        const listForms = whiteListForms(list.row);
        this.record({ source: "wl", status: list.status === "UNAVAILABLE" ? "ERROR" : list.status, forms: listForms.length });
        // A company in KRS is fully described by the white list; a sole trader (or a NIP the
        // list does not know) is also asked in CEIDG for the owner and the business address.
        const result = list.row.result && typeof list.row.result === "object" ? list.row.result : {};
        // A company: its people from the white list; only when the list names none (usual for a
        // sp. z o.o.), the board from KRS, whose public extract masks the names.
        if (list.status === "FOUND" && text(result.krs)) {
            const listed = listForms.some((form) => form.kind === "PERSON" && !form.organization);
            return { forms: listed ? listForms : [...listForms, ...(await this.board(text(result.krs)))], retry: Number.POSITIVE_INFINITY };
        }
        const ceidg = await this.ask("ceidg", "ceidg_szukaj_firmy", { nip: id });
        const ceidgFound = ceidgForms(ceidg.row);
        if (ceidg.status !== "UNAVAILABLE")
            this.record({ source: "ceidg", status: ceidg.status, forms: ceidgFound.length });
        return { forms: [...listForms, ...ceidgFound], retry: this.retryAfter([list, ceidg]) };
    }
    retryAfter(answers) {
        if (answers.some((answer) => answer.status === "ERROR"))
            return 0;
        if (answers.some((answer) => answer.status === "UNAVAILABLE"))
            return UNAVAILABLE_TTL_MS;
        return Number.POSITIVE_INFINITY;
    }
    async board(id) {
        const answer = await this.ask("krs", "krs_reprezentacja", { numerKrs: id });
        return answer.status === "FOUND" ? krsPersonForms(answer.row) : [];
    }
    async ask(source, tool, args) {
        try {
            const reply = await this.call({ source, tool, arguments: args });
            const row = reply.result && typeof reply.result === "object" ? reply.result : {};
            if (!reply.ok)
                return { status: "UNAVAILABLE", row };
            return { status: row.status === "FOUND" ? "FOUND" : row.status === "NOT_FOUND" ? "NOT_FOUND" : "ERROR", row };
        }
        catch {
            return { status: "ERROR", row: {} };
        }
    }
}
/** Off with LEX_REGISTRY_ENRICHMENT=off (no register lookups from pseudonymization). */
export function registryEnrichmentFor(runtime) {
    if (!runtime || /^(off|0|false)$/i.test(process.env.LEX_REGISTRY_ENRICHMENT?.trim() ?? ""))
        return undefined;
    return new RegistryEnrichment((request) => runtime.direct(request));
}
