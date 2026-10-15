// What the application checks in the answer itself, besides the gates: the causal method on a
// causal question, and the case's timeline (given to the model before the conversation: an API
// model keeps nothing between calls) when the request concerns the course of events.
export const CAUSAL_RESOURCE = "shared/MOD-GRAF-PRZYCZYNOWY.md";
// Cause and effect in the user's own case (establish or exclude a causal link).
export const CAUSAL_QUESTION = /(?<![\p{L}])(?:związ\p{L}*\s+przyczynow\p{L}*|przyczynowo[-\s]skutkow\p{L}*|co\s+z\s+czego\s+wynika|post\s+hoc|csqn|conditio\s+sine\s+qua\s+non|(?:czy|co)\s+(?:\p{L}+\s+){0,6}(?:spowodował\p{L}*|doprowadził\p{L}*|wywołał\p{L}*)|przerw\p{L}*\s+(?:\p{L}+\s+){0,2}związ\p{L}*|wyklucz\p{L}*\s+(?:\p{L}+\s+){0,3}(?:związ\p{L}*|przyczyn\p{L}*)|łańcuch\p{L}*\s+przyczyn\p{L}*)(?![\p{L}])/iu;
// The method applied, visibly: each link examined (MOD-GRAF-PRZYCZYNOWY), not the order of dates.
const CAUSAL_METHOD = /(?<![\p{L}])(?:csqn|conditio\s+sine\s+qua\s+non|warun\p{L}*\s+konieczn\p{L}*|post\s+hoc|dow[oó]d\p{L}*\s+(?:\p{L}+\s+){0,2}połącze\p{L}*|przerw\p{L}*\s+(?:\p{L}+\s+){0,2}związ\p{L}*|alternatywn\p{L}*\s+(?:wyjaśnie\p{L}*|przyczyn\p{L}*|scenariusz\p{L}*)|MET-ACH|NESS|adekwatn\p{L}*\s+związ\p{L}*|normaln\p{L}*\s+następstw\p{L}*|graf\p{L}*\s+przyczynow\p{L}*)(?![\p{L}])/iu;
// The request concerns the course of events (a timeline is material for it).
const TEMPORAL_REQUEST = /(?<![\p{L}])(?:kiedy|termin\p{L}*|przedawni\p{L}*|chronolog\p{L}*|oś\s+czasu|osi\s+czasu|kolejnoś\p{L}*|przebieg\p{L}*|zdarze\p{L}*|przeanalizuj|analiz\p{L}*|pozew|pozw\p{L}*|odpowied\p{L}*|apelacj\p{L}*|pism\p{L}*|szans\p{L}*)(?![\p{L}])/iu;
const MONTHS = {
    stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6, lipca: 7, sierpnia: 8,
    wrzesnia: 9, września: 9, pazdziernika: 10, października: 10, listopada: 11, grudnia: 12
};
/** Dates in a text as yyyy-mm-dd (numeric d.m.yyyy, ISO and Polish month names). */
export function isoDates(text) {
    const found = new Set();
    const add = (year, month, day) => {
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
            found.add(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    };
    for (const match of text.matchAll(/(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-]((?:19|20)\d{2})(?!\d)/g))
        add(Number(match[3]), Number(match[2]), Number(match[1]));
    for (const match of text.matchAll(/(?<!\d)((?:19|20)\d{2})-(\d{2})-(\d{2})(?!\d)/g))
        add(Number(match[1]), Number(match[2]), Number(match[3]));
    for (const match of text.matchAll(/(?<!\d)(\d{1,2})\s+(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|wrze[sś]nia|pa[zź]dziernika|listopada|grudnia)\s+((?:19|20)\d{2})/giu)) {
        add(Number(match[3]), MONTHS[match[2].toLowerCase()] ?? 0, Number(match[1]));
    }
    return found;
}
export function supervisedChecks(turn) {
    const checks = [];
    const causalAsked = CAUSAL_QUESTION.test(turn.query);
    const moduleRead = turn.readResources.has(CAUSAL_RESOURCE);
    const methodShown = CAUSAL_METHOD.test(turn.answer);
    checks.push({
        id: "ZWIAZEK-PRZYCZYNOWY",
        label: "Związek przyczynowy: metoda grafu przyczynowego (MOD-GRAF-PRZYCZYNOWY) zastosowana w odpowiedzi",
        status: !causalAsked ? "NOT_TRIGGERED" : moduleRead && methodShown ? "MET" : "MISSING",
        evidence: !causalAsked
            ? "pytanie nie dotyczy związku przyczynowego"
            : `${moduleRead ? "moduł wczytany" : "moduł NIE wczytany"}; ${methodShown ? "w odpowiedzi badanie połączeń (csqn / post hoc / przerwanie / alternatywy)" : "w odpowiedzi brak badania połączeń — sama kolejność zdarzeń nie dowodzi związku"}`,
        ...(causalAsked && !methodShown
            ? {
                correction: "Związek przyczynowy: zastosuj shared/MOD-GRAF-PRZYCZYNOWY.md — dla każdego połączenia podaj dowód (mechanizm, nie sama kolejność dat), test csqn, flagę post hoc, możliwe przerwanie związku i wyjaśnienia alternatywne; wskaż, czy związek ustalono, czy wykluczono, i na jakiej podstawie."
            }
            : {})
    });
    const dates = turn.timelineDates ?? [];
    const relevant = dates.length > 0 && (causalAsked || TEMPORAL_REQUEST.test(turn.query) || isoDates(turn.query).size > 0);
    const used = [...isoDates(turn.answer)].filter((date) => dates.includes(date));
    checks.push({
        id: "OS-CZASU-SPRAWY",
        label: "Oś czasu sprawy z pamięci: przekazana modelowi i użyta w odpowiedzi",
        status: !dates.length ? "NOT_TRIGGERED" : !relevant ? "NOT_TRIGGERED" : used.length ? "MET" : "MISSING",
        evidence: !dates.length
            ? "sprawa nie ma zapisanej osi czasu"
            : !relevant
                ? `przekazana (${dates.length} dat); prośba nie dotyczy przebiegu zdarzeń`
                : used.length
                    ? `przekazana (${dates.length} dat); w odpowiedzi ${used.length}: ${used.slice(0, 5).join(", ")}`
                    : `przekazana (${dates.length} dat); odpowiedź nie odwołuje się do żadnego zdarzenia z osi`,
        ...(relevant && !used.length
            ? {
                correction: "Oś czasu sprawy: oprzyj odpowiedź na osi czasu sprawy przekazanej przed rozmową — wskaż daty i zdarzenia z niej, które mają znaczenie dla prośby (lub napisz wprost, że oś czasu nie ma tu znaczenia i dlaczego)."
            }
            : {})
    });
    return checks;
}
