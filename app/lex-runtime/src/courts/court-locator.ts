// The district, regional and appeal court of an address, from official services only:
//   1. GUGiK address geocoder (UUG): the address point, its commune (TERC) and coordinates;
//   2. a whole commune: its court from the regulation (court-base.ts);
//   3. Warsaw, Kraków, Łódź: the registration unit (dzielnica, delegatura) of the point from
//      ULDK (GUGiK cadastre), mapped to its court by the regulation;
//   4. Gdańsk, Katowice, Lublin, Poznań, Szczecin, Wrocław: the court area of PRG (GUGiK WFS)
//      containing the point; a point within NEAR_BOUNDARY_METRES of another court's area is
//      reported with both (Szczecin's boundary runs along street axes).
// The regional and appeal court come from the regulation, never from PRG (its court layer
// lags behind: Czeladź, Grójec, Sławno, checked by app/courts/check_court_base_prg.py).
import {
  appealCourt,
  COURT_ACT,
  courtOfCommune,
  courtOfUnit,
  courtsHearing,
  districtCourt,
  regionalCourt,
  courtBase,
  type CaseKind,
  type CourtContact,
  type RegionalCourt
} from "./court-base.js";

export const UUG_URL = "https://services.gugik.gov.pl/uug/";
export const ULDK_URL = "https://uldk.gugik.gov.pl/";
export const PRG_WFS_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries";
export const NEAR_BOUNDARY_METRES = 30;

export type FetchText = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type CourtCard = {
  nazwa: string;
  adres: string | null;
  epuap?: string;
  email?: string;
  telefon?: string;
  zakres: string[];
};

export type CourtLookup = {
  status: "FOUND" | "NEAR_BOUNDARY" | "ADDRESS_NOT_FOUND" | "ADDRESS_INCOMPLETE" | "SERVICE_UNAVAILABLE";
  // What the services matched, without the street and number (they stay in the application).
  place?: { gmina: string; terc: string; jednostka?: string; exactNumber: boolean };
  method?: "AKT_GMINA" | "ULDK_JEDNOSTKA" | "PRG_OBSZAR_SADU" | "AKT_NAZWA_MIEJSCOWOSCI";
  sr?: CourtCard;
  so?: CourtCard;
  sa?: CourtCard;
  // NEAR_BOUNDARY: the courts of both sides; ADDRESS_*: the courts of the city when known.
  candidates?: CourtCard[];
  // A kind of case the district court does not hear: the courts of the region that do.
  kind?: { requested: CaseKind; heard: boolean; alternatives: CourtCard[] };
  basis: string;
  notes: string[];
};

export type ParsedAddress = {
  street?: string;
  // The name before the number may be a village with its post office elsewhere.
  village?: boolean;
  number?: string;
  locality?: string;
  postalCode?: string;
  postOffice?: string;
};

const STREET_PREFIX = /^(?:ul\.|ulica|al\.|aleja|aleje|pl\.|plac|os\.|osiedle|rondo|skwer|bulw\.|bulwar)\s+/iu;
// "12", "12A", "12/14", "12 lok. 3", "12 m. 3", "12/3" (a flat after the slash is tried without).
const NUMBER = /\b(\d{1,4}(?:\s?[A-Za-z](?![\p{L}]))?(?:\s*[/-]\s*\d{1,4}[A-Za-z]?)?)(?:\s*(?:m\.|lok\.|lokal|mieszk\.|m)\s*\d{1,4}[A-Za-z]?)?\s*$/u;

