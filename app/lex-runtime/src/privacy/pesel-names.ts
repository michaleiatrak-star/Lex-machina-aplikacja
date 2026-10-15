import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PiiSpan } from "./pseudonymizer.js";

// Given name + surname from the PESEL registers (privacy/given_names_pesel.tsv,
// surnames_pesel.tsv), in the application itself: the reserve when the Python gazetteer
// (Morfeusz, privacy/polish_pii_gazetteer.py) does not start, so names are not left in clear.
// The same files and the same inflection rules as privacy/surname_base.py (_readings); the
// gazetteer's finer rules (patrons "im. Jana Pawła II", common nouns) are not repeated here,
// so a pair is taken only where a person stands, never after a patron or street marker.

type Counts = { men: number; women: number };

class SortedTsv {
  private lines: Buffer[] | null = null;
  constructor(private readonly file: string) {}

  private load(): Buffer[] {
    if (this.lines) return this.lines;
    try {
      const data = readFileSync(this.file);
      const lines: Buffer[] = [];
      let start = 0;
      for (let index = 0; index < data.length; index += 1) {
        if (data[index] === 10) {
          if (index > start) lines.push(data.subarray(start, index));
          start = index + 1;
        }
      }
      if (start < data.length) lines.push(data.subarray(start));
      this.lines = lines;
    } catch {
      this.lines = [];
    }
    return this.lines;
  }

  get available(): boolean {
    return this.load().length > 0;
  }

  counts(name: string): Counts | null {
    const lines = this.load();
    const target = Buffer.from(name.toLocaleLowerCase("pl").split(/\s+/u).join(" "), "utf8");
    let lo = 0;
    let hi = lines.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const line = lines[mid]!;
      const tab = line.indexOf(9);
      const key = line.subarray(0, tab < 0 ? line.length : tab);
      const order = Buffer.compare(key, target);
      if (order === 0) {
        const [men, women] = line.subarray(tab + 1).toString("utf8").split("\t");
        return { men: Number(men) || 0, women: Number(women) || 0 };
      }
      if (order < 0) lo = mid + 1;
      else hi = mid - 1;
    }
    return null;
  }
}

function privacyDir(): string {
  const worker = process.env.LEX_GAZETTEER_WORKER;
  if (worker) return path.dirname(worker);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../privacy");
}

let bases: { given: SortedTsv; surnames: SortedTsv } | null = null;
function registers() {
  bases ??= {
    given: new SortedTsv(process.env.LEX_GIVEN_NAME_BASE || path.join(privacyDir(), "given_names_pesel.tsv")),
    surnames: new SortedTsv(process.env.LEX_SURNAME_BASE || path.join(privacyDir(), "surnames_pesel.tsv"))
  };
  return bases;
}

/** Test seam: other register files. */
export function usePeselRegisters(given: string, surnames: string): void {
  bases = { given: new SortedTsv(given), surnames: new SortedTsv(surnames) };
}

const PALATAL_LOC: Array<[string, string]> = [["strze", "str"], ["ście", "st"], ["ździe", "zd"], ["śle", "sł"], ["rze", "r"],
  ["cie", "t"], ["dzie", "d"], ["nie", "n"], ["sie", "s"], ["zie", "z"], ["le", "ł"], ["mie", "m"], ["pie", "p"], ["bie", "b"], ["wie", "w"]];
const FEM_DAT_REVERSE: Array<[string, string]> = [["ce", "ka"], ["dze", "ga"], ["sze", "cha"], ["rze", "ra"], ["cie", "ta"],
  ["dzie", "da"], ["nie", "na"], ["sie", "sa"], ["zie", "za"], ["le", "ła"], ["mie", "ma"], ["pie", "pa"], ["bie", "ba"], ["wie", "wa"]];

const mobileE = (stem: string) =>
  stem.length >= 3 && /[kcłńr]$/u.test(stem) && !/[aeiouyąęó]$/u.test(stem.slice(0, -1)) ? [stem.slice(0, -1) + "e" + stem.slice(-1)] : [];

