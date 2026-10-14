import type { CitedDocument } from "./case-content-grounding.js";

// The judgment's or interpretation's text read against the user's question and what the
// answer says about it, the way a lawyer reads it in a conversation: does it concern the
// question, does it say what the answer claims. A separate model call judges; each verdict
// must quote the document word for word, and the application checks that quote, so a
// judge's own invention cannot pass as the document's content.

export type SemanticVerdict = {
  signature: string;
  topic: "MATCH" | "PARTIAL" | "NO_MATCH";
  claim: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED";
  reason: string;
  quote: string;
  // What the judge read as the thesis attributed to the document and as the question's
  // criteria: the verdict is about exactly these, and the correction names them.
  thesis?: string;
  criteria?: string;
};

export type SemanticCheck = {
  verdicts: SemanticVerdict[];
  // Verdicts whose quote is not in the document: not used.
  rejected: string[];
};

const MAX_DOCUMENTS = 4;
const HEAD_CHARS = 1_500;
const PASSAGE_CHARS = 900;
const BUDGET_CHARS = 8_000;

const fold = (value: string): string =>
  value.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L").toLocaleLowerCase("pl");
const squeeze = (value: string): string => fold(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const stems = (value: string): string[] => squeeze(value).split(" ").filter((word) => word.length >= 5).map((word) => word.slice(0, 6));

// Lines of a court portal around the document (ETPC base of the Ministry of Justice, SAOS, CBOSA).
const PORTAL_LINE =
  /browser is ancient|chrome frame|pliki?\s+cookies|cookies|liczba dokumentów w bazie|ostatnia aktualizacja|^\s*(?:metryka|treść|drukuj|pobierz|bip|x|d)\s*$/iu;
// Where the court's or authority's own assessment begins: what separates its view from a
// party's argument it reports.
const ASSESSMENT =
  /(?:sąd|izba|trybunał|organ|prezes(?:\s+urzędu)?|sąd najwyższy|sąd apelacyjny|sąd okręgowy|sąd rejonowy|sąd odwoławczy|krajowa izba odwoławcza)\s+(?:\p{L}+\s+){0,3}(?:zważył|zważyła|ustalił(?:a)?\s+i\s+zważył(?:a)?|uznał(?:a)?,|stwierdził(?:a)?,|podzielił(?:a)?|nie\s+podzielił(?:a)?)|ocena\s+stanowiska|uzasadnienie\s+interpretacji|stanowisko\s+organu|w\s+ocenie\s+(?:sądu|izby|trybunału|organu|prezesa)|apelacja\s+(?:nie\s+)?(?:jest|była|zasługiwała)|skarga\s+(?:kasacyjna\s+)?(?:nie\s+)?(?:jest|zasługuje|zasługiwała)|odwołanie\s+(?:nie\s+)?zasługuje|zarzut\p{L}*\s+(?:\p{L}+\s+){0,2}(?:okazał|nie\s+zasługuj|jest\s+bezzasadn|są\s+bezzasadn|chybion)/iu;

export function cleanText(text: string, keepLines = false): string {
  return text
    .replace(/\\[nrt]/g, "\n")
    .split(/\n+/u)
    .filter((line) => !PORTAL_LINE.test(line))
    .join("\n")
    .replace(keepLines ? /[^\S\n]+/g : /\s+/g, " ")
    .trim();
}

// Passages of whole sentences, so a sentence the judge must quote is not cut at a boundary.
function passages(plain: string): Array<{ at: number; text: string }> {
  const sentences = plain.match(/[^.!?;]+(?:[.!?;]+|$)\s*/gu) ?? [plain];
  const out: Array<{ at: number; text: string }> = [];
  let at = 0, current = "", start = 0;
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > PASSAGE_CHARS) {
      out.push({ at: start, text: current.trim() });
      start = at;
      current = "";
    }
    current += sentence;
    at += sentence.length;
  }
  if (current.trim()) out.push({ at: start, text: current.trim() });
  return out;
}

/** The document's head (court, date, subject), the start of the court's own assessment and
 * the passages closest to the question and claim, weighted by how rare their words are. */
export function relevantExcerpt(text: string, question: string, claim: string): string {
  const plain = cleanText(text);
  if (plain.length <= BUDGET_CHARS) return plain;
  const head = plain.slice(0, HEAD_CHARS).replace(/\s\S*$/u, "");
  const rest = passages(plain.slice(head.length));
  const df = new Map<string, number>();
  const passageStems = rest.map((passage) => new Set(stems(passage.text)));
  for (const set of passageStems) for (const stem of set) df.set(stem, (df.get(stem) ?? 0) + 1);
  const wanted = new Set([...stems(question), ...stems(claim)]);
  const scored = rest.map((passage, index) => {
    let score = 0;
    for (const stem of passageStems[index]!) if (wanted.has(stem)) score += Math.log(1 + rest.length / (df.get(stem) ?? 1));
    return { ...passage, index, score };
  });
  const chosen = new Set<number>();
  // The court's assessment: the first passage where it begins, and the next one.
  const assessment = scored.find((passage) => ASSESSMENT.test(passage.text));
  if (assessment) {
    chosen.add(assessment.index);
    if (assessment.index + 1 < scored.length) chosen.add(assessment.index + 1);
  }
  let used = head.length + [...chosen].reduce((sum, index) => sum + scored[index]!.text.length, 0);
  for (const passage of [...scored].filter((item) => item.score > 0).sort((a, b) => b.score - a.score)) {
    if (chosen.has(passage.index)) continue;
    if (used + passage.text.length > BUDGET_CHARS) continue;
    chosen.add(passage.index);
    used += passage.text.length;
  }
  const parts: string[] = [head];
  let previous = -2;
  for (const index of [...chosen].sort((a, b) => a - b)) {
    parts.push(index === previous + 1 ? scored[index]!.text : `[…] ${scored[index]!.text}`);
    previous = index;
  }
  return parts.join("\n");
}

