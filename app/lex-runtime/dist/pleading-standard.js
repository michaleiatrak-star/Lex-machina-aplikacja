// A pleading to a court is built as pisma-procesowe-v3 prescribes, whatever skill leads the matter
// (V P 3/26, 2026-11-16: the witness skill led, the draft had no anticipation nor fallback):
// facts with their sources, the dependencies between them and the goals, and only then the text,
// each argument FAKT → DOWÓD → PRAWO → SKUTEK → ANTYCYPACJA → ZAMKNIĘCIE FURTKI → WNIOSEK
// (pisma-procesowe-v3/modules/MOD-BUDOWA-ARGUMENTU.md). After the text, the application checks
// the elements a reader can see.
export const PLEADING_STANDARD_RESOURCE = "modules/MOD-BUDOWA-ARGUMENTU.md";
const DRAFT = /(?<![\p{L}])(?:przygotuj|sporządź|napisz|zredaguj|opracuj|stwórz|przygotować|sporządzić|napisać|projekt)\p{L}*/iu;
const PLEADING = /(?<![\p{L}])(?:pism\p{L}*\s+(?:procesow|przygotowawcz|do\s+(?:s[ąa]du|organu|rzecznika|prokurat))\p{L}*|pozew|pozwu|odpowied\p{L}*\s+na\s+(?:pozew|apelacj|zażaleni|skarg|zarządzeni|zobowiązani|postanowieni|wezwani\p{L}*\s+s[ąa]d)\p{L}*|(?:odpowied|stanowisk|wyjaśnieni|ustosunkowani)\p{L}*\s+(?:\p{L}+\s+){0,2}?do\s+(?:s[ąa]du|organu)|apelacj\p{L}*|zażaleni\p{L}*|odwołani\p{L}*|sprzeciw\p{L}*|skarg\p{L}*|wnios\p{L}*\s+(?:dowodow|o\s+)\p{L}*|podważeni\p{L}*|zarzut\p{L}*\s+od|kasacj\p{L}*|zawiadomieni\p{L}*\s+o\s+(?:popełnieni|przewinieni|przestęp|podejrzeni)\p{L}*)/iu;
// What is drafted is an assessment, not the pleading ("przygotuj ocenę szans apelacji").
const ASSESSMENT_DRAFTED = /(?<![\p{L}])(?:przygotuj|sporządź|napisz|zredaguj|opracuj|stwórz|przygotować|sporządzić|napisać)\p{L}*\s+(?:\p{L}+\s+){0,2}?(?:ocen\p{L}*|analiz\p{L}*|opini\p{L}*|raport\p{L}*|podsumowani\p{L}*|notatk\p{L}*|streszczeni\p{L}*|pytani\p{L}*|chronologi\p{L}*|plan\p{L}*)(?![\p{L}])/iu;
/** The turn asks for a pleading to a court or an authority (not an opinion or a summary). */
export function isCourtPleading(question) {
    return DRAFT.test(question) && PLEADING.test(question) && !ASSESSMENT_DRAFTED.test(question);
}
export function pleadingStandardPrompt(moduleText) {
    return [
        "# STANDARD BUDOWY PISMA PROCESOWEGO (pisma-procesowe-v3, wczytany przez aplikację)",
        "Kolejność pracy: (1) fakty z akt z dosłownym źródłem; (2) zależności: który fakt wykazuje który cel, które fakty się wzmacniają albo przeczą sobie; (3) dopiero potem pismo. Każdy blok uzasadnienia według schematu poniżej. Etapy (1)–(2) w uwagach poza pismem, krótko (tabela cel → fakty → zależność).",
        moduleText.trim()
    ].join("\n\n");
}
/** What a reader of the draft can check of the seven elements. */
// A motion to take evidence ("wnoszę o dopuszczenie dowodu z przesłuchania świadka", "wniosek dowodowy").
const EVIDENCE_MOTION = /(?<![\p{L}])(?:wnios\p{L}*\s+dowodow\p{L}*|wnosz\p{L}*\s+o\s+(?:dopuszczenie|przeprowadzenie|zobowiązanie|zwrócenie\s+się|przesłuchanie|zażądanie|dołączenie|włączenie)|dopuszczeni\p{L}*\s+(?:i\s+przeprowadzeni\p{L}*\s+)?dowod\p{L}*|przeprowadzeni\p{L}*\s+dowod\p{L}*|zobowiązani\p{L}*\s+(?:\p{L}+\s+){0,3}do\s+(?:złożenia|przedłożenia|przedstawienia)|zwróceni\p{L}*\s+się\s+do\s+(?:\p{L}+\s+){0,3}o\s+(?:nadesłanie|przesłanie|udostępnienie))/iu;
// A fact the draft says is not in the material (to be proven, completed, known to the party only).
const OUTSIDE_MATERIAL = /(?:⬛|nie\s+(?:zostało|zostały|został|jest|są)\s+(?:jeszcze\s+)?(?:udokumentowan\p{L}*|wykazan\p{L}*)|(?:brak|nie\s+ma)\s+(?:go\s+|jej\s+|ich\s+)?w\s+(?:aktach|materiał\p{L}*)|poza\s+(?:aktami|materiałem)|według\s+wiedzy\s+(?:strony|klienta|skarżąc\p{L}*)|(?:może|mogą)\s+(?:to\s+)?potwierdzić\s+(?:świad\p{L}*|\[PII))/iu;
// Access to the files: the refusal relied on the opponent's explanations the party has not seen.
const FILE_ACCESS = /(?:wgląd\p{L}*\s+do\s+akt|dostęp\p{L}*\s+do\s+akt|udostępni\p{L}*\s+(?:\p{L}+\s+){0,2}akt|przegląd\p{L}*\s+akt|kopi\p{L}*\s+(?:\p{L}+\s+){0,2}wyjaśnie\p{L}*|doręczeni\p{L}*\s+(?:\p{L}+\s+){0,2}wyjaśnie\p{L}*)/iu;
/** The refusal in the files rests on the opponent's explanations (the motion for access to the files is due). */
export function refusalOnExplanations(documents) {
    const refusal = documents.some((document) => document.category === "ORZECZENIE" && /odm(?:ow|aw)\p{L}*/iu.test(document.text.slice(0, 3_000)));
    const explanations = documents.some((document) => document.kind === "WYJASNIENIA") ||
        documents.some((document) => document.category === "ORZECZENIE" && /(?:z\s+)?wyjaśnie\p{L}*\s+(?:\p{L}+\s+){0,3}(?:adwokat\p{L}*|radc\p{L}*|obwinion\p{L}*|pełnomocni\p{L}*|\[PII)/iu.test(document.text));
    return refusal && explanations;
}
export function argumentSchemaGaps(answer, options = {}) {
    const gaps = [];
    const justification = /UZASADNIENIE/u.exec(answer);
    const body = justification ? answer.slice(justification.index) : answer;
    if (!/(?:może\s+(?:podnieść|twierdzić|argumentować|zarzucić)|można\s+(?:by\s+)?(?:zarzucić|podnieść)|Argument\s+ten\s+(?:jest\s+)?(?:chybiony|nietrafny)|antycypac)/iu.test(body)) {
        gaps.push({ element: "ANTYCYPACJA", detail: "brak przewidzianego zarzutu przeciwnika i jego obalenia przy najsilniejszej tezie" });
    }
    // "Gdyby sąd uznał …, i tak …" and a heading "Podstawa alternatywna" close the gap as well (V P 3/26 run).
    if (!/(?:Nawet\s+(?:gdyby|jeżeli|jeśli|w\s+razie)|niezależnie\s+od\s+powyższego|z\s+ostrożności|ewentualnie|podstaw\p{L}*\s+alternatywn\p{L}*|(?:Gdyby|Jeżeli|Jeśli)\s+(?:\p{L}+\s+){0,3}(?:uzna\p{L}*|przyj\p{L}*|nie\s+podzieli\p{L}*)[^.]{0,200}?\bi\s+tak\b|w\s+przeciwnym\s+razie)/iu.test(body)) {
        gaps.push({ element: "ZAMKNIĘCIE FURTKI", detail: "brak podstawy alternatywnej na wypadek nieuwzględnienia tezy głównej" });
    }
    // Facts without their proof: blocks of the justification with no quote, document marker or "Dowód".
    const blocks = body.split(/\n(?=\*\*[IVX]+\.|#{2,4}\s|\*\*\d+\.)/u).slice(1);
    const unproven = blocks.filter((block) => block.length > 300 && !/\[\[LEXDOC|„[^”]{15,}”|\(?Dowód|dowodem|protok[oó]ł|załącznik/iu.test(block));
    if (unproven.length)
        gaps.push({ element: "DOWÓD", detail: `${unproven.length} bloków uzasadnienia bez dowodu przy fakcie` });
    if (!/(?<![\p{L}])(?:wnosz[ęe]|wnosi\s+o|wnoszą)(?![\p{L}])/iu.test(answer))
        gaps.push({ element: "WNIOSEK", detail: "brak wniosków (petitum)" });
    // A fact outside the material needs its evidence motion (point 7).
    const outside = body.split(/\n\s*\n/u).filter((paragraph) => OUTSIDE_MATERIAL.test(paragraph));
    if ((outside.length || unproven.length) && !EVIDENCE_MOTION.test(answer)) {
        gaps.push({
            element: "WNIOSEK DOWODOWY",
            detail: `${outside.length + unproven.length} miejsc z faktem spoza materiału albo bez dowodu, a pismo nie zawiera wniosku dowodowego: dla każdego takiego faktu wnieś o przeprowadzenie dowodu (teza dowodowa, środek dowodowy) albo usuń fakt`
        });
    }
    if (options.refusalOnExplanations && !FILE_ACCESS.test(answer)) {
        gaps.push({
            element: "WNIOSEK O DOSTĘP DO AKT",
            detail: "odmowa opiera się na wyjaśnieniach strony przeciwnej, których strona nie zna: wnieś o udostępnienie akt (wgląd, kopie wyjaśnień) i o możliwość odniesienia się do nich"
        });
    }
    // A conclusion that depends on a fact still to be filled in ("⬛ [UZUPEŁNIJ: data]") is stated as
    // certain (V P 3/26: "Jedno z tych zeznań jest nieprawdziwe" before the date was known).
    const conditional = body
        .split(/\n\s*\n/u)
        // The sentence with the open fact and the one after it: the categorical conclusion drawn from it
        // there, without a condition (a whole paragraph flagged conclusions about other, settled facts).
        .flatMap((paragraph) => {
        const sentences = paragraph.split(/(?<=[.!?\]])\s+(?=[\p{Lu}„(])/u);
        return sentences.flatMap((sentence, index) => (/⬛/u.test(sentence) ? [`${sentence} ${sentences[index + 1] ?? ""}`] : []));
    })
        .filter((sentence) => /⬛/u.test(sentence) && /(?:jest\s+nieprawdziw|nieprawdą|zaprzeczył|fałszyw|skłamał|kłamie|nie\s+mo(?:że|gą)\s+być\s+prawdziw)/iu.test(sentence) && !/(?:wariant|jeżeli|jeśli|gdyby|o\s+ile|w\s+razie)/iu.test(sentence));
    // A provision a motion rests on (petitum: "wnoszę o … konfrontację (art. 272 k.p.c.)") is applied in the
    // justification: its premises shown on these facts (user report 2026-11-17: art. 272 k.p.c., the
    // confrontation of witnesses who contradict each other, moved for one witness's two testimonies).
    const unapplied = motionProvisionsWithoutPremises(answer);
    if (unapplied.length) {
        gaps.push({
            element: "PRZESŁANKI WNIOSKU",
            detail: `wnioski powołują ${unapplied.join(", ")}, a uzasadnienie nie wykazuje, że przesłanki tego przepisu są spełnione w tej sprawie (kto, jakie fakty, który dowód): wykaż każdą przesłankę albo usuń wniosek`
        });
    }
    if (conditional.length)
        gaps.push({ element: "TEZA WARUNKOWA", detail: `${conditional.length} zdań przesądza wniosek zależny od faktu do uzupełnienia (⬛): rozpisz warianty albo usuń tezę do czasu ustalenia faktu` });
    return gaps;
}
export function schemaCorrection(gaps) {
    return [
        "4) Schemat budowy argumentu (pisma-procesowe-v3, MOD-BUDOWA-ARGUMENTU): uzupełnij brakujące elementy w piśmie, nie dopisując nowych faktów spoza akt:",
        ...gaps.map((gap) => `- ${gap.element}: ${gap.detail}`)
    ].join("\n");
}
const ARTICLE = /(?<![\p{L}])art\.\s*(\d+[a-z]?(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)(?:\s*§\s*\d+[a-z]?)?/giu;
// Words with which a justification applies a provision to the facts.
const APPLIES = /(?:przesłan\p{L}*|spełnion\p{L}*|zachodz\p{L}*|zachodzi|wypełni\p{L}*|w\s+niniejszej\s+sprawie|w\s+tej\s+sprawie|ponieważ|skoro|albowiem|gdyż|bowiem)/iu;
/** Articles cited in the motions (before the justification) that the justification never applies to the facts. */
export function motionProvisionsWithoutPremises(answer) {
    const justification = /\n[#*\s]*UZASADNIENIE/iu.exec(answer);
    if (!justification)
        return [];
    const opening = /(?:wnosz[ęe]|wnosi)\s+o\s*:?/iu.exec(answer.slice(0, justification.index));
    if (!opening)
        return [];
    const petitum = answer.slice(opening.index, justification.index);
    const body = answer.slice(justification.index);
    const missing = [];
    for (const match of petitum.matchAll(ARTICLE)) {
        const number = match[1].toLowerCase();
        const sentences = body.split(/(?<=[.;!?])\s+(?=[\p{Lu}„(])/u).filter((sentence) => new RegExp(`(?<![\\p{L}])art\\.\\s*${number}(?![\\d\\p{L}])`, "iu").test(sentence));
        if (!sentences.some((sentence) => APPLIES.test(sentence)) && !missing.includes(`art. ${number}`))
            missing.push(`art. ${number}`);
    }
    return missing;
}
