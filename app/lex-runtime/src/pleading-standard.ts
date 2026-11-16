// A pleading to a court is built as pisma-procesowe-v3 prescribes, whatever skill leads the matter
// (XI P 27/26, 2026-11-16: the witness skill led, the draft had no anticipation nor fallback):
// facts with their sources, the dependencies between them and the goals, and only then the text,
// each argument FAKT → DOWÓD → PRAWO → SKUTEK → ANTYCYPACJA → ZAMKNIĘCIE FURTKI → WNIOSEK
// (pisma-procesowe-v3/modules/MOD-BUDOWA-ARGUMENTU.md). After the text, the application checks
// the elements a reader can see.

export const PLEADING_STANDARD_RESOURCE = "modules/MOD-BUDOWA-ARGUMENTU.md";

const DRAFT = /\b(?:przygotuj|sporządź|napisz|zredaguj|opracuj|stwórz|przygotować|sporządzić|napisać|projekt)\p{L}*/iu;
const PLEADING =
  /\b(?:pism\p{L}*\s+(?:procesow|przygotowawcz|do\s+s[ąa]du)\p{L}*|pozew|pozwu|odpowied\p{L}*\s+na\s+(?:pozew|apelacj|zażaleni|skarg)\p{L}*|apelacj\p{L}*|zażaleni\p{L}*|odwołani\p{L}*|sprzeciw\p{L}*|skarg\p{L}*|wnios\p{L}*\s+(?:dowodow|o\s+)\p{L}*|podważeni\p{L}*|zarzut\p{L}*\s+od)/iu;

/** The turn asks for a pleading to a court or an authority (not an opinion or a summary). */
export function isCourtPleading(question: string): boolean {
  return DRAFT.test(question) && PLEADING.test(question);
}

export function pleadingStandardPrompt(moduleText: string): string {
  return [
    "# STANDARD BUDOWY PISMA PROCESOWEGO (pisma-procesowe-v3, wczytany przez aplikację)",
    "Kolejność pracy: (1) fakty z akt z dosłownym źródłem; (2) zależności: który fakt wykazuje który cel, które fakty się wzmacniają albo przeczą sobie; (3) dopiero potem pismo. Każdy blok uzasadnienia według schematu poniżej. Etapy (1)–(2) w uwagach poza pismem, krótko (tabela cel → fakty → zależność).",
    moduleText.trim()
  ].join("\n\n");
}

export type SchemaGap = { element: string; detail: string };

/** What a reader of the draft can check of the seven elements. */
export function argumentSchemaGaps(answer: string): SchemaGap[] {
  const gaps: SchemaGap[] = [];
  const justification = /UZASADNIENIE/u.exec(answer);
  const body = justification ? answer.slice(justification.index) : answer;
  if (!/(?:może\s+(?:podnieść|twierdzić|argumentować|zarzucić)|można\s+(?:by\s+)?(?:zarzucić|podnieść)|Argument\s+ten\s+(?:jest\s+)?(?:chybiony|nietrafny)|antycypac)/iu.test(body)) {
    gaps.push({ element: "ANTYCYPACJA", detail: "brak przewidzianego zarzutu przeciwnika i jego obalenia przy najsilniejszej tezie" });
  }
  if (!/(?:Nawet\s+(?:gdyby|jeżeli|jeśli|w\s+razie)|niezależnie\s+od\s+powyższego|z\s+ostrożności|ewentualnie)/iu.test(body)) {
    gaps.push({ element: "ZAMKNIĘCIE FURTKI", detail: "brak podstawy alternatywnej na wypadek nieuwzględnienia tezy głównej" });
  }
  // Facts without their proof: blocks of the justification with no quote, document marker or "Dowód".
  const blocks = body.split(/\n(?=\*\*[IVX]+\.|#{2,4}\s|\*\*\d+\.)/u).slice(1);
  const unproven = blocks.filter((block) => block.length > 300 && !/\[\[LEXDOC|„[^”]{15,}”|\(?Dowód|dowodem|protok[oó]ł|załącznik/iu.test(block));
  if (unproven.length) gaps.push({ element: "DOWÓD", detail: `${unproven.length} bloków uzasadnienia bez dowodu przy fakcie` });
  if (!/(?<![\p{L}])(?:wnosz[ęe]|wnosi\s+o|wnoszą)(?![\p{L}])/iu.test(answer)) gaps.push({ element: "WNIOSEK", detail: "brak wniosków (petitum)" });
  // A conclusion that depends on a fact still to be filled in ("⬛ [UZUPEŁNIJ: data]") is stated as
  // certain (XI P 27/26: "Jedno z tych zeznań jest nieprawdziwe" before the date was known).
  const conditional = body
    .split(/\n\s*\n/u)
    .filter((paragraph) => /⬛/u.test(paragraph) && /(?:jest\s+nieprawdziw|nieprawdą|zaprzeczył|fałszyw|skłamał|kłamie|nie\s+mo(?:że|gą)\s+być\s+prawdziw)/iu.test(paragraph) && !/(?:wariant|jeżeli|jeśli|gdyby|o\s+ile|w\s+razie)/iu.test(paragraph));
  if (conditional.length) gaps.push({ element: "TEZA WARUNKOWA", detail: `${conditional.length} akapitów przesądza wniosek zależny od faktu do uzupełnienia (⬛): rozpisz warianty albo usuń tezę do czasu ustalenia faktu` });
  return gaps;
}

export function schemaCorrection(gaps: readonly SchemaGap[]): string {
  return [
    "4) Schemat budowy argumentu (pisma-procesowe-v3, MOD-BUDOWA-ARGUMENTU): uzupełnij brakujące elementy w piśmie, nie dopisując nowych faktów spoza akt:",
    ...gaps.map((gap) => `- ${gap.element}: ${gap.detail}`)
  ].join("\n");
}