// Who says what in the document: only the competent authority's decision (operative part,
// thesis, its own reasoning) can support "the court/organ held". A party's argument, an
// appeal ground, an applicant's view the organ rejected or a dissent cannot.
export type PassageRole =
  | "ROZSTRZYGNIĘCIE"
  | "TEZA"
  | "OCENA ORGANU ORZEKAJĄCEGO"
  | "OCENA SĄDU NIŻSZEJ INSTANCJI"
  | "STANOWISKO STRONY"
  | "ZDANIE ODRĘBNE"
  | "INNE";

// A party, an appellant or an applicant reporting its own view. "W skardze/apelacji..." counts
// only at the start of a sentence: mid-sentence it is the authority answering the ground
// ("Przyjmując układ argumentacji podniesionej w odwołaniu Izba wskazuje"; MATCH-250).
const PARTY_ACTOR =
  "(?:skarżąc|powod(?!ach|u(?![\\p{L}])|y(?![\\p{L}]))|powód|powódk|pozwan|odwołując|apelując|apelant|obrońc|oskarżon|obwinion|wnioskodawc|uczestni|wnoszą\\p{L}*\\s+kasacj|zamawiając|przystępując|wierzyciel|dłużni|administrator|bank|rząd|prokurator)";
const PARTY_VERB =
  "(?:podn\\p{L}*|twierdzi\\p{L}*|wniósł|wniosł\\p{L}*|wnieśli|wnieść|wnos\\p{L}*|zarzuci\\p{L}*|zarzuca\\p{L}*|uważa\\p{L}*|argumentowa\\p{L}*|wskazywa\\p{L}*|wskaza\\p{L}*|wskazuje|stwierdzi\\p{L}*|stwierdza|zaznaczy\\p{L}*|zaznacza|podkreśli\\p{L}*|przedstawi\\p{L}*|wyrazi\\p{L}*|domaga\\p{L}*|kwestionowa\\p{L}*|zaskarży\\p{L}*|oświadczy\\p{L}*|wywodzi\\p{L}*|wywi\\p{L}*|zaj\\p{L}*\\s+stanowisko|wyjaśni\\p{L}*|przyzna\\p{L}*|nie\\s+przyzna\\p{L}*|powoła\\p{L}*|podkreśla\\p{L}*|akcentowa\\p{L}*)";
const LEAD = "^\\s*(?:(?:ponadto|natomiast|nadto|dodatkowo|również|także|następnie|jednocześnie|z\\s+kolei|dalej|wreszcie|zaś|również\\s+też),?\\s+){0,2}";
const PARTY = new RegExp(
  [
    `${LEAD}w\\s+(?:pozwie|wniosku\\s+o\\s+wszczęcie|skardze|apelacji|kasacji|odwołaniu|zażaleniu|sprzeciwie|odpowiedzi\\s+na|piśmie\\s+procesowym|postępowaniu\\s+głównym|uzasadnieniu\\s+(?:wniesionego|skargi|apelacji|odwołania|kasacji|zażalenia))`,
    `${LEAD}${PARTY_ACTOR}\\p{L}*(?:\\s+[\\p{L}.()\\d]+){0,4}\\s+${PARTY_VERB}`,
    `(?<![\\p{L}\\p{N}])(?:zdaniem|według|w\\s+ocenie|w\\s+opinii)\\s+(?:(?:strony|spółki|szkoły|administratora)(?![\\p{L}\\p{N}])|${PARTY_ACTOR})`,
    `(?![\\p{L}\\p{N}])${PARTY_ACTOR}\\p{L}*\\s+${PARTY_VERB}`,
    `^\\s*zarzuci\\p{L}*\\s+w\\s+(?:zażaleniu|apelacji|skardze|kasacji|odwołaniu)`,
    `^\\s*zaznaczyć\\s+zarzuty`,
    `^\\s*(?:apelacj\\p{L}*|kasacj\\p{L}*|skarg\\p{L}*(?:\\s+kasacyjn\\p{L}*)?|zażaleni\\p{L}*|odwołani\\p{L}*|sprzeciw)\\s+(?:od\\s+.{0,120}?\\s+)?(?:wniósł|wniosła|wnieśli|wniosło|złożył\\p{L}*|wywiódł|wywiodła|wywiedli)(?![\\p{L}\\p{N}])`,
    `^\\s*(?:zarzut|wniosek)\\s*(?:$|o(?![\\p{L}\\p{N}])|\\d|[:.])`,
    `\\b(?:sąd\\s+pytający|pytający\\s+sąd)(?![\\p{L}\\p{N}])`,
    `stanowisko\\s+wnioskodawcy`,
    `organ\\s+(?:w\\s+odpowiedzi|podatkowy\\s+twierdził|twierdził)`
  ].join("|"),
  "iu"
);

// The competent authority speaking in its own voice: its reasoning verbs, its verdict on a
// ground ("Zarzut ... jest częściowo zasadny"), the official appeal form's answer heading.
const AUTHORITY_VERB =
  "(?:zważył\\p{L}*|uznał\\p{L}*|uznaje|stwierdza|stwierdził\\p{L}*|wskazuje|wskazał\\p{L}*|podziela|podzielił\\p{L}*|nie\\s+podziela|nie\\s+podzielił\\p{L}*|przyjął|przyjęła|przyjmuje|ustalił\\p{L}*|ocenia|ocenił\\p{L}*|doszedł|doszła|rozważył\\p{L}*|zauważa|zauważył\\p{L}*|konstatuje|nie\\s+znalazł\\p{L}*|nie\\s+dopatrzył\\p{L}*)";
