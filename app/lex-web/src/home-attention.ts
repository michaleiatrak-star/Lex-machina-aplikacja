import type { InvoiceView, UpcomingCaseEvent } from "./api.js";

const DAY = 86_400_000;

/** "Dzień dobry" until 18:00, then "Dobry wieczór". */
export function greeting(now: Date): string {
  return now.getHours() >= 18 ? "Dobry wieczór" : "Dzień dobry";
}

export type AttentionItem = { key: "drafts" | "due" | "events"; text: string };

/**
 * What needs attention on Start: invoice drafts not issued, payment dates in the next
 * 7 days (payment itself is not tracked, so nothing is called unpaid) and events in 3 days.
 */
export function homeAttention(events: readonly UpcomingCaseEvent[], invoices: readonly InvoiceView[], now: Date): AttentionItem[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const drafts = invoices.filter((invoice) => invoice.status === "DRAFT").length;
  const due = invoices.filter((invoice) => {
    if (invoice.status !== "ISSUED" || !invoice.paymentDueDate) return false;
    const at = Date.parse(`${invoice.paymentDueDate}T00:00:00`);
    return at >= today && at < today + 8 * DAY;
  }).length;
  const soon = events.filter((event) => {
    const at = Date.parse(event.startsAt);
    return at >= now.getTime() && at < today + 4 * DAY;
  }).length;
  const items: AttentionItem[] = [];
  if (soon) items.push({ key: "events", text: `Zdarzenia w ciągu 3 dni: ${soon}` });
  if (drafts) items.push({ key: "drafts", text: `Szkice faktur do wystawienia: ${drafts}` });
  if (due) items.push({ key: "due", text: `Terminy płatności faktur w ciągu 7 dni: ${due} (zapłata nie jest śledzona w aplikacji)` });
  return items;
}
