const EVIDENCE = {
    // KROK 0a: "→ wynik: MODE=A / MODE=B / MODE=C".
    "AD-KROK0a-MODE": [[/MODE\s*[=:]\s*[ABC]\b/u, "wynik detekcji trybu MODE=A, B albo C"]],
    // KROK 0b: SD-VER/SD-READ, mapa pokrycia ze statusem BRAK-DOK dla dowodu, którego brak.
    "AD-KROK0b-SDVER": [[/SD-(?:VER|READ)|mapa\s+pokrycia|BRAK-DOK/iu, "SD-VER: skan kompletności plików (mapa pokrycia, BRAK-DOK)"]],
    // KROK 0c: ST-INIT, rejestr kroków (MOD-STEP-TRACKER).
    "AD-KROK0c-STINIT": [[/ST-INIT|rejestr\s+krok/iu, "ST-INIT: rejestr kroków"]],
    // KROK 1: FORMAT WYJŚCIA (STEP 4): DASHBOARD / NARR / OBA / INLINE.
    "AD-KROK1-INTAKE": [[/\b(?:DASHBOARD|NARR|OBA|INLINE)\b/u, "format wyjścia: DASHBOARD, NARR, OBA albo INLINE"]],
    // KROK 2: "Odpowiedz na każde pytanie diagnostyczne (TAK/NIE/?)" — BLOK A pierwszy.
    "AD-KROK2-ROUTER": [
        [/\bA1\b[^\n]{0,160}?(?:TAK|NIE|\?)/u, "BLOK A: odpowiedź na A1 (TAK/NIE/?)"],
        [/\bA2\b[^\n]{0,160}?(?:TAK|NIE|\?)/u, "BLOK A: odpowiedź na A2 (TAK/NIE/?)"]
    ],
    // BLOK G: karta każdej osoby — rola procesowa, znaczenie dla sprawy.
    "AD-BLOKG-STRONY": [
        [/[Rr]ol[aię]\s+procesow|\b(?:Powód|Pozwan\p{L}*|Świadek|Pełnomocnik|Biegły)\b/u, "karty osób z rolą procesową"],
        [/[Zz]naczeni\p{L}*[^\n]{0,60}(?:kluczow|pomocnicz|tło)/u, "znaczenie dla sprawy (kluczowe / pomocnicze / tło)"]
    ],
    // BLOK J: lapsusy [LA-…] albo jawne stwierdzenie ich braku.
    "AD-BLOKJ-LAPSUSY": [[/\[LA-[A-Z-]+\]|\[LAPSUS\]|(?:brak|nie\s+stwierdzono|nie\s+wykryto)\s+lapsus/iu, "lapsusy [LA-…] albo stwierdzenie ich braku"]],
    // BLOK H: rekordy DIS01…, fakty bezsporne, przepisy z etykietą weryfikacji w ELI.
    "AD-BLOKH-DIS": [
        [/\bDIS\s?0?\d{1,2}\b/u, "rekordy kwestii spornych DIS01, DIS02…"],
        [/[Ff]akty\s+bezsporne|common\s+ground/u, "fakty bezsporne każdej kwestii"],
        [/ELI|RZĄD\s*1|wymaga\s+weryfikacji/iu, "przepisy z etykietą „wymaga weryfikacji w ELI”"]
    ]
};
const WITNESS = {
    // PRE-W1a: SD-VER, kompletność skanowania (SD-INW / SD-REJ).
    "PRE-W1a-SD-VER": [[/SD-(?:VER|INW|REJ)|kompletnoś\p{L}*\s+skan/iu, "SD-VER: kompletność skanowania dowodów"]],
    // PRE-W1a.4: pełna lista plików ze statusem ✅ SPRAWDZONY / 🔶 CZĘŚCIOWO / ⬜ NIESPRAWDZONY / ➖ NIE DOTYCZY.
    "PRE-W1a.4-RZ-SHOW": [[/SPRAWDZONY|CZĘŚCIOWO|NIE\s+DOTYCZY|[✅🔶⬜➖]/u, "RZ-SHOW: lista plików ze statusem (SPRAWDZONY / CZĘŚCIOWO / NIESPRAWDZONY / NIE DOTYCZY)"]],
    // ETAP W2: model przesłuchania, tezy, scoring W2.
    "W2-THESES-AND-MODEL": [
        [/\b(?:PEACE|LEJEK|Funnel|ONE-FACT|CHRONOLOGICZN\p{L}*)\b/iu, "model przesłuchania (PEACE / LEJEK / ONE-FACT / CHRONOLOGICZNY)"],
        [/\bT1\b/u, "tezy T1, T2…"],
        [/[Ss]coring/u, "scoring W2"]
    ],
    // CHECKPOINT-W2: pola podsumowania.
    "CHECKPOINT-W2": [
        [/ŚWIADEK\s*:/u, "ŚWIADEK:"],
        [/TYP\s*:/u, "TYP:"],
        [/SCORING\s+W2/u, "SCORING W2"],
        [/MODEL\s*:/u, "MODEL:"],
        [/LUKI\s+DOWODOWE/u, "LUKI DOWODOWE"],
        [/CHRONOLOGIA/u, "CHRONOLOGIA ZDARZEŃ"]
    ],
    // ETAP W3: bloki pytań, MACIERZ FINALNA z dowodem kontrolnym, SCORING FINALNY.
    "W3-QUESTIONS": [
        [/BLOK\s+A/u, "BLOK A (pytania identyfikujące i wiarygodnościowe)"],
        [/BLOK\s+D/u, "BLOK D (pytania na sprzeczności)"],
        [/[Dd]owód\s+kontrolny/u, "MACIERZ FINALNA z kolumną „Dowód kontrolny”"],
        [/SCORING\s+FINALNY/u, "SCORING FINALNY"]
    ]
};
const PARTS = {
    EVIDENCE_ANALYSIS_V1: EVIDENCE,
    WITNESS_QUESTIONING_V1: WITNESS
};
/** The elements the step's skill names that its message lacks (none for a step without a format). */
export function orderedCheckpointGaps(workflowId, checkpoint, text) {
    return (PARTS[workflowId]?.[checkpoint] ?? []).filter(([pattern]) => !pattern.test(text)).map(([, label]) => label);
}
