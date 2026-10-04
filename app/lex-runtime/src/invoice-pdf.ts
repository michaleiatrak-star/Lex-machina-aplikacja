import {
  invoiceTotals,
  lineNetCents,
  type InvoiceAnnotations,
  type InvoiceLogo,
  type InvoiceParty,
  type InvoiceRecord
} from "./invoice-store.js";
import { PdfDocument, pdfImage, textWidth, wrapText, type FontName, type PdfPage } from "./pdf-writer.js";

/**
 * The invoice as a PDF file (A4), with the issuer's logo when one is set in
 * Ustawienia → Faktury i KSeF. Same content as the printed invoice in the app.
 */

const MARGIN = 40;
const PAGE_BOTTOM = 56;
const CONTENT = 595.28 - 2 * MARGIN;

function formatMoney(cents: bigint | string, currency: string): string {
  const value = typeof cents === "string" ? cents : `${cents < 0n ? "-" : ""}${(cents < 0n ? -cents : cents) / 100n}.${String((cents < 0n ? -cents : cents) % 100n).padStart(2, "0")}`;
  const [whole, fraction] = value.split(".");
  return `${whole!.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${fraction ?? "00"} ${currency}`;
}

const rateLabel = (rate: string) => (/^\d/.test(rate) ? `${rate}%` : rate);

function annotationTexts(annotations: InvoiceAnnotations | undefined): string[] {
  if (!annotations) return [];
  return [
    annotations.cashMethod ? "metoda kasowa" : "",
    annotations.selfBilling ? "samofakturowanie" : "",
    annotations.reverseCharge ? "odwrotne obciążenie" : "",
    annotations.splitPayment ? "mechanizm podzielonej płatności" : "",
    annotations.exemptionBasis ? `Podstawa zwolnienia: ${annotations.exemptionBasis}` : ""
  ].filter(Boolean);
}

type Column = { title: string; width: number; align: "left" | "right" };
const COLUMNS: Column[] = [
  { title: "Lp.", width: 24, align: "right" },
  { title: "Nazwa towaru lub usługi", width: 0, align: "left" },
  { title: "J.m.", width: 34, align: "left" },
  { title: "Ilość", width: 44, align: "right" },
  { title: "Cena netto", width: 70, align: "right" },
  { title: "Opust", width: 58, align: "right" },
  { title: "Wartość netto", width: 76, align: "right" },
  { title: "VAT", width: 38, align: "right" }
];
COLUMNS[1]!.width = CONTENT - COLUMNS.reduce((sum, column) => sum + column.width, 0);

