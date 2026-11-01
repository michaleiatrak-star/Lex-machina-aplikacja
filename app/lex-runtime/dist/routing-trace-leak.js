/**
 * The router's KROK 3A trace written by the model into the answer ("TRYB: LAIK", "PRIMARY: dr-02…
 * ROUTER-WCZYTANY: TAK", "WERSJA ROUTERA: 3.74"): the application writes that trace itself from the
 * audit (mandatoryPath.routingTrace), so the model's copy is internal text shown to the user (live
 * B02-P04, C09-058: graders took a point for form every time). Only a block of such lines naming the
 * router's own fields is removed, never a single "TRYB:" line of a letter.
 */
const TRACE_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:TRYB|PRIMARY|SECONDARY|ODRZUCONE|PROFIL|ODROCZONE|WERSJA ROUTERA|BLUEPRINT|KROK 3A|ŚLAD ROUTINGU)(?:\*\*)?\s*[:—-]/iu;
const TRACE_HEADING = /^\s*(?:#+\s*)?(?:\*\*)?(?:KROK 3A|Ślad routingu|Routing)(?:\*\*)?\s*:?\s*$/iu;
const ROUTER_FIELD = /^\s*(?:[-*•]\s*)?(?:\*\*)?(?:PRIMARY|WERSJA ROUTERA)(?:\*\*)?\s*:/iu;
export function withoutModelRoutingTrace(text) {
    const lines = text.split("\n");
    const drop = new Set();
    let index = 0;
    while (index < lines.length) {
        if (!TRACE_LINE.test(lines[index])) {
            index += 1;
            continue;
        }
        let end = index;
        const traced = [];
        while (end < lines.length && (TRACE_LINE.test(lines[end]) || (!lines[end].trim() && TRACE_LINE.test(lines[end + 1] ?? "")))) {
            if (lines[end].trim())
                traced.push(end);
            end += 1;
        }
        if (traced.length >= 3 && traced.some((line) => ROUTER_FIELD.test(lines[line]))) {
            for (let line = index; line < end; line += 1)
                drop.add(line);
            const heading = index - 1;
            if (heading >= 0 && TRACE_HEADING.test(lines[heading]))
                drop.add(heading);
        }
        index = end;
    }
    if (drop.size === 0)
        return text;
    return lines
        .filter((_line, at) => !drop.has(at))
        .join("\n")
        .replace(/\n{3,}/gu, "\n\n")
        .replace(/\n+$/u, text.endsWith("\n") ? "\n" : "");
}
