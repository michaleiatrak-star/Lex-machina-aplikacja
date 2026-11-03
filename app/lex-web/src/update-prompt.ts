import type { UpdateStatusResponse } from "./api.js";

declare const __LEX_APP_VERSION__: string | undefined;

/** Version of this build (vite.config.ts), "0.0.0" outside a Vite build. */
export const APP_VERSION: string = typeof __LEX_APP_VERSION__ === "string" ? __LEX_APP_VERSION__ : "0.0.0";

// A newer version is offered as soon as a check finds it: at the start and while the
// application runs (UPDATE_CHECK_INTERVAL_MS). "Później" waits for the next start,
// "Pomiń tę wersję" for a newer one.
export type DetectedUpdate = { version: string; releaseUrl?: string; detectedAt: string };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DETECTED = "lex.update.detected";
const SKIPPED = "lex.update.skipped";
// The update handed to the installer: the next start says whether it installed.
const HANDOFF = "lex.update.handoff";
// The runner writes its journal within seconds; no trace after this means it never ran.
const HANDOFF_SILENT_MS = 2 * 60 * 1000;
export const UPDATE_RUNNER_LOG = "%LOCALAPPDATA%\\LexMachina\\update-runner.log";

// GitHub API without a token: 60 requests an hour per address; one check an hour.
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function semver(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(value.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function newerVersion(candidate: string, current: string): boolean {
  const a = semver(candidate);
  const b = semver(current);
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! > b[index]!;
  }
  return false;
}

function read(store: Store | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: Store | null, key: string, value: string | null): void {
  try {
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the prompt only does not wait for the next start.
  }
}

/** The update to ask about at this start: found earlier, newer than this build, not skipped. */
export function startupUpdate(store: Store | null, current: string = APP_VERSION): DetectedUpdate | null {
  let detected: DetectedUpdate | null = null;
  try {
    detected = JSON.parse(read(store, DETECTED) ?? "null") as DetectedUpdate | null;
  } catch {
    return null;
  }
  if (!detected || typeof detected.version !== "string") return null;
  if (!newerVersion(detected.version, current)) {
    // Installed meanwhile (or older): nothing to offer any more.
    write(store, DETECTED, null);
    return null;
  }
  return read(store, SKIPPED) === detected.version ? null : detected;
}

/** Records the result of a check for the next start; an unreachable check changes nothing. */
export function rememberUpdateStatus(store: Store | null, status: UpdateStatusResponse, now: Date = new Date()): void {
  if (status.status === "AVAILABLE" && status.latestVersion) {
    write(
      store,
      DETECTED,
      JSON.stringify({ version: status.latestVersion, ...(status.releaseUrl ? { releaseUrl: status.releaseUrl } : {}), detectedAt: now.toISOString() } satisfies DetectedUpdate)
    );
  } else if (status.status === "UP_TO_DATE" || status.status === "NO_RELEASE") {
    write(store, DETECTED, null);
  }
}

export function skipUpdateVersion(store: Store | null, version: string): void {
  write(store, SKIPPED, version);
}

export function updateStore(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Why the last update of this version did not install, in the user's words (null: no failure). */
export function failedUpdateMessage(attempt: UpdateStatusResponse["lastAttempt"], version: string): string | null {
  if (!attempt || attempt.targetVersion !== version) return null;
  const code = attempt.lastError;
  const reason =
    attempt.state === "ROLLBACK_FAILED"
      ? "instalacja nie powiodła się, a przywrócenie poprzedniej wersji też; zainstaluj aplikację ponownie instalatorem ze strony wydania"
      : attempt.state === "ROLLED_BACK"
        ? "instalacja nie powiodła się i przywrócono poprzednią wersję"
        : attempt.state === "INTERRUPTED"
          ? `instalator aktualizacji zatrzymał się w trakcie (${code.replace(/^INTERRUPTED_AT:/u, "etap ")}); poprzednia wersja działa`
        : /PRODUCT_VERSION/u.test(code)
          ? "pobrany instalator ma inną wersję niż zapowiedziana"
          : /SIGNATURE|SIGNER/u.test(code)
            ? "podpis instalatora nie przeszedł weryfikacji"
            : /HASH/u.test(code)
              ? "suma kontrolna pobranego pliku się nie zgadza"
              : /SPACE_INSUFFICIENT/u.test(code)
                ? "za mało miejsca na dysku na kopię zapasową"
                : /PARENT_EXIT_TIMEOUT/u.test(code)
                  ? "aplikacja nie zamknęła się na czas"
                  : /INSTALLER_FAILED/u.test(code)
                    ? "instalator zakończył się błędem"
                    : "instalacja została przerwana";
  return `Poprzednia próba instalacji wersji ${attempt.targetVersion} nie powiodła się: ${reason}. Możesz spróbować ponownie albo pobrać instalator ze strony wydania.`;
}

/** Just before the installer takes over: remembered for the next start. */
export function rememberUpdateHandoff(store: Store | null, version: string, now: Date = new Date()): void {
  write(store, HANDOFF, JSON.stringify({ version, at: now.toISOString() }));
}

/** The handover failed at once (the error is shown now): nothing to report at the next start. */
export function clearUpdateHandoff(store: Store | null): void {
  write(store, HANDOFF, null);
}

/**
 * What happened to the update handed over before this start (shown once): installed, failed
 * with the runner's reason, or no trace at all (the runner never ran or was stopped before its
 * journal: before, that case showed nothing and the same update was offered again).
 */
export function updateHandoffOutcome(
  store: Store | null,
  attempt: UpdateStatusResponse["lastAttempt"],
  current: string = APP_VERSION,
  now: Date = new Date()
): { kind: "INSTALLED" | "FAILED"; version: string; message: string } | null {
  let handoff: { version?: unknown; at?: unknown } | null = null;
  try {
    handoff = JSON.parse(read(store, HANDOFF) ?? "null") as { version?: unknown; at?: unknown } | null;
  } catch {
    handoff = null;
  }
  if (!handoff || typeof handoff.version !== "string" || typeof handoff.at !== "string") return null;
  const version = handoff.version;
  if (!newerVersion(version, current)) {
    write(store, HANDOFF, null);
    return { kind: "INSTALLED", version, message: `Zaktualizowano Lex Machina do wersji ${current}.` };
  }
  const journal = failedUpdateMessage(attempt, version);
  // The runner journals an attempt after it was handed over; an older entry is another attempt.
  const fresh = attempt && attempt.targetVersion === version && (!attempt.at || Date.parse(attempt.at) >= Date.parse(handoff.at) - 60_000);
  if (journal && fresh) {
    write(store, HANDOFF, null);
    return { kind: "FAILED", version, message: journal };
  }
  // Still within the runner's first seconds (e.g. this start is the runner's own restart).
  if (now.getTime() - Date.parse(handoff.at) < HANDOFF_SILENT_MS) return null;
  write(store, HANDOFF, null);
  return {
    kind: "FAILED",
    version,
    message:
      `Aktualizacja do wersji ${version} nie została zainstalowana: instalator aktualizacji nie uruchomił się, został zatrzymany ` +
      `albo przerwany przed rozpoczęciem (np. przez program antywirusowy lub zasady systemu). Spróbuj ponownie; jeśli się powtórzy, pobierz instalator ` +
      `ze strony wydania. Dziennik (Windows): ${UPDATE_RUNNER_LOG}`
  };
}

/**
 * The update to offer right after a check: the check's result recorded, then the same rules as at
 * the start (newer than this build, not skipped), and not a version put off with "Później".
 */
export function updateOfferAfterCheck(
  store: Store | null,
  status: UpdateStatusResponse,
  postponed: string | null,
  current: string = APP_VERSION,
  now: Date = new Date()
): DetectedUpdate | null {
  rememberUpdateStatus(store, status, now);
  const offer = startupUpdate(store, current);
  if (offer) return offer.version === postponed ? null : offer;
  // Without storage (private mode): the check itself decides.
  if (status.status === "AVAILABLE" && status.latestVersion && newerVersion(status.latestVersion, current) && status.latestVersion !== postponed && read(store, SKIPPED) !== status.latestVersion) {
    return { version: status.latestVersion, ...(status.releaseUrl ? { releaseUrl: status.releaseUrl } : {}), detectedAt: now.toISOString() };
  }
  return null;
}
