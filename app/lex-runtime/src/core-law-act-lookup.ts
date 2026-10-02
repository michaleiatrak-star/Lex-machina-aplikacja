import { eliLinks } from "./core-law-index.js";
import { shortActTitle } from "./eli-act-descriptor.js";

/**
 * Akt prawny dodawany przez użytkownika do lokalnej kopii (RAG): adres ISAP
 * (WDU20250000383), ELI (DU/2025/383, eli.gov.pl, api.sejm.gov.pl) albo
 * "Dz.U. 2025 poz. 383" / "M.P. 2024 poz. 12". Akt jest zawsze sprawdzany
 * w Sejm ELI: istnienie, akt bazowy (gdy podano obwieszczenie t.j.), najnowszy
 * tekst jednolity, status i dostępność tekstu. Do kopii trafia najnowszy t.j.,
 * a gdy go nie ma — tekst aktu.
 */

const ELI_ACTS = "https://api.sejm.gov.pl/eli/acts";
const REQUEST_TIMEOUT_MS = 15_000;

export type EliFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type CoreLawActLookup = {
  // ELI wskazane przez użytkownika.
  inputEli: string;
  // Akt, którego dotyczy (dla obwieszczenia t.j.: akt ogłoszony w t.j.).
  baseEli: string;
  // Tekst pobierany do kopii: najnowszy t.j. albo sam akt.
  currentEli: string;
  title: string;
  // Krótka nazwa dla list i modeli: "Ustawa o podatku akcyzowym", "Kodeks wykroczeń".
  shortTitle: string;
  type: string | null;
  status: string | null;
  promulgation: string | null;
  consolidated: boolean;
  consolidatedTitle: string | null;
  // Nowelizacje po pobieranym tekście (po t.j. albo od ogłoszenia aktu).
  amendmentsAfter: number;
  sourceUrl: string;
};

export class CoreLawActLookupError extends Error {
  constructor(
    readonly code:
      | "CORE_LAW_ACT_REFERENCE_INVALID"
      | "CORE_LAW_ACT_NOT_FOUND"
      | "CORE_LAW_ACT_NOT_IN_FORCE"
      | "CORE_LAW_ACT_TEXT_UNAVAILABLE"
      | "CORE_LAW_ACT_SOURCE_UNAVAILABLE",
    readonly httpStatus: number
  ) {
    super(code);
  }
}

/** ELI ("DU/2025/383", "MP/2024/12") z adresu ISAP, ELI albo oznaczenia dziennika. */
export function parseLegalActReference(input: string): string | null {
  const value = input.normalize("NFKC").trim();
  if (!value || value.length > 500) return null;

  // ISAP: W + DU/MP + rok + nr (3 cyfry) + pozycja (4 cyfry), np. WDU19640160093 = Dz.U. 1964 nr 16 poz. 93.
  const isap = /\bW(DU|MP)(\d{4})(\d{3})(\d{4})\b/i.exec(value);
  if (isap) {
    const pos = Number(isap[4]);
    return pos > 0 ? `${isap[1]!.toUpperCase()}/${isap[2]}/${pos}` : null;
  }

  const eli = /(?:^|[^A-Za-z])(DU|MP)\/(\d{4})\/(\d{1,6})(?!\d)/i.exec(value);
  if (eli) {
    const pos = Number(eli[3]);
    return pos > 0 ? `${eli[1]!.toUpperCase()}/${eli[2]}/${pos}` : null;
  }

  const journal =
    /\b(Dz\.?\s*U|M\.?\s*P)\.?\s*(?:z\s+)?(\d{4})\s*(?:r\.?)?\s*,?\s*(?:nr\s*\d+\s*,?\s*)?poz\.?\s*(\d{1,6})\b/iu.exec(
      value
    );
  if (journal) {
    const publisher = /^dz/i.test(journal[1]!) ? "DU" : "MP";
    const pos = Number(journal[3]);
    return pos > 0 ? `${publisher}/${journal[2]}/${pos}` : null;
  }
  return null;
}

