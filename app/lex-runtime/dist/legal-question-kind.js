// Questions about the law itself and about case law (user 2026-11-26): the statute skill
// (analizator-przepisow-v2) for the legal basis, the provisions, their wording and interpretation;
// the case-law skill (orzeczenia-sadowe-v2) for rulings, lines of case law, a ruling's thesis or
// status and whether a court or a party said something. Read on the text without Polish letters.
const fold = (value) => value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replaceAll("ł", "l").replace(/\s+/g, " ").trim();
// A delivered or analysed document ("ten wyrok", "w załączniku", "przeanalizuj"): the court-analysis
// or evidence skill keeps it.
const OWN_DOCUMENT = /\b(?:ten|tego|tym|ponizsz\w*|zalaczon\w*|w zalacznik\w*|przeslan\w*|otrzymal\w*|dostal\w*|doreczon\w*)\s+(?:\w+\s+)?(?:wyrok|postanowien|nakaz|orzeczen|uchwal|decyzj)\w*|\b(?:przeanalizuj|zanalizuj|ocen moje|w zalaczeniu|zalaczam)\b/;
// A ruling's signature: Polish courts (I C 1/20, III CZP 25/11, II PK 123/19, I ACa 100/20, II OSK 2286/20,
// V ACa 50/21), the Constitutional Tribunal (K 1/20, SK 3/19, P 7/20), KIO (KIO 123/24).
const SIGNATURE = /\b(?:[ivx]{1,5}\s+(?:c|ca|aca|ga|gc|gz|cz|czp|csk|csko|cnp|cnpp|pk|pz|pzp|pa|pz|p|u|ua|uk|uz|uzp|ks|kk|ko|kzp|kz|ak|aka|nsp|nsk|ps|osk|fsk|gsk|sa\/\w+|sa)\s+\d{1,5}\/\d{2}|(?:k|sk|p|kp|u|ts)\s+\d{1,4}\/\d{2}|kio\s+\d{1,5}\/\d{2})\b/;
const CASE_LAW_WORDS = /\b(?:orzecznictw\w*|orzeczen\w*|orzekal\w*|orzeka|linii? orzecznicz\w*|rozbieznosc\w* w orzecznictw\w*|jak sady (?:ocenia\w*|rozstrzyga\w*|podchodz\w*|traktuj\w*)|jak (?:orzeka|orzekaja|rozstrzyga)\w*|wyrok\w* (?:sn|nsa|wsa|tk|tsue|etpc|sadu najwyzszego|trybunalu|sadu apelacyjnego)|uchwal\w* (?:sn|nsa|sadu najwyzszego|skladu)|tez[aey] (?:wyroku|uchwaly|orzeczenia|postanowienia)|precedens\w*)\b/;
// What is asked about a named ruling: its thesis, status, validity, who said it.
const RULING_QUESTION = /\b(?:tez[aey]|uchylon\w*|zmienion\w*|obowiazuj\w*|prawomocn\w*|aktualn\w*|nadal|status\w*|czy sad\w* (?:stwierdzil|uznal|orzekl|przyjal)\w*|co (?:orzekl|uznal|stwierdzil|rozstrzygnal)\w*|twierdzeni\w* (?:strony|powoda|pozwanego|skarzacego)|stanowisk\w* strony|czy to (?:sad|strona))\b/;
const STATUTE_WORDS = /\b(?:podstaw\w* prawn\w*|na (?:jakiej|ktorej) podstawie (?:prawnej|przepisu)|jak\w* przepis\w*|jaki\w* przepis\w*|jaka ustawa|ktor\w* (?:ustawa|przepis)\w*|przepis\w* (?:reguluj|dotycz|okresla|stanowi)\w*|reguluj\w* (?:to )?przepis\w*|podaj (?:mi )?przepis\w*|interpretacj\w* przepis\w*|wykladni\w*|brzmieni\w* (?:art|przepis|ustawy)\w*|stan prawny|nowelizacj\w*|czy (?:zmienil|zmienila|zmienilo) sie (?:brzmienie|przepis|prawo)\w*)\b/;
/** A question about case law: rulings, lines, a ruling's thesis or status (no document of the user's). */
export function caseLawQuestion(question) {
    const text = fold(question);
    if (OWN_DOCUMENT.test(text))
        return false;
    return CASE_LAW_WORDS.test(text) || (SIGNATURE.test(text) && (RULING_QUESTION.test(text) || /\b(?:wyrok|uchwal|postanowien|orzeczen)\w*/.test(text)));
}
/** A question about the law: legal basis, provisions, their wording or interpretation. */
export function statuteQuestion(question) {
    const text = fold(question);
    if (OWN_DOCUMENT.test(text))
        return false;
    return STATUTE_WORDS.test(text);
}
// Explaining a legal notion or the difference between two ("czym różni się zadatek od zaliczki",
// "wyjaśnij, co to jest przedawnienie", "porównaj spółkę z o.o. i komandytową"): the statute skill
// (user 2026-11-27). A question about the user's own situation ("czy mogę…", "mój pracodawca") or a
// request to draft stays where it is.
const CONCEPT = /\b(?:roznic\w*|czym (?:sie )?rozni\w*|rozni sie|porownaj|porownani\w*|na czym polega\w*|co (?:to jest|to znaczy|oznacza|znaczy)|(?:wyjasnij|objasnij|wytlumacz)\w*,? (?:co to|czym jest|pojeci|termin|instytucj|roznic|na czym))/;
const OWN_SITUATION = /\b(?:moj\w*|mnie|mi|mam|mamy|moge|mozemy|musze|musimy|dostal\w*|otrzymal\w*|jestem|zostal\w*em|zostalam|nasz\w*|ta umow\w*|tej umow\w*|tego pisma|w zalacz\w*)\b/;
const DRAFT = /\b(?:napisz|przygotuj|sporzadz|zredaguj|opracuj|stworz|wygeneruj|popraw|przeredaguj)\w*/;
/** A question explaining a legal notion or the difference between notions, not one's own matter. */
export function conceptQuestion(question) {
    const text = fold(question);
    if (OWN_DOCUMENT.test(text) || OWN_SITUATION.test(text) || DRAFT.test(text))
        return false;
    return CONCEPT.test(text);
}
const DIFFERENCE = /\b(?:roznic\w*|czym (?:sie )?rozni\w*|rozni sie|porownaj|porownani\w*)\b/;
/** A comparison of legal notions ("różnica między…", "czym różni się…"), not one notion explained. */
export function differenceQuestion(question) {
    return conceptQuestion(question) && DIFFERENCE.test(fold(question));
}
