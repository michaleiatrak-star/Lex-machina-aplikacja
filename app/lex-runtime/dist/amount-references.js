// Stawki, terminy, kary i sankcje podane liczbowo (PRAWO-HARDGATE, ZASADA ABSOLUTNA):
// wartość jest potwierdzona tylko wtedy, gdy występuje w brzmieniu przepisu
// zweryfikowanego w tym samym wierszu; inaczej dostaje ⚠️ [NIEWERYFIKOWANE].
// Wiersz mówi o normie (termin, kara, stawka), a nie o faktach sprawy.
const NORMATIVE_CONTEXT = /zagrożon|podlega\s|ustawow|w\s+terminie|termin\p{L}*\s+(?:na|do|wynosi|\d)|stawk|grzywn|pozbawienia\s+wolności|ograniczenia\s+wolności|przedawni|odsetk|opłat\p{L}*\s+(?:stał|stosunkow|podstawow|sądow|kancelaryjn)|wpis\p{L}*\s+(?:stał|stosunkow)|sankcj|kar\p{L}*\s+(?:umown|pieniężn|porządkow)/iu;
const AMOUNT = /(?<![\p{L}\d,.])(?:(?:do|od)\s+lat\s+\d{1,2}|\d{1,3}(?:[  ]\d{3})+(?:,\d+)?\s*(?:zł|złotych|PLN)|\d+(?:,\d+)?\s*(?:zł|złotych|PLN|%|proc\.?|procent\p{L}*)|\d{1,4}\s*(?:dni|dnia|tygodni\p{L}*|tydzień|miesięcy|miesiąca|miesiące|lat|lata|roku))(?![\p{L}\d])/giu;
function unitOf(text) {
    if (/lat|lata|roku/iu.test(text))
        return "Y";
    if (/miesi/iu.test(text))
        return "M";
    if (/tydz|tygod/iu.test(text))
        return "W";
    if (/dni|dnia/iu.test(text))
        return "D";
    if (/%|proc/iu.test(text))
        return "P";
    return "Z";
}
function keyOf(text) {
    const years = /(?:do|od)\s+lat\s+(\d{1,2})/iu.exec(text);
    const number = years ? years[1] : (/\d+(?:[  ]\d{3})*(?:,\d+)?/u.exec(text)?.[0] ?? "");
    return `${number.replace(/[  ]/g, "")}${unitOf(text)}`;
}
/** Wartości liczbowe norm w wierszu; pusty wynik, gdy wiersz nie mówi o normie. */
export function amountMatches(lineText) {
    if (!NORMATIVE_CONTEXT.test(lineText))
        return [];
    AMOUNT.lastIndex = 0;
    return [...lineText.matchAll(AMOUNT)].map((match) => ({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
        key: keyOf(match[0])
    }));
}
// Ustawy piszą okresy słownie ("trzech lat", "w terminie tygodnia").
const NUMERALS = [
    ["jednego|jeden|jedna|jednej", 1],
    ["dwóch|dwa|dwie|dwu", 2],
    ["trzech|trzy", 3],
    ["czterech|cztery", 4],
    ["pięciu|pięć", 5],
    ["sześciu|sześć", 6],
    ["siedmiu|siedem", 7],
    ["ośmiu|osiem", 8],
    ["dziewięciu|dziewięć", 9],
    ["dziesięciu|dziesięć", 10],
    ["dwunastu|dwanaście", 12],
    ["czternastu|czternaście", 14],
    ["piętnastu|piętnaście", 15],
    ["dwudziestu|dwadzieścia", 20],
    ["trzydziestu|trzydzieści", 30],
    ["sześćdziesięciu|sześćdziesiąt", 60],
    ["dziewięćdziesięciu|dziewięćdziesiąt", 90]
];
const PERIOD = "(?=\\s+(?:dni|dnia|tygodni\\p{L}*|tydzień|miesięcy|miesiąca|miesiące|lat|lata|roku)(?![\\p{L}]))";
function digitsForWords(text) {
    let result = text.replace(/(w\s+terminie|w\s+ciągu|po\s+upływie|przed\s+upływem|okres\p{L}*)\s+(tygodnia|miesiąca|roku)(?![\p{L}])/giu, "$1 1 $2");
    for (const [words, value] of NUMERALS) {
        result = result.replace(new RegExp(`(?<![\\p{L}])(?:${words})${PERIOD}`, "giu"), String(value));
    }
    // "do lat trzech" -> "do lat 3"
    for (const [words, value] of NUMERALS) {
        result = result.replace(new RegExp(`((?:do|od)\\s+lat\\s+)(?:${words})(?![\\p{L}])`, "giu"), `$1${value}`);
    }
    return result;
}
/** Czy brzmienie przepisu zawiera tę wartość (ta sama liczba i jednostka). */
export function evidenceHasAmount(evidence, key) {
    const text = digitsForWords(evidence.normalize("NFKC"));
    AMOUNT.lastIndex = 0;
    return [...text.matchAll(AMOUNT)].some((match) => keyOf(match[0]) === key);
}
/** Znacznik ⚠️ tuż za podanymi końcami fragmentów (wartość, sygnatura) należy do nich. */
export function markerSpansAfter(lineText, ends) {
    const spans = [];
    for (const end of ends) {
        const marker = /^\s{0,2}⚠️?\s*\[NIEWERYFIKOWANE\]/u.exec(lineText.slice(end));
        if (marker)
            spans.push({ start: end + marker[0].indexOf("⚠"), end: end + marker[0].length });
    }
    return spans;
}
/** Znacznik ⚠️ wstawiony tuż za wartością należy do niej, nie do przepisu w wierszu. */
export function amountMarkerSpans(lineText) {
    return markerSpansAfter(lineText, amountMatches(lineText).map((amount) => amount.end));
}
