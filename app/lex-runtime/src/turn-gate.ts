import fs from "node:fs";
import { flashDomains, fold, parseFlashRouting, type FlashRoute } from "./domain-module-map.js";
import { provisionsForDetection } from "./legal-act-abbreviations.js";
import { criminalMatter } from "./matter-signals.js";
import { laterTurn } from "./skill-sections.js";
import type { LexSkillRegistry } from "./registry.js";
import { requestOf, withoutRoutingMarkers } from "./request-intent.js";
import { latestUserTurn, threadUserText } from "./skill-selection.js";

/**
 * Legal gate at the entry of a chat turn (every provider): a message with no legal
 * signal at all ("jak upiec sernik", "napisz funkcję w Pythonie") is answered in the
 * conversational lane, without the router, legal skills and the mandatory path.
 * Deliberately one-sided: any legal word, intent, routing phrase or legal thread
 * keeps the full legal path. Doubt is legal.
 */

// Stems of folded words (no diacritics) that name a legal matter, an authority or a
// conflict a client brings to a lawyer. Matched at the start of a word.
const LEGAL_STEMS = [
  // "praw" is rights and law, not "prawie" (almost), "prawda", "prawdziwy", "prawidłowy", "prawa ręka".
  "praw(?!d|ie(?![a-z])|ic|idlow|ej (?:rek|stron|nog)|a (?:reka|strona|noga)|o (?:jazdy )?(?:reki|strony))", "prawn", "prawni", "ustaw(?!ic|ien|il|ia[cl]|ion)", "kodeks", "przepis(?!\\s+na\\b)", "paragraf", "artykul", "rozporzadz", "dyrektyw", "konstytuc",
  "sad(?!zic|zi\\b|zil|zon|zen|zaw|ownik\\b)", "sedzi", "wyrok", "postanowieni", "pozew", "pozw", "apelac", "zazaleni", "skarg", "odwola", "sprzeciw", "kasac",
  "rozpraw", "proces", "pelnomocni", "adwokat", "radc", "notariu", "komorni", "mediac", "biegl", "swiad", "dowod",
  "umow", "kontrakt", "aneks", "regulamin", "ugod", "wypowiedz", "kara", "kary", "karn", "grzywn", "mandat", "odszkodowa",
  "zadoscuczyn", "roszczen", "dlug(?!o\\b|osc|ie\\b|ich\\b|im\\b|iego|iej|a\\b)", "dluz", "wierzyc", "zaplat", "faktur", "windyk", "egzekuc", "zajeci", "zajal",
  "spadk", "spadek", "testament", "zachow", "dziedzicz", "rozwod", "alimen", "opiek", "wladz", "separac", "malzen",
  "najem", "najm", "wynajm", "wynajem", "czynsz", "kaucj", "lokator", "eksmis", "wlasciciel", "wlasnos", "nieruchomos", "dzialk", "dzialc", "bez (?:mojej|jego|jej|naszej) wiedzy",
  "sasiad", "pracodaw", "pracowni", "zwolni", "urlop", "wynagrodz", "zus", "krus", "emerytur", "rent", "zasil", "swiadcze",
  "urzad", "urzedni", "decyzj", "organ", "gmin", "wojewod", "starost", "burmistrz", "wojt", "skarbow", "podat", "vat", "pit", "cit",
  "polic(?!z)", "prokurat", "przestep", "wykrocz", "oszu", "krad", "pobi", "grozi", "nek", "zglos", "zawiadom",
  "reklamac", "rekojm", "gwarancj", "zwrot", "odstap", "konsument", "ubezpiecz", "polis", "kredyt", "pozyczk", "zablokow",
  "rodo", "dane osobow", "wizerun", "autorsk", "licencj", "patent", "znak towar", "zezwoleni", "pozwoleni", "koncesj",
  "spolk", "wspolni", "upadlos", "restruktur", "zarzad", "udzial", "rejestr", "krs", "ceidg", "przetarg", "zamowieni publ",
  "obywatel", "paszport", "melduj", "zamelduj", "wymelduj", "pobyt", "wiz", "cudzoziem", "uchodz",
  "lekarz", "szpital", "pacjent", "dokumentacj", "szkod", "wypad", "uszkodz", "zalal", "zalew", "zniszczy", "pogryz",
  "termin", "przedawni", "pismo", "pisma", "wniosek", "wezwani", "uchwal", "nakaz", "zakaz", "obowiaz", "uprawnie",
  "legaln", "nielegaln", "wolno", "dozwolon", "przysluguj", "nalez mi", "naleza mi", "nalezy mi", "odpowiedzialn",
  "szef", "kierowni", "firma nie", "nie placi", "nie zaplacil", "nie oddaj", "nie odda", "oddac pieniadz", "ukradl", "zabral",
  "nie pozwal", "widyw", "kontakt(?:y|ow|ami)? z dzie", "zostawil", "wyprowadzil", "nie chce oddac", "nie chce zaplac",
  "bez (?:mojej |jego |jej |ich |naszej )?zgod", "odmow", "opodatk", "odlicz", "ulg", "wierzytel", "syndyk", "orzeczeni",
  "opublikow", "publikac", "wymeldow", "zameldow", "(?:moich|moje|twoich|klientow|pracownikow) dan", "dan(?:e|ych) (?:osob|klient|pracown)",
  "korupc", "sankcj", "audyt", "complian", "dzierzaw", "doplat", "refundac", "etykiet", "wycofan", "mobilizac", "sluzb", "taryf",
  "traktat", "pomoc publiczn", "wyklucz", "ksieg", "nadzor", "kontrol", "sprostowan", "fiskus", "wad(?:a|y|e|liw)", "intercyz",
  "rozdzielnos", "ubezwlasnowol", "ojcostw", "wspolwlasnos", "konwencj", "konsul", "dyskrymin", "wywiez", "uprowadz", "przyjeci",
  "dopuszcz", "kara?t[ay] (?:polaka|pobytu)", "licencj", "certyfik", "iso", "aml", "dora", "nis2", "ai act",
  "akt(?:a|ach|ami|om)\\b", "dokument", "spraw(?:a|y|ie|e|ach|om|ami)\\b", "klient", "rozprawa", "protokol",
  // Matters told without a legal word (benchmark 2026-10-08, scenarios-5000): a gift,
  // a petition, a brand, whistleblowing, a carrier's liability, ESG, an internal inquiry.
  "darowizn", "zglasz", "podpis", "nieprawidlowos", "zastrzec", "zastrzez", "esg", "csrd", "antykorupc", "dochodzeni",
  "przewozn", "odpowiada za", "ukrad", "nazw\\w* (?:dla )?(?:mojej |naszej )?(?:marki|firmy|sklepu|produktu)", "praktyk\\w* lekarsk", "zalozyc (?:firm|spolk|fundacj|stowarzysz|dzialalnos|praktyk)",
  "usun\\w* (?:moje |moj )?(?:zdjec|zdjeci|wpis|komentarz|dane)\\w* z (?:internet|sieci|portal|forum|google|facebook|serwis|strony)",
];
const LEGAL_LEXICON = new RegExp(`(?<![a-z0-9])(?:${LEGAL_STEMS.join("|")})`, "u");

