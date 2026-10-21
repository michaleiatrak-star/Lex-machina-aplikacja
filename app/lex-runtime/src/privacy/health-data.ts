// Health data (art. 9 RODO: a special category): diagnoses, injuries, conditions, treatment.
// Not masked by default: in a matter of damages or redress the injury is the case itself, and
// a masked diagnosis leaves the model nothing to assess. The preview lists them for a decision
// (mask one, mask all) and the chat names them in the turn's log.

export type HealthMention = { start: number; end: number; value: string };

// Terms with the words that name the condition after them ("złamania kości udowej",
// "zaburzenia lękowe"): up to two lower-case words.
const WITH_OBJECT = [
  "złamani\\p{L}*", "uraz\\p{L}* (?:głowy|kręgosłupa|kolana|barku|ręki|nogi|ciała|mózgu|oka|wielonarządow\\p{L}*|psychiczn\\p{L}*|czaszkowo\\p{L}*)", "wstrząśnieni\\p{L}*", "stłuczeni\\p{L}*", "oparzeni\\p{L}*", "zwichnięci\\p{L}*",
  "zaburzeni\\p{L}* (?:psychiczn|lękow|osobowości|depresyjn|odżywiania|nastroju)\\p{L}*", "uszkodzeni\\p{L}* (?:ciała|mózgu|rdzenia|kręgosłupa|nerwu)\\p{L}*",
  "chorob\\p{L}* (?:afektywn|psychiczn|nowotworow|przewlekł|zawodow|Alzheimera|Parkinsona)\\p{L}*", "niewydolnoś\\p{L}*", "amputacj\\p{L}*",
  "porażeni\\p{L}*", "leczeni\\p{L}* (?:psychiatryczn|onkologiczn|odwykow|szpitaln)\\p{L}*", "choruje na", "cierpi na", "zdiagnozowan\\p{L}*"
];
const ALONE = [
  "depresj\\p{L}*", "nerwic\\p{L}*", "schizofreni\\p{L}*", "psychoz\\p{L}*", "nowotw[oó]r\\p{L}*", "białaczk\\p{L}*", "chłoniak\\p{L}*",
  "cukrzyc\\p{L}*", "padaczk\\p{L}*", "epilepsj\\p{L}*", "stwardnieni\\p{L}* rozsian\\p{L}*", "HIV", "AIDS", "zawał\\p{L}*", "udar\\p{L}* mózgu",
  "astm\\p{L}*", "autyzm\\p{L}*", "ADHD", "uzależnieni\\p{L}* od (?:alkoholu|narkotyków|hazardu)", "alkoholizm\\p{L}*", "niepełnosprawnoś\\p{L}*",
  "poronieni\\p{L}*", "dyskopati\\p{L}*", "przepuklin\\p{L}*", "hospitalizacj\\p{L}*", "PTSD", "anoreksj\\p{L}*", "bulimi\\p{L}*", "otępieni\\p{L}*"
];
const OBJECT = "(?:\\s+(?!i\\b|oraz\\b|w\\b|na\\b|z\\b|ze\\b|do\\b|od\\b|po\\b|przez\\b)\\p{Ll}[\\p{Ll}-]+){0,2}";
const TERMS = new RegExp(
  `(?<![\\p{L}])(?:(?:${WITH_OBJECT.join("|")})${OBJECT}|(?:${ALONE.join("|")}))(?![\\p{L}])`,
  "giu"
);
// ICD-10 code after its label: "rozpoznanie: S72.0", "ICD-10 F32.1".
const ICD = /(?:ICD(?:-10)?|rozpoznani\p{L}*|kod\p{L}* choroby)\s*:?\s*([A-TV-Z]\d{2}(?:\.\d{1,2})?)(?![\w.])/giu;

/** Mentions of health data in the text, in order, not overlapping. */
export function detectHealthData(text: string): HealthMention[] {
  const found: HealthMention[] = [];
  for (const match of text.matchAll(TERMS)) {
    const value = match[0].replace(/\s+$/u, "");
    found.push({ start: match.index!, end: match.index! + value.length, value });
  }
  for (const match of text.matchAll(ICD)) {
    const start = match.index! + match[0].lastIndexOf(match[1]!);
    found.push({ start, end: start + match[1]!.length, value: match[1]! });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  return found.filter((item, index) => !found.slice(0, index).some((other) => other.start <= item.start && item.end <= other.end));
}
