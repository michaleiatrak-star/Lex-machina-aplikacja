// The same person written another way in one document: by OCR (a mark lost, a space lost, a
// letter misread) or by the writer (a given name inflected, the surname not: "Panem Michałem
// Wiatrak"). The morphology reads each spelling as its own person; the model would then see
// several persons where the case has one.
/** Letters only, without marks or case: "MICHAŁ WIATRAK", "Michal  Wiatrak" -> "michalwiatrak". */
function loose(text) {
    return text
        .replace(/ł/gu, "l")
        .replace(/Ł/gu, "L")
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLocaleLowerCase("pl")
        .replace(/[^\p{L}]/gu, "");
}
const words = (text) => text.split(/\s+/u).filter(Boolean);
function distance(a, b) {
    if (Math.abs(a.length - b.length) > 1)
        return 2;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        const current = [i];
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[b.length];
}
/**
 * The known person a mention is, or null: the same letters (marks, case and spaces aside);
 * every word a case form of the person's word in its place ("Michałem" of Michał,
 * "Wiatrak" of Wiatrak; "Michalina" is no form of Michał); one letter off in a long name,
 * marked for the user to confirm.
 */
export function samePerson(value, own, known) {
    const surface = loose(value);
    if (surface.length < 6)
        return null;
    const parts = words(value).map(loose);
    for (const person of known) {
        if (person === own || person.type === "organization")
            continue;
        const forms = Object.values(person.forms).map((form) => form.text);
        if (forms.some((form) => loose(form) === surface))
            return { entity: person };
        // Word by word: each word of the mention is a form of the person's word in that place.
        const byPlace = [];
        for (const form of forms) {
            const formWords = words(form).map(loose);
            if (formWords.length !== parts.length)
                continue;
            formWords.forEach((word, place) => (byPlace[place] ??= new Set()).add(word));
        }
        if (parts.length >= 2 && byPlace.length === parts.length && parts.every((word, place) => byPlace[place].has(word))) {
            return { entity: person };
        }
    }
    // OCR: one letter off in a long name, the same number of words.
    if (surface.length >= 12) {
        for (const person of known) {
            if (person === own || person.type === "organization")
                continue;
            const canonical = loose(person.canonical);
            if (words(person.canonical).length === parts.length && distance(surface, canonical) === 1) {
                return { entity: person, uncertain: `odczyt zniekształcony przez OCR? Ta sama osoba co ${person.canonical}` };
            }
        }
    }
    return null;
}
