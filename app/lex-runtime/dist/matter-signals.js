import { provisionsForDetection } from "./legal-act-abbreviations.js";
// Sprawa karna (DR-03) rozpoznana z treści pytania, zanim model cokolwiek przeczyta:
// w trybie automatycznym skill główny nie jest jeszcze znany (PROFIL-LEKKI: sprawa
// karna zawsze PEŁNY; "Karne: +kwalifikator").
const CRIMINAL_ACT = /\bart\.?\s*\d+[a-z]?(?:\s*§\s*\d+[a-z]?)?\s+(?:KK|KPK|KKS|KKW|KW|KPW)\b/u;
const CRIMINAL_WORDS = /\b(?:kodeks\p{L}*\s+karn\p{L}*|kodeks\p{L}*\s+postępowania\s+karnego|przestęp\p{L}*|wykrocze\p{L}*|oskarżon\p{L}*|podejrzan\p{L}*|akt\p{L}*\s+oskarżenia|prokurat\p{L}*|postępowani\p{L}*\s+karn\p{L}*|odpowiedzialnoś\p{L}*\s+karn\p{L}*|zarzut\p{L}*\s+popełnienia|kar\p{L}*\s+pozbawienia\s+wolności|grzywn\p{L}*|mandat\p{L}*\s+karn\p{L}*|skarbow\p{L}*\s+(?:przestęp|wykrocz)\p{L}*)/iu;
// The same matter told in everyday words ("pobił mnie", "jazda po alkoholu", "mandat"):
// the qualifier is still required. Not "dochodzenie" (also a civil claim) and not
// the mandate of an MP or councillor.
const LAY_CRIMINAL_WORDS = new RegExp("(?<![\\p{L}])(?:" +
    [
        "pobi(?:ł|li|ci|t)\\p{L}*",
        "(?:u|o|wy)?krad(?:ł|ła|li|zież|zion|nięt)\\p{L}*",
        "kradzież\\p{L}*",
        "włama\\p{L}*",
        "rozb(?:ój|oju|oje)",
        "oszust\\p{L}*",
        "oszuka\\p{L}*",
        "przywłaszcz\\p{L}*",
        "sprzeniewierz\\p{L}*",
        "fałszerstw\\p{L}*",
        "podrobi\\p{L}*",
        "narkoty\\p{L}*",
        "marihuan\\p{L}*",
        "amfetamin\\p{L}*",
        "wyłudz\\p{L}*",
        "nietrzeźw\\p{L}*",
        "promil\\p{L}*",
        "po\\s+(?:alkoholu|pijanemu|pijaku|narkotykach)",
        "stalking\\p{L}*",
        "uporczyw\\p{L}*\\s+nęk\\p{L}*",
        "przemoc\\p{L}*\\s+domow\\p{L}*",
        "niebiesk\\p{L}*\\s+kart\\p{L}*",
        "znęca\\p{L}*",
        "śledztw\\p{L}*",
        "postępowani\\p{L}*\\s+przygotowawcz\\p{L}*",
        "pokrzywdzon\\p{L}*",
        "areszt\\p{L}*",
        "zawiadomi\\p{L}*\\s+o\\s+(?:podejrzeniu\\s+)?(?:popełnieni|przestęp)\\p{L}*",
        "groźb\\p{L}*\\s+karaln\\p{L}*",
        "mandat(?:u|em|y|ów|ami|ach|cie)?(?!\\s+(?:posła|posłanki|radnego|radnej|senatora|wójta|burmistrza|prezydenta|członka))"
    ].join("|") +
    ")(?![\\p{L}])", "iu");
export function criminalMatter(text) {
    return CRIMINAL_ACT.test(provisionsForDetection(text)) || CRIMINAL_WORDS.test(text) || LAY_CRIMINAL_WORDS.test(text);
}
