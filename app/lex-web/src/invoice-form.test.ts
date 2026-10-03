import { describe, expect, it } from "vitest";
import { formatMoney, invoiceErrorText, lineNet, previewTotals } from "./invoice-form.js";

describe("invoice form", () => {
  it("previews totals like the runtime", () => {
    expect(lineNet({ name: "a", unit: "h", quantity: "1,5", unitNetPrice: "400", vatRate: "23" })).toBe("600.00");
    expect(previewTotals([
      { name: "a", unit: "szt.", quantity: "3", unitNetPrice: "0.10", vatRate: "23" },
      { name: "b", unit: "szt.", quantity: "1", unitNetPrice: "0.05", vatRate: "23" },
      { name: "c", unit: "szt.", quantity: "2", unitNetPrice: "10", vatRate: "zw" }
    ])).toMatchObject({ net: "20.35", vat: "0.08", gross: "20.43" });
    expect(previewTotals([{ name: "a", unit: "h", quantity: "x", unitNetPrice: "1", vatRate: "23" }])).toBeNull();
  });

  it("formats money and field errors in Polish", () => {
    expect(formatMoney("1234567.50", "PLN")).toBe("1 234 567,50 PLN");
    expect(invoiceErrorText("INVOICE_FIELD_REQUIRED:buyer.address")).toBe("Uzupełnij pole: adres nabywcy.");
    expect(invoiceErrorText("INVOICE_FIELD_INVALID:lines.1.unitNetPrice")).toBe("Nieprawidłowa wartość pola: pozycja 2: cena netto.");
  });

  it("subtracts the line discount and rejects discounts above the value", () => {
    expect(lineNet({ name: "a", unit: "szt.", quantity: "2", unitNetPrice: "100", vatRate: "zw", discount: "20" })).toBe("180.00");
    expect(lineNet({ name: "a", unit: "szt.", quantity: "1", unitNetPrice: "10", vatRate: "23", discount: "11" })).toBeNull();
    expect(invoiceErrorText("NUMBERING_PATTERN_NR_REQUIRED")).toBe("Wzór musi zawierać dokładnie jeden token {NR}.");
  });
});