/** Candidate nominatives of an inflected name (privacy/surname_base.py _readings). */
export function nominativeCandidates(word: string): string[] {
  const low = word.toLocaleLowerCase("pl");
  const found = new Set<string>([word]);
  const noun = (stem: string) => {
    if (stem.length < 2) return;
    found.add(stem);
    found.add(stem + "o");
    for (const alt of mobileE(stem)) found.add(alt);
  };
  const feminine = (stem: string) => {
    if (stem.length < 2) return;
    found.add(stem + "a");
    found.add(stem + "o");
  };
  for (const [ending] of [["owi"], ["iem"], ["em"], ["a"], ["u"]]) if (low.endsWith(ending!)) noun(word.slice(0, -ending!.length));
  for (const [ending, base] of PALATAL_LOC) if (low.endsWith(ending)) noun(word.slice(0, -ending.length) + base);
  for (const ending of ["iego", "iemu", "im"]) if (low.endsWith(ending)) found.add(word.slice(0, -ending.length) + "i");
  for (const ending of ["ego", "emu", "em", "ym"]) if (low.endsWith(ending)) found.add(word.slice(0, -ending.length) + "y");
  for (const ending of ["iej", "ej", "ą"]) if (low.endsWith(ending)) found.add(word.slice(0, -ending.length) + "a");
  for (const ending of ["y", "i", "ę", "ą", "o"]) if (low.endsWith(ending)) feminine(word.slice(0, -ending.length));
  for (const [ending, base] of FEM_DAT_REVERSE) if (low.endsWith(ending)) feminine(word.slice(0, -ending.length) + base.slice(0, -1));
  return [...found];
}

const best = (base: SortedTsv, word: string): number =>
  Math.max(0, ...nominativeCandidates(word).map((form) => {
    const counts = base.counts(form);
    return counts ? Math.max(counts.men, counts.women) : 0;
  }));

// A given name borne by at least this many persons, more often as a given name than a surname.
const GIVEN_MIN = 50;
const NAME = /\p{Lu}[\p{Ll}’'-]+(?:-\p{Lu}[\p{Ll}’'-]+)?/u;
// After these a name is a patron, a street or an institution's, not a person in the case.
const NOT_A_PERSON_BEFORE = /(?:\bim\.|\bimienia|\bul\.|\bulic\p{L}*|\bal\.|\bpl\.|\bos\.|\bSzpital\p{L}*|\bSzkoł\p{L}*|\bfundacj\p{L}*)\s*$/iu;

export function peselRegistersAvailable(): boolean {
  const { given, surnames } = registers();
  return given.available && surnames.available;
}

/** "Jan Kowalski", "Janowi Kowalskiemu", "Kowalski Jan" (a letterhead), "Annę Nowak-Lis". */
export function detectPeselNames(text: string): PiiSpan[] {
  if (!peselRegistersAvailable()) return [];
  const { given, surnames } = registers();
  const isGiven = (word: string) => {
    const count = best(given, word);
    return count >= GIVEN_MIN && count >= best(surnames, word);
  };
  const isSurname = (word: string) => word.split("-").every((part) => best(surnames, part) > 0);
  const spans: PiiSpan[] = [];
  const pair = new RegExp(`(${NAME.source})[ \\t]+(${NAME.source})`, "gu");
  for (let match = pair.exec(text); match; match = pair.exec(text)) {
    const [whole, first, second] = match as unknown as [string, string, string];
    if (NOT_A_PERSON_BEFORE.test(text.slice(Math.max(0, match.index - 25), match.index))) continue;
    const person = (isGiven(first) && isSurname(second) && !isGiven(second)) || (isSurname(first) && !isGiven(first) && isGiven(second));
    if (!person) {
      // The second word may open the next pair ("Pan Jan Kowalski").
      pair.lastIndex = match.index + first.length;
      continue;
    }
    spans.push({ start: match.index, end: match.index + whole.length, kind: "PERSON", value: whole, confidence: 0.85, source: "AUTO" });
  }
  return spans;
}
