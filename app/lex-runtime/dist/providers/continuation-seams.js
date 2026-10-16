// An answer the provider cut at its output limit and continued ("Kontynuuj dokładnie od miejsca
// przerwania", the Claude CLI's "Output token limit hit. Resume directly"): the pieces are joined
// here. The model resumes mid-thought and often repeats what it already wrote, from a few letters
// ("Zarządc" + "cy") to whole lines; that repetition is dropped. A long document should not rely
// on such seams at all: it is written in parts that end on a whole unit (long-document.ts).
const MAX_OVERLAP = 2_000;
const NEVER_DOUBLED = new Set(["c", "ł", "w", "y", "h", "ą", "ę", "ś", "ć", "ź", "ż", "ó", "ń"]);
/** `next` appended to `text` without the part of it that repeats the end of `text`. */
export function joinContinuation(text, next) {
    if (!text)
        return next;
    if (!next)
        return text;
    // A whole repeated run (a line, a paragraph): the longest suffix of `text` that `next` starts with.
    const limit = Math.min(MAX_OVERLAP, text.length, next.length);
    for (let size = limit; size >= 12; size -= 1) {
        if (text.endsWith(next.slice(0, size)))
            return text + next.slice(size);
    }
    // Mid-word: 2-3 letters re-emitted ("przedwstęp" + "tępna"); a single letter only below.
    const tail = /(\p{L}+)$/u.exec(text)?.[1] ?? "";
    const head = /^(\p{L}+)/u.exec(next)?.[1] ?? "";
    if (tail && head) {
        for (let size = Math.min(3, tail.length, head.length - 1); size >= 2; size -= 1) {
            if (tail.endsWith(head.slice(0, size)))
                return text + next.slice(size);
        }
        // One letter repeated where Polish never doubles it ("Zarządc" + "cy" -> "Zarządcy").
        const last = tail.at(-1).toLocaleLowerCase("pl");
        if (head.length > 1 && head[0].toLocaleLowerCase("pl") === last && NEVER_DOUBLED.has(last))
            return text + next.slice(1);
    }
    return text + next;
}
/** Continuation pieces joined in order. */
export function joinContinuations(pieces) {
    return pieces.reduce((text, piece) => joinContinuation(text, piece), "");
}
