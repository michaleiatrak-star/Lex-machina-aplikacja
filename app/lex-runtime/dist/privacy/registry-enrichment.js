import { firmFragments } from "./firm-names.js";
import { detectIdentifiers, validNip } from "./identifiers.js";
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
    const name = text(result.tytul_lub_nazwa);
    // The firm's accounts on the list: the one in a letter is the firm's, also as OCR misread it.
    const accounts = (Array.isArray(result.rachunki) ? result.rachunki : [])
        .filter((value) => typeof value === "string" && /^\d{26}$/u.test(value))
        .map((value) => ({
        text: value.replace(/^(\d{2})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})(\d{4})$/u, "$1 $2 $3 $4 $5 $6 $7"),
        kind: "IBAN",
        uncertain: `rachunek z białej listy VAT${name ? `: ${name}` : ""}`
    }));
    // The firm's KRS and REGON: found also without their label, and a REGON one digit off
    // after its label is the same firm's (a typo in the document or an OCR misreading).
    const numbers = ["krs", "regon"]
        .map((key) => ({ key, value: text(result[key])?.replace(/\D/gu, "") }))
        .filter((item) => Boolean(item.value && /^\d{9,14}$/u.test(item.value)))
        .map(({ key, value }) => ({
        text: value,
        kind: key === "krs" ? "KRS" : "REGON",
        uncertain: `${key.toUpperCase()} z białej listy VAT${name ? `: ${name}` : ""}: ${value}`
    }));
    return [
        ...accounts,
        ...numbers,
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
            // "KRS 0000 297714": the register's tool takes digits only.
            const id = span.value.replace(/\D/gu, "");
            keys.set(`krs:${id}`, { source: "krs", id });
        }
    }
    // A NIP after its label as OCR damaged it ("634–30–21–499", "634-3O-21-499", "NIP634 30 21 499"):
    // asked only when the digits, with letters read for digits, pass the checksum.
    for (const match of value.matchAll(/\bN[I1lí]P\s*(?:nr\.?\s*)?:?\s*((?:PL\s?)?[\dOoIl|][\dOoIl|  –—-]{8,16}[\dOoIl|])/gu)) {
        const id = match[1].replace(/^PL\s?/u, "").replace(/[Oo]/gu, "0").replace(/[Il|]/gu, "1").replace(/\D/gu, "").slice(0, 10);
        if (id.length === 10 && validNip(id))
            keys.set(`nip:${id}`, { source: "nip", id });
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
    // The register facts of the numbers looked up, by NIP and by KRS.
    factsById = new Map();
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
    /** Register facts of the firms whose NIP or KRS is among these values (as written in the documents). */
    facts(values) {
        const found = new Set();
        for (const value of values) {
            const digits = value.replace(/\D/gu, "");
            const facts = this.factsById.get(digits) ?? this.factsById.get(digits.padStart(10, "0"));
            if (facts)
                found.add(facts);
        }
        return [...found];
    }
    remember(source, row) {
        const result = row.result && typeof row.result === "object" ? row.result : null;
        if (row.status !== "FOUND" || !result)
            return;
        const nip = text(result.nip)?.replace(/\D/gu, "");
        const krs = text(result.krs)?.replace(/\D/gu, "") ?? (/KRS\s*(\d{10})/u.exec(text(result.identyfikator) ?? "")?.[1]);
        const known = (nip && this.factsById.get(nip)) || (krs && this.factsById.get(krs)) || { checkedAt: new Date(this.now()).toISOString().slice(0, 10), sources: [] };
        const next = {
            ...known,
            ...(nip ? { nip } : {}),
            ...(krs ? { krs } : {}),
            ...(text(result.tytul_lub_nazwa) ? { name: text(result.tytul_lub_nazwa) } : {}),
            sources: [...new Set([...known.sources, source])]
        };
        if (source === "krs") {
            if (text(result.rejestr))
                next.register = text(result.rejestr);
            if (text(result.status_rejestru))
                next.registerStatus = text(result.status_rejestru);
            if (text(result.forma_prawna))
                next.legalForm = text(result.forma_prawna);
            if (text(result.siedziba))
                next.seat = text(result.siedziba);
            if (text(result.stan_z_dnia))
                next.extractDate = text(result.stan_z_dnia);
        }
        if (source === "wl") {
            if (text(result.status_vat))
                next.vatStatus = text(result.status_vat);
            if (text(result.data_rejestracji_vat))
                next.vatRegistered = text(result.data_rejestracji_vat);
            if (text(result.data_wykreslenia))
                next.vatStruckOff = text(result.data_wykreslenia);
            if (Array.isArray(result.rachunki))
                next.accounts = result.rachunki.filter((item) => typeof item === "string");
        }
        if (nip)
            this.factsById.set(nip, next);
        if (krs)
            this.factsById.set(krs, next);
        if (this.factsById.size > 400)
            this.factsById.delete(this.factsById.keys().next().value);
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
            this.remember("krs", krs.row);
            const forms = [...krsForms(krs.row), ...(await this.board(id))];
            this.record({ source: "krs", status: krs.status === "UNAVAILABLE" ? "ERROR" : krs.status, forms: forms.length });
            return { forms, retry: this.retryAfter([krs]) };
        }
        const list = await this.ask("wl", "wl_sprawdz_nip", { nip: id });
        this.remember("wl", list.row);
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
/** The facts as the analysis reads them, in plain text (the caller protects it like any text). */
export function registryFactsText(facts) {
    if (!facts.length)
        return "";
    const lines = [
        "# PODMIOTY W REJESTRACH (aplikacja — odczyt z rejestrów, sprawdzone)",
        "Dane pobrane przez aplikację z KRS i z białej listy VAT dla numerów z materiałów: traktuj jako sprawdzone (KROK 0D: ⬛ → ✅ dla tych pól, ze źródłem i datą). Reprezentacja i pełnomocnictwa: krs_reprezentacja.",
    ];
    for (const item of facts) {
        const parts = [
            item.name ? `${item.name}` : "podmiot",
            item.krs ? `KRS ${item.krs}` : "",
            item.nip ? `NIP ${item.nip}` : "",
            item.legalForm ? `forma: ${item.legalForm.toLocaleLowerCase("pl")}` : "",
            item.seat ? `siedziba: ${titleCase(item.seat)}` : "",
            item.registerStatus ? `KRS: ${item.registerStatus}${item.extractDate ? ` (odpis aktualny, stan z ${item.extractDate})` : ""}` : "",
            item.vatStatus ? `VAT: ${item.vatStatus}${item.vatRegistered ? ` od ${item.vatRegistered}` : ""}${item.vatStruckOff ? `, wykreślony ${item.vatStruckOff}` : ""}` : "",
            item.accounts?.length ? `rachunki na białej liście: ${item.accounts.join(", ")}` : ""
        ].filter(Boolean);
        lines.push(`- ${parts.join("; ")} — źródła: ${item.sources.map((source) => (source === "krs" ? "KRS (api-krs.ms.gov.pl)" : "biała lista VAT (wl-api.mf.gov.pl)")).join(", ")}, odczyt ${item.checkedAt}.`);
    }
    lines.push("Rachunek podany w piśmie, którego nie ma na białej liście, wskaż wprost (płatność na rachunek spoza wykazu).");
    return lines.join("\n");
}
/** The check digit a NIP should have, or null when no digit fits (the number cannot exist). */
function nipCheckDigit(value) {
    const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    const sum = weights.reduce((total, weight, index) => total + weight * Number(value[index]), 0) % 11;
    return sum === 10 ? null : sum;
}
/** A word of a name, folded for comparison ("Logistyka" = "LOGISTYKA", "Ł" = "L"). */
function fold(value) {
    return value.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/giu, "l").toLocaleLowerCase("pl");
}
/**
 * The document's party data checked against the register, computed by the application (not
 * left to the model): a NIP after its label with a wrong check digit, and for each KRS number
 * of the material whose extract was read, whether the paragraph naming it gives the register's
 * name, seat and NIP. A mismatch means the comparycja names another firm or a wrong number:
 * the parties must be corrected from current extracts before signature.
 */
