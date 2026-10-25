import { describe, expect, it } from "vitest";
import type { InvoiceView, UpcomingCaseEvent } from "./api";
import { greeting, homeAttention } from "./home-attention";

const now = new Date(2026, 9, 25, 10, 0);
const invoice = (status: "DRAFT" | "ISSUED", paymentDueDate?: string) => ({ status, ...(paymentDueDate ? { paymentDueDate } : {}) }) as InvoiceView;
const event = (startsAt: string) => ({ startsAt }) as UpcomingCaseEvent;

describe("Start: what needs attention", () => {
  it("counts drafts, payment dates within 7 days and events within 3 days", () => {
    const items = homeAttention(
      [event("2026-10-26T09:00:00"), event("2026-11-10T09:00:00")],
      [invoice("DRAFT"), invoice("ISSUED", "2026-10-30"), invoice("ISSUED", "2026-12-01"), invoice("ISSUED", "2026-10-01")],
      now
    );
    expect(items.map((item) => item.text)).toEqual([
      "Zdarzenia w ciągu 3 dni: 1",
      "Szkice faktur do wystawienia: 1",
      "Terminy płatności faktur w ciągu 7 dni: 1 (zapłata nie jest śledzona w aplikacji)"
    ]);
  });

  it("never calls a past payment date unpaid and is empty when nothing is pending", () => {
    expect(homeAttention([], [invoice("ISSUED", "2026-10-01")], now)).toEqual([]);
  });

  it("greets by the time of day", () => {
    expect(greeting(now)).toBe("Dzień dobry");
    expect(greeting(new Date(2026, 9, 25, 19, 0))).toBe("Dobry wieczór");
  });
});
