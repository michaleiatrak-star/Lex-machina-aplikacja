import { describe, expect, it } from "vitest";
import { newerVersion, rememberUpdateHandoff, rememberUpdateStatus, skipUpdateVersion, startupUpdate, updateHandoffOutcome } from "./update-prompt.js";

function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}
const available = { currentVersion: "0.1.46", status: "AVAILABLE" as const, checkedAt: "2026-10-24T08:00:00.000Z", latestVersion: "0.1.47", releaseUrl: "https://github.com/michaleiatrak-star/Lex-machina-aplikacja/releases/tag/v0.1.47" };

describe("aktualizacja wykryta w tej sesji, pytanie przy następnym starcie", () => {
  it("pyta przy starcie o wersję wykrytą wcześniej, nowszą od zainstalowanej", () => {
    const store = memory();
    expect(startupUpdate(store, "0.1.46")).toBeNull();
    rememberUpdateStatus(store, available);
    expect(startupUpdate(store, "0.1.46")).toMatchObject({ version: "0.1.47", releaseUrl: available.releaseUrl });
  });

  it("po instalacji, pominięciu albo braku nowszej wersji nie pyta", () => {
    const store = memory();
    rememberUpdateStatus(store, available);
    expect(startupUpdate(store, "0.1.47")).toBeNull();
    rememberUpdateStatus(store, available);
    skipUpdateVersion(store, "0.1.47");
    expect(startupUpdate(store, "0.1.46")).toBeNull();
    rememberUpdateStatus(store, { ...available, latestVersion: "0.1.48" });
    expect(startupUpdate(store, "0.1.46")?.version).toBe("0.1.48");
    rememberUpdateStatus(store, { ...available, status: "UP_TO_DATE", latestVersion: undefined });
    expect(startupUpdate(store, "0.1.46")).toBeNull();
  });

  it("brak połączenia nie kasuje wykrytej wersji; porównanie wersji liczbowo", () => {
    const store = memory();
    rememberUpdateStatus(store, available);
    rememberUpdateStatus(store, { ...available, status: "UNAVAILABLE" });
    expect(startupUpdate(store, "0.1.46")?.version).toBe("0.1.47");
    expect(newerVersion("0.1.10", "0.1.9")).toBe(true);
    expect(newerVersion("0.1.9", "0.1.10")).toBe(false);
    expect(newerVersion("bad", "0.1.0")).toBe(false);
  });
});

describe("wynik aktualizacji przekazanej instalatorowi, przy następnym starcie", () => {
  const handed = new Date("2026-11-03T10:00:00Z");
  const later = new Date("2026-11-03T10:10:00Z");

  it("nowa wersja działa: raz komunikat o instalacji", () => {
    const store = memory();
    rememberUpdateHandoff(store, "0.1.55", handed);
    expect(updateHandoffOutcome(store, undefined, "0.1.55", later)).toMatchObject({ kind: "INSTALLED", version: "0.1.55" });
    expect(updateHandoffOutcome(store, undefined, "0.1.55", later)).toBeNull();
  });

  it("bez śladu w dzienniku (runner nie ruszył): komunikat zamiast cichej ponownej oferty (0.1.54 -> 0.1.55)", () => {
    const store = memory();
    rememberUpdateHandoff(store, "0.1.55", handed);
    // Restart by the runner itself, seconds later: not yet.
    expect(updateHandoffOutcome(store, undefined, "0.1.54", new Date("2026-11-03T10:00:30Z"))).toBeNull();
    const outcome = updateHandoffOutcome(store, undefined, "0.1.54", later);
    expect(outcome).toMatchObject({ kind: "FAILED", version: "0.1.55" });
    expect(outcome!.message).toContain("nie uruchomił się");
    expect(outcome!.message).toContain("update-runner.log");
    expect(updateHandoffOutcome(store, undefined, "0.1.54", later)).toBeNull();
  });

  it("dziennik z tej próby: jego powód; dziennik ze starszej próby nie jest tą próbą", () => {
    const store = memory();
    rememberUpdateHandoff(store, "0.1.55", handed);
    const rolled = { state: "ROLLED_BACK" as const, targetVersion: "0.1.55", lastError: "UPDATE_INSTALLER_FAILED:2", at: "2026-11-03T10:01:00Z" };
    expect(updateHandoffOutcome(store, rolled, "0.1.54", later)!.message).toContain("przywrócono poprzednią wersję");

    rememberUpdateHandoff(store, "0.1.55", handed);
    const old = { ...rolled, at: "2026-11-01T10:01:00Z" };
    expect(updateHandoffOutcome(store, old, "0.1.54", later)!.message).toContain("nie uruchomił się");

    rememberUpdateHandoff(store, "0.1.55", handed);
    const interrupted = { state: "INTERRUPTED" as const, targetVersion: "0.1.55", lastError: "INTERRUPTED_AT:INSTALLING", at: "2026-11-03T10:00:05Z" };
    expect(updateHandoffOutcome(store, interrupted, "0.1.54", later)!.message).toContain("zatrzymał się w trakcie (etap INSTALLING)");
  });
});
