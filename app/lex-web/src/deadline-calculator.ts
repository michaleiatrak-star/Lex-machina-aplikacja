// Court deadlines counted by rules, never by a model (user 2026-11-25). The rules, from the app's
// local ELI copy (2026-11-25):
// - art. 165 § 1 KPC: deadlines are counted under civil law;
// - art. 111 § 2 KC: the day of the event (delivery) is not counted; § 1: a deadline in days ends
//   with the end of its last day;
// - art. 112 KC: weeks, months, years end on the day matching the first day by name or date, and
//   when the last month has no such date, on its last day;
// - art. 115 KC: an end falling on a statutory day off or on a Saturday moves to the next day that
//   is neither;
// - ustawa o dniach wolnych od pracy, art. 1 (t.j. Dz.U. 2025 poz. 296): the days off and Sundays;
// - art. 131¹a § 2 KPC: a letter placed in the portal informacyjny with no confirmation of delivery
//   is delivered 14 days after the date it was placed.

import { N_, t } from "./i18n.js";

export type TermUnit = "DAYS" | "WEEKS" | "MONTHS" | "YEARS";

export type DayOff = { date: string; name: string };

/** YYYY-MM-DD of a date in the calendar (no time zone: dates only). */
function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parse(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) throw new Error("DEADLINE_DATE_INVALID");
  const value = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (value.month < 1 || value.month > 12 || value.day < 1 || value.day > daysInMonth(value.year, value.month)) throw new Error("DEADLINE_DATE_INVALID");
  return value;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(date: string, days: number): string {
  const { year, month, day } = parse(date);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return iso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: string): number {
  const { year, month, day } = parse(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Easter Sunday of the Gregorian calendar (anonymous algorithm). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

// 24 December is a day off in the consolidated text of 2025 (art. 1 pkt 1 lit. ka); earlier years
// are counted without it.
const CHRISTMAS_EVE_FROM = 2025;

/** The statutory days off of a year (art. 1 pkt 1 of the act; Sundays come from the weekday). */
export function daysOff(year: number): DayOff[] {
  const easter = easterSunday(year);
  const days: DayOff[] = [
    { date: iso(year, 1, 1), name: N_("Nowy Rok") },
    { date: iso(year, 1, 6), name: N_("Święto Trzech Króli") },
    { date: easter, name: N_("pierwszy dzień Wielkiej Nocy") },
    { date: addDays(easter, 1), name: N_("drugi dzień Wielkiej Nocy") },
    { date: iso(year, 5, 1), name: N_("Święto Państwowe") },
    { date: iso(year, 5, 3), name: N_("Święto Narodowe Trzeciego Maja") },
    { date: addDays(easter, 49), name: N_("pierwszy dzień Zielonych Świątek") },
    { date: addDays(easter, 60), name: N_("Boże Ciało") },
    { date: iso(year, 8, 15), name: N_("Wniebowzięcie Najświętszej Maryi Panny") },
    { date: iso(year, 11, 1), name: N_("Wszystkich Świętych") },
    { date: iso(year, 11, 11), name: N_("Narodowe Święto Niepodległości") },
    ...(year >= CHRISTMAS_EVE_FROM ? [{ date: iso(year, 12, 24), name: N_("Wigilia Bożego Narodzenia") }] : []),
    { date: iso(year, 12, 25), name: N_("pierwszy dzień Bożego Narodzenia") },
    { date: iso(year, 12, 26), name: N_("drugi dzień Bożego Narodzenia") }
  ];
  return days.sort((x, y) => x.date.localeCompare(y.date));
}

const WEEKDAYS = [N_("niedziela"), N_("poniedziałek"), N_("wtorek"), N_("środa"), N_("czwartek"), N_("piątek"), N_("sobota")];

export function weekdayName(date: string): string {
  return t(WEEKDAYS[weekday(date)]!);
}

/** Why the day cannot end a deadline (art. 115 KC), or null for a working day. */
export function nonWorkingReason(date: string): string | null {
  const day = weekday(date);
  const name = daysOff(parse(date).year).find((item) => item.date === date)?.name;
  if (name) return t(name);
  return day === 6 || day === 0 ? weekdayName(date) : null;
}

/** The end of a deadline before art. 115 KC (art. 111, 112 KC). */
export function termEnd(start: string, amount: number, unit: TermUnit): string {
  if (!Number.isInteger(amount) || amount < 1 || amount > 3650) throw new Error("DEADLINE_AMOUNT_INVALID");
  if (unit === "DAYS") return addDays(start, amount);
  if (unit === "WEEKS") return addDays(start, amount * 7);
  const { year, month, day } = parse(start);
  const months = unit === "MONTHS" ? amount : amount * 12;
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  return iso(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export type DeadlineStep = { text: string; basis: string };

export type DeadlineResult = {
  // The day the deadline counts from (the event, e.g. delivery).
  from: string;
  // The last day under art. 111/112 KC, and the day it ends on after art. 115 KC.
  nominalEnd: string;
  end: string;
  steps: DeadlineStep[];
};

export type DeadlineInput = {
  event: string;
  amount: number;
  unit: TermUnit;
  // The event is a letter placed in the portal informacyjny with no confirmation of delivery:
  // `event` is the date it was placed (art. 131¹a § 2 KPC).
  portalPlaced?: boolean;
};

const UNIT_LABEL: Record<TermUnit, [string, string, string]> = {
  DAYS: [N_("{n} dzień"), N_("{n} dni"), N_("{n} dni")],
  WEEKS: [N_("{n} tydzień"), N_("{n} tygodnie"), N_("{n} tygodni")],
  MONTHS: [N_("{n} miesiąc"), N_("{n} miesiące"), N_("{n} miesięcy")],
  YEARS: [N_("{n} rok"), N_("{n} lata"), N_("{n} lat")]
};

export function termLabel(amount: number, unit: TermUnit): string {
  const [one, few, many] = UNIT_LABEL[unit];
  const lastTwo = amount % 100;
  const last = amount % 10;
  const word = amount === 1 ? one : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
  return t(word, { n: amount });
}

export function formatDate(date: string): string {
  const { year, month, day } = parse(date);
  return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
}

/** The deadline with each step of the count and its provision. */
export function computeDeadline(input: DeadlineInput): DeadlineResult {
  parse(input.event);
  const steps: DeadlineStep[] = [];
  let from = input.event;
  if (input.portalPlaced) {
    from = addDays(input.event, 14);
    steps.push({
      text: t("Pismo umieszczone w portalu {placed} bez potwierdzenia odbioru: doręczone z upływem 14 dni, {delivered}.", { placed: formatDate(input.event), delivered: formatDate(from) }),
      basis: "art. 131¹a § 2 KPC"
    });
  }
  steps.push({ text: t("Dnia doręczenia ({date}) nie wlicza się do terminu.", { date: formatDate(from) }), basis: "art. 111 § 2 KC w zw. z art. 165 § 1 KPC" });
  const nominalEnd = termEnd(from, input.amount, input.unit);
  steps.push({
    text: t("Termin {term}: ostatni dzień {date}.", { term: termLabel(input.amount, input.unit), date: formatDate(nominalEnd) }),
    basis: input.unit === "DAYS" ? "art. 111 § 1 KC" : "art. 112 KC"
  });
  let end = nominalEnd;
  for (let guard = 0; guard < 14; guard += 1) {
    const reason = nonWorkingReason(end);
    if (!reason) break;
    const next = addDays(end, 1);
    steps.push({ text: t("{date} to {reason}: koniec terminu przesuwa się na {next}.", { date: formatDate(end), reason, next: formatDate(next) }), basis: "art. 115 KC" });
    end = next;
  }
  steps.push({ text: t("Termin upływa {date} ({day}).", { date: formatDate(end), day: weekdayName(end) }), basis: "" });
  return { from, nominalEnd, end, steps };
}

/** Common deadlines; each wording read in the local ELI copy of KPC (t.j. Dz.U. 2026 poz. 468). */
export const DEADLINE_PRESETS: Array<{ id: string; label: string; amount: number; unit: TermUnit; basis: string }> = [
  { id: "apelacja", label: N_("Apelacja (od doręczenia wyroku z uzasadnieniem)"), amount: 2, unit: "WEEKS", basis: "art. 369 § 1 KPC" },
  { id: "zazalenie", label: N_("Zażalenie (od doręczenia postanowienia z uzasadnieniem)"), amount: 1, unit: "WEEKS", basis: "art. 394 § 2 KPC" },
  { id: "sprzeciw-zaoczny", label: N_("Sprzeciw od wyroku zaocznego"), amount: 2, unit: "WEEKS", basis: "art. 344 § 1 KPC" },
  { id: "sprzeciw-nakaz", label: N_("Sprzeciw od nakazu zapłaty (postępowanie upominawcze, doręczenie w kraju)"), amount: 2, unit: "WEEKS", basis: "art. 480² § 1 pkt 1 KPC" }
];
