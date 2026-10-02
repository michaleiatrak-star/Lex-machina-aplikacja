import type { CaseListItem, CaseScheduleKind } from "./api.js";

/** Events are stored as local wall-clock "YYYY-MM-DDTHH:MM". */

export const CASE_SCHEDULE_KINDS: ReadonlyArray<[CaseScheduleKind, string]> = [
  ["CLIENT_MEETING", "Spotkanie z klientem"],
  ["COURT_HEARING", "Posiedzenie sądu"],
  ["DEADLINE", "Termin"],
  ["OTHER", "Inne"]
];

export function caseScheduleKindLabel(kind: CaseScheduleKind): string {
  return CASE_SCHEDULE_KINDS.find(([id]) => id === kind)?.[1] ?? "Inne";
}

export function caseScheduleStartLabel(value: string): string {
  const parts = value.split("T");
  return parts.length === 2 ? parts[0] + " · " + parts[1] : value;
}

export function canWriteCase(item: CaseListItem | undefined): boolean {
  return Boolean(
    item &&
    !item.archivedAt &&
    (item.role === "OWNER" || item.role === "EDITOR")
  );
}

const pad = (value: number) => String(value).padStart(2, "0");

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export type CalendarDay = {
  key: string;
  day: number;
  inMonth: boolean;
};

/** Weeks (Monday first) covering the whole month; month is 0-based. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const weeks: CalendarDay[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days: CalendarDay[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + weekday);
      days.push({ key: dayKey(date), day: date.getDate(), inMonth: date.getMonth() === month });
    }
    if (week >= 4 && !days.some((item) => item.inMonth)) break;
    weeks.push(days);
  }
  return weeks;
}

export function groupByDay<T extends { startsAt: string }>(events: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const event of events) {
    const key = event.startsAt.slice(0, 10);
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  return grouped;
}

/** Cases for pickers and the home screen: active matters, newest first. */
export function casesNewestFirst(cases: readonly CaseListItem[]): CaseListItem[] {
  return cases
    .filter((item) => item.caseKind !== "FIRM_KNOWLEDGE")
    .slice()
    .sort((left, right) =>
      (right.updatedAt || right.createdAt).localeCompare(left.updatedAt || left.createdAt)
    );
}

export const MONTH_NAMES = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"
];

const MONTH_GENITIVE = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia"
];

const WEEKDAY_NAMES = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];

/** "2026-10-02" -> "piątek, 2 października 2026". */
export function dayLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return key;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${WEEKDAY_NAMES[date.getDay()]}, ${date.getDate()} ${MONTH_GENITIVE[date.getMonth()]} ${date.getFullYear()}`;
}

/** Days from `today` to `key` (both "YYYY-MM-DD"); negative = past. */
export function daysUntil(key: string, today: string): number {
  const toDate = (value: string) => {
    const [y, m, d] = value.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toDate(key) - toDate(today)) / 86_400_000);
}

/** "dziś", "jutro", "za 5 dni". */
export function relativeDayText(key: string, today: string): string {
  const days = daysUntil(key, today);
  if (days === 0) return "dziś";
  if (days === 1) return "jutro";
  if (days === -1) return "wczoraj";
  return days > 0 ? `za ${days} dni` : `${-days} dni temu`;
}
