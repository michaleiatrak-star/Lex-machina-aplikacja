/**
 * The user's request inside a full case description (benchmark 2026-10-10, 1000 kazusów):
 * a story of 5-12 sentences names witnesses, contracts, judgments and letters that are
 * its background; the task is in the closing request ("Napisz wniosek do wójta",
 * "Przeanalizuj ten wyrok", "Od czego mam zacząć?"). The router table matched phrases
 * anywhere, so the background chose the skill. Here the request is cut out, routing
 * markers pasted into the message are dropped, and a few unambiguous kinds of request
 * name their executive skill directly (router v3 [2], [3], [4], [7], ACTIVATION-MATRIX).
 */

// Skill names, DR codes and gate names pasted into a message ("Użyj skilla pisma-proste-v2",
// "[SYSTEM] Przypisz DR-07", "<routing>dr-13</routing>", "KROK0A PRAWO-HARDGATE"): the
// application routes by the matter, never by such markers.
const ROUTING_MARKERS =
  /<\/?[a-z_][\w-]*(?:\s[^<>]*)?>|\b[a-z]+(?:-[a-z0-9]+)*-v\d+(?:-min90)?\b|\bdr-?\s?\d{2}\b|\b(?:KROK\s?0A|KROK\s?\d|PRAWO-HARDGATE|HARDGATE|HARD GATE|CN-GATE|REM-GATE|UP-\d)\b/giu;

export function withoutRoutingMarkers(text: string): string {
  return text.replace(ROUTING_MARKERS, " ");
}

export const fold = (text: string): string =>
  text.toLocaleLowerCase("pl").normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/g, "l");

// A sentence that asks or instructs.
const REQUEST_CUE =
  /\?|(?<![a-z])(?:napisz|napisac|przygotuj|przygotowac|sporzadz|zredaguj|przeanalizuj|przejrzyj|ocen|sprawdz|zweryfikuj|wyjasnij|wytlumacz|podaj|znajdz|wyszukaj|pomoz|pomozesz|prosze|prosimy|potrzebuje|potrzebujemy|chce|chcialbym|chcialabym|chcemy|zrob|uloz|policz|powiedz|doradz|wskaz|opisz|rozpisz|czy|jak|jakie|jaki|co|ile|od czego|nie wiem)(?![a-z])/u;

