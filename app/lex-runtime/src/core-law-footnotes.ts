import { SMALL_LINE_MARK } from "./pdf-text-extractor.js";

// Przypisy (odnośniki) tekstu jednolitego z PDF Dz.U. i brzmienia jednostek drukowane dwa razy.
//
// W PDF treść odnośnika stoi na dole strony („25) W tym brzmieniu obowiązuje do wejścia w życie
// zmiany, o której mowa w odnośniku 26.”), a w treści przepisu zostaje znacznik „25 )”. Bez
// rozdzielenia przypisy z dołu strony wpadały do artykułu, który na tej stronie się kończył.
// Odnośnik przy jednostce mówi też, od kiedy obowiązuje jej brzmienie: t.j. drukuje obok siebie
// brzmienie obecne i to, które wejdzie w życie później (KP t.j. 2026/1245, art. 94 pkt 2b).

// Początek przypisu: numer, nawias bez spacji, wielka litera („2) Zdanie drugie…”). Punkty
// przepisu zaczynają się małą literą („1) zaznajamiać…”), a znacznik w treści ma spację („25 )”).
const NOTE_START = /^(\d{1,3})\)\s+(?=\p{Lu})/u;
// W bloku drobnego druku numer bywa oddzielony od nawiasu („1 ) Niniejsza…”: pdf.js 4.x stawia
// indeks górny osobno); tam spacja jest bezpieczna, bo blok to już wyłącznie przypisy.
const NOTE_START_SMALL = /^(\d{1,3}) ?\)\s+(?=\p{Lu})/u;
// Treść odnośnika t.j. zaczyna się jednym z tych zwrotów; bez tego warunku punkt pisany wielką
// literą („2) Skarb Państwa…”) mógłby uciąć resztę strony.
const NOTE_VOCABULARY =
  /^(?:W brzmieniu|W tym brzmieniu|Zdani[ae]|Wyraz|Dodan|Uchylon|Skreślon|Ze zmian|Przez art|Zmian[ay] tekstu|Niniejsz|Oznaczenie|Utracił|Utracił[ay]|Z dniem|Stosownie|Na podstawie|Część wspólna|Wyrok|Uznan|Tracą|Obowiązuje|Wejdzie|Wchodzi|Uchylony|Uchylona|Uchylone|Utrac|Nowe brzmienie|Obecnie|Treść|Zgodnie z|Ustawa|Art\. \d)/u;
// Znacznik odnośnika w treści: „25 )” (pdf.js rozdziela indeks górny spacją) albo „3) )”.
// Samo „1)” w środku wiersza to punkt („§ 2. 1) …”), nie znacznik.
const NOTE_MARKER = /(?<![\p{L}\d])(\d{1,3})(?: \)(?=\s|$|[.,;:)])|\)(?= ?\)))/gu;

/**
 * Przypisy z dołu każdej strony: strony bez nich i numer -> treść przypisu. Gdy ekstraktor
 * oznaczył wiersze mniejszej czcionki (SMALL_LINE_MARK), przypisem jest zwarty blok takich
 * wierszy na dole strony, także jego początek bez numeru (ciąg dalszy przypisu z poprzedniej
 * strony, np. długi wykaz dyrektyw w odnośniku 1). Bez znaczników (OCR) — rozpoznanie po treści.
 */
export function extractPageFootnotes(pageTexts: readonly string[]): {
  pages: string[];
  footnotes: Record<string, string>;
} {
  const footnotes: Record<string, string> = {};
  let open: string | null = null;
  const pages = pageTexts.map((page) => {
    if (!page.includes(SMALL_LINE_MARK)) return page;
    const lines = page.split("\n");
    let start = lines.length;
    while (start > 0 && (lines[start - 1]!.startsWith(SMALL_LINE_MARK) || !lines[start - 1]!.trim())) start -= 1;
    const block = lines.slice(start).map((line) => line.replaceAll(SMALL_LINE_MARK, "").trim()).filter(Boolean);
    const numbered = block.some((line) => NOTE_START_SMALL.test(line));
    // Mały druk na dole bez numeru odnośnika i bez otwartego przypisu (np. tabela) zostaje w treści.
    if (!block.length || (!numbered && open === null)) return page.replaceAll(SMALL_LINE_MARK, "");
    let current = NOTE_START_SMALL.test(block[0]!) ? null : open;
    for (const line of block) {
      const number = NOTE_START_SMALL.exec(line)?.[1];
      if (number) {
        current = number;
        footnotes[number] = line.replace(NOTE_START_SMALL, "").trim();
      } else if (current) {
        footnotes[current] = `${footnotes[current]} ${line}`.trim();
      }
    }
    open = current;
    return lines.slice(0, start).join("\n").replaceAll(SMALL_LINE_MARK, "");
  });
  if (pages.some((page, index) => page !== pageTexts[index])) return { pages: pages.map(spacedMarkers), footnotes };
  return extractFootnotesByContent(pageTexts, footnotes);
}

