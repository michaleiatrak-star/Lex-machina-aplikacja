// Stawki, terminy, kary i sankcje podane liczbowo (PRAWO-HARDGATE, ZASADA ABSOLUTNA):
// wartość jest potwierdzona tylko wtedy, gdy występuje w brzmieniu przepisu
// zweryfikowanego w tym samym wierszu; inaczej dostaje ⚠️ [NIEWERYFIKOWANE].

// Wiersz mówi o normie (termin, kara, stawka), a nie o faktach sprawy.
const NORMATIVE_CONTEXT =
  /zagrożon|podlega\s|ustawow|w\s+terminie|termin\p{L}*\s+(?:na|do|wynosi|\d)|stawk|grzywn|pozbawienia\s+wolności|ograniczenia\s+wolności|przedawni|odsetk|opłat\p{L}*\s+(?:stał|stosunkow|podstawow|sądow|kancelaryjn)|wpis\p{L}*\s+(?:stał|stosunkow)|sankcj|kar\p{L}*\s+(?:umown|pieniężn|porządkow)/iu;

const AMOUNT =
  /(?<![\p{L}\d,.])(?:(?:do|od)\s+lat\s+\d{1,2}|\d{1,3}(?:[  ]\d{3})+(?:,\d+)?\s*(?:zł|złotych|PLN)|\d+(?:,\d+)?\s*(?:zł|złotych|PLN|%|proc\.?|procent\p{L}*)|\d{1,4}\s*(?:dni|dnia|tygodni\p{L}*|tydzień|miesięcy|miesiąca|miesiące|lat|lata|roku))(?![\p{L}\d])/giu;

export type AmountMatch = { text: string; start: number; end: number; key: string };

function unitOf(text: string): string {
  if (/lat|lata|roku/iu.test(text)) return "Y";
  if (/miesi/iu.test(text)) return "M";
  if (/tydz|tygod/iu.test(text)) return "W";
  if (/dni|dnia/iu.test(text)) return "D";
  if (/%|proc/iu.test(text)) return "P";
  return "Z";
}

function keyOf(text: string): string {
  const years = /(?:do|od)\s+lat\s+(\d{1,2})/iu.exec(text);
  const number = years ? years[1]! : (/\d+(?:[  ]\d{3})*(?:,\d+)?/u.exec(text)?.[0] ?? "");
  // "48 600,00 zł" in an invoice and "48 600 zł" in the answer are one value (live C09-062).
  return `${number.replace(/[\s\u00a0\u202f]/gu, "").replace(/,0+$/u, "")}${unitOf(text)}`;
}

// Własne żądanie strony ("Wzywam do zapłaty ... w terminie 7 dni", "wnoszę o zasądzenie kwoty
// 12 000 zł wraz z odsetkami", "wyznaczam termin 14 dni"): wartość ustala strona, nie przepis.
// Also the polite forms of a letter ("Proszę o zwrot kaucji w terminie 7 dni", "Oczekuję…",
// "Zwracam się o…") and a time counted from this letter, which no statute does (live C12-018:
// the letter to the landlord was not exported, "7 dni" unverified).
const OWN_DEMAND =
  /(?<![\p{L}])(?:proszę\s+o|prosimy\s+o|oczekuję|oczekujemy|zwracam\s+się\s+(?:z\s+prośbą\s+)?o|od\s+(?:dnia\s+)?(?:otrzymania|doręczenia)\s+(?:niniejszego\s+|tego\s+)?(?:pisma|wezwania)|wzywam\p{L}*|wzywamy|wyznaczam\p{L}*|żądam\p{L}*|domagam\s+się|domagamy\s+się|proponuj\p{L}*|oferuj\p{L}*|zobowiązuję\s+się|wnosz\p{L}*\s+o\s+(?:zasądzenie|zapłatę|nakazanie|orzeczenie\s+nakazem)|wnosimy\s+o\s+(?:zasądzenie|zapłatę)|wnosi\s+o\s+(?:zasądzenie|zapłatę)|domaga\s+się|żąda\s+(?:zapłaty|zasądzenia|kwoty))(?![\p{L}])/iu;

