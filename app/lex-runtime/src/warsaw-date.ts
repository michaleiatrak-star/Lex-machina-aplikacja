/**
 * Dzisiejsza data (YYYY-MM-DD) w czasie polskim (Europe/Warsaw), nie w UTC:
 * o 00:30 w dniu wejścia w życie noweli UTC wskazuje jeszcze dzień poprzedni.
 */
const WARSAW_DATE = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Warsaw",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

export function todayWarsaw(now: number | string | Date = Date.now()): string {
  const moment = now instanceof Date ? now : new Date(now);
  return WARSAW_DATE.format(moment);
}
