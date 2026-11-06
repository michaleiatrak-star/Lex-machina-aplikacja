import { describe, expect, it } from "vitest";
import { amountKeysIn, factSumKeys } from "../src/amount-references.js";

// live C09-062: the client report on an invoice list and a demand for payment.
const invoices = [
  "Nr faktury | Kontrahent | Termin płatności | Kwota brutto",
  "FV/2026/07/12 | Techbud | 2026-08-14 | 48600,00",
  "FV/2026/06/30 | Techbud | 2026-06-18 | 23 210,00",
  "FV/2026/05/02 | Inny | 14.10.2026 | 14600"
].join("\n");

describe("the case's own figures", () => {
  const keys = amountKeysIn(invoices, new Date("2026-11-06T10:00:00Z"));
  it("table figures without a currency, with decimals as in the answer", () => {
    expect(keys).toEqual(expect.arrayContaining(["48600Z", "23210Z", "14600Z"]));
  });
  it("days between the case's dates and today (overdue)", () => {
    expect(keys).toContain("84D"); // 2026-08-14 -> 2026-11-06
    expect(keys).toContain("141D"); // 2026-06-18 -> 2026-11-06
  });
  it("a statutory period between two dates is not taken as a fact", () => {
    expect(amountKeysIn("doręczono 01.03.2026, pismo z 15.03.2026", new Date("2027-01-01T00:00:00Z"))).not.toContain("14D");
  });
  it("sums of two or three amounts", () => {
    expect(factSumKeys(keys)).toEqual(expect.arrayContaining(["71810Z", "86410Z"]));
  });
  it("years and identifiers are no amounts", () => {
    const other = amountKeysIn("W roku 2026 NIP 1234567890 sprawa", new Date("2026-11-06T00:00:00Z"));
    expect(other).not.toContain("2026Z");
    expect(other).not.toContain("1234567890Z");
  });
});
