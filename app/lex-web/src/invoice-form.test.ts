import { describe, expect, it } from "vitest";
import { addDays, emptyDraft, formatMoney, invoiceErrorText, lineNet, previewTotals, termDaysOf } from "./invoice-form.js";

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

  it("computes the transfer due date from the issue date and defaults", () => {
    expect(addDays("2026-12-25", 14)).toBe("2027-01-08");
    expect(termDaysOf("2026-10-03", "2026-10-17")).toBe(14);
    expect(termDaysOf("2026-10-03", "2026-10-18")).toBeNull();
    const draft = emptyDraft(undefined, "2026-10-03", { paymentMethod: "przelew", paymentTermDays: 7, vatRate: "8" });
    expect(draft).toMatchObject({ paymentMethod: "przelew", paymentDueDate: "2026-10-10" });
    expect(draft.lines[0]!.vatRate).toBe("8");
    expect(emptyDraft(undefined, "2026-10-03", { paymentMethod: "zapłacono", paymentTermDays: 7, vatRate: "23" }).paymentDueDate).toBe("");
    expect(emptyDraft(undefined, "2026-10-03").lines[0]!.vatRate).toBe("23");
  });
});