function order(eli: string): [number, number] {
  const match = /^(?:DU|MP)\/(\d{4})\/(\d+)$/.exec(eli);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function eliJson(fetcher: EliFetch, path: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(`${ELI_ACTS}/${path}`, {
      headers: { Accept: "application/json", "User-Agent": "LexMachina-core-law-acts/1.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    throw new CoreLawActLookupError("CORE_LAW_ACT_SOURCE_UNAVAILABLE", 502);
  }
  if (response.status === 404) {
    throw new CoreLawActLookupError("CORE_LAW_ACT_NOT_FOUND", 404);
  }
  if (!response.ok) {
    throw new CoreLawActLookupError("CORE_LAW_ACT_SOURCE_UNAVAILABLE", 502);
  }
  try {
    const body: unknown = await response.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new CoreLawActLookupError("CORE_LAW_ACT_SOURCE_UNAVAILABLE", 502);
  }
}

/** "Ustawa z dnia 6 grudnia 2008 r. o podatku akcyzowym" -> "Ustawa o podatku akcyzowym". */
export function shortLegalActName(title: string, type: string | null): string {
  const short = shortActTitle(title);
  if (short.length < 4) return title;
  return /^\p{Ll}/u.test(short) ? `${type?.trim() || "Akt"} ${short}` : short;
}

export async function lookupCoreLawAct(
  reference: string,
  fetcher: EliFetch = globalThis.fetch.bind(globalThis)
): Promise<CoreLawActLookup> {
  const inputEli = parseLegalActReference(reference);
  if (!inputEli) {
    throw new CoreLawActLookupError("CORE_LAW_ACT_REFERENCE_INVALID", 400);
  }

  const meta = await eliJson(fetcher, inputEli);
  const references = await eliJson(fetcher, `${inputEli}/references`);

  // Obwieszczenie t.j.: akt bazowy z relacji "Tekst jednolity dla aktu".
  const baseEli = eliLinks(references, (key) => /jednolit\S* dla/i.test(key))[0]?.eli ?? inputEli;
  const baseMeta = baseEli === inputEli ? meta : await eliJson(fetcher, baseEli);
  const baseReferences =
    baseEli === inputEli ? references : await eliJson(fetcher, `${baseEli}/references`);

  const status = text(baseMeta.status);
  if (status && /uchyl|nieobowi|wygas|wygaś/i.test(status)) {
    throw new CoreLawActLookupError("CORE_LAW_ACT_NOT_IN_FORCE", 422);
  }

  const newest = eliLinks(baseReferences, (key) => /^Inf\. o tekście jednolitym$/i.test(key))
    .filter((link) => !/uchyl|nieobowi/i.test(link.status))
    .sort((a, b) => a.year - b.year || a.pos - b.pos)
    .at(-1);
  let currentEli = inputEli;
  if (newest) {
    const [year, pos] = order(currentEli);
    if (currentEli === baseEli || newest.year > year || (newest.year === year && newest.pos > pos)) {
      currentEli = newest.eli;
    }
  }

  const currentMeta =
    currentEli === inputEli ? meta : currentEli === baseEli ? baseMeta : await eliJson(fetcher, currentEli);
  if (currentMeta.textHTML !== true && currentMeta.textPDF !== true) {
    throw new CoreLawActLookupError("CORE_LAW_ACT_TEXT_UNAVAILABLE", 422);
  }

  const consolidated = currentEli !== baseEli;
  const currentReferences =
    currentEli === inputEli
      ? references
      : currentEli === baseEli
        ? baseReferences
        : await eliJson(fetcher, `${currentEli}/references`);
  const amendmentsAfter = eliLinks(currentReferences, (key) =>
    consolidated ? /^Nowelizacje po tekście jednolitym$/i.test(key) : /^Akty zmieniające$/i.test(key)
  ).length;

  return {
    inputEli,
    baseEli,
    currentEli,
    title: text(baseMeta.title) ?? baseEli,
    shortTitle: shortLegalActName(text(baseMeta.title) ?? baseEli, text(baseMeta.type)),
    type: text(baseMeta.type),
    status,
    promulgation: text(baseMeta.promulgation),
    consolidated,
    consolidatedTitle: consolidated ? text(currentMeta.title) : null,
    amendmentsAfter,
    sourceUrl: `${ELI_ACTS}/${currentEli}`
  };
}