const AUTHORITY = new RegExp(
  [
    `\\bzważ(?:ył|yła|yli|ając)(?![\\p{L}\\p{N}])`,
    `(?<![\\p{L}\\p{N}])(?:sąd|izba|trybunał|prezes\\s+(?:urzędu|uodo)|organ\\s+interpretacyjny|dyrektor\\s+krajowej\\s+informacji\\s+skarbowej)(?:\\s+\\p{L}+){0,4}?\\s+${AUTHORITY_VERB}`,
    `\\bw\\s+ocenie\\s+(?:sądu|izby|trybunału|prezesa|organu)`,
    `\\bocena\\s+stanowiska(?![\\p{L}\\p{N}])|\\buzasadnienie\\s+interpretacji(?![\\p{L}\\p{N}])|\\bna\\s+wstępie\\s+rozważań|\\brozważania\\s+(?:sądu|izby)`,
    `\\bzarzut\\p{L}*(?:\\s+\\S+){0,16}?\\s+(?:jest|są|był|była|okazał\\p{L}*|nie\\s+jest|nie\\s+są|nie\\s+był|nie\\s+zasługuj\\p{L}*)\\s+(?:częściowo\\s+|w\\s+pełni\\s+|całkowicie\\s+)?(?:zasadn|niezasadn|bezzasadn|chybion|trafn|nietrafn|na\\s+uwzględnienie|uzasadnion|nieuzasadnion)`,
    `\\bzarzut\\p{L}*\\s+(?:ten|te)(?![\\p{L}\\p{N}])`,
    `(?<![\\p{L}\\p{N}])(?:(?:ocenić|uznać)\\s+należy|należy\\s+(?:go\\s+|je\\s+|ją\\s+)?(?:ocenić|uznać))\\s+(?:jako|za)\\s+(?:częściowo\\s+)?(?:zasadn|niezasadn|bezzasadn|chybion|trafn|nietrafn|uzasadnion|nieuzasadnion)`,
    `(?<![\\p{L}\\p{N}])(?:apelacja|kasacja|skarga(?:\\s+kasacyjna)?|odwołanie|zażalenie)(?:\\s+\\p{L}+){0,4}?\\s+(?:jest|okazał\\p{L}*|nie\\s+jest|nie\\s+zasługuj\\p{L}*|zasługuj\\p{L}*|podlega\\p{L}*)\\s+(?:częściowo\\s+)?(?:zasadn|niezasadn|bezzasadn|oczywiście|na\\s+uwzględnienie|uwzględnieniu|oddaleniu|odrzuceniu)`,
    `(?<![\\p{L}\\p{N}])(?:powyższe|takie|to)\\s+stanowisko\\s+(?:jest|nie\\s+jest)(?![\\p{L}\\p{N}])|\\bwbrew\\s+stanowisku(?![\\p{L}\\p{N}])|\\bz\\s+takim\\s+poglądem\\s+nie(?![\\p{L}\\p{N}])|\\bnie\\s+sposób\\s+(?:się\\s+)?zgodzić`,
    `\\bzwięźle\\s+o\\s+powodach`
  ].join("|"),
  "iu"
);

// The operative part: a verb of decision opening the sentence ("Oddala apelację"), not a
// provision's own wording recalled in the reasoning ("Nakazuje on stosować...").
const OPERATIVE = /^\s*(?:\p{Lu}[\p{L} ]{0,80}\s)?(?:orzeka|postanawia|oddala|uchyla|zasądza|umarza|uwzględnia|odrzuca|nakłada|nakazuje|zobowiązuje|stwierdza nieważność|zmienia|uniewinnia|odmawia)(?![\p{L}\p{N}])(?!\s+(?:on|ona|ono|one|to|ten|ta|te|przepis|ustawa|się)(?![\p{L}\p{N}]))/iu;

// Who speaks to the court rather than for it: the referring court of a question of law, the
// participants of a constitutional review, an organ answering a complaint.
const PARTICIPANT = new RegExp(
  [
    `\\b(?:sąd\\s+pytający|pytający\\s+sąd)(?![\\p{L}\\p{N}])`,
    `^\\s*(?:\\p{L}+,?\\s+){0,2}(?:prokurator\\s+generalny|rzecznik\\s+praw\\s+obywatelskich|marszałek\\s+sejmu|sejm|minister\\p{L}*|prezes\\s+rady\\s+ministrów|wnioskodawc\\p{L}*|skarżąc\\p{L}*|uczestni\\p{L}*)(?![\\p{L}\\p{N}]).{0,140}?(?<![\\p{L}\\p{N}])(?:zaj\\p{L}*\\s+stanowisko|wni\\p{L}*|wnosi\\p{L}*|wskaza\\p{L}*|wskazuje|stwierdzi\\p{L}*|podkreśli\\p{L}*|uzna\\p{L}*|uważa\\p{L}*|twierdzi\\p{L}*|zarzuci\\p{L}*|podni\\p{L}*|przedstawi\\p{L}*)`
  ].join("|"),
  "iu"
);

// The authority adopting or rejecting a party's view ("Sąd przychylił się do stanowiska
// powoda", "Słusznie skarżący podnosi", "Należy zgodzić się z apelującym", "Zarzuty apelacji
// okazały się zasadne"): the authority's own voice, though the sentence names the party.
const ENDORSEMENT = new RegExp(
  [
    `^\\s*(?:\\p{L}+,?\\s+){0,2}?(?:słusznie|trafnie|zasadnie|prawidłowo|niesłusznie|nietrafnie|niezasadnie|bezzasadnie|bezpodstawnie|chybion\\p{L}*\\s+jest|rację\\s+ma\\p{L}*|ma\\p{L}*\\s+rację|nie\\s+ma\\p{L}*\\s+racji)(?![\\p{L}\\p{N}])`,
    `\\b(?:należy|trzeba|wypada|można)\\s+(?:więc\\s+|zatem\\s+|w\\s+pełni\\s+)?(?:się\\s+)?(?:zgodzić|podzielić|przyznać\\s+rację|odmówić\\s+racji)`,
    `\\bnie\\s+sposób\\s+(?:(?:się\\s+)?zgodzić|odmówić\\s+racji|podzielić)`,
    `\\b(?:sąd|izba|trybunał|organ|prezes)(?:\\s+[\\p{L}.]+){0,4}?\\s+(?:nie\\s+)?(?:przychyl\\p{L}*|podziel\\p{L}*|podziela|zgodzi\\p{L}*|zgadza|aprobuje|zaaprobowa\\p{L}*|uwzględni\\p{L}*|odrzuci\\p{L}*|przyj\\p{L}*\\s+za\\s+własn\\p{L}*)`,
    `\\b(?:stanowisk\\p{L}*|argumentacj\\p{L}*|twierdzeni\\p{L}*|zarzut\\p{L}*|wywod\\p{L}*|pogląd\\p{L}*|apelacj\\p{L}*|kasacj\\p{L}*|skarg\\p{L}*|odwołani\\p{L}*|zażaleni\\p{L}*|wnios\\p{L}*)(?:\\s+[\\p{L}.]+){0,4}?\\s+(?:nie\\s+)?(?:zasługuj\\p{L}*\\s+na\\s+(?:aprobatę|uwzględnienie|podzielenie|akceptację)|okazał\\p{L}*\\s+się\\s+(?:częściowo\\s+)?(?:zasadn|bezzasadn|niezasadn|trafn|chybion|słuszn|uzasadnion)\\p{L}*|(?:jest|są|był\\p{L}*)\\s+(?:częściowo\\s+)?(?:zasadn|bezzasadn|niezasadn|trafn|nietrafn|chybion|słuszn|niesłuszn|uzasadnion|nieuzasadnion)\\p{L}*)`
  ].join("|"),
  "iu"
);
// A sentence that opens as a party's report stays the party's, whatever court it describes
// ("Skarżący zarzucił, że Sąd nie uwzględnił wniosku"); an evaluative opening is the authority's.
const ENDORSEMENT_LEAD =
  /^\s*(?:\p{L}+,?\s+){0,2}?(?:słusznie|trafnie|zasadnie|prawidłowo|niesłusznie|nietrafnie|niezasadnie|bezzasadnie|bezpodstawnie|rację\s+ma\p{L}*|nie\s+ma\p{L}*\s+racji|(?:należy|trzeba|wypada)\s+(?:więc\s+|zatem\s+)?(?:się\s+)?(?:zgodzić|podzielić|przyznać\s+rację|odmówić\s+racji))(?![\p{L}\p{N}])/iu;
