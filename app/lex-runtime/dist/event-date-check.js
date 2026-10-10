// PRAWO-HARDGATE KROK 4: „Sprawdź datę »stan na dzień« — czy obowiązuje w dacie zdarzenia?”
// Przepisy zweryfikowane w brzmieniu aktualnym aplikacja sprawdza także na dzień
// zdarzenia z pytania (Sejm ELI, asOf) i porównuje brzmienie. Wynik trafia do rejestru
// ścieżki obowiązkowej; znaczniki w odpowiedzi się nie zmieniają (hierarchia zamknięta).
const MONTHS = {
    stycznia: "01",
    lutego: "02",
    marca: "03",
    kwietnia: "04",
    maja: "05",
    czerwca: "06",
    lipca: "07",
    sierpnia: "08",
    września: "09",
    października: "10",
    listopada: "11",
    grudnia: "12"
};
const DATE = /\b(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./](\d{1,2})[./](\d{4})|(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+(\d{4}))\b/giu;
// Ta sama data jako fragment innego wzorca (bez grup przechwytujących).
export const POLISH_DATE_SOURCE = "\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[./]\\d{1,2}[./]\\d{4}|\\d{1,2}\\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\\s+\\d{4}";
function isoFromMatch(match) {
    const [year, month, day] = match[1]
        ? [match[1], match[2], match[3]]
        : match[6]
            ? [match[6], match[5], match[4]]
            : [match[9], MONTHS[match[8].toLocaleLowerCase("pl")], match[7]];
    const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso ? null : iso;
}
/** "2023-05-01", "01.05.2023", "1 maja 2023" -> "2023-05-01"; inna wartość albo zła data: null. */
export function polishDateToIso(value) {
    DATE.lastIndex = 0;
    const match = DATE.exec(value.trim());
    DATE.lastIndex = 0;
    return match && match.index === 0 && match[0].length === value.trim().length ? isoFromMatch(match) : null;
}
// "ustawa z dnia 6 czerwca 1997 r.", "Dz.U. z 2025 r." - data aktu, nie zdarzenia.
const ACT_DATE_BEFORE = /(?:ustaw\p{L}*|kodeks\p{L}*|rozporządzeni\p{L}*|obwieszczeni\p{L}*|dekret\p{L}*|uchwał\p{L}*|wyrok\p{L}*|postanowieni\p{L}*|interpretacj\p{L}*)\s+(?:\S+\s+){0,6}z\s+dnia\s*$/iu;
// Termin na przyszłość ("do dnia", "termin upływa") nie jest datą zdarzenia.
const DEADLINE_BEFORE = /(?:do\s+dnia|termin\p{L}*\s+(?:upływa|mija)?\s*(?:dnia)?|najpóźniej)\s*$/iu;
const MAX_DATES = 2;
const MAX_RECORDS = 6;
/** Daty zdarzeń z przeszłości w tekście pytania (ISO, rosnąco, najwyżej dwie). */
export function eventDates(text, today) {
    const dates = new Set();
    DATE.lastIndex = 0;
    for (const match of text.matchAll(DATE)) {
        const before = text.slice(Math.max(0, match.index - 80), match.index);
        if (ACT_DATE_BEFORE.test(before) || DEADLINE_BEFORE.test(before))
            continue;
        const iso = isoFromMatch(match);
        if (!iso || iso >= today || iso < "1990-01-01")
            continue;
        dates.add(iso);
    }
    const sorted = [...dates].sort();
    // Najwcześniejsza i najpóźniejsza: brzmienie między nimi mogło się zmienić.
    return sorted.length <= MAX_DATES ? sorted : [sorted[0], sorted.at(-1)];
}
const flat = (value) => value.normalize("NFKC").replace(/\s+/g, " ").trim();
function actInput(record) {
    const act = record.actDescriptor;
    if (!act)
        return null;
    return act.id === "ELI" ? act.baseEli || act.eli : act.id;
}
/**
 * Przepisy VERIFIED w brzmieniu aktualnym, sprawdzone na dzień zdarzenia osobnym
 * narzędziem (osobny rejestr: znaczniki odpowiedzi zostają przy rekordach aktualnych).
 */
export async function checkProvisionsAtEventDates(args) {
    const current = args.records
        .filter((record) => record.kind === "statute" && record.status === "VERIFIED" && !record.asOf && record.evidence && actInput(record))
        .filter((record, index, all) => all.findIndex((other) => other.claim === record.claim) === index)
        .slice(0, MAX_RECORDS);
    const items = [];
    if (current.length === 0 || args.dates.length === 0)
        return { dates: args.dates, items };
    const calls = current.flatMap((record, recordIndex) => args.dates.map((asOf, dateIndex) => ({
        record,
        asOf,
        call: {
            id: `event-date-${recordIndex + 1}-${dateIndex + 1}`,
            name: "verify_legal_reference",
            input: { claim: record.claim, kind: "statute", act: actInput(record), asOf }
        }
    })));
    const results = await args.runTools(calls.map((item) => item.call)).catch(() => []);
    for (const { record, asOf, call } of calls) {
        const raw = results.find((result) => result.tool_use_id === call.id)?.content ?? "";
        let payload = {};
        try {
            payload = JSON.parse(raw);
        }
        catch {
            payload = {};
        }
        if (payload.status !== "VERIFIED" || !payload.evidence) {
            items.push({
                claim: record.claim,
                asOf,
                result: "UNKNOWN",
                detail: `brzmienia na ${asOf} nie ustalono w ELI (${payload.error ?? payload.status ?? "brak wyniku"})`
            });
            continue;
        }
        const same = flat(payload.evidence) === flat(record.evidence);
        items.push({
            claim: record.claim,
            asOf,
            result: same ? "SAME" : "DIFFERENT",
            detail: same
                ? `na ${asOf} brzmienie takie jak aktualne (ELI)`
                : `na ${asOf} brzmienie INNE niż aktualne (ELI) — odpowiedź opiera się na brzmieniu aktualnym; ustal prawo właściwe dla zdarzenia (przepisy intertemporalne)`
        });
    }
    return { dates: args.dates, items };
}