/** A Polish address as written in a letter: street and number, postal code, town. */
export function parseAddress(raw: string): ParsedAddress {
  const text = raw
    .replace(/\s+/gu, " ")
    .replace(/[;]+/gu, ",")
    // "Buszy nr 1", "Długa nr. 12": the number without its label.
    .replace(/\s+nr\.?\s+(?=\d)/giu, " ")
    .replace(/\s*,\s*/gu, ", ")
    .replace(/,\s*$/u, "")
    .trim();
  const postal = /\b(\d{2}-\d{3})\s+([\p{L}][\p{L} .-]*?)(?=,|$)/u.exec(text);
  const rest = postal ? (text.slice(0, postal.index) + text.slice(postal.index + postal[0].length)).replace(/^,\s*|,\s*$/gu, "").replace(/,\s*,/gu, ",") : text;
  const parts = rest.split(/,\s*/u).map((part) => part.trim()).filter(Boolean);
  const address: ParsedAddress = {};
  if (postal) {
    address.postalCode = postal[1]!;
    address.postOffice = postal[2]!.trim();
  }
  // The part with a house number is the street (or, without one, the locality and its number).
  const numbered = parts.findIndex((part) => NUMBER.test(part));
  if (numbered >= 0) {
    const part = parts[numbered]!;
    const match = NUMBER.exec(part)!;
    address.number = match[1]!.replace(/\s+/gu, "");
    const name = part.slice(0, match.index).trim();
    const others = parts.filter((_, index) => index !== numbered);
    if (STREET_PREFIX.test(name) || others.length || postal) {
      // "ul. Długa 12, Kraków" / "Długa 12, 31-147 Kraków" / "Kołbaskowo 106, 72-001 Kołbaskowo".
      const locality = others[0] ?? address.postOffice;
      if (!STREET_PREFIX.test(name) && postal && !others.length && locality && name.toLocaleLowerCase("pl") === locality.toLocaleLowerCase("pl")) {
        address.locality = name;
      } else if (!STREET_PREFIX.test(name) && !others.length && postal) {
        // "Kozłówka 5, 21-132 Kamionka": a village with its post office elsewhere, or a street.
        address.street = name;
        address.locality = address.postOffice!;
        address.village = true;
      } else {
        address.street = name;
        if (locality) address.locality = locality;
      }
    } else {
      address.locality = name;
    }
  } else if (parts.length) {
    address.locality = parts.at(-1)!;
  }
  if (address.locality && !address.street && !address.number && address.postOffice) address.locality = address.postOffice;
  return address;
}

