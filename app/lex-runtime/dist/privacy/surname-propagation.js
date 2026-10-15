// A person found once by full name is protected in the other ways documents name them: the
// surname alone in any case ("Nowakowi", "Pan Wilk") and the surname first ("WILK JAN",
// "Kowalski Jan" in lists) — with the full name's token, so the model sees one person.
// Guards for the quality of the result: a surname two persons of the case share is not
// given to either; at the start of a sentence or in capitals the word may be a common noun
// ("Wilk zaatakował owce"): masked (privacy first) and marked ambiguous, so the local AI can
// suggest and the preview lets the user unmask it with one click.
// Words before a surname that make it a person: honorifics, roles of the proceedings, titles.
const PERSON_CONTEXT = new Set([
    "pan", "pana", "panu", "panem", "panie", "pani", "panią", "panią", "państwo", "państwa",
    "pozwany", "pozwanego", "pozwanemu", "pozwanym", "pozwana", "pozwanej", "pozwaną",
    "powód", "powoda", "powodowi", "powodem", "powódka", "powódki", "powódce", "powódką",
    "świadek", "świadka", "świadkowi", "świadkiem", "wnioskodawca", "wnioskodawcy", "wnioskodawczyni",
    "uczestnik", "uczestnika", "uczestniczka", "dłużnik", "dłużnika", "wierzyciel", "wierzyciela",
    "oskarżony", "oskarżonego", "oskarżona", "pokrzywdzony", "pokrzywdzonego", "pokrzywdzona",
    "adw", "r.pr", "mec", "dr", "prof", "inż", "mgr", "sędzia", "sędziego", "biegły", "biegłego", "obrońca", "pełnomocnik"
]);
function words(text) {
    return text.trim().split(/\s+/u).filter(Boolean);
}
/** Full-name persons (one person, not a firm, at least a given name and a surname). */
function persons(entities) {
    const seen = new Map();
    for (const entity of entities) {
        if (entity.type === "organization" || entity.number === "pl")
            continue;
        if (words(entity.canonical).length < 2)
            continue;
        seen.set(entity.canonical.toLocaleLowerCase("pl"), entity);
    }
    return [...seen.values()];
}
function sentenceStart(text, at) {
    const before = text.slice(Math.max(0, at - 40), at).replace(/\s+$/u, "");
    return before === "" || /[.!?:;\n–—-]$/u.test(before) || /\n\s*$/u.test(text.slice(Math.max(0, at - 40), at));
}
function previousWord(text, at) {
    return (/([\p{L}.]+)\.?\s+$/u.exec(text.slice(Math.max(0, at - 30), at))?.[1] ?? "").replace(/\.$/u, "").toLocaleLowerCase("pl");
}
/** Mentions of known persons by surname alone or surname first, not yet covered. */
export function surnameMentions(text, entities, taken) {
    const people = persons(entities);
    // Surname form -> the persons who have it (unique ones only are used).
    const owners = new Map();
    const reversed = new Map();
    for (const person of people) {
        for (const form of Object.values(person.forms)) {
            const parts = words(form.text);
            if (parts.length < 2)
                continue;
            const surname = parts.at(-1);
            if (surname.length < 3)
                continue;
            const key = surname.toLocaleLowerCase("pl");
            owners.set(key, (owners.get(key) ?? new Set()).add(person));
            reversed.set(`${surname} ${parts.slice(0, -1).join(" ")}`, person);
        }
    }
    const mentions = [];
    const add = (start, end, entity, ambiguous) => {
        if (taken(start, end) || mentions.some((item) => item.start < end && start < item.end))
            return;
        mentions.push({ start, end, value: text.slice(start, end), entity, ...(ambiguous ? { ambiguous: true } : {}) });
    };
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Surname first: "Wilk Jan", "WILK JAN" — the whole order is the person.
    for (const [form, person] of reversed) {
        for (const variant of new Set([form, form.toLocaleUpperCase("pl")])) {
            for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escape(variant)}(?![\\p{L}\\p{N}])`, "gu"))) {
                add(match.index, match.index + match[0].length, person, false);
            }
        }
    }
    // Surname alone, with a capital (or in capitals, as in a heading).
    for (const [key, set] of owners) {
        if (set.size !== 1)
            continue;
        const person = [...set][0];
        const capital = key.charAt(0).toLocaleUpperCase("pl") + key.slice(1);
        const upper = key.toLocaleUpperCase("pl");
        for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}-])(?:${escape(capital)}|${escape(upper)})(?![\\p{L}\\p{N}-])`, "gu"))) {
            const at = match.index;
            const certain = PERSON_CONTEXT.has(previousWord(text, at)) || (match[0] === capital && !sentenceStart(text, at));
            add(at, at + match[0].length, person, !certain);
        }
    }
    return mentions.sort((a, b) => a.start - b.start);
}