// Questions about rights and duties, whatever the topic.
const LEGAL_INTENT =
  /(?<![a-z])(?:czy (?:(?:cos|jakos|w ogole|tu|tutaj|teraz|wtedy|nadal|jeszcze) )*(?:moge|mozna|musze|trzeba|wolno|mam prawo|grozi|jestem zobowiazan|to legalne|to zgodne|da sie)|co (?:(?:mi|w tej sytuacji|teraz) )?grozi|cos (?:moge|mozna|da sie)|co (?:(?:moge|mam|mozna|powinienem|powinnam|nalezy) )(?:z tym )?(?:zrobic|robic)|od czego zaczac|jakie mam (?:prawa|szanse|opcje|mozliwosci)|kto (?:placi|odpowiada|ponosi|zaplaci)|ile (?:mam czasu|mam dni)|do kogo (?:sie )?(?:zwrocic|zglosic|isc)|gdzie (?:sie )?(?:zglosic|zwrocic|to zglosic|zlozyc)|jak (?:to )?(?:zalatwic|rozwiazac|sie bronic|sie odwolac|zaskarzyc|dochodzic|odzyskac (?:pieniadz|kaucj|dlug|nalezn|zaplat|wklad|depozyt|prawo|samoch|mieszk)|zglosic|wypowiedziec|rozwiazac umowe))/u;

// One everyday word of a domain's routing row ("pies", "student", "zamówienie",
// "fotowoltaika") names a topic, not yet a matter: alone it does not make the
// message legal. Any second signal (a legal word, an intent) does.
const TOPIC_ONLY = new Set([
  "dług", "sąd", "student", "uczeń", "szkoła", "uczelnia", "matura", "zamówienie", "pies", "zwierzę", "sport", "energia", "transport",
  "środowisko", "żywność", "rolnik", "rolnictwo", "hodowla", "budowa", "apteka", "fotowoltaika", "studnia", "geodeta", "zabytek",
  "prasa", "redakcja", "narzędzia", "kalkulator", "strategia", "spam", "cookies", "newsletter", "wojsko", "odpady", "farmacja",
  "lekarz rodzinny", "IP", "za granicą", "Konwencja", "dyrektywa", "uchwała", "wynagrodzenie", "urlop", "emerytura", "recepta"
]);

