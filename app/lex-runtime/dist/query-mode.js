export const MODE_SOURCE = "prawny-router-v3/references/KROK1-detekcja.md";
/** Quoted phrases of the "| Sygnał | Tryb |" table, by the mode they lead to. */
export function parseModeSignals(krok1) {
    const signals = { laik: [], prawnik: [], direct: [] };
    for (const line of krok1.split("\n")) {
        const cells = line.split("|").map((cell) => cell.trim());
        if (cells.length < 4)
            continue;
        const phrases = [...cells[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
        const target = cells[2];
        if (/LAIK/.test(target)) {
            signals.laik.push(...phrases);
            if (/bez terminologii/i.test(cells[1]))
                signals.laik.push("__SYTUACJA_ZYCIOWA__");
        }
        else if (/PRAWNIK/.test(target))
            signals.prawnik.push(...phrases);
        else if (/PYTANIE/.test(target))
            signals.direct.push(...(phrases.length ? phrases : ["__DOKUMENT_BEZ_KOMENTARZA__"]));
    }
    if (!signals.laik.length || !signals.prawnik.length)
        throw new Error("MODE_SIGNALS_UNREADABLE");
    return signals;
}
const fold = (value) => value.normalize("NFKD").replace(/\p{M}/gu, "").replace(/ł/g, "l").toLowerCase();
// Professional terminology beyond the table's examples ("KPC" / "KK" stand for act abbreviations).
const ACT_ABBREVIATIONS = /\b(?:KC|KPC|KK|KPK|KKW|KW|KPW|KKS|KP|KPA|KRO|KSH|PPSA|PZP|k\.c\.|k\.p\.c\.|k\.k\.|k\.p\.k\.|k\.p\.a\.|k\.p\.|k\.r\.o\.)(?![\p{L}])/u;
// A provision cited by number and act, also in lower case: "233 kk", "art. 415 kc", "§ 2 kpc".
const NUMBERED_PROVISION = /\b\d+[a-z]?\s*(?:§\s*\d+\s*)?(?:kc|kpc|kk|kpk|kkw|kw|kpw|kks|kp|kpa|kro|ksh|ppsa|pzp|k\.c\.|k\.k\.|k\.p\.c\.|k\.p\.k\.)(?![\p{L}])/iu;
function matchesPrawnik(signal, text, folded) {
    if (/^art\. X/.test(signal))
        return /\bart\.?\s*\d+/i.test(text) || /§\s*\d+/.test(text) || NUMBERED_PROVISION.test(text);
    if (/^sygn\.?$/.test(signal))
        return /\bsygn\.?\s*(akt)?\s*[A-Z]/i.test(text);
    // Abbreviations are matched case-sensitively as words ("SA" is not "sa").
    if (/^[A-Z]{2,4}$/.test(signal))
        return new RegExp(`\\b${signal}\\b`).test(text);
    return folded.includes(fold(signal));
}
export function detectQueryMode(question, signals, previous) {
    const text = question.trim();
    const folded = fold(text);
    const base = { source: MODE_SOURCE };
    // The answer to the KROK 1 question.
    if (/^\s*(a\)?|a\.|tak,? jestem prawnikiem.*|jestem prawnikiem.*|pracuj[eę] w prawie.*)\s*$/i.test(text)) {
        return { ...base, mode: "PRAWNIK", decision: "ODPOWIEDZ_NA_PYTANIE", signals: { laik: [], prawnik: ["odpowiedź a)"], direct: [] } };
    }
    if (/^\s*(b\)?|b\.|nie,? potrzebuj[eę] wyja[sś]nie[nń].*)\s*$/i.test(text)) {
        return { ...base, mode: "LAIK", decision: "ODPOWIEDZ_NA_PYTANIE", signals: { laik: ["odpowiedź b)"], prawnik: [], direct: [] } };
    }
    const prawnik = [...new Set(signals.prawnik.filter((signal) => matchesPrawnik(signal, text, folded)))];
    if (ACT_ABBREVIATIONS.test(text) && !prawnik.some((signal) => /^[A-Z]{2,4}$/.test(signal)))
        prawnik.push("skrót aktu");
    const laik = signals.laik.filter((signal) => signal !== "__SYTUACJA_ZYCIOWA__" && folded.includes(fold(signal)));
    const direct = signals.direct.filter((signal) => !signal.startsWith("__") && new RegExp(`\\b${fold(signal)}\\b`).test(folded));
    const found = { laik, prawnik, direct };
    // A citation (article, case number) is professional even with a lay phrase.
    const citation = prawnik.some((signal) => /^art\. X|^sygn/.test(signal));
    if (prawnik.length && (!laik.length || citation))
        return { ...base, mode: "PRAWNIK", decision: "PRAWNIK", signals: found };
    if (laik.length && !prawnik.length)
        return { ...base, mode: "LAIK", decision: "LAIK", signals: found };
    if (!prawnik.length && !laik.length && !direct.length) {
        // "Sytuacja życiowa bez terminologii → LAIK"; an earlier mode of the matter wins.
        return previous
            ? { ...base, mode: previous, decision: "POPRZEDNI", signals: found }
            : { ...base, mode: "LAIK", decision: "LAIK", signals: { ...found, laik: ["sytuacja życiowa bez terminologii"] } };
    }
    return previous
        ? { ...base, mode: previous, decision: "POPRZEDNI", signals: found }
        : { ...base, mode: "LAIK", decision: "NIEROZSTRZYGNIETY", signals: found };
}
export function queryModePrompt(decision) {
    const lines = [
        "# TRYB ODPOWIEDZI (ustalony przez aplikację na wejściu, KROK 1)",
        `Tryb: ${decision.mode}. Ustalenie: ${decision.decision}; sygnały PRAWNIK: ${decision.signals.prawnik.join(", ") || "brak"}; sygnały LAIK: ${decision.signals.laik.join(", ") || "brak"}.`
    ];
    if (decision.decision === "NIEROZSTRZYGNIETY") {
        lines.push("Sygnały są niejednoznaczne: zgodnie z KROK 1 zadaj teraz WYŁĄCZNIE jedno pytanie bezpośrednie o doświadczenie prawne (a/b, opcja „kreator”) i nie analizuj sprawy przed odpowiedzią.");
    }
    else {
        lines.push("Nie zmieniaj tego trybu i nie wykrywaj go ponownie; pisz w nim (LAIK: prosto, krok po kroku; PRAWNIK: tekst specjalistyczny).");
    }
    return lines.join("\n");
}
