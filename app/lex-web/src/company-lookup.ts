import { queryMcpSearch, type InvoiceParty, type McpSearchQueryResponse } from "./api.js";

// Dane kontrahenta po NIP z rejestrów online, przez konektory MCP (bez modelu):
// najpierw biała lista VAT (bez klucza; spółki i JDG zarejestrowane do VAT),
// a gdy podmiotu w niej nie ma albo wykaz nie odpowiada: CEIDG (JDG, wymaga klucza).
// KRS szuka po NIP przez ten sam wykaz VAT, więc nie daje nic ponad białą listę.

type Row = Record<string, unknown>;
type Query = (source: string, tool: string, args: Record<string, unknown>) => Promise<McpSearchQueryResponse>;

export type CompanyLookup = {
  party: InvoiceParty;
  source: "biala-lista-vat" | "ceidg";
  sourceLabel: string;
  status: string;
  // Rachunki z wykazu VAT (tylko biała lista); do faktury sprzedawcy.
  accounts: string[];
  warnings: string[];
  evidence: string | null;
};

export class CompanyLookupError extends Error {}

const WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

// "PL 123-456-32-18" → "1234563218"; null, gdy to nie jest poprawny NIP.
export function normalizeNip(input: string): string | null {
  const nip = input.replace(/[\s-]/g, "").replace(/^PL/i, "");
  if (!/^\d{10}$/.test(nip)) return null;
  const sum = WEIGHTS.reduce((total, weight, index) => total + weight * Number(nip[index]), 0) % 11;
  return sum === Number(nip[9]) ? nip : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// CEIDG podaje adres jako "ulica nr kod miasto"; przecinek przed kodem pocztowym.
function ceidgAddress(value: string): string {
  return value.replace(/\s+(\d{2}-\d{3})\s+/, ", $1 ");
}

export function fromWhiteList(nip: string, reply: Row): CompanyLookup | null {
  if (reply.status !== "FOUND" || !reply.result || typeof reply.result !== "object") return null;
  const row = reply.result as Row;
  const name = text(row.tytul_lub_nazwa);
  const address = text(row.adres);
  if (!name || !address) return null;
  const status = text(row.status_vat) ?? "nieznany";
  const warnings: string[] = [];
  if (status !== "Czynny") {
    const removed = text(row.data_wykreslenia);
    warnings.push(`Status VAT: ${status}${removed ? ` (wykreślony ${removed})` : ""}. Sprawdź, czy faktura ma być wystawiona temu podmiotowi.`);
  }
  if (row.ma_rachunki_wirtualne === true) warnings.push("Podmiot ma rachunki wirtualne.");
  const proof = reply.dowod_sprawdzenia as Row | undefined;
  return {
    party: { name, nip, address },
    source: "biala-lista-vat",
    sourceLabel: "biała lista VAT (Ministerstwo Finansów)",
    status: `VAT: ${status}`,
    accounts: Array.isArray(row.rachunki) ? row.rachunki.filter((item): item is string => typeof item === "string") : [],
    warnings,
    evidence: text(proof?.requestId)
  };
}

export function fromCeidg(nip: string, reply: Row): CompanyLookup | null {
  if (reply.status !== "FOUND" || !reply.result || typeof reply.result !== "object") return null;
  const row = reply.result as Row;
  const answered = text(row.identyfikator);
  if (answered && answered !== nip) throw new CompanyLookupError(`CEIDG zwróciło inny NIP (${answered}) niż podany. Dane nie zostały wstawione.`);
  const name = text(row.tytul_lub_nazwa);
  const address = text(row.adres_dzialalnosci);
  if (!name || !address) return null;
  const status = text(row.status_ceidg) ?? "nieznany";
  const warnings = status === "AKTYWNY"
    ? []
    : [`Status w CEIDG: ${status}. Sprawdź, czy faktura ma być wystawiona temu przedsiębiorcy.`];
  return {
    party: { name, nip, address: ceidgAddress(address) },
    source: "ceidg",
    sourceLabel: "CEIDG",
    status: `CEIDG: ${status}`,
    accounts: [],
    warnings,
    evidence: text(row.id_ceidg)
  };
}

function problem(reply: Row): string | null {
  if (reply.status === "NOT_FOUND") return null;
  return text(reply.detail) ?? text(reply.error) ?? text(reply.status) ?? "brak odpowiedzi";
}

async function ask(query: Query, source: string, tool: string, nip: string): Promise<Row> {
  try {
    const reply = await query(source, tool, { nip });
    return reply.result && typeof reply.result === "object" ? reply.result as Row : { status: "ERROR" };
  } catch (error) {
    return { status: "ERROR", detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function lookupCompanyByNip(input: string, query: Query = queryMcpSearch): Promise<CompanyLookup> {
  const nip = normalizeNip(input);
  if (!nip) throw new CompanyLookupError("Nieprawidłowy NIP: potrzebne 10 cyfr z poprawną cyfrą kontrolną.");

  const whiteList = await ask(query, "wl", "wl_sprawdz_nip", nip);
  const fromList = fromWhiteList(nip, whiteList);
  if (fromList) return fromList;

  const ceidg = await ask(query, "ceidg", "ceidg_szukaj_firmy", nip);
  const fromRegistry = fromCeidg(nip, ceidg);
  if (fromRegistry) return fromRegistry;

  const listProblem = problem(whiteList);
  const ceidgProblem = problem(ceidg);
  if (!listProblem && !ceidgProblem) {
    throw new CompanyLookupError(`Nie znaleziono podmiotu o NIP ${nip} w wykazie podatników VAT ani w CEIDG. Wpisz dane ręcznie.`);
  }
  const parts = [
    listProblem ? `biała lista VAT: ${listProblem}` : "brak w wykazie podatników VAT",
    ceidgProblem
      ? /CEIDG_API_KEY/.test(ceidgProblem)
        ? "CEIDG: brak klucza API (Ustawienia → Konektory MCP)"
        : `CEIDG: ${ceidgProblem}`
      : "brak w CEIDG"
  ];
  throw new CompanyLookupError(`Nie udało się pobrać danych (${parts.join("; ")}). Wpisz dane ręcznie.`);
}