const PARTY_OPENING = new RegExp(
  `${LEAD}(?:w\\s+(?:pozwie|skardze|apelacji|kasacji|odwołaniu|zażaleniu|sprzeciwie|odpowiedzi)|(?:zdaniem|według|w\\s+ocenie|w\\s+opinii)\\s+${PARTY_ACTOR}|(?:[\\p{L},]+\\s+){0,4}?${PARTY_ACTOR}\\p{L}*(?:\\s+[\\p{L}.()\\d]+){0,4}\\s+${PARTY_VERB})`,
  "iu"
);
// "Skarżący trafnie zarzuca", "W skardze kasacyjnej słusznie podniesiono": the verdict on the ground.
const ENDORSED_GROUND =
  /^.{0,80}?(?<![\p{L}\p{N}])(?:słusznie|trafnie|zasadnie|niesłusznie|nietrafnie|niezasadnie|bezzasadnie|bezpodstawnie)\s+(?:\p{L}+\s+){0,2}?(?:podn\p{L}*|zarzuc\p{L}*|zarzuci\p{L}*|wskaz\p{L}*|twierdz\p{L}*|wywod\p{L}*|kwestionu\p{L}*|kwestionowa\p{L}*|argumentu\p{L}*|domaga\p{L}*)/iu;
const endorses = (sentence: string): boolean =>
  ENDORSEMENT_GATE.test(sentence) &&
  (ENDORSEMENT_LEAD.test(sentence) || ENDORSED_GROUND.test(sentence) || (!PARTY_OPENING.test(sentence) && ENDORSEMENT.test(sentence)));
const authoritySpeaks = (sentence: string): boolean => AUTHORITY_GATE.test(sentence) && !PARTY_OPENING.test(sentence) && AUTHORITY.test(sentence);
const ENDORSEMENT_GATE = /słuszn|trafn|zasadn|prawidłow|bezpodstawn|chybion|racj|zgodzić|zgadza|podziel|przychyl|aprob|uwzględni|odrzuci|własn|zasługuj|okazał/iu;

// Cheap keyword gates: the full patterns run only on sentences that can match them.
const PARTY_GATE = /skarż|powod|powód|pozwan|odwołuj|apel|obroń|obrońc|oskarż|obwin|wniosk|uczestn|wnosz|zamawiaj|przystęp|wierzyc|dłużn|administr|bank|rząd|prokur|zdaniem|według|ocenie|opinii|zarzu|zaznaczyć|wniosek|stanowisk|organ|pozwie|skard|kasacj|zażal|sprzeciw|odwoła|piśmie|postępowaniu\s+głównym/iu;
const AUTHORITY_GATE = /zważ|sąd|izb|trybunał|prezes|organ|dyrektor|ocen|rozważa|zarzut|należy|apelacj|kasacj|skarg|odwołani|zażaleni|stanowisk|wbrew|pogląd|sposób|zwięźle/iu;
const gated = (gate: RegExp, pattern: RegExp): RegExp => ({ test: (text: string) => gate.test(text) && pattern.test(text) }) as RegExp;
const OPERATIVE_GATE = /orzeka|postanawia|oddala|uchyla|zasądza|umarza|uwzględnia|odrzuca|nakłada|nakazuje|zobowiązuje|stwierdza|zmienia|uniewinnia|odmawia/iu;
const PARTICIPANT_GATE = /pytając|prokurator|rzecznik|marszałek|sejm|minister|prezes\s+rady|wnioskodawc|skarżąc|uczestni/iu;
const isOperative = (sentence: string): boolean => OPERATIVE_GATE.test(sentence.slice(0, 120)) && OPERATIVE.test(sentence);

const ROLE_MARKERS: Array<[RegExp, PassageRole]> = [
  [/^\s*zdanie\s+odrębne/iu, "ZDANIE ODRĘBNE"],
  [/stanowisk\p{L}*[^.]{0,160}?\bjest\s+(?:nie)?prawidłow\p{L}*/iu, "ROZSTRZYGNIĘCIE"],
  [/^\s*(?:sentencja|teza)(?![\p{L}\p{N}])/iu, "TEZA"],
  [{ test: isOperative } as RegExp, "ROZSTRZYGNIĘCIE"],
  [{ test: endorses } as RegExp, "OCENA ORGANU ORZEKAJĄCEGO"],
  [gated(PARTICIPANT_GATE, PARTICIPANT), "STANOWISKO STRONY"],
  [{ test: authoritySpeaks } as RegExp, "OCENA ORGANU ORZEKAJĄCEGO"],
  [gated(PARTY_GATE, PARTY), "STANOWISKO STRONY"]
];