const words = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("pl")
    .replace(/[„”"'.]/gu, " ")
    .split(/[\s-]+/u)
    .filter((word) => word.length > 1 && !/^(?:ul|al|pl|os|aleja|aleje|plac|osiedle|ulica|gen|marsz|ks|św|im|płk|prof|dr)$/u.test(word));

const sameText = (a: string, b: string) => words(a).join(" ") === words(b).join(" ");

// village: a name before the number taken as a village (its post office elsewhere); accepted
// only with the postal code of the letter (else "Kościuszki 50" finds a village Kościuszki).
type Query = { text: string; number: string; street?: string; locality: string; village?: boolean };

// The number as the register writes it: "12", "12A", "10/16"; a flat ("12/3") and a range
// ("2-3") are tried as their first building number too.
function numberVariants(number: string): string[] {
  const compact = number.replace(/\s+/gu, "").toUpperCase().replace(/^(\d+)([A-Z])$/u, "$1$2");
  return [...new Set([compact, compact.replace(/\/.*$/u, ""), compact.replace(/-.*$/u, "")])].filter(Boolean);
}

function queries(address: ParsedAddress): Query[] {
  const out: Query[] = [];
  if (!address.number) return out;
  const street = address.street?.replace(STREET_PREFIX, (prefix) => (/^(?:al\.|aleja|aleje)/iu.test(prefix) ? "Aleja " : /^(?:pl\.|plac)/iu.test(prefix) ? "Plac " : /^(?:os\.|osiedle)/iu.test(prefix) ? "Osiedle " : ""));
  for (const number of numberVariants(address.number)) {
    if (street && address.locality) out.push({ text: `${address.locality}, ${street} ${number}`, number, street, locality: address.locality });
    // A village with its post office elsewhere ("Kozłówka 5, 21-132 Kamionka"): the village itself.
    if (street && address.village) out.push({ text: `${street} ${number}`, number, locality: street, village: true });
    if (!street && address.locality) out.push({ text: `${address.locality} ${number}`, number, locality: address.locality });
  }
  return out.filter((query, index) => out.findIndex((other) => other.text === query.text) === index);
}

/** A hit is the address asked for: the same number, town (or postal code) and street. */
function matches(hit: UugHit, query: Query, address: ParsedAddress): boolean {
  if (hit.number.toUpperCase().replace(/\s+/gu, "") !== query.number) return false;
  const town = sameText(hit.city, query.locality) || (address.postOffice ? sameText(hit.city, address.postOffice) : false);
  const coded = Boolean(address.postalCode) && hit.code === address.postalCode;
  if (!town && !coded) return false;
  if (query.village && !coded) return false;
  if (!query.street) return hit.street === null || sameText(hit.city, query.locality);
  if (!hit.street) return false;
  return sameStreet(hit.street, query.street);
}

// The register shortens ("Boh. Warszawy") and drops given names ("Staszica" for "Stanisława
// Staszica"): the main (last) word must be the same, another word may be its abbreviation.
function sameStreet(register: string, written: string): boolean {
  const have = words(register);
  const want = words(written);
  const main = want.at(-1);
  if (!main || have.at(-1) !== main) return false;
  return want.slice(0, -1).every((word) => have.includes(word) || have.some((other) => other.length >= 3 && word.startsWith(other)) || !have.slice(0, -1).length);
}

type UugHit = { city: string; street: string | null; number: string; teryt: string; x: number; y: number; accuracy: number; code: string };

async function geocode(fetchText: FetchText, query: string, signal?: AbortSignal): Promise<UugHit[]> {
  const url = `${UUG_URL}?${new URLSearchParams({ request: "GetAddress", address: query })}`;
  const response = await fetchText(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`UUG_HTTP_${response.status}`);
  const text = await response.text();
  // UUG answers a query it cannot parse ("Rynek 2-3") with plain "Blad zapytania.": no hit.
  if (!text.trimStart().startsWith("{")) return [];
  const body = JSON.parse(text) as { results?: Record<string, Record<string, string>> | null };
  return Object.values(body.results ?? {}).map((item) => ({
    city: item.city ?? "",
    street: item.street ?? null,
    number: item.number ?? "",
    teryt: item.teryt ?? "",
    x: Number(item.x),
    y: Number(item.y),
    accuracy: Number(item.accuracy),
    code: item.code ?? ""
  }));
}

async function registrationUnit(fetchText: FetchText, x: number, y: number, signal?: AbortSignal): Promise<string | null> {
  const url = `${ULDK_URL}?request=GetParcelByXY&xy=${x},${y},2180&result=teryt`;
  const response = await fetchText(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`ULDK_HTTP_${response.status}`);
  const lines = (await response.text()).trim().split("\n");
  if (lines[0]?.trim() !== "0" || !lines[1]) return null;
  return /^(\d{6}_\d)/u.exec(lines[1])?.[1] ?? null;
}

async function prgCourtAreas(fetchText: FetchText, x: number, y: number, radius: number, signal?: AbortSignal): Promise<string[]> {
  // EPSG:2180 as an URN: northing first.
  const bbox = [y - radius, x - radius, y + radius, x + radius].map((value) => value.toFixed(2)).join(",");
  const url = `${PRG_WFS_URL}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ms:S03_Sad_rejonowy&PROPERTYNAME=JPT_NAZWA_&BBOX=${bbox},urn:ogc:def:crs:EPSG::2180`;
  const response = await fetchText(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`PRG_HTTP_${response.status}`);
  return [...new Set([...(await response.text()).matchAll(/<ms:JPT_NAZWA_>([^<]+)<\/ms:JPT_NAZWA_>/gu)].map((match) => match[1]!.trim()))];
}

function card(court: { nazwa: string; zakres: string[]; adres?: CourtContact }): CourtCard {
  const contact = court.adres;
  return {
    nazwa: court.nazwa,
    adres: contact ? `${/^(?:ul\.|al\.|pl\.|os\.|Plac|Aleja|Al\.)/u.test(contact.ulica) ? contact.ulica : `ul. ${contact.ulica}`}, ${contact.kod} ${contact.miejscowosc}` : null,
    ...(contact?.epuap ? { epuap: contact.epuap } : {}),
    ...(contact?.email ? { email: contact.email } : {}),
    ...(contact?.telefon ? { telefon: contact.telefon } : {}),
    zakres: court.zakres
  };
}

function withLevels(court: RegionalCourt, kind: CaseKind | undefined): Pick<CourtLookup, "sr" | "so" | "sa" | "kind"> {
  const so = districtCourt(court.so);
  const sa = so ? appealCourt(so.sa) : null;
  return {
    sr: card(court),
    ...(so ? { so: card(so) } : {}),
    ...(sa ? { sa: card(sa) } : {}),
    ...(kind
      ? {
          kind: {
            requested: kind,
            heard: court.zakres.includes(kind),
            alternatives: court.zakres.includes(kind) ? [] : courtsHearing(kind, court.so).map(card)
          }
        }
      : {})
  };
}

const basisOf = (court: RegionalCourt) => `${COURT_ACT}, § 3: ${court.nazwa} – dla ${court.obszar_tekst}`;

export type LocateOptions = { fetchText: FetchText; kind?: CaseKind; signal?: AbortSignal };

/** The courts of an address (the address itself is not part of the result). */
export async function locateCourt(raw: string, options: LocateOptions): Promise<CourtLookup> {
  const result = await locate(raw, options);
  return result;
}

async function locate(raw: string, options: LocateOptions): Promise<CourtLookup> {
  const address = parseAddress(raw);
  const asked = queries(address);
  if (!asked.length) {
    return { status: "ADDRESS_INCOMPLETE", basis: COURT_ACT, notes: ["Adres bez numeru budynku albo bez miejscowości: podaj pełny adres (ulica i numer albo miejscowość i numer)."], ...offlineCandidates(address) };
  }
  let hits: UugHit[] = [];
  let exactNumber = false;
  try {
    for (const query of asked) {
      const found = (await geocode(options.fetchText, query.text, options.signal)).filter((hit) => Number.isFinite(hit.x) && matches(hit, query, address));
      if (found.length) {
        hits = found;
        exactNumber = query.number === numberVariants(address.number ?? "")[0];
        break;
      }
    }
  } catch (error) {
    return { status: "SERVICE_UNAVAILABLE", basis: COURT_ACT, notes: [`Geokoder GUGiK niedostępny (${error instanceof Error ? error.message : String(error)}).`], ...offlineCandidates(address) };
  }
  let neighbour: string | null = null;
  if (!hits.length && address.number && /^\d+/u.test(address.number)) {
    // A number missing from the register: the nearest existing one on the same side of the
    // street first (even/odd), the result marked approximate.
    const base = Number(/^\d+/u.exec(address.number)![0]);
    const nearby = [2, -2, 4, -4, 1, -1, 6, -6].map((step) => base + step).filter((value) => value > 0);
    try {
      for (const query of asked.filter((item) => item.number === numberVariants(address.number!)[0]).slice(0, 1)) {
        for (const number of nearby) {
          const probe = { ...query, number: String(number), text: query.text.replace(/\s\S+$/u, ` ${number}`) };
          const found = (await geocode(options.fetchText, probe.text, options.signal)).filter((hit) => Number.isFinite(hit.x) && matches(hit, probe, address));
          if (found.length) {
            hits = found;
            neighbour = String(number);
            break;
          }
        }
      }
    } catch {
      // Below: the street or the town alone.
    }
  }
  if (!hits.length) {
    try {
      const commune = await communeWithoutNumber(options.fetchText, address, options.signal);
      if (commune) return commune.lookup(options.kind);
    } catch {
      // As below: the address is reported as not found.
    }
    return { status: "ADDRESS_NOT_FOUND", basis: COURT_ACT, notes: ["Geokoder GUGiK nie znalazł tego adresu (numer budynku musi istnieć w ewidencji): sprawdź adres w aktach."], ...offlineCandidates(address) };
  }
  const best = hits.sort((a, b) => b.accuracy - a.accuracy)[0]!;
  const communes = new Set(hits.filter((hit) => hit.accuracy === best.accuracy).map((hit) => hit.teryt));
  if (communes.size > 1) {
    return { status: "ADDRESS_NOT_FOUND", basis: COURT_ACT, notes: [`Adres pasuje do ${communes.size} gmin: podaj kod pocztowy.`] };
  }
  const commune = courtOfCommune(best.teryt);
  if (!commune) {
    return { status: "ADDRESS_NOT_FOUND", basis: COURT_ACT, notes: [`Gmina ${best.teryt} poza wykazem rozporządzenia.`] };
  }
  const place = { gmina: best.city, terc: best.teryt, exactNumber: exactNumber && !neighbour };
  const approximate = neighbour ? [`Numeru ${address.number} nie ma w ewidencji adresów; położenie ustalone według sąsiedniego numeru ${neighbour} tej ulicy.`] : [];
  if ("court" in commune) {
    return { status: "FOUND", place, method: "AKT_GMINA", ...withLevels(commune.court, options.kind), basis: basisOf(commune.court), notes: approximate };
  }
  const city = commune.split;
  try {
    if (city.jednostki_ewidencyjne) {
      const unit = await registrationUnit(options.fetchText, best.x, best.y, options.signal);
      const found = unit ? courtOfUnit(unit) : null;
      if (found) {
        return {
          status: "FOUND",
          place: { ...place, jednostka: found.unit },
          method: "ULDK_JEDNOSTKA",
          ...withLevels(found.court, options.kind),
          basis: `${basisOf(found.court)} (dzielnica ${found.unit} z ewidencji gruntów, ULDK GUGiK)`,
          notes: approximate
        };
      }
    }
    const here = await prgCourtAreas(options.fetchText, best.x, best.y, 0.5, options.signal);
    const around = await prgCourtAreas(options.fetchText, best.x, best.y, NEAR_BOUNDARY_METRES, options.signal);
    const own = here.map(regionalCourt).filter((court): court is RegionalCourt => Boolean(court) && city.sady.includes(court!.nazwa));
    const near = around.map(regionalCourt).filter((court): court is RegionalCourt => Boolean(court) && city.sady.includes(court!.nazwa));
    if (own.length === 1 && near.length <= 1) {
      return { status: "FOUND", place, method: "PRG_OBSZAR_SADU", ...withLevels(own[0]!, options.kind), basis: `${basisOf(own[0]!)} (obszar sądu z PRG GUGiK)`, notes: approximate };
    }
    const sides = (own.length ? [...own, ...near.filter((court) => !own.includes(court))] : near).slice(0, 3);
    if (sides.length) {
      return {
        status: "NEAR_BOUNDARY",
        place,
        method: "PRG_OBSZAR_SADU",
        ...(own.length === 1 ? withLevels(own[0]!, options.kind) : {}),
        candidates: sides.map(card),
        basis: sides.map(basisOf).join(" | "),
        notes: [...approximate, `Adres leży przy granicy obszarów sądów (do ${NEAR_BOUNDARY_METRES} m): sprawdź opis granicy w rozporządzeniu dla strony ulicy tego budynku.`]
      };
    }
  } catch (error) {
    return {
      status: "SERVICE_UNAVAILABLE",
      place,
      candidates: city.sady.map(regionalCourt).filter((court): court is RegionalCourt => Boolean(court)).map(card),
      basis: COURT_ACT,
      notes: [`Miasto ${city.nazwa} ma kilka sądów rejonowych, a usługa obszarów sądów GUGiK nie odpowiedziała (${error instanceof Error ? error.message : String(error)}).`]
    };
  }
  return {
    status: "ADDRESS_NOT_FOUND",
    place,
    candidates: city.sady.map(regionalCourt).filter((court): court is RegionalCourt => Boolean(court)).map(card),
    basis: COURT_ACT,
    notes: [`Punkt adresowy poza obszarami sądów miasta ${city.nazwa} w PRG.`]
  };
}

/**
 * A number missing from the register (a new building, a number written otherwise): the street
 * in its town, else the town alone when its name is one commune's. The court follows when the
 * commune has one district court; a city with several needs the building.
 */
async function communeWithoutNumber(fetchText: FetchText, address: ParsedAddress, signal?: AbortSignal): Promise<{ lookup: (kind?: CaseKind) => CourtLookup } | null> {
  const town = address.street && !address.village ? address.locality : address.locality ?? address.postOffice;
  if (!town) return null;
  const tried: Array<{ query: string; keep: (hit: UugHit) => boolean; level: string }> = [];
  if (address.street) tried.push({ query: `${town}, ${address.street.replace(STREET_PREFIX, "")}`, keep: (hit) => sameText(hit.city, town) && Boolean(hit.street) && sameStreet(hit.street!, address.street!), level: "ulicy" });
  tried.push({ query: town, keep: (hit) => sameText(hit.city, town) && !hit.street, level: "miejscowości" });
  for (const { query, keep, level } of tried) {
    const found = (await geocode(fetchText, query, signal)).filter(keep);
    const communes = [...new Set(found.map((hit) => hit.teryt))];
    if (communes.length === 1) {
      const commune = courtOfCommune(communes[0]!);
      if (!commune) return null;
      const place = { gmina: found[0]!.city, terc: communes[0]!, exactNumber: false };
      return {
        lookup: (kind) =>
          "court" in commune
            ? {
                status: "FOUND",
                place,
                method: "AKT_GMINA",
                ...withLevels(commune.court, kind),
                basis: basisOf(commune.court),
                notes: [`Numeru budynku nie ma w ewidencji adresów; sąd ustalony dla ${level} w gminie, która w całości należy do jednego sądu rejonowego.`]
              }
            : {
                status: "ADDRESS_NOT_FOUND",
                place,
                candidates: commune.split.sady.map(regionalCourt).filter((court): court is RegionalCourt => Boolean(court)).map(card),
                basis: COURT_ACT,
                notes: [`${commune.split.nazwa} ma kilka sądów rejonowych: potrzebny numer budynku istniejący w ewidencji adresów.`]
              }
      };
    }
    if (communes.length > 1) return null;
  }
  return null;
}

const placeKey = (text: string) => text.normalize("NFKC").toLocaleLowerCase("pl").replace(/[-\s]+/gu, " ").replace(/\s*\([^)]*\)/gu, "").trim();

/**
 * Without the geocoder: the court of a town named in the regulation (a town is a commune
 * of its own or the seat of one); villages and split cities are left as candidates.
 */
export function offlineCandidates(address: ParsedAddress): Pick<CourtLookup, "candidates" | "method" | "sr" | "so" | "sa"> | Record<string, never> {
  const names = [address.locality, address.postOffice].filter((name): name is string => Boolean(name)).map(placeKey);
  if (!names.length) return {};
  const base = courtBase();
  for (const city of Object.values(base.miasta_dzielone)) {
    if (names.includes(placeKey(city.nazwa))) {
      return { candidates: city.sady.map(regionalCourt).filter((court): court is RegionalCourt => Boolean(court)).map(card) };
    }
  }
  const courts = base.sr.filter((court) => court.obszar.miasta.some((town) => names.includes(placeKey(town))));
  if (courts.length === 1) return { candidates: courts.map(card) };
  return {};
}