/** Wartości liczbowe norm w wierszu; pusty wynik, gdy wiersz nie mówi o normie. */
export function amountMatches(lineText: string): AmountMatch[] {
  if (!NORMATIVE_CONTEXT.test(lineText) || OWN_DEMAND.test(lineText)) return [];
  AMOUNT.lastIndex = 0;
  return [...lineText.matchAll(AMOUNT)].map((match) => ({
    text: match[0],
    start: match.index!,
    end: match.index! + match[0].length,
    key: keyOf(match[0])
  }));
}

// Ustawy piszą okresy słownie ("trzech lat", "w terminie tygodnia").
const NUMERALS: Array<[string, number]> = [
  ["jednego|jeden|jedna|jednej", 1],
  ["dwóch|dwa|dwie|dwu", 2],
  ["trzech|trzy", 3],
  ["czterech|cztery", 4],
  ["pięciu|pięć", 5],
  ["sześciu|sześć", 6],
  ["siedmiu|siedem", 7],
  ["ośmiu|osiem", 8],
  ["dziewięciu|dziewięć", 9],
  ["dziesięciu|dziesięć", 10],
  ["dwunastu|dwanaście", 12],
  ["czternastu|czternaście", 14],
  ["piętnastu|piętnaście", 15],
  ["dwudziestu|dwadzieścia", 20],
  ["trzydziestu|trzydzieści", 30],
  ["sześćdziesięciu|sześćdziesiąt", 60],
  ["dziewięćdziesięciu|dziewięćdziesiąt", 90]
];
const PERIOD = "(?=\\s+(?:dni|dnia|tygodni\\p{L}*|tydzień|miesięcy|miesiąca|miesiące|lat|lata|roku)(?![\\p{L}]))";

function digitsForWords(text: string): string {
  let result = text.replace(
    /(w\s+terminie|w\s+ciągu|po\s+upływie|przed\s+upływem|okres\p{L}*)\s+(tygodnia|miesiąca|roku)(?![\p{L}])/giu,
    "$1 1 $2"
  );
  for (const [words, value] of NUMERALS) {
    result = result.replace(new RegExp(`(?<![\\p{L}])(?:${words})${PERIOD}`, "giu"), String(value));
  }
  // "do lat trzech" -> "do lat 3"
  for (const [words, value] of NUMERALS) {
    result = result.replace(new RegExp(`((?:do|od)\\s+lat\\s+)(?:${words})(?![\\p{L}])`, "giu"), `$1${value}`);
  }
  return result;
}

/** Czy brzmienie przepisu zawiera tę wartość (ta sama liczba i jednostka). */
export function evidenceHasAmount(evidence: string, key: string): boolean {
  const text = digitsForWords(evidence.normalize("NFKC"));
  AMOUNT.lastIndex = 0;
  return [...text.matchAll(AMOUNT)].some((match) => keyOf(match[0]) === key);
}

/** Znacznik ⚠️ tuż za podanymi końcami fragmentów (wartość, sygnatura) należy do nich. */
export function markerSpansAfter(lineText: string, ends: number[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  for (const end of ends) {
    // Also "⚠️ [NIEWERYFIKOWANE: z materiałów sprawy]" and 🟨 after a signature (RD 121/26, live):
    // read as the next article's marker, it was dropped when that article was verified.
    const marker = /^\s{0,2}(?:⚠️?\s*\[NIEWERYFIKOWANE(?::[^\]\r\n]*)?\]|🟨\s*\[KOTWICA-URZĘDOWA(?::[^\]\r\n]*)?\])/u.exec(lineText.slice(end));
    if (marker) spans.push({ start: end + marker[0].search(/[⚠🟨]/u), end: end + marker[0].length });
  }
  return spans;
}

/** Znacznik ⚠️ wstawiony tuż za wartością należy do niej, nie do przepisu w wierszu. */
export function amountMarkerSpans(lineText: string): Array<{ start: number; end: number }> {
  return markerSpansAfter(lineText, amountMatches(lineText).map((amount) => amount.end));
}

