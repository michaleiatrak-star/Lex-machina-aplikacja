import { describe, expect, it } from "vitest";
import { newerVersion, rememberUpdateStatus, skipUpdateVersion, startupUpdate } from "./update-prompt.js";

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
