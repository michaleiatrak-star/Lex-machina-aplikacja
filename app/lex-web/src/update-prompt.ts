import type { UpdateStatusResponse } from "./api.js";

declare const __LEX_APP_VERSION__: string | undefined;

/** Version of this build (vite.config.ts), "0.0.0" outside a Vite build. */
export const APP_VERSION: string = typeof __LEX_APP_VERSION__ === "string" ? __LEX_APP_VERSION__ : "0.0.0";

// A newer version found by a check in one session is offered at the next start (like Paint.NET):
// no question in the middle of work, a direct one when the application opens.
export type DetectedUpdate = { version: string; releaseUrl?: string; detectedAt: string };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const DETECTED = "lex.update.detected";
const SKIPPED = "lex.update.skipped";

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
