import { provisionsForDetection } from "./legal-act-abbreviations.js";

// Sprawa karna (DR-03) rozpoznana z treści pytania, zanim model cokolwiek przeczyta:
// w trybie automatycznym skill główny nie jest jeszcze znany (PROFIL-LEKKI: sprawa
// karna zawsze PEŁNY; "Karne: +kwalifikator").
const CRIMINAL_ACT = /\bart\.?\s*\d+[a-z]?(?:\s*§\s*\d+[a-z]?)?\s+(?:KK|KPK|KKS|KKW|KW|KPW)\b/u;
const CRIMINAL_WORDS =
  /\b(?:kodeks\p{L}*\s+karn\p{L}*|kodeks\p{L}*\s+postępowania\s+karnego|przestęp\p{L}*|wykrocze\p{L}*|oskarżon\p{L}*|podejrzan\p{L}*|akt\p{L}*\s+oskarżenia|prokurat\p{L}*|postępowani\p{L}*\s+karn\p{L}*|odpowiedzialnoś\p{L}*\s+karn\p{L}*|zarzut\p{L}*\s+popełnienia|kar\p{L}*\s+pozbawienia\s+wolności|grzywn\p{L}*|mandat\p{L}*\s+karn\p{L}*|skarbow\p{L}*\s+(?:przestęp|wykrocz)\p{L}*|karnie|kradzie\p{L}*|ukradł\p{L}*|pobi(?:cie|ł\p{L}*|t[yaeo]\p{L}*)|oszust\p{L}*|podrobi\p{L}*|podrobion\p{L}*|sfałszow\p{L}*|fałszerstw\p{L}*|pijan\p{L}*\s+kierow\p{L}*|nietrzeźw\p{L}*|po\s+pijanemu|groźb\p{L}*\s+karaln\p{L}*)/iu;

// The same matter told in everyday words ("pobił mnie", "jazda po alkoholu", "mandat"):
// the qualifier is still required. Not "dochodzenie" (also a civil claim) and not
// the mandate of an MP or councillor.
const LAY_CRIMINAL_WORDS = new RegExp(
  "(?<![\\p{L}])(?:" +
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
      "mandat(?:u|em|y|ów|ami|ach|cie)?(?!\\s+(?:posła|posłanki|radnego|radnej|senatora|wójta|burmistrza|prezydenta|członka|dla\\s+pracodawcy))",
      "zniewa(?:ż|g)\\p{L}*",
      "zniesławi\\p{L}*",
      "pomówi\\p{L}*",
      "oszczerstw\\p{L}*",
      "punkt\\p{L}*\\s+karn\\p{L}*",
      "przekrocz\\p{L}*\\s+prędkoś\\p{L}*",
      "(?:utrat\\p{L}*|zatrzyma\\p{L}*|odebra\\p{L}*|straci\\p{L}*|stracę|cofnię\\p{L}*)\\s+prawa\\s+jazdy",
      "jazd\\p{L}*\\s+bez\\s+uprawnień",
      "wypad\\p{L}*\\s+drogow\\p{L}*",
      "zatarci\\p{L}*\\s+skazania",
      "krajow\\p{L}*\\s+rejestr\\p{L}*\\s+karn\\p{L}*",
      "wyrok\\p{L}*\\s+w\\s+zawieszeniu",
      "(?:warunkow\\p{L}*\\s+)?zawieszeni\\p{L}*\\s+wykonania\\s+kary",
      "dobrowoln\\p{L}*\\s+poddani\\p{L}*\\s+się\\s+karze",
      "dozor\\p{L}*\\s+elektroniczn\\p{L}*",
      "skazan(?:y|ego|emu|ym|a|ej|i|ych)",
      "pran\\p{L}*\\s+pieniędzy",
      "dopalacz\\p{L}*",
      "podszy\\p{L}*\\s+się",
      "kradzież\\p{L}*\\s+tożsamości",
      "czynn\\p{L}*\\s+żal\\p{L}*\\s+w\\s+sprawie\\s+karn\\p{L}*",
      "(?:bije|bił|biła|bili|biją|uderzył\\p{L}*|kopnął|kopnęła|dusił\\p{L}*)\\s+mnie",
      "grozi(?:ł|ła|li)?\\s+mi(?![\\p{L}])",
      "fałszow\\p{L}*",
      "(?:dosta|otrzyma|usłysza|postawi)\\p{L}*\\s+(?:\\p{L}+\\s+)?zarzut(?!\\p{L}*\\s+od\\s+nakazu)\\p{L}*",
      "intymn\\p{L}*\\s+(?:zdję\\p{L}*|nagra\\p{L}*|film\\p{L}*|wizerun\\p{L}*)",
      "(?:wy)?łudzi\\p{L}*",
      "na\\s+wnuczka",
      "włama\\p{L}*",
      "okradzi\\p{L}*|okradł\\p{L}*"
    ].join("|") +
    ")(?![\\p{L}])",
  "iu"
);

// Messages are often typed without Polish letters ("pobil mnie sasiad"): the same
// patterns run once more on text and pattern with the letters replaced.
const PLAIN: Record<string, string> = { ą: "a", ć: "c", ę: "e", ł: "l", ń: "n", ó: "o", ś: "s", ź: "z", ż: "z", Ą: "A", Ć: "C", Ę: "E", Ł: "L", Ń: "N", Ó: "O", Ś: "S", Ź: "Z", Ż: "Z" };
const plain = (text: string): string => text.replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/gu, (letter) => PLAIN[letter]!);
const plainPattern = (pattern: RegExp): RegExp => new RegExp(plain(pattern.source), pattern.flags);
const PLAIN_CRIMINAL_WORDS = plainPattern(CRIMINAL_WORDS);
const PLAIN_LAY_CRIMINAL_WORDS = plainPattern(LAY_CRIMINAL_WORDS);

export function criminalMatter(text: string): boolean {
  if (CRIMINAL_ACT.test(provisionsForDetection(text)) || CRIMINAL_WORDS.test(text) || LAY_CRIMINAL_WORDS.test(text)) return true;
  const unaccented = plain(text);
  return PLAIN_CRIMINAL_WORDS.test(unaccented) || PLAIN_LAY_CRIMINAL_WORDS.test(unaccented);
}
