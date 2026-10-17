// The common courts of Poland as the regulation of the Minister of Justice sets them (seats,
// areas, kinds of cases: t.j. Dz.U. 2026 poz. 492), with the Ministry's contact data. Built by
// app/courts/build_court_base.py; checked against the court areas of PRG (GUGiK) by
// app/courts/check_court_base_prg.py. Where PRG disagrees (its court layer lags behind the
// regulation: Czeladź, Grójec, Sławno…), the regulation decides.
import { COURT_BASE } from "./court-base-data.js";

export type CourtContact = {
  ulica: string;
  kod: string;
  miejscowosc: string;
  telefon: string;
  email: string;
  epuap: string;
};

export type CaseKind =
  | "cywilne"
  | "rodzinne"
  | "karne"
  | "pracy"
  | "ubezpieczen_spolecznych"
  | "gospodarcze"
  | "upadlosciowe"
  | "krs"
  | "rejestr_zastawow"
  | "ksiegi_wieczyste"
  | "lustracyjne"
  | "wlasnosc_intelektualna"
  | "rejestr_prasy";

export const CASE_KINDS: readonly CaseKind[] = [
  "cywilne", "rodzinne", "karne", "pracy", "ubezpieczen_spolecznych", "gospodarcze", "upadlosciowe",
  "krs", "rejestr_zastawow", "ksiegi_wieczyste", "lustracyjne", "wlasnosc_intelektualna", "rejestr_prasy"
];

type Court = { nazwa: string; zakres: CaseKind[]; adres?: CourtContact };

export type AppealCourt = Court;
export type DistrictCourt = Court & { sa: string };
export type RegionalCourt = Court & {
  so: string;
  // The area as the regulation words it (quoted in the lookup's basis).
  obszar_tekst: string;
  obszar: { miasta: string[]; gminy: string[]; czesc: { miasto: string; opis: string; jednostki?: string[] } | null };
  // TERC codes (PRG) of the communes the court covers whole.
  terc: string[];
  siedziba?: string;
};

export type SplitCity = {
  nazwa: string;
  terc: string;
  sady: string[];
  // Dzielnice of Warsaw, delegatury of Kraków and Łódź as PRG registration units (ULDK code).
  jednostki_ewidencyjne?: Record<string, { jednostka: string; sad: string }>;
};

export type CourtBase = {
  sa: AppealCourt[];
  so: DistrictCourt[];
  sr: RegionalCourt[];
  miasta_dzielone: Record<string, SplitCity>;
  zrodla: Record<string, string>;
  problemy: string[];
};

export const COURT_ACT = "rozporządzenie Ministra Sprawiedliwości z 28.12.2018 r. (t.j. Dz.U. 2026 poz. 492)";