/**
 * Klucze wartości podanych jako fakty sprawy (wiadomości użytkownika, akta). Pytanie o normę
 * ("czy termin na sprzeciw to 14 dni?") nie jest faktem: tę wartość weryfikuje się w przepisie.
 */
// A sum in a spreadsheet or a table without its currency ("48600", "48 600,00", "48600.00"):
// the case's own figure. Not a year, not an identifier (at most 9 digits).
const BARE_MONEY = /(?<![\p{L}\d,.\/-])(\d{1,3}(?:[   ]\d{3})+|\d{4,9})(?:[,.](\d{2}))?(?![\p{L}\d\/-]|[,.]\d)/gu;
const DATE = /(?<!\d)(?:(\d{1,2})[./-](\d{1,2})[./-](\d{4})|(\d{4})-(\d{2})-(\d{2}))(?!\d)/gu;
// Periods a statute commonly sets: a span between the case's dates equal to one of them is not
// taken as a fact (it may be the statutory term the answer names).
const STATUTORY_PERIOD_DAYS = new Set([3, 7, 14, 21, 30, 60, 90, 120, 180, 365]);
const DAY_MS = 24 * 60 * 60 * 1000;

function dateOf(match: RegExpMatchArray): number | null {
  const [day, month, year] = match[3] ? [match[1], match[2], match[3]] : [match[6], match[5], match[4]];
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  const value = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(value) ? value : null;
}

/**
 * The case's own values (the user's messages, the case's documents): amounts with their unit,
 * figures of a table without it, and the days between the case's dates (and today), such as
 * the days an invoice is overdue (live C09-062: "84 dni", "48 600 zł" from faktury.xlsx).
 */
export function amountKeysIn(text: string, today: Date = new Date()): string[] {
  const keys = new Set<string>();
  for (const sentence of text.split(/(?<=[.?!])\s+|\n+/u)) {
    if (/\?\s*$/u.test(sentence) && NORMATIVE_CONTEXT.test(sentence)) continue;
    AMOUNT.lastIndex = 0;
    for (const match of sentence.matchAll(AMOUNT)) keys.add(keyOf(match[0]));
    if (!NORMATIVE_CONTEXT.test(sentence)) {
      for (const match of sentence.replace(DATE, " ").matchAll(BARE_MONEY)) {
        const whole = Number(match[1]!.replace(/[\s  ]/gu, ""));
        if (whole >= 1900 && whole <= 2100 && !match[2]) continue;
        keys.add(`${whole}${match[2] && !/^0+$/u.test(match[2]) ? `,${match[2]}` : ""}Z`);
      }
    }
  }
  const dates = [...new Set([...text.matchAll(DATE)].map(dateOf).filter((value): value is number => value !== null))].slice(0, 40);
  dates.push(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  for (let i = 0; i < dates.length; i += 1) {
    for (let j = i + 1; j < dates.length; j += 1) {
      const days = Math.round(Math.abs(dates[i]! - dates[j]!) / DAY_MS);
      if (days > 0 && !STATUTORY_PERIOD_DAYS.has(days)) keys.add(`${days}D`);
    }
  }
  return [...keys];
}

/** Sums of two or three of the case's own money amounts ("łącznie 71 810 zł"): its own figure too. */
export function factSumKeys(keys: Iterable<string>): string[] {
  const values = [...new Set([...keys].filter((key) => /^\d+(?:,\d+)?Z$/u.test(key)).map((key) => Number(key.slice(0, -1).replace(",", "."))))].slice(0, 40);
  const sums = new Set<string>();
  const add = (value: number) => {
    const cents = Math.round(value * 100);
    sums.add(cents % 100 === 0 ? `${cents / 100}Z` : `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}Z`);
  };
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      add(values[i]! + values[j]!);
      for (let k = j + 1; k < values.length; k += 1) add(values[i]! + values[j]! + values[k]!);
    }
  }
  return [...sums];
}