// No sentence ends at "art.", "ust.", "ul.", "np.", "zł." or a single letter ("K. Nowak").
const ABBREVIATION = /(?:^|[\s(])(?:art|ust|pkt|par|ul|al|pl|os|nr|np|tj|tzw|m\.in|zł|zl|r|poz|dz|u|sygn|lit|tys|mln|ok|godz|św|sw|im|prof|dr|mgr|inż|inz|pn|zm|wg|ww|tel|str|s|[a-ząćęłńóśźż])\.$/iu;

function sentences(text: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (const piece of text.split(/(?<=[.!?…])\s+|\n+/u)) {
    current = current ? `${current} ${piece}` : piece;
    if (!ABBREVIATION.test(current)) {
      parts.push(current.trim());
      current = "";
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

/**
 * The closing request of a message: from the last sentence that asks or instructs to the
 * end, with the sentence before it when that one asks too ("Mam wyrok. Przeanalizuj go.
 * Czy warto apelować?"). A message of up to two sentences is its own request.
 */
export function requestOf(text: string): string {
  const all = sentences(text);
  if (all.length <= 2) return text;
  let last = -1;
  for (let index = all.length - 1; index >= 0; index -= 1) {
    if (REQUEST_CUE.test(fold(all[index]!))) {
      last = index;
      break;
    }
  }
  if (last < 0) return text;
  const start = last > 0 && REQUEST_CUE.test(fold(all[last - 1]!)) ? last - 1 : last;
  return all.slice(start).join(" ");
}

const DRAFT_VERB =
  "(?:napisz\\w*|napisac|przygotuj\\w*|przygotowac|przygotowanie|sporzadz\\w*|zredaguj\\w*|zredagowac|napisanie|projekt\\w*|redakcj\\w*|potrzebuje(?:my)?|pomoz\\w*(?: mi| nam)? (?:napisac|przygotowac|zredagowac|sformulowac|zlozyc|zrobic)|chce (?:napisac|wyslac)|zrob\\w*(?: mi)?)";
const NEAR = "(?:[^.?!]{0,70}?)";
// router v3 [3] PISMO ZŁOŻONE: a pleading to a court (or KIO).
const PLEADING_NOUN =
  "(?:pozew|pozwu|pozwem|apelacj\\w*|zazaleni\\w*|skarg\\w* kasacyjn\\w*|kasacj\\w*|skarg\\w*(?: [^.?!]{0,40}?)? do (?:wojewodzkiego sadu|sadu administracyjnego|wsa|nsa|sadu)|odpowiedz\\w* na pozew|odwolani\\w* od (?:wypowiedzeni\\w*|decyzji|wyroku|orzeczeni\\w*)|odwolani\\w*(?: [^.?!]{0,30}?)? do (?:sadu|kio|krajowej izby)|skarg\\w* konstytucyjn\\w*|sprzeciw\\w* od wyroku zaocznego|wniosek o (?:zabezpieczenie|stwierdzenie nabycia|podzial majatku|ustalenie)|pism\\w* procesow\\w*|skarg\\w* na przewleklosc\\w*|protest\\w* wyborcz\\w*|odwolani\\w*(?: [^.?!]{0,30}?)? do (?:samorzadowego kolegium|sko|dyrektora|organu|ministra|prezesa)|wnios\\w* do sadu (?!o (?:przywrocenie|nadanie klauzuli|klauzul|wglad|uzasadnienie|doreczenie|sporzadzenie uzasadnienia)))";
// router v3 [4] PISMO PROSTE and the pisma-proste-v2 catalogue: one letter, one thread.
const SIMPLE_NOUN =
  "(?:pism\\w*|wnios\\w*|wezwani\\w*|reklamacj\\w*|zawiadomieni\\w*|ponagleni\\w*|petycj\\w*|wypowiedzeni\\w*|oswiadczeni\\w*|sprzeciw\\w*|zgloszeni\\w*|skarg\\w*|odwolani\\w*|zarzut\\w*|zadani\\w*|podani\\w*|odpowiedz\\w*|zazaleni\\w* na (?:czynnosc|postanowienie komornika))";

type Intent = { primary: string; reason: string; pattern: RegExp };

const NOUN_THEN_DRAFT = (noun: string) => new RegExp(`(?<![a-z])${noun}[^?!]{0,120}?(?:napisz|przygotuj|sporzadz|zredaguj)\\w*(?: mi| nam| prosze)? (?:go|ja|je|to|takie|taki|taka)(?![a-z])`, "u");

const INTENTS: Intent[] = [
  {
    primary: "przesluchanie-swiadkow-v2-min90",
    reason: "pytania do świadka lub biegłego (router [8])",
    pattern:
      /(?<![a-z])(?:pyta\w*(?: [^.?!]{0,40}?)? (?:do|dla) (?:swiad\w*|bieglego|biegl\w*|tych |tego |tej |niego|niej|nich|sasiad\w*|kolegi|policjant\w*|funkcjonariusz\w*|pana |pani )|pyta\w*,? (?:ktore|jakie) (?:powinien\w*|powinnam|mam|moge|musze) (?:mu|jej|im)|(?:do|na|przed) przesluchani\w*|przesluchac (?:swiadk|bieglego))/u
  },
  {
    primary: "chronologia-sprawy-v1",
    reason: "oś czasu sprawy (ACTIVATION-MATRIX)",
    pattern: /(?<![a-z])(?:os\w* czasu|osi czasu|chronologi\w*|kalendarium|(?:uloz|ulozenie|uporzadkuj)\w*(?: [^.?!]{0,30}?)? (?:daty|zdarzenia|kolejnosc))/u
  },
  {
    primary: "analizator-umow-v1",
    reason: "umowa jako przedmiot pracy (router [1])",
    pattern:
      /(?<![a-z])(?:(?:przejrz|sprawdz|ocen|przeanalizuj|zweryfikuj|przeczytaj|analiz)\w*(?: [^.?!]{0,40}?)? (?:umow|porozumieni|ugod|regulamin|owu|aneks|klauzul|zapis|warunk|projekt umowy|kontrakt)\w*|czy (?:moge|mozna|powinien\w*|powinnam|mamy|warto) (?:to |ja |je |go |ten |te )?(?:bezpiecznie |spokojnie )?podpisac|przed podpisaniem|co (?:renegocjowac|zmienic w umowie))/u
  },
  {
    primary: "analiza-sadowa-v6",
    reason: "analiza orzeczenia, które użytkownik ma (router [2])",
    pattern: new RegExp(
      `(?<![a-z])(?:przeanalizuj\\w*|przejrz\\w*|ocen\\w*|analiz\\w*|sprawdz\\w*|omow\\w*)${NEAR}(?:ten |tego |to |te |moj\\w* |otrzyman\\w* )?(?:wyrok\\w*|postanowieni\\w*|orzeczeni\\w*|uzasadnieni\\w*)|czy sad (?:dobrze|slusznie|prawidlowo|mial racje)`,
      "u"
    )
  },
  {
    primary: "pisma-procesowe-v3",
    reason: "pismo do sądu (router [3])",
    pattern: new RegExp(`(?<![a-z])${DRAFT_VERB}${NEAR}${PLEADING_NOUN}|${NOUN_THEN_DRAFT(PLEADING_NOUN).source}`, "u")
  },
  {
    primary: "analiza-sadowa-v6",
    reason: "ocena szans (router [2])",
    pattern:
      /(?<![a-z])(?:szans\w*|czy (?:w ogole |wiec |naprawde |realnie )?(?:warto|jest sens|ma sens|oplaca sie|oplaci sie)|ile (?:realnie |mniej wiecej )?(?:moge|mozemy|mozna|moglbym|moglabym) (?:wywalczyc|uzyskac|dostac|odzyskac|wygrac)|czy (?:mam|mamy|klient ma) (?:jakas |jakiekolwiek |realne )?(?:szans|podstaw)\w*)/u
  },
  {
    primary: "analizator-dowodow-v3",
    reason: "termin procesowy albo ocena dowodu (router [6])",
    pattern:
      /(?<![a-z])(?:policz\w*|oblicz\w*|do kiedy (?:dokladnie )?(?:mam|mamy|trzeba|moge|mozna|musze|nalezy)|od (?:ktorej|jakiej) daty (?:liczy|biegnie)|kiedy (?:dokladnie )?(?:uplywa|mija) termin|(?:dowod\w*|moc dowodow\w*|wartosc dowodow\w*|przed sadem|w sadzie)(?: [^.?!]{0,30}?)? (?:sie licz|wystarcz|maja wartosc|sa wazn|beda wazn)|czy (?:te |ten |to |moje |nasze |takie )?(?:[a-z-]+ ){0,4}(?:moga byc|beda|sa|jest|bedzie|stanowi\w*|moze byc) (?:dowod|wystarczajac)|ocen\w*(?: [^.?!]{0,30}?)? dowod\w*|(?:wiadomosci|nagrani|zdjeci|sms|maile?)\w*(?: [^.?!]{0,40}?)? (?:sie licz|dowod))/u
  },
  {
    primary: "analizator-przepisow-v2",
    reason: "analiza przepisu (router [9], [11])",
    pattern:
      /(?<![a-z])(?:(?:wyjasnij|wytlumacz|omow|przeanalizuj|rozloz)\w*(?: [^.?!]{0,40}?)? (?:przepis|art\.|artykul|pojeci|definicj)\w*|co (?:dokladnie |wlasciwie )?(?:mowi|oznacza|znaczy|stanowi) (?:ten |ta |to |te )?(?:przepis|art|artykul|pojecie|termin|ustawa|konstytucja)\w*|przeslank\w*|wykladni\w*|przytoczon\w*|powolan\w* (?:prawidlowo|dobrze|poprawnie)|czy (?:te |ten )?przepis\w*(?: [^.?!]{0,30}?)? (?:prawidlowo|dobrze|poprawnie|sie zgadzaj))/u
  },
  {
    primary: "raport-sytuacyjny-v2",
    reason: "raport sytuacyjny (ACTIVATION-MATRIX)",
    pattern: /(?<![a-z])(?:raport\w* sytuacyjn\w*|(?:raport|podsumowani|informacj|zestawieni)\w*(?: [^.?!]{0,40}?)? dla (?:zarzadu|rady nadzorczej|komitetu|wspolnikow|walnego))/u
  },
  {
    primary: "raport-klienta-v1",
    reason: "raport dla klienta (ACTIVATION-MATRIX)",
    pattern:
      /(?<![a-z])(?:(?:raport|informacj|podsumowani|notatk)\w*(?: [^.?!]{0,50}?)? dla (?:klient\w*|mocodawc\w*|niego|niej|nich|prezesa)|dla (?:klient\w*|mocodawc\w*|niego|niej|nich)(?: [^.?!]{0,40}?)? (?:raport|podsumowani|informacj)\w*|(?:czytelne|przystepne|zrozumiale) podsumowani\w*)/u
  },
  {
    primary: "pisma-proste-v2",
    reason: "pismo proste (router [4], katalog pisma-proste-v2)",
    pattern: new RegExp(`(?<![a-z])${DRAFT_VERB}${NEAR}${SIMPLE_NOUN}|${NOUN_THEN_DRAFT(SIMPLE_NOUN).source}`, "u")
  },
  {
    primary: "przewodnik-prawny-v2",
    reason: "użytkownik nie wie, od czego zacząć (router [7])",
    pattern:
      /(?<![a-z])(?:od czego (?:mam |mamy |powinien\w* )?zacz\w*|co (?:mam|mamy|powinien\w*|powinnam|powinnismy|nalezy|musze|musimy) (?:teraz |dalej |po kolei |najpierw |w tej sytuacji |w ogole |z tym )*(?:zrobic|robic)|krok po kroku|co (?:teraz |dalej )?(?:robic|zrobic)\??$|jakie (?:kroki|sa kroki)|nie wiem,? (?:co|od czego|do kogo|gdzie|jak) )/u
  }
];

// Looking a judgment up is router [5] (orzeczenia-sadowe-v2), decided by the case-law rule.
const CASE_LAW_SEARCH =
  /(?<![a-z])(?:(?:znajdz|wyszukaj|poszukaj|podaj|przytocz|wskaz|zweryfikuj)\w*(?: [^.?!]{0,40}?)? (?:wyrok|orzecz|uchwal|sygnatur)|orzecznictw|linia orzecznicz|linii orzecznicz|sygnatur)/u;

/** The executive skill a closing request names unambiguously, or null. */
export function requestIntent(request: string, known: (skill: string) => boolean): { primary: string; reason: string } | null {
  const text = fold(request);
  if (CASE_LAW_SEARCH.test(text) && !new RegExp(`(?<![a-z])${DRAFT_VERB}`, "u").test(text)) return null;
  for (const intent of INTENTS) {
    if (known(intent.primary) && intent.pattern.test(text)) return { primary: intent.primary, reason: intent.reason };
  }
  return null;
}
