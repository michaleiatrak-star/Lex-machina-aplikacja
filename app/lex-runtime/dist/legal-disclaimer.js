// KROK 7 routera: ostatnim elementem odpowiedzi prawnej jest disclaimer z
// shared/DISCLAIMER.md (wariant LAIK albo PRAWNIK, przy projekcie pisma także
// WARIANT PISMO SĄDOWE). Gdy model go nie dał na końcu, dokłada go aplikacja.
const CLOSING = /nie\s+stanowi\s+porady\s+prawnej/iu;
function block(markdown, heading) {
    const at = markdown.search(heading);
    if (at < 0)
        return null;
    const fence = /```[^\n]*\n([\s\S]*?)```/u.exec(markdown.slice(at));
    return fence?.[1]?.trim() || null;
}
/** Warianty z pliku kanonicznego; null, gdy plik nie ma oczekiwanej budowy. */
export function parseDisclaimer(markdown) {
    const laik = block(markdown, /^###\s+TRYB LAIK/mu);
    const prawnik = block(markdown, /^###\s+TRYB PRAWNIK/mu);
    const pismo = block(markdown, /^###\s+WARIANT PISMO/mu);
    if (!laik || !prawnik)
        return null;
    return { laik, prawnik, ...(pismo ? { pismo } : {}) };
}
/** Disclaimer jest ostatnim akapitem odpowiedzi. */
export function endsWithDisclaimer(answer) {
    const paragraphs = answer.trim().split(/\n\s*\n/u).filter((paragraph) => !/^\s*(?:-{3,}|\*{3,})\s*$/u.test(paragraph));
    return CLOSING.test(paragraphs.slice(-2).join("\n"));
}
const OPENING = /^\s*(?:-{3,}\s*\n\s*)?(?:⚖️|⚠️\s*\*\*Przed podpisaniem|\*\*(?:Zastrzeżenie|Ważna informacja)|Zastrzeżenie\s*:)/u;
/**
 * The model's closing disclaimer, cut off: it is the fixed text of
 * shared/DISCLAIMER.md (acts verified there in ELI), so the gates check the
 * analysis without it and the application appends the canonical text.
 */
export function splitTrailingDisclaimer(answer) {
    const text = answer.trimEnd();
    const starts = [0, ...[...text.matchAll(/\n\s*\n/gu)].map((match) => match.index + match[0].length)];
    // The earliest of the last few paragraphs that opens the disclaimer.
    for (const start of starts.slice(-4)) {
        const tail = text.slice(start);
        if (!OPENING.test(tail) || !CLOSING.test(tail) || tail.length > 2500)
            continue;
        let body = text.slice(0, start).trimEnd();
        // A "---" rule left alone above it belongs to the disclaimer.
        body = body.replace(/\n\s*(?:-{3,}|\*{3,})\s*$/u, "").trimEnd();
        return { body, disclaimer: tail };
    }
    return { body: answer, disclaimer: null };
}
export function withDisclaimer(answer, texts, options) {
    if (endsWithDisclaimer(answer))
        return { text: answer, appended: false };
    const parts = [options.mode === "LAIK" ? texts.laik : texts.prawnik];
    if (options.pleading && options.mode === "PRAWNIK" && texts.pismo)
        parts.push(texts.pismo);
    return { text: `${answer.trimEnd()}\n\n${parts.join("\n\n")}`, appended: true };
}
