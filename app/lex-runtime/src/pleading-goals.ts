// Goals a pleading must take up besides the contradictions of the matrix (RD 121/26 plan, point 4):
// a single strong fact of an official document on the topic (the opponent's statement in a protocol:
// "każda taka sytuacja będzie traktowana jako nękanie"), and every charge of the party's earlier
// letter, which the pleading upholds with its evidence or drops with a stated reason.
import type { DescribedFact, FactRow } from "./fact-matrix.js";

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ł/gu, "l")
    .replace(/[^\p{L}\d]+/gu, " ")
    .trim();

const STOP = new Set(["ktore", "ktory", "ktora", "przez", "oraz", "ponie", "takze", "jedna", "jest", "byly", "bylo", "zosta", "ktorz", "wobec", "tylko", "jezel", "ponad", "sprawy", "spraw"]);
const stems = (text: string) => new Set(fold(text).split(" ").filter((word) => word.length >= 5).map((word) => word.slice(0, 5)).filter((stem) => !STOP.has(stem)));

/** Kinds whose statement is an official record or the opponent's own word. */
export function officialKind(kind: string, category: string): boolean {
  return category === "ORZECZENIE" || kind.startsWith("PROTOKOL") || ["WYJASNIENIA", "OPINIA_BIEGLEGO", "ZASWIADCZENIE"].includes(kind);
}

// What a party declares, explains or a body establishes weighs more than a heading or a date.
const STATEMENT = /(?:oświadcz|twierdz|stanowisk|wyjaśni|zapowied|ustaleni|rozstrzygn|przyzna|treść|deklarac)/iu;

export type OfficialFact = { goal: string; fact: DescribedFact };

/**
 * Facts stated by one official document only (not a difference, so no matrix goal), on the topic of
 * the matter: the strongest per topic, at most `limit`.
 */
export function officialFactGoals(rows: readonly FactRow[], officialRecords: ReadonlySet<string>, focus: string, limit = 4): OfficialFact[] {
  const focusStems = stems(focus);
  const candidates = rows
    .filter((row) => !row.differs)
    .flatMap((row) =>
      row.cells
        .filter((cell) => officialRecords.has(cell.record))
        .flatMap((cell) => cell.facts.map((fact) => ({ row, fact })))
    )
    .map(({ row, fact }) => {
      const own = stems(`${fact.topic} ${fact.value} ${fact.quote}`);
      const hits = [...own].filter((stem) => focusStems.has(stem)).length;
      return { row, fact, score: hits * 2 + (STATEMENT.test(fact.attribute) ? 3 : 0) + (row.cells.length >= 2 ? 1 : 0) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const chosen: OfficialFact[] = [];
  for (const item of candidates) {
    const key = fold(item.row.topic);
    if (seen.has(key)) continue;
    seen.add(key);
    chosen.push({
      goal: `Wykorzystać fakt z dokumentu urzędowego (${item.fact.record}): ${item.fact.topic} — ${item.fact.attribute}: „${item.fact.quote}”`,
      fact: item.fact
    });
    if (chosen.length >= limit) break;
  }
  return chosen;
}

const CHARGE =
  /(?<![\p{L}])(?:zarzuca\p{L}*|zarzut\p{L}*|naruszy\p{L}*|naruszeni\p{L}*|naruszaj\p{L}*|dopuści\p{L}*\s+się|przewinieni\p{L}*|nękani\p{L}*|nęka\p{L}*|bezprawn\p{L}*|niezgodn\p{L}*\s+z\s+(?:prawem|zasadami|art)|przetwarza\p{L}*\s+(?:moich\s+|moje\s+)?dan\p{L}*|ujawni\p{L}*)(?![\p{L}])/iu;

/** The charges of the party's earlier letter: sentences that charge someone, in order, at most `limit`. */
export function partyCharges(text: string, limit = 8): string[] {
  const sentences = text
    .replace(/\s+/gu, " ")
    .split(/(?<=[.;!?])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ0-9(])|\s(?=\d{1,2}[.)]\s)/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 30 && CHARGE.test(sentence));
  const charges: string[] = [];
  for (const sentence of sentences) {
    const text = sentence.length > 240 ? `${sentence.slice(0, 237)}...` : sentence;
    if (charges.some((charge) => overlap(stems(charge), stems(text)) >= 0.6)) continue;
    charges.push(text);
    if (charges.length >= limit) break;
  }
  return charges;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size) return 0;
  return [...a].filter((stem) => b.has(stem)).length / a.size;
}

/** A charge the answer says nothing about (less than 40% of its words), neither upheld nor dropped. */
export function unaddressedCharges(answer: string, charges: readonly string[]): string[] {
  const said = stems(answer);
  return charges.filter((charge) => overlap(stems(charge), said) < 0.4);
}

export function chargeGoal(record: string, charge: string): string {
  return `Zarzut z wcześniejszego pisma strony (${record}): „${charge}” — podtrzymać z dowodem albo wycofać z podaniem powodu`;
}

export function chargeCorrection(charges: readonly string[]): string {
  return [
    "KONTROLA APLIKACJI — zarzuty z wcześniejszego pisma strony bez odpowiedzi w projekcie. Każdy podtrzymaj (fakt, dowód, przepis) albo wycofaj z podaniem powodu w uwagach poza pismem; żadnego nie pomijaj milczeniem:",
    ...charges.map((charge, index) => `${index + 1}. „${charge}”`)
  ].join("\n");
}