export function registryConsistencyText(material, facts) {
    const lines = [];
    const seen = new Set();
    for (const match of material.matchAll(/\bNIP\s*(?:nr\.?\s*)?:?\s*((?:PL\s?)?\d{3}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}|(?:PL\s?)?\d{3}[\s-]?\d{2}[\s-]?\d{2}[\s-]?\d{3})(?!\d)/gu)) {
        const nip = match[1].replace(/\D/gu, "");
        if (nip.length !== 10 || seen.has(nip) || validNip(nip))
            continue;
        seen.add(nip);
        const expected = nipCheckDigit(nip);
        lines.push(`- NIP ${nip}: błędna cyfra kontrolna (${expected === null ? "żadna cyfra kontrolna nie pasuje" : `wyliczona ${expected}, w numerze ${nip[9]}`}) — taki NIP nie istnieje; podmiotu nie da się sprawdzić w białej liście VAT po tym numerze.`);
    }
    const paragraphs = material.split(/\n\s*\n|\n(?=\s*(?:a|oraz|i)\s*\n)/u);
    for (const item of facts) {
        if (!item.krs)
            continue;
        const krsDigits = item.krs.replace(/^0+/u, "");
        const paragraph = paragraphs.find((part) => part.replace(/\D+/gu, " ").split(" ").some((number) => number.length >= 7 && number.replace(/^0+/u, "") === krsDigits));
        if (!paragraph)
            continue;
        const folded = fold(paragraph);
        const issues = [];
        const name = item.name ? firmNameForms(item.name)[0]?.text : undefined;
        if (name && !folded.includes(fold(name)))
            issues.push(`nazwa w KRS: „${item.name}” — dokument podaje inną nazwę`);
        if (item.seat && !folded.includes(fold(item.seat).slice(0, Math.max(4, fold(item.seat).length - 2))))
            issues.push(`siedziba w KRS: ${titleCase(item.seat)} — dokument podaje inną`);
        const documentNips = [...paragraph.matchAll(/\bNIP\s*(?:nr\.?\s*)?:?\s*((?:PL\s?)?[\d\s-]{10,16}\d)/gu)].map((found) => found[1].replace(/\D/gu, "").slice(-10));
        if (item.nip && documentNips.length && !documentNips.includes(item.nip))
            issues.push(`NIP w KRS: ${item.nip} — dokument podaje ${documentNips.join(", ")}`);
        lines.push(issues.length
            ? `- KRS ${item.krs}: NIEZGODNE z dokumentem: ${issues.join("; ")}.`
            : `- KRS ${item.krs}: zgodne z dokumentem (nazwa${item.seat ? ", siedziba" : ""}${item.nip && documentNips.length ? ", NIP" : ""}).`);
    }
    if (!lines.length)
        return "";
    return [
        "# ZGODNOŚĆ DANYCH STRON Z REJESTRAMI (aplikacja — porównanie wykonane przed analizą)",
        "Wynik jest ustaleniem (KROK 0D / AU-POV): przy NIEZGODNE napisz wprost, który numer należy do jakiego podmiotu w rejestrze, i wskaż korektę komparycji przed podpisem. Nazwa i siedziba spółki z rejestru to dane podmiotu, nie dane osobowe: podawaj je (symbolem firmy, gdy go masz).",
        ...lines
    ].join("\n");
}