// Citations: an article or a section, a case number, a Dz.U. reference.
const CITATION = /\bart\.?\s*\d|§\s*\d|\bsygn\.?|\bdz\.?\s?u\.?|\b[ivx]+\s+[a-z]{1,4}\s+\d+\/\d{2}\b/iu;

function hasLegalSignal(text: string, flash: FlashRoute[]): boolean {
  if (!text.trim()) return false;
  const folded = fold(provisionsForDetection(text));
  return (
    CITATION.test(text) ||
    LEGAL_LEXICON.test(folded) ||
    LEGAL_INTENT.test(folded) ||
    criminalMatter(text) ||
    flashDomains(flash, text).some((row) => row.matched.some((phrase) => !TOPIC_ONLY.has(phrase)))
  );
}

// A general request: a question or an instruction ("jak upiec", "ile to jest", "co to
// jest", "napisz wiersz", "przetłumacz"), after an optional greeting. A bare statement
// ("Komitet audytu w jednostce zainteresowania publicznego") describes a matter and
// stays legal.
const OPENING = /^(?:(?:hej|hejka|czesc|witam|witaj|dzien dobry|dobry wieczor|siema|halo)[\s,!.]*)?(?:(?:mam (?:takie )?pytanie|pytanie|prosba)\s*[:,-]?\s*)?/u;
const GENERAL_REQUEST =
  /^(?:jak|jaki|jaka|jakie|jakiego|jakim|ile|chce|chcialbym|chcialabym|chcemy|prosze|prosimy|potrzebuje|potrzebujemy|przygotuj|rozpisz|sprawdz|szukam|poszukaj|znajdz|kto|kim|komu|kiedy|gdzie|skad|dokad|dlaczego|czemu|po co|co|czym|czy|ktory|ktora|ktore|napisz|wymysl|przetlumacz|policz|oblicz|rozwiaz|przelicz|podaj|polec|zaproponuj|opowiedz|stresc|wyjasnij|wytlumacz|uloz|zagrajmy|popraw|wymien|opisz|zrob|stworz|narysuj|zaplanuj|pomoz|daj|powiedz|wskaz|porownaj|polecisz|polecasz|podpowiesz|podpowiedz|doradz|doradzisz|podziel|pomnoz|dodaj|odejmij|naucz|pokaz|wymysl|masz|w co|plan|cwiczenia|przepis na)\b/u;

/** True only for a general request with no legal signal, in a thread with none either. */
export function isNonLegalMessage(query: string, flash: FlashRoute[]): boolean {
  // Routing markers pasted into a message ("#prawo #pozew", "[[legal=true]]", "KROK0A")
  // do not make a recipe legal; the matter decides.
  const latest = withoutRoutingMarkers(latestUserTurn(query)).replace(/#[\p{L}_]+|\[\[[^\]]*\]\]/gu, " ");
  // A question opening the message, or the closing request of a story ("Mam psa, który
  // tyje. ... Ułóż mi plan diety.") (benchmark 2026-10-10, 1000 kazusów).
  const opening = (text: string) => GENERAL_REQUEST.test(fold(text.trim()).replace(OPENING, ""));
  if (!opening(latest) && !opening(requestOf(latest))) return false;
  if (hasLegalSignal(latest, flash)) return false;
  // A follow-up in a legal thread ("tak, w maju") belongs to that matter.
  if (laterTurn(query) && hasLegalSignal(threadUserText(query), flash)) return false;
  return true;
}

let flashCache: { file: string; mtimeMs: number; rows: FlashRoute[] } | null = null;

/** prawo-polskie-v2 "Routing błyskawiczny" of the registry, re-read after a skill update. */
export function registryFlashRoutes(registry: LexSkillRegistry): FlashRoute[] {
  const file = registry.get("prawo-polskie-v2")?.skillFile;
  if (!file) return [];
  try {
    const mtimeMs = fs.statSync(file).mtimeMs;
    if (flashCache?.file === file && flashCache.mtimeMs === mtimeMs) return flashCache.rows;
    flashCache = { file, mtimeMs, rows: parseFlashRouting(fs.readFileSync(file, "utf8")) };
    return flashCache.rows;
  } catch {
    return [];
  }
}
