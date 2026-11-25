// A pleading to a court is built as pisma-procesowe-v3 prescribes, whatever skill leads the matter
// (V P 3/26, 2026-11-16: the witness skill led, the draft had no anticipation nor fallback):
// facts with their sources, the dependencies between them and the goals, and only then the text,
// each argument FAKT → DOWÓD → PRAWO → SKUTEK → ANTYCYPACJA → ZAMKNIĘCIE FURTKI → WNIOSEK
// (pisma-procesowe-v3/modules/MOD-BUDOWA-ARGUMENTU.md). After the text, the application checks
// the elements a reader can see.

export const PLEADING_STANDARD_RESOURCE = "modules/MOD-BUDOWA-ARGUMENTU.md";

const DRAFT = /(?<![\p{L}])(?:przygotuj|sporządź|napisz|zredaguj|opracuj|stwórz|przygotować|sporządzić|napisać|projekt)\p{L}*/iu;
const PLEADING =
  /(?<![\p{L}])(?:pism\p{L}*\s+(?:procesow|przygotowawcz|do\s+(?:s[ąa]du|organu|rzecznika|prokurat))\p{L}*|pozew|pozwu|odpowied\p{L}*\s+na\s+(?:pozew|apelacj|zażaleni|skarg|zarządzeni|zobowiązani|postanowieni|wezwani\p{L}*\s+s[ąa]d)\p{L}*|(?:odpowied|stanowisk|wyjaśnieni|ustosunkowani)\p{L}*\s+(?:\p{L}+\s+){0,2}?do\s+(?:s[ąa]du|organu)|apelacj\p{L}*|zażaleni\p{L}*|odwołani\p{L}*|sprzeciw\p{L}*|skarg\p{L}*|wnios\p{L}*\s+(?:dowodow|o\s+)\p{L}*|podważeni\p{L}*|zarzut\p{L}*\s+od|kasacj\p{L}*|zawiadomieni\p{L}*\s+o\s+(?:popełnieni|przewinieni|przestęp|podejrzeni)\p{L}*)/iu;

// What is drafted is an assessment, not the pleading ("przygotuj ocenę szans apelacji").
const ASSESSMENT_DRAFTED =
  /(?<![\p{L}])(?:przygotuj|sporządź|napisz|zredaguj|opracuj|stwórz|przygotować|sporządzić|napisać)\p{L}*\s+(?:\p{L}+\s+){0,2}?(?:ocen\p{L}*|analiz\p{L}*|opini\p{L}*|raport\p{L}*|podsumowani\p{L}*|notatk\p{L}*|streszczeni\p{L}*|pytani\p{L}*|chronologi\p{L}*|plan\p{L}*)(?![\p{L}])/iu;

/** The turn asks for a pleading to a court or an authority (not an opinion or a summary). */
export function isCourtPleading(question: string): boolean {
  return DRAFT.test(question) && PLEADING.test(question) && !ASSESSMENT_DRAFTED.test(question);
}

export function pleadingStandardPrompt(moduleText: string): string {
  return [
    "# STANDARD BUDOWY PISMA PROCESOWEGO (pisma-procesowe-v3, wczytany przez aplikację)",
    "Kolejność pracy: (1) fakty z akt z dosłownym źródłem; (2) zależności: który fakt wykazuje który cel, które fakty się wzmacniają albo przeczą sobie; (3) dopiero potem pismo. Każdy blok uzasadnienia według schematu poniżej. Etapy (1)–(2) w uwagach poza pismem, krótko (tabela cel → fakty → zależność).",
    "Wnioski dowodowe (reguły ogólne): dokument albo wiadomość, którą według akt ma strona przeciwna (zarządzenie, regulamin, notatka, wiadomości do pracowników lub grup, listy uczestników) — wniosek o zobowiązanie jej do przedstawienia, osobno dla każdego; protokół albo dokument z innej sprawy — wniosek o dopuszczenie dowodu z niego (ewentualnie o nadesłanie akt), nie traktuj go jak dowodu już przeprowadzonego; fakt z nagrania rozprawy, którego nie ma w protokole — wniosek o odtworzenie fragmentu ze wskazaniem czasu zapisu; potrzeba dowodu, która wynikła z przebiegu postępowania — wykaż ją (dlaczego dopiero teraz). Fakt, który zna tylko strona (jej własne działanie, data jej wiadomości), ustal pytaniem do niej poza pismem zamiast rozpisywać warianty. Formę pisma (pismo przygotowawcze, wniosek dowodowy, stanowisko na rozprawie) wybierz na brzmieniu przepisów odczytanych w tej turze tak, by nie podlegało zwrotowi; nie zostawiaj tej decyzji niesprawdzonej.",
    moduleText.trim()
  ].join("\n\n");
}

