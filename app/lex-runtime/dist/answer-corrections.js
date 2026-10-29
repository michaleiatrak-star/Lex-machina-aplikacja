// What a correcting round of the application changed in an answer: the findings that sent it
// back and the sentences of the first version the corrected one no longer has. Kept with the
// answer, so "which claims did you remove?" is answered from this record, not reconstructed.
const MAX_REMOVED = 15;
const MAX_SENTENCE = 400;
const MAX_FINDINGS = 10;
const normalize = (text) => text
    .replace(/[✅🟨⚠️⛔]|\[VER:[^\]]*\]/gu, "")
    .replace(/[*_#>`|]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("pl");
// Legal abbreviations end with a dot inside a sentence ("art. 6", "Dz.U. poz. 5").
const ABBREVIATION = /(?:^|[\s(\[])(?:art|ust|pkt|poz|nr|lit|sygn|r|tj|t\.j|Dz\.U|zm|godz|str|s|ok|tzw|np|m\.in|ww|zob|por|par|k\.c|k\.p\.c|k\.k|k\.p\.a)\.$/iu;
function splitLine(line) {
    const parts = line.split(/(?<=[.!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9„"(\[])/u);
    const out = [];
    for (const part of parts) {
        const last = out[out.length - 1];
        if (last !== undefined && (ABBREVIATION.test(last) || /\[[^\]]*$/u.test(last)))
            out[out.length - 1] = `${last} ${part}`;
        else
            out.push(part);
    }
    return out;
}
// Sentences and list items; a sentence ends at . ! ? before whitespace and a capital or digit.
function sentences(text) {
    return text
        .split(/\n+/u)
        .flatMap(splitLine)
        .map((part) => part.replace(/^\s*(?:[-*•]|\d{1,3}[.)])\s+/u, "").trim())
        .filter((part) => normalize(part).length >= 20);
}
// A sentence the round only added to ("art. 17 ust. 3 lit. e" -> "... lit. e RODO", RD 121/26)
// is kept, not removed: every word stays, in order, with a few new ones.
const MAX_INSERTED_WORDS = 6;
function amended(words, candidates) {
    return candidates.some((candidate) => {
        if (candidate.length < words.length || candidate.length > words.length + MAX_INSERTED_WORDS)
            return false;
        let at = 0;
        for (const word of candidate)
            if (at < words.length && word === words[at])
                at += 1;
        return at === words.length;
    });
}
/** Sentences of the first version the corrected one does not contain (in their order). */
export function removedSentences(before, after) {
    const kept = normalize(after);
    const afterWords = sentences(after).map((sentence) => normalize(sentence).split(" "));
    const seen = new Set();
    const removed = [];
    for (const sentence of sentences(before)) {
        const key = normalize(sentence);
        if (seen.has(key) || kept.includes(key) || amended(key.split(" "), afterWords))
            continue;
        seen.add(key);
        removed.push(sentence.length > MAX_SENTENCE ? `${sentence.slice(0, MAX_SENTENCE)}…` : sentence);
        if (removed.length >= MAX_REMOVED)
            break;
    }
    return removed;
}
export function answerCorrection(round, findings, before, after) {
    return { round, findings: findings.slice(0, MAX_FINDINGS), removed: removedSentences(before, after) };
}
export function validAnswerCorrections(value) {
    return (Array.isArray(value) &&
        value.length <= 4 &&
        value.every((item) => item &&
            typeof item === "object" &&
            (item.round === "MANDATORY_PATH" || item.round === "CASE_GROUNDING" || item.round === "NO_ANSWER" || item.round === "ACT_NAME") &&
            Array.isArray(item.findings) &&
            item.findings.length <= MAX_FINDINGS &&
            item.findings.every((finding) => typeof finding === "string" && finding.length <= 500) &&
            Array.isArray(item.removed) &&
            item.removed.length <= MAX_REMOVED &&
            item.removed.every((sentence) => typeof sentence === "string" && sentence.length <= MAX_SENTENCE + 1)));
}
// An answer that only puts the answer off ("nie mogę jeszcze sporządzić…, dalsza odpowiedź
// zostanie przygotowana po…") gives the user neither the substance nor a question to answer.
const DEFERRAL = new RegExp([
    // "Nie mogę jeszcze sporządzić…", "nie jestem w stanie teraz podać…"
    String.raw `\bnie\s+(?:mogę|mogłem|jestem\s+w\s+stanie|można)\s+(?:jeszcze\s+|na\s+tym\s+etapie\s+|teraz\s+)?(?:bezpiecznie\s+)?(?:sporządzić|przygotować|udzielić|odpowiedzieć|wydać|podać|przedstawić)`,
    // "…zostanie przygotowana po…", "po (ich) zakończeniu kontroli"
    String.raw `\bzostanie\s+przygotowan\p{L}*\s+po`,
    String.raw `\bpo\s+(?:ich\s+)?(?:zakończeniu|domknięciu|uzupełnieniu)\s+(?:kontroli|weryfikacji|sprawdzeń)`,
    // "muszę najpierw zweryfikować przepisy", "należy jeszcze sprawdzić"
    String.raw `\b(?:muszę|należy|trzeba|powinienem)\s+(?:najpierw|jeszcze|wcześniej|przedtem)\s+(?:zweryfikować|sprawdzić|potwierdzić|ustalić|przeanalizować)`,
    // "potrzebuję jeszcze potwierdzenia podstaw prawnych"
    String.raw `\bpotrzebuję\s+(?:jeszcze\s+|najpierw\s+)?(?:potwierdzenia|weryfikacji|sprawdzenia|zweryfikowania|analizy)`,
    // "Następnie przedstawię gotowy projekt", "Przygotuję odpowiedź, ale…"
    String.raw `\b(?:następnie|potem|wówczas|później)\s+(?:przedstawię|przygotuję|sporządzę|podam|prześlę)`,
    String.raw `\bprzygotuję\s+(?:odpowiedź|pismo|projekt)\p{L}*\s*,\s*ale`
].join("|"), "iu");
// Markdown emphasis and headings the chat renders ("**Do:**", "### Tytuł"): not the text.
export function withoutMarkdown(text) {
    return text
        .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?)/gmu, "")
        .replace(/(\*\*|__)(.+?)\1/gu, "$2")
        .replace(/(?<![\p{L}\p{N}*_])[*_](?![\s*_])([^*_\n]+?)(?<![\s*_])[*_](?![\p{L}\p{N}*_])/gu, "$1");
}
/** The body of an answer without the disclaimer the application appends. */
function answerBody(text) {
    const cut = text.search(/⚖️|\bWażna informacja:/u);
    return (cut >= 0 ? text.slice(0, cut) : text).trim();
}
/** True for an answer that defers without substance and without a question or a list of what is missing. */
export function emptyDeferral(text) {
    const body = withoutMarkdown(answerBody(text));
    if (!body || body.length > 900 || !DEFERRAL.test(body))
        return false;
    if (/\?/u.test(body))
        return false;
    const items = body.split("\n").filter((line) => /^\s*(?:[-*•]|\d{1,2}[.)])\s+\S/u.test(line));
    return items.length < 2;
}
// Every correcting round: the user never saw the corrected draft nor the check; the application
// lists its corrections next to the answer. Without this the answer opened with "Co poprawiłam
// względem poprzedniej wersji" and withdrew claims the user had never read (test 500, live run).
export const CORRECTED_ANSWER_FORM = [
    "FORMA: zwróć całą odpowiedź dla użytkownika od nowa, tak jakby była pierwsza.",
    "Użytkownik nie widział poprzedniej wersji ani tej kontroli: nie pisz o poprzedniej wersji, poprawkach, kontroli aplikacji,",
    "wycofanych twierdzeniach ani o tym, co zmieniono (aplikacja pokazuje poprawki osobno).",
    "Twierdzenie, którego nie potwierdza pobrany tekst, pomiń albo oznacz ⚠️ w treści, bez komentarza o zmianie."
].join(" ");
export const NO_ANSWER_CORRECTION = [
    "KONTROLA APLIKACJI — odpowiedź bez treści: poprzednia odpowiedź tylko zapowiada odpowiedź na później,",
    "nie daje użytkownikowi ani merytorycznej odpowiedzi na jego pytanie, ani pytania, na które mógłby odpowiedzieć.",
    "Napisz ją od nowa: odpowiedz merytorycznie na podstawie dokumentów sprawy w zakresie, w jakim to możliwe;",
    "jeżeli czegoś brakuje do dalszej części, wymień konkretnie, czego (dane, dokumenty, decyzje użytkownika), w formie pytań.",
    "Nie zapowiadaj odpowiedzi na później i nie powołuj się na niedomknięte kontrole bez wskazania, co z nich wynika."
].join(" ");