const key = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/[–—]/gu, "-")
    .replace(/\bm\.\s?st\.\s?/giu, "miasta stołecznego ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("pl");

const byName = new Map<string, RegionalCourt | DistrictCourt | AppealCourt>();
for (const court of [...COURT_BASE.sa, ...COURT_BASE.so, ...COURT_BASE.sr]) byName.set(key(court.nazwa), court);
// A commune by the first six digits of its TERC (WWPPGG): unique within Poland.
const byCommune = new Map<string, RegionalCourt>();
for (const court of COURT_BASE.sr) for (const code of court.terc) byCommune.set(code.slice(0, 6), court);
// All cities with several district courts are cities with powiat rights: the first four digits
// of TERC (WWPP) name the city, its dzielnice and delegatury too ("146510_8" is in Warsaw).
const splitByPowiat = new Map<string, SplitCity>();
for (const city of Object.values(COURT_BASE.miasta_dzielone)) splitByPowiat.set(city.terc.slice(0, 4), city);

export function courtBase(): CourtBase {
  return COURT_BASE;
}

export function courtByName(name: string): RegionalCourt | DistrictCourt | AppealCourt | null {
  return byName.get(key(name)) ?? null;
}

export function regionalCourt(name: string): RegionalCourt | null {
  return COURT_BASE.sr.find((court) => key(court.nazwa) === key(name)) ?? null;
}

export function districtCourt(name: string): DistrictCourt | null {
  return COURT_BASE.so.find((court) => key(court.nazwa) === key(name)) ?? null;
}

export function appealCourt(name: string): AppealCourt | null {
  return COURT_BASE.sa.find((court) => key(court.nazwa) === key(name)) ?? null;
}

/**
 * The court of a commune by its TERC (6 or 7 digits, or a PRG registration unit "126105_9"):
 * a whole commune gives its district court, a city with several gives the split city.
 */
export function courtOfCommune(code: string): { court: RegionalCourt } | { split: SplitCity } | null {
  const digits = code.replace(/_/u, "");
  const split = splitByPowiat.get(digits.slice(0, 4));
  if (split) return { split };
  const court = byCommune.get(digits.slice(0, 6));
  return court ? { court } : null;
}

/** The court of a registration unit of a split city ("146510_8" Śródmieście of Warsaw). */
export function courtOfUnit(code: string): { court: RegionalCourt; unit: string } | null {
  for (const city of Object.values(COURT_BASE.miasta_dzielone)) {
    const unit = city.jednostki_ewidencyjne?.[code];
    if (unit) {
      const court = regionalCourt(unit.sad);
      return court ? { court, unit: unit.jednostka } : null;
    }
  }
  return null;
}

/** District courts of the same regional court that hear a kind of case the given one does not. */
export function courtsHearing(kind: CaseKind, district: string): RegionalCourt[] {
  return COURT_BASE.sr.filter((court) => key(court.so) === key(district) && court.zakres.includes(kind));
}

/** The court as the letter's addressee: name and the address of its seat. */
export function courtAddressLine(court: Court): string {
  const contact = court.adres;
  if (!contact) return court.nazwa;
  const street = /^(?:ul\.|al\.|pl\.|os\.|Plac|Aleja|Al\.)/u.test(contact.ulica) ? contact.ulica : `ul. ${contact.ulica}`;
  return `${court.nazwa}, ${street}, ${contact.kod} ${contact.miejscowosc}`;
}

// "Sąd Rejonowy …" in a letter's header or "Sądu Rejonowego …" in its text.
const GENITIVE: Array<[RegExp, string]> = [
  [/^Sąd Rejonowy\b/u, "Sądu Rejonowego"],
  [/^Sąd Okręgowy\b/u, "Sądu Okręgowego"],
  [/^Sąd Apelacyjny\b/u, "Sądu Apelacyjnego"]
];

let namePattern: RegExp | null = null;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+").replace(/-/gu, "\\s*[-–]\\s*");

/** Court names in a text (a court's letter, a judgment, a pleading), in order of appearance. */
export function courtsInText(text: string): Array<{ court: RegionalCourt | DistrictCourt | AppealCourt; index: number }> {
  if (!namePattern) {
    const variants = [...COURT_BASE.sa, ...COURT_BASE.so, ...COURT_BASE.sr]
      .flatMap((court) => [court.nazwa, ...GENITIVE.filter(([pattern]) => pattern.test(court.nazwa)).map(([pattern, genitive]) => court.nazwa.replace(pattern, genitive))])
      .concat(COURT_BASE.sr.filter((court) => court.nazwa.includes("miasta stołecznego")).map((court) => court.nazwa.replace("miasta stołecznego", "m.st.")))
      .sort((a, b) => b.length - a.length);
    namePattern = new RegExp(`(?<![\\p{L}])(${variants.map(escape).join("|")})(?![\\p{L}])`, "giu");
  }
  const found: Array<{ court: RegionalCourt | DistrictCourt | AppealCourt; index: number }> = [];
  for (const match of text.matchAll(namePattern)) {
    let name = match[1]!.replace(/\s+/gu, " ").replace(/\s*[-–]\s*/gu, "-").replace(/\bm\.st\./u, "miasta stołecznego");
    for (const [pattern, genitive] of GENITIVE) {
      const nominative = pattern.source.replace(/^\^|\\b$/gu, "");
      if (name.startsWith(genitive)) name = name.replace(genitive, nominative);
    }
    const court = courtByName(name);
    if (court) found.push({ court, index: match.index ?? 0 });
  }
  return found;
}
