// The same person under different placeholders (2026-11-16): every document of a case
// has its own key, so the user (in the question) and the person acquitted in a verdict, or an
// attorney named in full in one document and by surname in another, were different symbols to
// the model; it wrote that the acquittal "concerned another person". The application restores
// the placeholders locally, compares the names and tells the model only which symbols are one
// person, never the name.
const PERSON_TOKEN = /\[(?:LMPII:D\d{2}|PII):PERSON:\d{4}\]/gu;
const fold = (text) => text
    .replace(/ł/gu, "l")
    .replace(/Ł/gu, "L")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("pl")
    .replace(/[^\p{L}\s-]/gu, " ")
    .split(/[\s-]+/u)
    .filter((word) => word.length >= 2);
// A case form to its stem: "Kowalczyka", "Kowalczykowi" -> "kowalczyk"; "Michała" -> "michal";
// "Zawadzkiego" -> "zawadzki".
function stem(word) {
    for (const ending of ["skiego", "skiemu", "skim", "ckiego", "ckiemu", "ckim", "dzkiego"]) {
        if (word.endsWith(ending))
            return word.slice(0, word.length - ending.length + 3);
    }
    for (const ending of ["owi", "iem", "em", "ie", "a", "u", "y", "ej", "ą", "e"]) {
        if (word.length - ending.length >= 4 && word.endsWith(ending))
            return word.slice(0, -ending.length);
    }
    return word;
}
/** The placeholders of persons in the texts (each once, in order). */
export function personTokens(texts) {
    return [...new Set(texts.flatMap((text) => text.match(PERSON_TOKEN) ?? []))];
}
/**
 * Groups of placeholders that stand for one person: the same name (case forms aside), and a
 * surname alone joined to the one full name with that surname (none when two persons share it).
 */
export function samePersonGroups(tokens, restore) {
    const named = tokens
        .map((token) => ({ token, words: fold(restore(token) ?? "").map(stem) }))
        .filter((item) => item.words.length > 0);
    const full = new Map();
    for (const item of named.filter((entry) => entry.words.length >= 2)) {
        // A given name in another transliteration ("Jurij" / "Yurii", "Aleksandr" / "Oleksandr")
        // with the same surname is the same person: the first key whose surname matches and whose
        // given name is within transliteration distance.
        const exact = [...item.words].sort().join(" ");
        const near = [...full.keys()].find((key) => key !== exact && sameNameAcrossScripts(key.split(" "), item.words));
        const key = full.has(exact) ? exact : near ?? exact;
        full.set(key, [...(full.get(key) ?? []), item.token]);
    }
    // A surname alone: the full names ending with it.
    for (const item of named.filter((entry) => entry.words.length === 1)) {
        const matches = [...full.keys()].filter((key) => key.split(" ").includes(item.words[0]));
        if (matches.length === 1)
            full.get(matches[0]).push(item.token);
    }
    return [...full.values()].filter((group) => group.length >= 2).map((group) => [...new Set(group)]).filter((group) => group.length >= 2);
}
export function identityLegendPrompt(groups, questionTokens = new Set()) {
    if (!groups.length)
        return "";
    return [
        "# TE SAME OSOBY POD RÓŻNYMI SYMBOLAMI (ustalone lokalnie przez aplikację)",
        "Każdy dokument ma własne symbole osób. Symbole w jednym wierszu to ta sama osoba (aplikacja porównała nazwiska na tym komputerze, odmiana i samo nazwisko uwzględnione). Traktuj je jako jedną osobę we wszystkich dokumentach; nie pisz, że dokument dotyczy „innej osoby”, gdy jej symbol jest w tym samym wierszu.",
        ...groups.map((group) => `- ${group.join(" = ")}${group.some((token) => questionTokens.has(token)) ? " (osoba wymieniona w pytaniu użytkownika)" : ""}`)
    ].join("\n");
}
// Latin spellings of one Cyrillic name: y/j/i, kh/h/ch, ii/ij/iy at the end, doubled letters.
function transliterated(word) {
    return word
        .replace(/^y/u, "j")
        .replace(/(?:ii|iy|ij|yj|yi)$/u, "ij")
        .replace(/kh|ch/gu, "h")
        .replace(/y/gu, "i")
        .replace(/(.)\1/gu, "$1");
}
function sameNameAcrossScripts(a, b) {
    if (a.length !== b.length || a.length < 2)
        return false;
    const left = a.map(transliterated).sort();
    const right = b.map(transliterated).sort();
    return left.every((word, index) => word === right[index]);
}
