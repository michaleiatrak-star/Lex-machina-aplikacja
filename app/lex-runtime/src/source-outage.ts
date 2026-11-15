/**
 * Sources that just failed to answer (timeout, transport error, HTTP 5xx) are skipped for a few
 * minutes: a model asks the same dead source again in later rounds and each call costs up to
 * 50 s (SAOS: 3 attempts of 45 s in its connector; live test 2026-11-15, SDI 8/12). A bot check
 * or HTTP 403 is not an outage here: it leads to the user's verification window.
 */
const OUTAGE_MS = 5 * 60 * 1000;
const until = new Map<string, number>();

const OUTAGE_TEXT =
  /TIMEOUT|TIMED?[ _]?OUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|AbortError|aborted|TRANSPORT|HTTP_5\d\d|limit czasu|nie odpowiada/iu;
const NOT_OUTAGE = /VERIFICATION_REQUIRED|BOT_PROTECTION|BROWSER_CHECK|captcha|HTTP_403|HTTP_429|POLICY_BLOCKED|DATA_FORBIDDEN|JURISDICTION_BLOCKED/iu;

export function sourceKey(source: string | undefined | null): string | null {
  const key = (source ?? "").trim().toLowerCase();
  return key ? key : null;
}

/** Whether a failure text means the source did not answer (not a refusal and not "no results"). */
export function isOutage(text: string): boolean {
  return OUTAGE_TEXT.test(text) && !NOT_OUTAGE.test(text);
}

export function markOutage(source: string | undefined | null, now = Date.now()): void {
  const key = sourceKey(source);
  if (key) until.set(key, now + OUTAGE_MS);
}

/** Minutes left of a recent outage of the source, or 0. */
export function recentOutage(source: string | undefined | null, now = Date.now()): number {
  const key = sourceKey(source);
  const end = key ? until.get(key) ?? 0 : 0;
  if (end <= now) {
    if (key) until.delete(key);
    return 0;
  }
  return Math.ceil((end - now) / 60_000);
}

export function outageResult(source: string, minutes: number): string {
  return JSON.stringify({
    status: "SOURCE_UNAVAILABLE",
    error: "SOURCE_RECENTLY_UNAVAILABLE",
    instruction:
      `Źródło ${source} nie odpowiedziało przed chwilą (limit czasu albo błąd połączenia); aplikacja nie pyta go ponownie przez ok. ${minutes} min. ` +
      "Nie ponawiaj tego źródła w tej odpowiedzi: użyj innych źródeł i powiedz wprost, które źródło było niedostępne. To nie jest dowód braku orzeczenia ani przepisu."
  });
}

export function clearOutagesForTest(): void {
  until.clear();
}
