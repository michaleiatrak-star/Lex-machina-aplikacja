// A common-court signature entered as the courts write it: department (Roman numeral),
// repertory, number and year ("XI C 1768/26"), as the court portals' search asks for it.

export type SignatureParts = { wydzial: string; repertorium: string; numer: string; rok: string };

const ROMAN: Array<[number, string]> = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];

export function roman(value: number): string {
  let rest = value;
  let out = "";
  for (const [size, symbol] of ROMAN) {
    while (rest >= size) {
      out += symbol;
      rest -= size;
    }
  }
  return out;
}

export const DEPARTMENTS: readonly string[] = Array.from({ length: 30 }, (_, index) => roman(index + 1));

// Repertories of the common courts by court level (regulamin urzędowania i zarządzenie o
// biurowości), the ones a lawyer meets most; any other can be typed.
const REGIONAL = ["C", "Nc", "Ns", "Co", "Cps", "Nkd", "Nmo", "RC", "RNs", "RNc", "Nsm", "Nk", "K", "Kp", "Ko", "Kop", "Kow", "Kzw", "W", "Wz", "Wo", "P", "Po", "Pz", "U", "GC", "GNc", "GNs", "GCo", "GU", "GUp", "GR", "GRz", "GRp"];
const DISTRICT = ["C", "Ca", "Cz", "Co", "Ns", "Nc", "RC", "RCa", "RCz", "K", "Ka", "Kz", "Ko", "Kp", "Kow", "Kzw", "P", "Pa", "Pz", "U", "Ua", "Uz", "GC", "Ga", "Gz", "GNc", "GNs", "GU", "GUp", "GUz", "GR", "Gzu", "Gzr", "Gzp", "Cgg", "Ko"];
const APPEAL = ["ACa", "ACz", "ACo", "AGa", "AGz", "AKa", "AKz", "AKo", "AKp", "APa", "APz", "AUa", "AUz", "ACz", "AGo"];

/** Repertories for a court by its name: a district court's, a regional court's or an appeal court's. */
export function repertoriesFor(courtName: string): string[] {
  const list = /^Sąd Apelacyjny/u.test(courtName) ? APPEAL : /^Sąd Okręgowy/u.test(courtName) ? DISTRICT : /^Sąd Rejonowy/u.test(courtName) ? REGIONAL : [...REGIONAL, ...DISTRICT, ...APPEAL];
  return [...new Set(list)];
}

/** Years a pending case may carry: this year back to fifteen years ago. */
export function signatureYears(now: Date = new Date()): string[] {
  return Array.from({ length: 16 }, (_, index) => String(now.getFullYear() - index));
}

/** "XI C 1768/26" (or "/2026", "sygn. akt …") into its parts; the year in four digits. */
export function splitSignature(value: string): SignatureParts | null {
  const text = value.normalize("NFKC").replace(/^sygn\.?\s*(?:akt)?\s*:?\s*/iu, "").replace(/\s+/gu, " ").trim();
  const match = /^([IVXL]{1,6}) ([0-9]?[A-Z][A-Za-z]{0,5}(?:-[A-Za-z]+)?) (\d{1,6})\/(\d{2}|\d{4})$/u.exec(text);
  if (!match) return null;
  return { wydzial: match[1]!, repertorium: match[2]!, numer: String(Number(match[3])), rok: match[4]!.length === 2 ? `20${match[4]}` : match[4]! };
}

/** The parts written as the court writes them: "XI C 1768/26". Null while a part is missing or wrong. */
export function composeSignature(parts: SignatureParts): string | null {
  const wydzial = parts.wydzial.trim().toUpperCase();
  const repertorium = parts.repertorium.trim();
  const numer = parts.numer.trim();
  const rok = parts.rok.trim();
  if (!/^[IVXL]{1,6}$/u.test(wydzial) || !/^[0-9]?[A-Z][A-Za-z]{0,5}(?:-[A-Za-z]+)?$/u.test(repertorium) || !/^\d{1,6}$/u.test(numer) || !/^(?:\d{2}|\d{4})$/u.test(rok)) return null;
  return `${wydzial} ${repertorium} ${Number(numer)}/${rok.slice(-2)}`;
}

export const EMPTY_SIGNATURE: SignatureParts = { wydzial: "", repertorium: "", numer: "", rok: "" };