// Court levels, to tell the issuing court's own view from the one it reviews: "Sąd Okręgowy
// uznał" in a Supreme Court cassation judgment is the reviewed view, not the holding.
const COURT_LEVELS: Array<[RegExp, number]> = [
  [/(?<![\p{L}\p{N}])Sąd(?:u|em)?\s+Najwyższ\p{L}*|(?<![\p{L}\p{N}])Naczeln\p{L}*\s+Sąd\p{L}*\s+Administracyjn\p{L}*/iu, 4],
  [/(?<![\p{L}\p{N}])Sąd(?:u|em)?\s+Apelacyjn\p{L}*|(?<![\p{L}\p{N}])Wojewódzk\p{L}*\s+Sąd\p{L}*\s+Administracyjn\p{L}*/iu, 3],
  [/(?<![\p{L}\p{N}])Sąd(?:u|em)?\s+Okręgow\p{L}*|(?<![\p{L}\p{N}])Krajow\p{L}*\s+Izb\p{L}*\s+Odwoławcz\p{L}*/iu, 2],
  [/(?<![\p{L}\p{N}])Sąd(?:u|em)?\s+Rejonow\p{L}*/iu, 1]
];

function issuingLevel(text: string): number | null {
  const head = text.slice(0, 600);
  let best: { at: number; level: number } | null = null;
  for (const [pattern, level] of COURT_LEVELS) {
    const at = head.search(pattern);
    if (at >= 0 && (!best || at < best.at)) best = { at, level };
  }
  return best?.level ?? null;
}

/** The sentence names a court below the issuing one as the one that held something. */
function lowerCourtView(sentence: string, level: number): boolean {
  if (!/sąd/iu.test(sentence.slice(0, 120))) return false;
  const found = /(?<![\p{L}\p{N}])(sąd\p{L}*(?:\s+(?!uznał|uznała|przyjął|przyjęła|stwierdził|stwierdziła|ustalił|ustaliła|ocenił|oceniła|wskazał|wskazała|doszedł|doszła|zważył|orzekł|wyraził|oddalił|zasądził|uwzględnił|uchylił|zmienił|umorzył)[\p{L}()]+\.?){0,4}?),?\s+(?:uznał|uznała|przyjął|przyjęła|stwierdził|stwierdziła|ustalił|ustaliła|ocenił|oceniła|wskazał|wskazała|doszedł|doszła|zważył|orzekł|wyraził|oddalił|zasądził|uwzględnił|uchylił|zmienił|umorzył)(?![\p{L}\p{N}])/iu.exec(sentence);
  if (!found || found.index > 60) return false;
  const subject = found[1]!;
  if (/(?<![\p{L}\p{N}])(?:słusznie|trafnie|prawidłowo|zasadnie|niesłusznie|nietrafnie|nieprawidłowo|błędnie|wadliwie|bezpodstawnie|wbrew)(?![\p{L}\p{N}])/iu.test(sentence)) return false;
  if (/(?<![\p{L}\p{N}])(?:meriti|pierwszej\s+instancji|I\s+instancji|niższej\s+instancji)(?![\p{L}\p{N}])/iu.test(subject)) return level >= 2;
  if (/\bodwoławcz\p{L}*|\bdrugiej\s+instancji|(?<![\p{L}\p{N}])II\s+instancji/iu.test(subject)) return level === 4;
  const named = COURT_LEVELS.find(([pattern]) => pattern.test(subject))?.[1];
  return named !== undefined && named < level;
}