// pdf.js 4.x skleja znacznik za nawiasem („(uchylony) 9)”), 6.x go rozdziela („9 )”). Tylko ten
// kontekst: samo „N)” po dwukropku czy kropce to punkt wyliczenia, nie znacznik odnośnika.
function spacedMarkers(page: string): string {
  return page.replace(/\) (\d{1,3})\)(?=\s|$)/gu, ") $1 )");
}

function extractFootnotesByContent(
  pageTexts: readonly string[],
  footnotes: Record<string, string>
): { pages: string[]; footnotes: Record<string, string> } {
  const pages = pageTexts.map((page) => {
    const lines = page.split("\n");
    const start = lines.findIndex((line, index) => {
      const number = NOTE_START.exec(line)?.[1];
      if (!number || !NOTE_VOCABULARY.test(line.replace(NOTE_START, ""))) return false;
      // Do końca strony już tylko odnośniki: żadnego nagłówka artykułu ani paragrafu.
      if (lines.slice(index + 1).some((next) => /^(?:Art\.\s*\d|§\s*\d+[a-z]*\.)/u.test(next))) return false;
      // Znacznik tego odnośnika („3 )”, „zm. 3) )”) stoi wyżej na tej samej stronie, nie na początku wiersza.
      const above = lines.slice(0, index).join("\n");
      return new RegExp(`[^\\n\\d]\\s?${number}\\s?\\)`, "u").test(above);
    });
    if (start < 0) return page;
    let current: string | null = null;
    for (const line of lines.slice(start)) {
      const number = NOTE_START.exec(line)?.[1];
      if (number) {
        current = number;
        footnotes[number] = line.replace(NOTE_START, "").trim();
      } else if (current) {
        footnotes[current] = `${footnotes[current]} ${line.trim()}`.trim();
      }
    }
    return lines.slice(0, start).join("\n");
  });
  return { pages, footnotes };
}

// Nagłówek jednostki systematyzującej między artykułami („Rozdział II”, „DZIAŁ I”, „TYTUŁ II”):
// w PDF zostaje na końcu poprzedniego artykułu razem z tytułem rozdziału.
// Także „Rozdział 2[1]” (indeks górny) i załączniki ustawy po ostatnim artykule
// („Załączniki do ustawy z dnia…”, „Załącznik nr 1 FORMULARZ…”).
const STRUCTURE_HEADING = /\n(?:(?:KSIĘGA|CZĘŚĆ|Część|TYTUŁ|Tytuł|DZIAŁ|Dział|Rozdział|ROZDZIAŁ|Oddział|ODDZIAŁ|Podrozdział)\s+(?:[IVXLCDM]+[a-z]{0,2}|\d+[a-z]*(?:\s*\[\s*\d+\s*\]|\s+\d{1,2}(?=\s*\n))?|[A-ZĄĆĘŁŃÓŚŹŻ]+)(?:\s|$)|Załącznik(?:i|\s+nr\s+\d+)?\s+do\s+ustawy\s)/u;

export function stripTrailingHeadings(text: string): string {
  const match = STRUCTURE_HEADING.exec(text);
  return match ? text.slice(0, match.index).trimEnd() : text;
}

// Znacznik przyklejony do numeru ustępu/paragrafu na początku wiersza („2. 2) W sprawach…”).
const LABEL_MARKER = /(?<=^(?:§ \d+[a-z]*(?:\s*\[\s*\d+[a-z]*\s*\])?|\d+[a-z]*|Art\.\s*\d+[a-z]*(?:\s*\[\s*\d+[a-z]*\s*\][a-z]*|\s+\d{1,3}[a-z]*)?)\s*\.\s*)(\d{1,3})\)(?=\s+(?:\p{Lu}|\d+[a-z]*\.\s|§))/gmu;