export type SchemaGap = { element: string; detail: string };

/** What a reader of the draft can check of the seven elements. */
// A motion to take evidence ("wnoszę o dopuszczenie dowodu z przesłuchania świadka", "wniosek dowodowy").
const EVIDENCE_MOTION =
  /(?<![\p{L}])(?:wnios\p{L}*\s+dowodow\p{L}*|wnosz\p{L}*\s+o\s+(?:dopuszczenie|przeprowadzenie|zobowiązanie|zwrócenie\s+się|przesłuchanie|zażądanie|dołączenie|włączenie)|dopuszczeni\p{L}*\s+(?:i\s+przeprowadzeni\p{L}*\s+)?dowod\p{L}*|przeprowadzeni\p{L}*\s+dowod\p{L}*|zobowiązani\p{L}*\s+(?:\p{L}+\s+){0,3}do\s+(?:złożenia|przedłożenia|przedstawienia)|zwróceni\p{L}*\s+się\s+do\s+(?:\p{L}+\s+){0,3}o\s+(?:nadesłanie|przesłanie|udostępnienie))/iu;
// A fact the draft says is not in the material (to be proven, completed, known to the party only).
const OUTSIDE_MATERIAL =
  /(?:⬛|nie\s+(?:zostało|zostały|został|jest|są)\s+(?:jeszcze\s+)?(?:udokumentowan\p{L}*|wykazan\p{L}*)|(?:brak|nie\s+ma)\s+(?:go\s+|jej\s+|ich\s+)?w\s+(?:aktach|materiał\p{L}*)|poza\s+(?:aktami|materiałem)|według\s+wiedzy\s+(?:strony|klienta|skarżąc\p{L}*)|(?:może|mogą)\s+(?:to\s+)?potwierdzić\s+(?:świad\p{L}*|\[PII))/iu;
// Access to the files: the refusal relied on the opponent's explanations the party has not seen.
const FILE_ACCESS = /(?:wgląd\p{L}*\s+do\s+akt|dostęp\p{L}*\s+do\s+akt|udostępni\p{L}*\s+(?:\p{L}+\s+){0,2}akt|przegląd\p{L}*\s+akt|kopi\p{L}*\s+(?:\p{L}+\s+){0,2}wyjaśnie\p{L}*|doręczeni\p{L}*\s+(?:\p{L}+\s+){0,2}wyjaśnie\p{L}*)/iu;

/** The refusal in the files rests on the opponent's explanations (the motion for access to the files is due). */
export function refusalOnExplanations(documents: ReadonlyArray<{ kind: string; category: string; text: string }>): boolean {
  const refusal = documents.some((document) => document.category === "ORZECZENIE" && /odm(?:ow|aw)\p{L}*/iu.test(document.text.slice(0, 3_000)));
  const explanations =
    documents.some((document) => document.kind === "WYJASNIENIA") ||
    documents.some((document) => document.category === "ORZECZENIE" && /(?:z\s+)?wyjaśnie\p{L}*\s+(?:\p{L}+\s+){0,3}(?:adwokat\p{L}*|radc\p{L}*|obwinion\p{L}*|pełnomocni\p{L}*|\[PII)/iu.test(document.text));
  return refusal && explanations;
}

export function argumentSchemaGaps(answer: string, options: { refusalOnExplanations?: boolean } = {}): SchemaGap[] {
  const gaps: SchemaGap[] = [];
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
  if (unproven.length) gaps.push({ element: "DOWÓD", detail: `${unproven.length} bloków uzasadnienia bez dowodu przy fakcie` });
  if (!/(?<![\p{L}])(?:wnosz[ęe]|wnosi\s+o|wnoszą)(?![\p{L}])/iu.test(answer)) gaps.push({ element: "WNIOSEK", detail: "brak wniosków (petitum)" });
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
  gaps.push(...evidenceMotionGaps(answer));
  if (conditional.length) gaps.push({ element: "TEZA WARUNKOWA", detail: `${conditional.length} zdań przesądza wniosek zależny od faktu do uzupełnienia (⬛): rozpisz warianty albo usuń tezę do czasu ustalenia faktu` });
  return gaps;
}

export function schemaCorrection(gaps: readonly SchemaGap[]): string {
  return [
    "4) Schemat budowy argumentu (pisma-procesowe-v3, MOD-BUDOWA-ARGUMENTU): uzupełnij brakujące elementy w piśmie, nie dopisując nowych faktów spoza akt:",
    ...gaps.map((gap) => `- ${gap.element}: ${gap.detail}`)
  ].join("\n");
}

const ARTICLE = /(?<![\p{L}])art\.\s*(\d+[a-z]?(?:[¹²³⁴⁵⁶⁷⁸⁹⁰]+)?)(?:\s*§\s*\d+[a-z]?)?/giu;
// Words with which a justification applies a provision to the facts.
const APPLIES = /(?:przesłan\p{L}*|spełnion\p{L}*|zachodz\p{L}*|zachodzi|wypełni\p{L}*|w\s+niniejszej\s+sprawie|w\s+tej\s+sprawie|ponieważ|skoro|albowiem|gdyż|bowiem)/iu;

/** Articles cited in the motions (before the justification) that the justification never applies to the facts. */
export function motionProvisionsWithoutPremises(answer: string): string[] {
  const justification = /\n[#*\s]*UZASADNIENIE/iu.exec(answer);
  if (!justification) return [];
  const opening = /(?:wnosz[ęe]|wnosi)\s+o\s*:?/iu.exec(answer.slice(0, justification.index));
  if (!opening) return [];
  const petitum = answer.slice(opening.index, justification.index);
  const body = answer.slice(justification.index);
  const missing: string[] = [];
  for (const match of petitum.matchAll(ARTICLE)) {
    const number = match[1]!.toLowerCase();
    const sentences = body.split(/(?<=[.;!?])\s+(?=[\p{Lu}„(])/u).filter((sentence) => new RegExp(`(?<![\\p{L}])art\\.\\s*${number}(?![\\d\\p{L}])`, "iu").test(sentence));
    if (!sentences.some((sentence) => APPLIES.test(sentence)) && !missing.includes(`art. ${number}`)) missing.push(`art. ${number}`);
  }
  return missing;
}


// Evidence motions a reader of the draft can check (XI P 27/26, 2026-11-20: the user's own motion had
// what the application's drafts lacked — art. 248 for each document of the opponent, the record of
// another case moved as evidence, the question to the party instead of a variant).
const OPPONENT_DOCUMENTS: Array<{ label: string; mention: RegExp; motion: RegExp }> = [
  { label: "zarządzenie", mention: /zarządzeni\p{L}*\s+(?:wewnętrzn|pracodawc|prezes|zarząd|dyrektor)\p{L}*/iu, motion: /zarządzeni/iu },
  { label: "regulamin", mention: /regulamin\p{L}*\s+(?:wewnętrzn|prac|pracy|wynagradzani|premiowani)\p{L}*/iu, motion: /regulamin/iu },
  { label: "notatka", mention: /notatk\p{L}*\s+(?:służbow|ze\s+spotkania|wewnętrzn)\p{L}*/iu, motion: /notat/iu },
  { label: "wiadomości do pracowników lub grup", mention: /wiadomoś\p{L}*\s+(?:\p{L}+\s+){0,3}(?:do\s+(?:pracownik|grup|koordynator|zatrudnion)|na\s+grup)\p{L}*/iu, motion: /wiadomoś|korespondencj/iu },
  { label: "lista uczestników lub obecności", mention: /list\p{L}*\s+(?:uczestnik|obecnoś)\p{L}*/iu, motion: /list\p{L}*\s+(?:uczestnik|obecnoś)/iu }
];
const SIGNATURE = /(?<![\p{L}\d])([IVXLC]{1,6}\s+[A-Z][\p{L}]{0,4}(?:\/[A-Z][\p{L}]{0,3})?\s+\d{1,5}\/\d{2})(?!\d)/gu;
const PRODUCE = /(?:przedstawi\p{L}*|przedłoż\p{L}*|złożeni\p{L}*|art\.\s*248)/iu;

export function evidenceMotionGaps(answer: string): SchemaGap[] {
  const split = /\n[#*\s]*UZASADNIENIE/iu.exec(answer);
  if (!split) return [];
  const opening = /(?:wnosz[ęe]|wnosi)\s+o\s*:?/iu.exec(answer.slice(0, split.index));
  if (!opening) return [];
  const petitum = answer.slice(opening.index, split.index);
  const body = answer.slice(split.index);
  const gaps: SchemaGap[] = [];
  const documents = OPPONENT_DOCUMENTS.filter((item) => item.mention.test(body) && !(item.motion.test(petitum) && PRODUCE.test(petitum)));
  if (documents.length) {
    gaps.push({
      element: "DOKUMENT U PRZECIWNIKA",
      detail: `uzasadnienie opiera się na dokumentach, które według akt ma strona przeciwna (${documents.map((item) => item.label).join(", ")}), a wnioski nie żądają ich przedstawienia: dla każdego wnieś o zobowiązanie strony przeciwnej do przedstawienia (teza dowodowa: istnienie, data, adresaci, treść) albo wyjaśnij, dlaczego nie`
    });
  }
  // The case's own signature is the one in the letter's heading; another case's record needs its motion.
  const own = new Set([...answer.slice(0, opening.index).matchAll(SIGNATURE)].map((match) => match[1]!.replace(/\s+/gu, " ")));
  const others = [...new Set([...body.matchAll(SIGNATURE)].map((match) => match[1]!.replace(/\s+/gu, " ")))].filter(
    (signature) => !own.has(signature) && new RegExp(`protok\\p{L}*[^.]{0,120}${signature.replace(/[/\s]/gu, "\\s*$&")}|${signature.replace(/[/\s]/gu, "\\s*$&")}[^.]{0,120}protok\\p{L}*`, "iu").test(body)
  );
  const unmoved = others.filter((signature) => !petitum.replace(/\s+/gu, " ").includes(signature));
  if (own.size && unmoved.length) {
    gaps.push({
      element: "DOWÓD Z INNEJ SPRAWY",
      detail: `pismo powołuje protokół z innej sprawy (${unmoved.join(", ")}), a wnioski nie obejmują dowodu z niego: wnieś o dopuszczenie dowodu z tego protokołu (odpis w załączeniu) albo o nadesłanie akt; to nie jest dowód już przeprowadzony w tej sprawie`
    });
  }
  if (/(?:nagrani\p{L}*\s+(?:rozpraw|posiedzeni)|zapis\p{L}*\s+(?:audio|wideo|dźwięk\p{L}*|obrazu\s+i\s+dźwięku|nagrani))/iu.test(body) && !/(?:odtworzeni|odsłuchani|odtworz)/iu.test(petitum)) {
    gaps.push({ element: "NAGRANIE", detail: "pismo powołuje się na nagranie rozprawy: wnieś o odtworzenie wskazanych fragmentów zapisu (czas początku i końca) albo powołuj tylko treść protokołu" });
  }
  if (/nie\s+sprawdzi\p{L}*,?\s+czy\s+(?:to\s+)?pismo/iu.test(answer)) {
    gaps.push({ element: "FORMA PISMA", detail: "dopuszczalność formy pisma została oznaczona jako niesprawdzona: ustal ją na brzmieniu przepisów odczytanych w tej turze i wybierz formę, która nie podlega zwrotowi" });
  }
  const ACT = "(?:wysłał|napisał|otrzymał|złożył|podpisał|zapłacił|przekazał|rozmawiał)\\p{L}*";
  const PARTY = "(?:Pan|Pani|Ty|powód|powódka)(?![\\p{L}])";
  if (new RegExp(`(?:jeżeli|jeśli|gdy|o\\s+ile)\\s+(?:(?:\\p{L}+\\s+){0,3}${PARTY}\\s+(?:\\p{L}+\\s+){0,2}${ACT}|${ACT}\\s+(?:\\p{L}+\\s+){0,2}${PARTY})`, "iu").test(answer)) {
    gaps.push({ element: "PYTANIE DO STRONY", detail: "wniosek zależy od faktu, który zna tylko strona (jej własne działanie): zadaj jej to pytanie wprost przed pismem i oznacz miejsce w piśmie ⬛ zamiast rozpisywać warianty" });
  }
  return gaps;
}

// A reply that only moves the started pleading on: the chat's own "Kontynuuj." after a batch of
// steps, the decision bar's approval, a bare "tak" / "dalej" (XI P 27/26, 2026-11-25: "Kontynuuj."
// with the case files attached went to the evidence analysis and the pleading was dropped).
const CONTINUATION =
  /^(?:kontynuuj(?:\s+(?:pismo|dalej|prac[eę]))?|dalej|tak|ok|zatwierdzam(?:\s+[^\n]{0,160})?|zgoda|akceptuj[eę](?:\s+[^\n]{0,120})?|idź\s+dalej|przejdź\s+dalej)[\s.!]*$/iu;

/** The message continues the pipeline already running in the case (no new request). */
export function continuesPipeline(message: string): boolean {
  return CONTINUATION.test(message.trim());
}