const LIST_ITEM = /^\s*(?:[•\-–—*▪]|\d{1,2}[.)]|[a-z]\)|[IVX]{1,4}\.)\s/u;
const QUOTE_OPEN = /[„“«]/gu;
const QUOTE_CLOSE = /[”»"]/gu;
const PARTY_GOES_ON = /^\s*(?:\p{L}+,?\s+){0,4}?(?:podni\p{L}*|wni\p{L}*|zarzuci\p{L}*|argumentowa\p{L}*|twierdzi\p{L}*|wywodzi\p{L}*|wywi\p{L}*|domaga\p{L}*|akcentowa\p{L}*)(?![\p{L}\p{N}])/iu;

/** The text in sentences, each with the role of the passage it stands in. Once the
 * authority's own assessment has begun, a party marker holds to the end of its paragraph
 * (and the list items it introduces): the authority recalls a ground, then answers it.
 * A sentence inside a quotation keeps the role of the sentence that opened it. */
export function passageRoles(text: string): Array<{ role: PassageRole; text: string }> {
  // Hard line breaks inside a sentence (SAOS, portals) and after an abbreviation join the
  // sentence back; a line that ends a sentence, a heading or a form box stays its own.
  const plain = text
    .replace(/\\[nrt]/g, "\n")
    .replace(/[ \t]*\n+[ \t]*(?=[\p{Ll}\d§(„"])/gu, (gap, at: number, all: string) => {
      const before = all.slice(Math.max(0, at - 8), at);
      const next = all.slice(at + gap.length, at + gap.length + 14);
      if (/^(?:orzeka|postanawia|oddala|uchyla|zasądza|umarza|uwzględnia|odrzuca|nakłada|nakazuje|zobowiązuje|stwierdza|zmienia|uniewinnia|odmawia)(?![\p{L}\p{N}])/u.test(next)) return gap;
      if (/[^\n.;:!?☐☒]$/u.test(before)) return " ";
      return /(?:^|[^\p{L}\p{N}])\p{L}{1,5}\.$/u.test(before) && /^[\p{Ll}\d§]/u.test(next) ? " " : gap;
    });
  const level = issuingLevel(plain);
  const out: Array<{ role: PassageRole; text: string }> = [];
  let current: PassageRole = "INNE";
  let assessing = false;
  let dissent = false;
  let quoteDepth = 0;
  let quoteRole: PassageRole = "INNE";
  let carry = false;
  let quoteLines = 0;
  for (const line of plain.split(/\n+/u)) {
    if (!line.trim()) continue;
    // An unclosed quotation mark (a stray „ in a portal text) must not carry a role through the
    // rest of the document: a quotation runs over at most three lines.
    quoteLines = quoteDepth > 0 ? quoteLines + 1 : 0;
    if (quoteLines > 3) quoteDepth = 0;
    const reported = current === "STANOWISKO STRONY" || current === "OCENA SĄDU NIŻSZEJ INSTANCJI";
    if (/^\s*uzasadnienie\s*$/iu.test(line) && !dissent) current = "INNE";
    if (!dissent && reported && !carry && !LIST_ITEM.test(line) && !(current === "STANOWISKO STRONY" && PARTY_GOES_ON.test(line))) current = assessing ? "OCENA ORGANU ORZEKAJĄCEGO" : "INNE";
    const sentences = line.split(/(?<=[.;!?])(?<!(?:^|[\s(])\p{Lu}\.)(?<!(?<![\p{L}\p{N}])(?:r|art|ust|pkt|poz|sygn|nr|tj|np|tzw|ok|zm|Dz|U|par|lit|godz|zł|ww|t|k|p|c|s|w|m\.in)\.)\s+/u).map((sentence) => sentence.trim()).filter(Boolean);
    for (const sentence of sentences) {
      const inQuote = quoteDepth > 0;
      quoteDepth = Math.max(0, quoteDepth + (sentence.match(QUOTE_OPEN)?.length ?? 0) - (sentence.match(QUOTE_CLOSE)?.length ?? 0));
      if (dissent) {
        out.push({ role: "ZDANIE ODRĘBNE", text: sentence });
        continue;
      }
      if (inQuote) {
        out.push({ role: quoteRole, text: sentence });
        continue;
      }
      let marked = ROLE_MARKERS.find(([pattern]) => pattern.test(sentence))?.[1];
      if (marked === "ROZSTRZYGNIĘCIE" && assessing && isOperative(sentence)) marked = undefined;
      if (level !== null && (marked === "OCENA ORGANU ORZEKAJĄCEGO" || marked === undefined) && lowerCourtView(sentence, level)) marked = "OCENA SĄDU NIŻSZEJ INSTANCJI";
      if (marked === "ZDANIE ODRĘBNE") {
        dissent = true;
        out.push({ role: marked, text: sentence });
        continue;
      }
      if (marked === "OCENA ORGANU ORZEKAJĄCEGO" && !endorses(sentence)) assessing = true;
      if (marked) current = marked;
      if (quoteDepth > 0) quoteRole = current;
      out.push({ role: current, text: sentence });
    }
    // A party line that announces what follows ("zarzucając:", the appeal form's "Wniosek")
    // carries its role to the next line.
    carry = current === "STANOWISKO STRONY" && /(?::\s*$|^\s*(?:zarzut|wniosek)\s*$)/iu.test(line);
  }
  return out;
}

const DECISIVE: PassageRole[] = ["ROZSTRZYGNIĘCIE", "TEZA"];

// What the case is about, as the document or its register entry names it ("w przedmiocie
// udostępnienia informacji publicznej", CBOSA "Hasła tematyczne", EUREKA "Temat
// interpretacji"). Pinned at the top of the excerpt: the judge reads it first and it is never
// cut out of a long document (calibration 2026-10-13: a separate subject-only call is safe but
// costs more than it saves when checking an answer).
const SUBJECT_PATTERNS = [
  /(?:Sprawa\s+ze\s+skargi|skargi|odwołania|wniosku)[^.\n]{0,200}?\bw\s+przedmiocie\s+[^.\n]{5,200}/iu,
  /\bw\s+przedmiocie\s+[^.\n]{5,200}/iu,
  /\bHasła\s+tematyczne\s*[:\-]?\s*[^\n]{3,200}/iu,
  /\bTemat\s+interpretacji\s*[:\-]?\s*[^\n]{3,200}/iu,
  /\bprzedmiot(?:\s+sprawy)?\s*[:\-]\s*[^\n]{3,200}/iu,
  /\bw\s+sprawie\s+(?:z\s+powództwa|ze\s+skargi|z\s+wniosku)[^.\n]{5,240}/iu
];

export function caseSubject(text: string): string | null {
  const plain = text.replace(/\\[nrt]/g, "\n");
  for (const pattern of SUBJECT_PATTERNS) {
    const found = pattern.exec(plain)?.[0]?.trim();
    if (found) return found.replace(/\s+/g, " ");
  }
  return null;
}

/** Passages labelled by role, chosen as relevantExcerpt chooses them: the heading, the
 * decision, the start of the authority's own assessment, then the passages whose rare words
 * the question and the claim share, within the same budget, without the portal's chrome. */
export function roleExcerpt(text: string, question: string, claim: string): string {
  const passages: Array<{ role: PassageRole; text: string; index: number }> = [];
  for (const sentence of passageRoles(cleanText(text, true))) {
    const last = passages.at(-1);
    if (last && last.role === sentence.role && last.text.length + sentence.text.length < PASSAGE_CHARS) last.text += ` ${sentence.text}`;
    else passages.push({ ...sentence, index: passages.length });
  }
  const label = (passage: { role: PassageRole; text: string }) => `[${passage.role}] ${passage.text}`;
  const subject = caseSubject(text);
  const pinned = subject ? `[OKREŚLENIE SPRAWY] ${subject}\n` : "";
  if (passages.reduce((sum, passage) => sum + passage.text.length, 0) <= BUDGET_CHARS) return pinned + passages.map(label).join("\n");
  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number): void => {
    const passage = passages[index];
    if (!passage || chosen.has(index) || used + passage.text.length > BUDGET_CHARS) return;
    chosen.add(index);
    used += passage.text.length;
  };
  for (const passage of passages) {
    if (used >= HEAD_CHARS) break;
    take(passage.index);
  }
  for (const passage of passages.filter((item) => DECISIVE.includes(item.role)).slice(0, 3)) take(passage.index);
  // The start of the authority's reasoning ("zważył, co następuje") first; any passage labelled
  // as its assessment only when the document has no such heading.
  const assessment =
    passages.find((item) => !chosen.has(item.index) && ASSESSMENT.test(item.text)) ??
    passages.find((item) => !chosen.has(item.index) && item.role === "OCENA ORGANU ORZEKAJĄCEGO");
  if (assessment) {
    take(assessment.index);
    take(assessment.index + 1);
  }
  const passageStems = passages.map((passage) => new Set(stems(passage.text)));
  const df = new Map<string, number>();
  for (const set of passageStems) for (const stem of set) df.set(stem, (df.get(stem) ?? 0) + 1);
  const wanted = new Set([...stems(question), ...stems(claim)]);
  const scored = passages
    .map((passage) => {
      let score = 0;
      for (const stem of passageStems[passage.index]!) if (wanted.has(stem)) score += Math.log(1 + passages.length / (df.get(stem) ?? 1));
      return { index: passage.index, score: score + (passage.role === "OCENA ORGANU ORZEKAJĄCEGO" ? 0.5 : 0) };
    })
    .filter((item) => item.score > 0.5)
    .sort((a, b) => b.score - a.score);
  for (const item of scored) {
    take(item.index);
    // A reported view (a party's, the reviewed court's) comes with the authority's answer to it.
    const passage = passages[item.index]!;
    const next = passages[item.index + 1];
    if (chosen.has(item.index) && (passage.role === "STANOWISKO STRONY" || passage.role === "OCENA SĄDU NIŻSZEJ INSTANCJI") && next?.role === "OCENA ORGANU ORZEKAJĄCEGO") take(next.index);
  }
  const parts: string[] = [];
  let previous = -2;
  for (const index of [...chosen].sort((a, b) => a - b)) {
    parts.push(index === previous + 1 ? label(passages[index]!) : `[…]\n${label(passages[index]!)}`);
    previous = index;
  }
  return pinned + parts.join("\n").replace(/^\[…\]\n/u, "");
}

// The competent authority's decision, not a party's claim.
export const AUTHORITY_RULE =
  "Twierdzenie, że sąd lub organ coś orzekł, uznał lub przyjął, popiera wyłącznie rozstrzygnięcie, teza albo własne rozważania właściwego organu orzekającego. " +
  "Argument strony, zarzut skargi, apelacji lub kasacji, pogląd sądu niższej instancji relacjonowany przez sąd wyższy, stanowisko organu będącego stroną sporu sądowego, stanowisko wnioskodawcy uznane za nieprawidłowe i zdanie odrębne " +
  "nie są stanowiskiem organu — przypisanie ich sądowi lub organowi to UNSUPPORTED. " +
  "Wyjątek: organ przyjął to stanowisko we własnym zdaniu (np. „stanowisko wnioskodawcy jest prawidłowe”, „Sąd przychylił się do stanowiska powoda”, „słusznie skarżący podnosi”, „należy zgodzić się z apelującym”, „zarzut okazał się zasadny”) — wtedy przyjęta treść jest stanowiskiem organu w zakresie, w jakim ją przyjął; " +
  "gdy organ je odrzucił („niesłusznie”, „nie podzielił”, „zarzut chybiony”), twierdzenie odpowiedzi, że organ tak uznał, to UNSUPPORTED. ";

export const ROLE_LEGEND =
  "Fragmenty tekstu mają w nawiasach kwadratowych rolę nadaną mechanicznie przez aplikację (OKREŚLENIE SPRAWY, ROZSTRZYGNIĘCIE, TEZA, OCENA ORGANU ORZEKAJĄCEGO, OCENA SĄDU NIŻSZEJ INSTANCJI, STANOWISKO STRONY, ZDANIE ODRĘBNE, INNE); " +
  "określenie sprawy mówi, czego dotyczy dokument — gdy wyraźnie wskazuje inny problem niż pytanie, to NO_MATCH; " +
  "traktuj ją jako wskazówkę, a w razie sprzeczności z treścią rozstrzyga treść. Cytat w polu quote kopiuj bez etykiety. ";

export const SEMANTIC_JUDGE_SYSTEM =
  "OCENA ZGODNOŚCI ORZECZEŃ, INTERPRETACJI I PRZEPISÓW Z PYTANIEM. Jesteś kontrolerem, nie autorem odpowiedzi. " +
  "Dla każdego dokumentu oceń wyłącznie na podstawie jego podanego tekstu: (1) topic — czy dokument dotyczy problemu z pytania użytkownika " +
  "(MATCH: tak; PARTIAL: dotyczy tylko części kryteriów pytania, np. innego podmiotu lub innego sądu niż pytany; NO_MATCH: innego problemu); " +
  "(2) claim — czy to, co odpowiedź mówi o dokumencie, wynika z jego tekstu (SUPPORTED: sens się zgadza, także przy parafrazie lub innych słowach; " +
  "PARTIAL: część twierdzenia nie wynika z tekstu albo pominięto istotne zastrzeżenie; UNSUPPORTED: tekst mówi co innego lub odwrotnie). " +
  "Różnica słów przy tym samym sensie to nie PARTIAL. Oceniaj to, co odpowiedź mówi o treści i rozstrzygnięciu; dane identyfikacyjne " +
  "(sąd wynikający z sygnatury, data, rodzaj orzeczenia) sprawdza osobno aplikacja — ich brak w podanym fragmencie nie jest powodem do PARTIAL. " +
  "Zanim ocenisz, zdefiniuj przedmiot oceny: criteria — kryteria, które pytanie rzeczywiście stawia (problem prawny; jeżeli pytanie je wskazuje: sąd lub organ, " +
  "rodzaj dokumentu, okres, podmiot), bez dopisywania własnych; thesis — jedno zdanie: co dokładnie odpowiedź twierdzi o tym dokumencie (jego rozstrzygnięcie lub " +
  "stanowisko, które mu przypisuje), wiernie, bez dodawania i pomijania zastrzeżeń; gdy odpowiedź przypisuje dokumentowi kilka twierdzeń, ujmij wszystkie. " +
  "topic oceniaj względem criteria, claim względem thesis. " +
  "Pole quote: dosłowny fragment tekstu dokumentu (10–300 znaków), który najlepiej uzasadnia ocenę; kopiuj znak w znak, bez skracania w środku. " +
  "Nie korzystaj z wiedzy spoza podanego tekstu. Zwróć wyłącznie JSON: " +
  '{"verdicts":[{"signature":"…","criteria":"…","thesis":"…","topic":"MATCH|PARTIAL|NO_MATCH","claim":"SUPPORTED|PARTIAL|UNSUPPORTED","reason":"jedno zdanie po polsku","quote":"…"}]}';

const KIND_LABEL: Record<CitedDocument["kind"], string> = { case: "orzeczenie", interpretation: "interpretacja", other: "orzeczenie lub decyzja", statute: "przepis (brzmienie z ELI)" };

export type JudgeOptions = { roles?: boolean; fullText?: boolean };

export function semanticJudgePrompt(question: string, documents: CitedDocument[], options: JudgeOptions = {}): string {
  return [
    `PYTANIE UŻYTKOWNIKA (wątek):\n${question.trim()}`,
    ...documents.slice(0, MAX_DOCUMENTS).map((document, index) =>
      [
        `DOKUMENT D${index + 1}: ${KIND_LABEL[document.kind]} ${document.signature}`,
        `CO ODPOWIEDŹ MÓWI O NIM:\n${document.claim.trim()}`,
        options.fullText
          ? `TEKST DOKUMENTU (pełny):\n${document.text}`
          : `TEKST DOKUMENTU (fragmenty pobrane ze źródła):\n${options.roles ? roleExcerpt(document.text, question, document.claim) : relevantExcerpt(document.text, question, document.claim)}`
      ].join("\n\n")
    )
  ].join("\n\n---\n\n");
}

const TOPICS = new Set(["MATCH", "PARTIAL", "NO_MATCH"]);
const CLAIMS = new Set(["SUPPORTED", "PARTIAL", "UNSUPPORTED"]);

/**
 * The document a verdict names: the same signature, or the judge's longer form of it
 * ("art. 16 UDIP" for the cited "art. 16"); a form two documents share names neither.
 */
function verdictDocument(signature: string, documents: CitedDocument[]): CitedDocument | undefined {
  const named = squeeze(signature);
  if (!named) return undefined;
  const exact = documents.find((candidate) => squeeze(candidate.signature) === named);
  if (exact) return exact;
  const longer = documents.filter((candidate) => {
    const own = squeeze(candidate.signature);
    return own.length > 0 && named.startsWith(`${own} `);
  });
  return longer.length === 1 ? longer[0] : undefined;
}

/** The judge's JSON, each verdict kept only when its quote is in that document's text. */
export function parseSemanticVerdicts(output: string, documents: CitedDocument[]): SemanticCheck {
  const json = /\{[\s\S]*\}/u.exec(output)?.[0];
  let raw: unknown;
  try {
    raw = json ? JSON.parse(json) : null;
  } catch {
    raw = null;
  }
  const items = Array.isArray((raw as { verdicts?: unknown } | null)?.verdicts) ? ((raw as { verdicts: unknown[] }).verdicts) : [];
  const verdicts: SemanticVerdict[] = [];
  const rejected: string[] = [];
  for (const item of items) {
    const value = item as Partial<SemanticVerdict>;
    const document = verdictDocument(String(value.signature ?? ""), documents);
    if (!document || !TOPICS.has(String(value.topic)) || !CLAIMS.has(String(value.claim))) continue;
    const quote = String(value.quote ?? "").trim();
    if (quote.length < 10 || !squeeze(document.text).includes(squeeze(quote))) {
      rejected.push(document.signature);
      continue;
    }
    verdicts.push({
      signature: document.signature,
      topic: value.topic as SemanticVerdict["topic"],
      claim: value.claim as SemanticVerdict["claim"],
      reason: String(value.reason ?? "").trim().slice(0, 400),
      quote: quote.slice(0, 300),
      ...(typeof value.thesis === "string" && value.thesis.trim() ? { thesis: value.thesis.trim().slice(0, 500) } : {}),
      ...(typeof value.criteria === "string" && value.criteria.trim() ? { criteria: value.criteria.trim().slice(0, 300) } : {})
    });
  }
  return { verdicts, rejected };
}

// Correction when the document is off the question or the answer misstates it. A document
// that answers only part of the question, described faithfully, needs none (calibration
// 2026-10-13: such answers usually say so themselves).
export const semanticProblems = (check: SemanticCheck): SemanticVerdict[] =>
  check.verdicts.filter((verdict) => verdict.topic === "NO_MATCH" || verdict.claim !== "SUPPORTED");

export function semanticCorrectionPrompt(problems: SemanticVerdict[]): string {
  return [
    "KONTROLA ZGODNOŚCI Z PYTANIEM (aplikacja, na podstawie pobranego tekstu dokumentów):",
    ...problems.map(
      (problem) =>
        `- ${problem.signature}: temat ${problem.topic}, twierdzenie ${problem.claim}.${problem.criteria ? ` Kryteria pytania: ${problem.criteria}.` : ""}${problem.thesis ? ` Oceniona teza odpowiedzi: „${problem.thesis}”.` : ""} ${problem.reason} Tekst dokumentu: „${problem.quote}”`
    ),
    "Popraw odpowiedź: dokument, który nie dotyczy pytania (NO_MATCH), nie jest trafieniem — nie przedstawiaj go jako odpowiedzi na pytanie. Dokument częściowo zgodny (PARTIAL) opisz z nazwaniem brakującego kryterium. Twierdzenie niepoparte (UNSUPPORTED) usuń albo zastąp tym, co rzeczywiście jest w tekście.",
    "Gdy po poprawce żaden dokument nie odpowiada na pytanie, napisz wprost, że nie znaleziono orzeczenia ani interpretacji spełniającej kryteria, i co sprawdzono. Podaj pełną poprawioną odpowiedź."
  ].join("\n");
}

export function semanticWarning(problems: SemanticVerdict[]): string {
  const label = { MATCH: "dotyczy pytania", PARTIAL: "dotyczy pytania tylko częściowo", NO_MATCH: "nie dotyczy pytania" } as const;
  return problems
    .map(
      (problem) =>
        `⚠️ Kontrola aplikacji: ${problem.signature} ${label[problem.topic]}${problem.claim === "SUPPORTED" ? "" : "; opis w odpowiedzi nie w pełni wynika z jego tekstu"}.${problem.claim !== "SUPPORTED" && problem.thesis ? ` Sprawdzana teza: „${problem.thesis}”.` : ""} ${problem.reason} Tekst dokumentu: „${problem.quote}”`
    )
    .join("\n");
}