/** Numery odnośników w treści artykułu i treść bez znaczników „25 )”. */
export function articleFootnotes(
  text: string,
  footnotes: Record<string, string>
): { text: string; notes: string[] } {
  const notes: string[] = [];
  const strip = (marker: string, number: string) => {
    if (footnotes[number] === undefined) return marker;
    notes.push(number);
    return "";
  };
  const cleaned = text
    .replace(NOTE_MARKER, strip)
    // Przy ustępie tylko odnośnik o typowej treści („W brzmieniu…”), nie punkt „1) Skarb Państwa”.
    .replace(LABEL_MARKER, (marker, number: string) =>
      NOTE_VOCABULARY.test(footnotes[number] ?? "") ? strip(marker, number) : marker
    );
  return { text: cleaned.replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n"), notes };
}

const MONTHS: Record<string, number> = {
  stycznia: 1, lutego: 2, marca: 3, kwietnia: 4, maja: 5, czerwca: 6,
  lipca: 7, sierpnia: 8, września: 9, października: 10, listopada: 11, grudnia: 12
};

/** Data z „wejdzie w życie z dniem 28 października 2026 r.” (ISO); null, gdy jej nie ma. */
export function futureDate(note: string): string | null {
  const match = /wejd(?:zie|ą) w życie z dniem (\d{1,2}) (\p{L}+) (\d{4}) r\./u.exec(note);
  const month = match ? MONTHS[match[2]!.toLocaleLowerCase("pl")] : undefined;
  if (!match || !month) return null;
  return `${match[3]}-${String(month).padStart(2, "0")}-${match[1]!.padStart(2, "0")}`;
}

/**
 * Data wejścia w życie zmiany z odnośnika; „ustawy, o której mowa w odnośniku 6” prowadzi do
 * daty podanej w odnośniku 6 (najwyżej 3 odesłania).
 */
export function noteDate(note: string, footnotes: Record<string, string>, depth = 0): string | null {
  // Przez odesłanie („ustawy, o której mowa w odnośniku 4”) liczy się data ustawy („która weszła
  // w życie z dniem 13 kwietnia 2026 r.”), nie data jednostki odnośnika 4 dopisana po średniku
  // („; wejdzie w życie z dniem 1 stycznia 2027 r.”; u.ś.p. t.j. 2026/854, art. 17 ust. 1a).
  const act = depth > 0 ? /któr[aey] (?:weszł[ay]|wchodzi|wchodzą|wejdzie|wejdą) w życie z dniem (\d{1,2} \p{L}+ \d{4} r\.)/u.exec(note)?.[1] : undefined;
  if (act) return futureDate(`wejdzie w życie z dniem ${act}`);
  // „wejdzie w życie z dniem …” (zmiana przyszła w dniu t.j.) albo „weszła w życie z dniem …”.
  const direct = futureDate(note) ?? futureDate(note.replace(/weszł[ay] w życie/u, "wejdzie w życie"));
  if (direct || depth >= 3) return direct;
  const next = /o której mowa w odnośniku (\d{1,3})/u.exec(note)?.[1];
  return next && footnotes[next] !== undefined ? noteDate(footnotes[next]!, footnotes, depth + 1) : null;
}

export type ArticleWording = {
  // Tekst artykułu z brzmieniami obowiązującymi w dniu `today`.
  text: string;
  // Brzmienia (lub nowe jednostki) wchodzące w życie po `today`.
  pending: { from: string | null; text: string }[];
  // Odnośnik zapowiada zmianę, ale daty nie da się odczytać: brzmienia nie wybrano.
  unresolved: boolean;
};

// Jednostka na początku wiersza: § 1. / ustęp „2.” / punkt „1)” / litera „a)”, po niej znacznik
// odnośnika „25 )” albo — przy ustępie i paragrafie — „2)” przed tekstem od wielkiej litery
// („2. 2) W sprawach…”, u.k.s.c. art. 13); punkt zaczyna się małą literą („2. 1) pierwszy”).
// Nagłówek artykułu („Art. 3b.”, „Art. 479 [45] .”) — artykuł drukowany w t.j. kilka razy.
const ARTICLE_LABEL = String.raw`Art\.\s*\d+[a-z]*(?:\s*\[\s*\d+[a-z]*\s*\]\s*[a-z]*|\s+\d{1,3}[a-z]*(?=\s+\.))?\s*\.`;
const UNIT_LABEL = new RegExp(String.raw`^(${ARTICLE_LABEL}|§ \d+[a-z]*(?:\s*\[\s*\d+[a-z]*\s*\]|\s+\d{1,2}(?=\s*\.))?\s*\.|\d+[a-z]*\.(?=\s)|\d+[a-z]*\)|[a-z]{1,2}\))`, "u");
const UNIT_LINE = new RegExp(String.raw`^(${ARTICLE_LABEL}|§ \d+[a-z]*(?:\s*\[\s*\d+[a-z]*\s*\]|\s+\d{1,2}(?=\s*\.))?\s*\.|\d+[a-z]*\.(?=\s)|\d+[a-z]*\)|[a-z]{1,2}\))\s*(?:(\d{1,3}) \)|(?<=[.]\s*)(\d{1,3})\)(?=\s+\p{Lu}))`, "u");
// Poziom jednostki: wyższa (mniejszy numer) kończy zakres niższej.
function unitLevel(label: string): number {
  if (label.startsWith("Art")) return -1;
  if (label.startsWith("§")) return 0;
  if (label.endsWith(".")) return 1;
  if (/^\d/u.test(label)) return 2;
  return 3;
}

/**
 * Brzmienie artykułu obowiązujące w dniu `today` (RRRR-MM-DD). Jednostka drukowana dwa razy
 * (odnośnik „obowiązuje do wejścia w życie zmiany, o której mowa w odnośniku M” przy pierwszej,
 * „wejdzie w życie z dniem …” w M) zostaje w jednym brzmieniu; jednostka dodana z datą
 * przyszłą wypada z tekstu do `pending`. Wejście: tekst ze znacznikami „N )”.
 */
export function articleWording(
  markedText: string,
  footnotes: Record<string, string>,
  today: string
): ArticleWording {
  // Znacznik sklejony z etykietą („Art. 10. 8) 1.”, pdf.js 4.x) do postaci „8 )”, którą czyta UNIT_LINE.
  const lines = markedText
    .split("\n")
    .map((line) => line.replace(LABEL_MARKER, (marker, number: string) => (footnotes[number] === undefined ? marker : `${number} )`)));
  const units: { label: string; level: number; note: string | null; start: number; end: number }[] = [];
  lines.forEach((line, index) => {
    const unit = UNIT_LINE.exec(line);
    const label = unit?.[1] ?? UNIT_LABEL.exec(line)?.[1];
    if (!label) return;
    const note = unit?.[2] ?? (unit?.[3] && NOTE_VOCABULARY.test(footnotes[unit[3]] ?? "") ? unit[3] : null);
    units.push({ label, level: unitLevel(label), note: note && footnotes[note] !== undefined ? note : null, start: index, end: lines.length });
  });
  // Jednostka sięga do następnej tego samego albo wyższego poziomu (pkt 10 z literami a, b).
  units.forEach((unit, index) => {
    const next = units.slice(index + 1).find((other) => other.level <= unit.level);
    unit.end = next ? next.start : lines.length;
    // Nagłówek artykułu bez znacznika: odnośnik bywa za treścią („Art. 10. (uchylony) 9 )”).
    if (unit.level < 0 && unit.note === null) {
      const child = units[index + 1] && units[index + 1]!.start < unit.end ? units[index + 1]!.start : unit.end;
      const own = lines.slice(unit.start, Math.max(child, unit.start + 1)).join("\n");
      for (const match of own.matchAll(NOTE_MARKER)) {
        if (footnotes[match[1]!] !== undefined) {
          unit.note = match[1]!;
          break;
        }
      }
    }
  });
  const drop = new Set<number>();
  const pending: ArticleWording["pending"] = [];
  let unresolved = false;
  units.forEach((unit, index) => {
    const note = unit.note ? footnotes[unit.note] ?? "" : "";
    const until = /[Oo]bowiązuje do wejścia w życie zmiany, o której mowa w odnośniku (\d{1,3})/u.exec(note)?.[1];
    const body = () => lines.slice(unit.start, unit.end).join("\n");
    if (until) {
      const next = units.slice(index + 1).find((other) => other.level <= unit.level);
      const from = noteDate(footnotes[until] ?? "", footnotes);
      if (!from || !next || next.note !== until) {
        unresolved = true;
        return;
      }
      // Dziś obowiązuje pierwsze brzmienie albo, od dnia zmiany, drugie.
      const [keep, skip] = today < from ? [unit, next] : [next, unit];
      for (let line = skip.start; line < skip.end; line += 1) drop.add(line);
      if (today < from) pending.push({ from, text: lines.slice(next.start, next.end).join("\n") });
      void keep;
      return;
    }
    if (/^Dodan[yaei]\b/u.test(note)) {
      const from = noteDate(note, footnotes);
      if (from && today < from) {
        for (let line = unit.start; line < unit.end; line += 1) drop.add(line);
        pending.push({ from, text: body() });
      }
    } else if (/wejdzie w życie/u.test(note) && !noteDate(note, footnotes)) {
      unresolved = true;
    }
  });
  const kept = lines
    .filter((_, index) => !drop.has(index))
    .map((line) => line.replace(LABEL_MARKER, (marker, number: string) => (footnotes[number] === undefined ? marker : "")))
    .join("\n");
  return {
    text: kept.replace(NOTE_MARKER, (marker, number: string) => (footnotes[number] === undefined ? marker : "")).replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n"),
    pending,
    unresolved
  };
}

/** Czy odnośniki artykułu zapowiadają zmianę jego treści po `today` (albo nie da się tego ustalić). */
export function hasPendingWording(markedText: string, footnotes: Record<string, string>, today: string): boolean {
  const wording = articleWording(markedText, footnotes, today);
  return wording.unresolved || wording.pending.length > 0;
}