export function invoicePdf(invoice: InvoiceRecord, options: { logo?: InvoiceLogo; now?: Date } = {}): { pdf: Buffer; logoOmitted?: string } {
  const document = new PdfDocument({ title: `Faktura ${invoice.number}`, author: invoice.seller.name, created: options.now ?? new Date() });
  let logo: { index: number; width: number; height: number } | null = null;
  let logoOmitted: string | undefined;
  if (options.logo) {
    try {
      const image = pdfImage(Buffer.from(options.logo.base64, "base64"));
      const scale = Math.min(170 / image.width, 64 / image.height, 1);
      logo = { index: document.addImage(image), width: image.width * scale, height: image.height * scale };
    } catch (error) {
      logoOmitted = error instanceof Error ? error.message : "PDF_IMAGE_FAILED";
    }
  }

  let page = document.addPage();
  let y = page.height - MARGIN;
  const newPage = () => {
    page = document.addPage();
    y = page.height - MARGIN;
  };
  const ensure = (height: number, onBreak?: () => void) => {
    if (y - height >= PAGE_BOTTOM) return;
    newPage();
    onBreak?.();
  };
  const paragraph = (text: string, font: FontName = "regular", size = 9, x = MARGIN, width = CONTENT) => {
    for (const line of wrapText(text, font, size, width)) {
      ensure(size + 3);
      page.text(x, y - size, line, { font, size });
      y -= size + 3;
    }
  };

  // Header: logo on the left, title and dates on the right.
  const top = y;
  if (logo) page.image(logo.index, MARGIN, top - logo.height, logo.width, logo.height);
  const right = MARGIN + CONTENT;
  page.textRight(right, top - 16, `Faktura ${invoice.number}`, { font: "bold", size: 16 });
  let headerY = top - 32;
  page.textRight(right, headerY, `Data wystawienia: ${invoice.issueDate}${invoice.placeOfIssue ? `, ${invoice.placeOfIssue}` : ""}`);
  if (invoice.saleDate) {
    headerY -= 12;
    page.textRight(right, headerY, `Data sprzedaży / wykonania usługi: ${invoice.saleDate}`);
  }
  if (invoice.status === "DRAFT") {
    headerY -= 16;
    page.textRight(right, headerY, "SZKIC — dokument niewystawiony", { font: "bold", size: 10 });
  }
  y = Math.min(top - (logo?.height ?? 0), headerY) - 22;

  // Parties.
  const half = (CONTENT - 20) / 2;
  const partyLines = (party: InvoiceParty) => [
    ...wrapText(party.name, "bold", 10, half).map((text) => ({ text, font: "bold" as FontName, size: 10 })),
    ...wrapText(party.address, "regular", 9, half).map((text) => ({ text, font: "regular" as FontName, size: 9 })),
    ...(party.nip ? [{ text: `NIP: ${party.nip}`, font: "regular" as FontName, size: 9 }] : [])
  ];
  const parties: Array<[string, InvoiceParty, number]> = [
    ["Sprzedawca", invoice.seller, MARGIN],
    ["Nabywca", invoice.buyer, MARGIN + half + 20]
  ];
  let lowest = y;
  for (const [title, party, x] of parties) {
    let partyY = y;
    page.text(x, partyY - 8, title.toUpperCase(), { font: "bold", size: 8, color: [0.35, 0.35, 0.35] });
    partyY -= 13;
    page.line(x, partyY, x + half, partyY);
    partyY -= 3;
    for (const line of partyLines(party)) {
      page.text(x, partyY - line.size, line.text, { font: line.font, size: line.size });
      partyY -= line.size + 3;
    }
    lowest = Math.min(lowest, partyY);
  }
  y = lowest - 18;

  // Lines.
  const tableHeader = () => {
    page.rect(MARGIN, y - 16, CONTENT, 16, 0.92);
    let x = MARGIN;
    for (const column of COLUMNS) {
      if (column.align === "right") page.textRight(x + column.width - 4, y - 11, column.title, { font: "bold", size: 8 });
      else page.text(x + 4, y - 11, column.title, { font: "bold", size: 8 });
      x += column.width;
    }
    y -= 16;
  };
  ensure(40);
  tableHeader();
  invoice.lines.forEach((line, index) => {
    const cells = [
      String(index + 1),
      line.name,
      line.unit,
      line.quantity,
      formatMoney(Number(line.unitNetPrice).toFixed(2), invoice.currency),
      line.discount ? formatMoney(Number(line.discount).toFixed(2), invoice.currency) : "—",
      formatMoney(lineNetCents(line), invoice.currency),
      rateLabel(line.vatRate)
    ];
    const wrapped = cells.map((cell, column) => wrapText(cell, "regular", 8.5, COLUMNS[column]!.width - 8));
    const height = Math.max(...wrapped.map((lines) => lines.length)) * 11 + 6;
    ensure(height, tableHeader);
    let x = MARGIN;
    wrapped.forEach((lines, column) => {
      const spec = COLUMNS[column]!;
      lines.forEach((text, row) => {
        const baseline = y - 11 - row * 11;
        if (spec.align === "right") page.textRight(x + spec.width - 4, baseline, text, { size: 8.5 });
        else page.text(x + 4, baseline, text, { size: 8.5 });
      });
      x += spec.width;
    });
    y -= height;
    page.line(MARGIN, y, MARGIN + CONTENT, y, 0.4, 0.8);
  });
  y -= 14;

  // Totals by rate.
  const totals = invoiceTotals(invoice.lines);
  const totalColumns = [60, 90, 90, 90];
  const totalsWidth = totalColumns.reduce((sum, width) => sum + width, 0);
  const totalsX = MARGIN + CONTENT - totalsWidth;
  const totalRow = (cells: string[], font: FontName, shade?: number) => {
    ensure(16);
    if (shade !== undefined) page.rect(totalsX, y - 15, totalsWidth, 15, shade);
    let x = totalsX;
    cells.forEach((cell, index) => {
      if (index === 0) page.text(x + 4, y - 10.5, cell, { font, size: 8.5 });
      else page.textRight(x + totalColumns[index]! - 4, y - 10.5, cell, { font, size: 8.5 });
      x += totalColumns[index]!;
    });
    y -= 15;
  };
  totalRow(["Stawka", "Netto", "VAT", "Brutto"], "bold", 0.92);
  for (const row of totals.byRate) {
    totalRow([rateLabel(row.vatRate), formatMoney(row.net, invoice.currency), formatMoney(row.vat, invoice.currency), formatMoney(row.gross, invoice.currency)], "regular");
  }
  page.line(totalsX, y, totalsX + totalsWidth, y, 0.6, 0.5);
  totalRow(["Razem", formatMoney(totals.net, invoice.currency), formatMoney(totals.vat, invoice.currency), formatMoney(totals.gross, invoice.currency)], "bold");
  y -= 6;
  ensure(20);
  page.textRight(MARGIN + CONTENT, y - 12, `Do zapłaty: ${formatMoney(totals.gross, invoice.currency)}`, { font: "bold", size: 12 });
  y -= 30;

  // Payment, annotations, notes.
  if (invoice.paymentMethod === "zapłacono") paragraph("Zapłacono", "bold", 11);
  else if (invoice.paymentMethod) paragraph(`Sposób płatności: ${invoice.paymentMethod}`);
  if (invoice.paymentDueDate) paragraph(`Termin płatności: ${invoice.paymentDueDate}`);
  if (invoice.bankAccount) paragraph(`Rachunek: ${invoice.bankAccount}`);
  for (const entry of annotationTexts(invoice.annotations)) paragraph(entry, "bold");
  if (invoice.notes) {
    y -= 6;
    paragraph(invoice.notes);
  }

  // Page numbers.
  document.pages.forEach((item: PdfPage, index) => {
    const label = `Faktura ${invoice.number} · strona ${index + 1} z ${document.pages.length}`;
    item.text(MARGIN + CONTENT - textWidth(label, "regular", 7.5), 28, label, { size: 7.5, color: [0.45, 0.45, 0.45] });
  });

  return { pdf: document.toBuffer(), ...(logoOmitted ? { logoOmitted } : {}) };
}

export function invoicePdfFileName(invoice: InvoiceRecord): string {
  const number = invoice.number.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `Faktura-${number || invoice.invoiceId}.pdf`;
}
