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
// A sentence the round only added to ("art. 17 ust. 3 lit. e" -> "... lit. e RODO", a live case)
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
        value.length <= 5 &&
        value.every((item) => item &&
            typeof item === "object" &&
            (item.round === "MANDATORY_PATH" || item.round === "CASE_GROUNDING" || item.round === "NO_ANSWER" || item.round === "ACT_NAME" || item.round === "QUOTE_SOURCE" || item.round === "STATUTE_CONTENT") &&
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
    String.raw `\bprzygotuję\s+(?:odpowiedź|pismo|projekt)\p{L}*\s*,\s*ale`,
    // "Czekam na wynik niezależnej recenzji projektu, zanim oddam gotowe pismo." (0.1.94)
    String.raw `\bczekam\s+na\s+(?:wynik|wyniki|recenzj\p{L}*|odpowiedź|weryfikacj\p{L}*|potwierdzeni\p{L}*)`,
    String.raw `\bzanim\s+(?:oddam|przekażę|przedstawię|przygotuję|podam)`
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
    const body = (cut >= 0 ? text.slice(0, cut) : text).trim();
    // The control blocks the application asks for (CN-GATE, REM-GATE…) are no substance: a deferral
    // followed by them is still a deferral (live case: 2.9 thousand characters of empty gates).
    const gates = body.search(/^\s*(?:\*\*)?(?:CN|WYJ|REM|OŚ|PP|ODW|SN|WER)-GATE\b/mu);
    return (gates > 0 ? body.slice(0, gates) : body).trim();
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
// A round that rewrites the whole answer replaces it only with an answer (XI P 27/26, 2026-11-20:
// a weaker model answered the source check with "Odtworzę pełną odpowiedź … Najpierw odczytam
// brakującą część zlecenia." and the application took it for the pleading: no quote and no
// provision left, so "fewer problems"; the user got one sentence instead of the letter).
const ANNOUNCEMENT = /^[\s*_#>]*(?:odtworzę|naniosę|poprawię|uzupełnię|przepiszę|przygotuję|sporządzę|zacznę|najpierw\s+(?:odczytam|sprawdzę|przeczytam|wczytam|ustalę)|poniżej\s+(?:poprawion|uzupełnion|pełn))/iu;
const PETITUM = /(?<![\p{L}])(?:wnosz[ęe]|wnosi\s+o|wnoszą)(?![\p{L}])/iu;
const DOCUMENT_MARK = /\[\[LEXDOC(?:REF)?:/gu;
/** Why a rewritten answer may not replace the first one; null when it may. */
export function rewriteRejection(before, after) {
    const text = after.trim();
    if (!text)
        return "pusta odpowiedź";
    if (emptyDeferral(text))
        return "odpowiedź odroczona bez treści";
    const original = before.trim();
    if (original.length >= 1_200 && text.length < original.length * 0.6)
        return "krótsza niż 60% pierwszej wersji";
    if (text.length < 600 && ANNOUNCEMENT.test(text))
        return "zapowiedź pracy zamiast odpowiedzi";
    if (PETITUM.test(original) && !PETITUM.test(text))
        return "bez wniosków, które miała pierwsza wersja";
    const marks = (value) => (value.match(DOCUMENT_MARK) ?? []).length;
    if (marks(original) >= 4 && marks(text) < marks(original) / 2)
        return "utracone odwołania do akt";
    // A drafted document (a contract by analizator-umow, a letter by pisma-proste, a pleading): its
    // units — paragraphs (§), articles, numbered points — may not go missing in a correcting round.
    const units = (value) => (value.match(DOCUMENT_UNIT) ?? []).length;
    if (units(original) >= 4 && units(text) < units(original) * 0.7)
        return "utracone jednostki dokumentu (paragrafy, artykuły, punkty)";
    return null;
}
const DOCUMENT_UNIT = /^[ \t>*#]*(?:§\s*\d+[a-z]?|Art(?:ykuł|\.)\s*\d+[a-z]?|\d{1,3}[.)])(?=\s)/gmu;
// Point corrections (2026-11-20, a pleading's checks took 1006 s: each round rewrote the whole
// letter): for a wrong quote or a provision described otherwise than its wording the model returns
// only the fragments to replace; the application applies them to the answer.
export const POINT_EDITS_FORM = [
    "FORMA: NIE przepisuj odpowiedzi. Zwróć WYŁĄCZNIE wiersze JSON, jeden obiekt w wierszu:",
    '{"bylo": "fragment odpowiedzi skopiowany dosłownie, z jednego akapitu, tak krótki, jak się da, ale jednoznaczny", "ma_byc": "nowe brzmienie tego fragmentu (pusty tekst = usunięcie)"}',
    "Jeden obiekt na każde miejsce do poprawy; nic poza wierszami JSON."
].join("\n");
/** The answer with the model's point edits applied; edits whose fragment is not found once are skipped. */
export function applyPointEdits(answer, reply) {
    let text = answer;
    let applied = 0;
    let skipped = 0;
    for (const line of reply.split("\n")) {
        const candidate = line.trim().replace(/^[-*]\s*/u, "").replace(/,$/u, "");
        if (!candidate.startsWith("{") || !candidate.endsWith("}"))
            continue;
        let edit;
        try {
            edit = JSON.parse(candidate);
        }
        catch {
            skipped += 1;
            continue;
        }
        const from = typeof edit.bylo === "string" ? edit.bylo : "";
        const to = typeof edit.ma_byc === "string" ? edit.ma_byc : null;
        const at = from.length >= 8 ? text.indexOf(from) : -1;
        if (at < 0 || to === null || text.indexOf(from, at + 1) >= 0) {
            skipped += 1;
            continue;
        }
        text = text.slice(0, at) + to + text.slice(at + from.length);
        applied += 1;
    }
    return { text: text.replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n"), applied, skipped };
}
