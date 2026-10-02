import type {
  InvoiceDraft,
  InvoiceLine,
  InvoiceParty,
  InvoiceTotals,
  InvoiceView
} from "./api.js";

// Podgląd sum w formularzu. Wiążące kwoty liczy runtime (invoice-store.ts) tym samym
// sposobem: grosze na liczbach całkowitych, VAT od sumy netto w danej stawce.

const QUANTITY = /^\d{1,12}([.,]\d{1,6})?$/;
const PRICE = /^\d{1,12}([.,]\d{1,2})?$/;
const PERCENT_RATE = /^\d{1,2}([.,]\d{1,2})?$/;

function scaled(value: string, scale: number): bigint {
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  return BigInt(whole! + fraction.padEnd(scale, "0").slice(0, scale));
}

function roundDiv(value: bigint, divisor: bigint): bigint {
  return (value * 2n + divisor) / (divisor * 2n);
}

function money(cents: bigint): string {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function lineNet(line: InvoiceLine): string | null {
  if (!QUANTITY.test(line.quantity.trim()) || !PRICE.test(line.unitNetPrice.trim())) return null;
  return money(roundDiv(scaled(line.quantity.trim(), 6) * scaled(line.unitNetPrice.trim(), 2), 1_000_000n));
}

export function previewTotals(lines: InvoiceLine[]): InvoiceTotals | null {
  const byRate = new Map<string, bigint>();
  for (const line of lines) {
    const net = lineNet(line);
    const rate = line.vatRate.trim().toLowerCase();
    if (net === null || !rate) return null;
    byRate.set(rate, (byRate.get(rate) ?? 0n) + scaled(net, 2));
  }
  let net = 0n;
  let vat = 0n;
  const rows = [...byRate.entries()].map(([vatRate, rateNet]) => {
    const rateVat = PERCENT_RATE.test(vatRate)
      ? roundDiv(rateNet * scaled(vatRate, 2), 10_000n)
      : 0n;
    net += rateNet;
    vat += rateVat;
    return { vatRate, net: money(rateNet), vat: money(rateVat), gross: money(rateNet + rateVat) };
  });
  return { byRate: rows, net: money(net), vat: money(vat), gross: money(net + vat) };
}

export function formatMoney(value: string, currency: string): string {
  const [whole, fraction] = value.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped},${fraction ?? "00"} ${currency}`;
}

export function emptyLine(): InvoiceLine {
  return { name: "", unit: "szt.", quantity: "1", unitNetPrice: "", vatRate: "" };
}

export function emptyParty(): InvoiceParty {
  return { name: "", nip: "", address: "" };
}

export function emptyDraft(seller: InvoiceParty | undefined, today: string): InvoiceDraft {
  return {
    number: "",
    issueDate: today,
    saleDate: today,
    seller: seller ? { ...seller } : emptyParty(),
    buyer: emptyParty(),
    lines: [emptyLine()],
    currency: "PLN",
    paymentMethod: "przelew",
    paymentDueDate: "",
    bankAccount: "",
    notes: ""
  };
}

export function draftOf(invoice: InvoiceView): InvoiceDraft {
  return {
    number: invoice.number,
    issueDate: invoice.issueDate,
    saleDate: invoice.saleDate ?? "",
    placeOfIssue: invoice.placeOfIssue ?? "",
    seller: { ...invoice.seller, nip: invoice.seller.nip ?? "" },
    buyer: { ...invoice.buyer, nip: invoice.buyer.nip ?? "" },
    lines: invoice.lines.map((line) => ({ ...line })),
    currency: invoice.currency,
    paymentMethod: invoice.paymentMethod ?? "",
    paymentDueDate: invoice.paymentDueDate ?? "",
    bankAccount: invoice.bankAccount ?? "",
    notes: invoice.notes ?? ""
  };
}

const FIELD_LABELS: Record<string, string> = {
  number: "numer faktury",
  issueDate: "data wystawienia",
  saleDate: "data sprzedaży / wykonania usługi",
  placeOfIssue: "miejsce wystawienia",
  "seller.name": "nazwa sprzedawcy",
  "seller.nip": "NIP sprzedawcy",
  "seller.address": "adres sprzedawcy",
  "buyer.name": "nazwa nabywcy",
  "buyer.nip": "NIP nabywcy",
  "buyer.address": "adres nabywcy",
  currency: "waluta",
  paymentDueDate: "termin płatności",
  lines: "pozycje faktury"
};

function fieldLabel(field: string): string {
  const line = /^lines\.(\d+)\.(\w+)$/.exec(field);
  if (line) {
    const part: Record<string, string> = {
      name: "nazwa",
      unit: "jednostka",
      quantity: "ilość",
      unitNetPrice: "cena netto",
      vatRate: "stawka VAT"
    };
    return `pozycja ${Number(line[1]) + 1}: ${part[line[2]!] ?? line[2]}`;
  }
  return FIELD_LABELS[field] ?? field;
}

const ERRORS: Record<string, string> = {
  INVOICE_NUMBER_TAKEN: "Faktura o tym numerze już istnieje.",
  INVOICE_ALREADY_ISSUED: "Faktura jest już wystawiona i nie można jej zmienić ani usunąć.",
  INVOICE_NOT_FOUND: "Nie znaleziono faktury.",
  INVOICE_LOGO_TYPE: "Logo musi być plikiem PNG albo JPEG.",
  INVOICE_LOGO_TOO_LARGE: "Logo może mieć najwyżej 512 KB.",
  KSEF_TOKEN_REQUIRED: "Wklej token KSeF.",
  KSEF_TOKEN_INVALID: "Token KSeF nie może zawierać spacji ani przekraczać 2048 znaków.",
  KSEF_CONTEXT_NIP_INVALID: "NIP kontekstu musi mieć 10 cyfr.",
  KSEF_PRODUCTION_CONFIRMATION_REQUIRED: "Przełączenie na środowisko produkcyjne wymaga potwierdzenia.",
  INVOICE_LEGAL_BASIS_UNAVAILABLE: "Konektor ISAP (ELI) jest niedostępny. Zainstaluj go w Ustawieniach → Konektory MCP."
};

export function invoiceErrorText(code: string): string {
  const [head, field] = code.split(":", 2);
  if (field && head === "INVOICE_FIELD_REQUIRED") return `Uzupełnij pole: ${fieldLabel(field)}.`;
  if (field && head === "INVOICE_FIELD_INVALID") return `Nieprawidłowa wartość pola: ${fieldLabel(field)}.`;
  if (field && head === "INVOICE_FIELD_TOO_LONG") return `Za długa wartość pola: ${fieldLabel(field)}.`;
  return ERRORS[code] ?? code;
}
