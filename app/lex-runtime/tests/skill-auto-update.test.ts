import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SkillAutoUpdater, type SkillAutoUpdateMaintenance } from "../src/skill-auto-update.js";

function settingsFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-auto-skills-")), "auto-update.json");
}

function fake(over: Partial<SkillAutoUpdateMaintenance> = {}): SkillAutoUpdateMaintenance {
  return {
    installedChannel: () => null,
    skillChannelStatus: vi.fn(async () => ({ status: "UP_TO_DATE" })),
    refreshSkillsFromChannel: vi.fn(async () => ({ commit: "abc1234" })),
    skillStatus: vi.fn(async () => ({ status: "UP_TO_DATE", latestVersion: "0.1.72", bundleReady: true })),
    applySkillUpdate: vi.fn(async () => ({ installedVersion: "0.1.73" })),
    ...over
  };
}

describe("automatyczna aktualizacja skilli", () => {
  it("zainstalowany kanał: aktualizuje z tego samego kanału, gdy drzewo się zmieniło", async () => {
    const m = fake({
      installedChannel: () => ({ channel: "development" }),
      skillChannelStatus: vi.fn(async () => ({ status: "AVAILABLE", latest: { commit: "abc1234" } }))
    });
    const updater = new SkillAutoUpdater(m, settingsFile());
    const result = await updater.runOnce();
    expect(result).toMatchObject({ outcome: "INSTALLED", source: "channel", channel: "development", target: "abc1234" });
    expect(m.refreshSkillsFromChannel).toHaveBeenCalledWith("development");
    expect(m.applySkillUpdate).not.toHaveBeenCalled();
    expect(updater.state().pendingActivation).toBe(true);
  });

  it("skille wbudowane: tylko podpisane wydanie, nigdy kanał (bez cofania wersji)", async () => {
    const m = fake({ skillStatus: vi.fn(async () => ({ status: "AVAILABLE", latestVersion: "0.1.73", bundleReady: true })) });
    const result = await new SkillAutoUpdater(m, settingsFile()).runOnce();
    expect(result).toMatchObject({ outcome: "INSTALLED", source: "release", target: "0.1.73" });
    expect(m.refreshSkillsFromChannel).not.toHaveBeenCalled();
  });

  it("wydanie bez gotowej weryfikacji: BLOCKED, bez instalacji", async () => {
    const m = fake({
      skillStatus: vi.fn(async () => ({ status: "AVAILABLE", latestVersion: "0.1.73", bundleReady: false, blockedReason: "SIGNED_INDEX_MISSING" }))
    });
    const result = await new SkillAutoUpdater(m, settingsFile()).runOnce();
    expect(result).toMatchObject({ outcome: "BLOCKED", detail: "SIGNED_INDEX_MISSING" });
    expect(m.applySkillUpdate).not.toHaveBeenCalled();
  });

  it("błąd instalacji zapisuje FAILED i nie oznacza aktywacji", async () => {
    const m = fake({
      installedChannel: () => ({ channel: "stable" }),
      skillChannelStatus: vi.fn(async () => ({ status: "AVAILABLE" })),
      refreshSkillsFromChannel: vi.fn(async () => {
        throw new Error("SKILL_CHANNEL_VALIDATION_FAILED");
      })
    });
    const updater = new SkillAutoUpdater(m, settingsFile());
    expect(await updater.runOnce()).toMatchObject({ outcome: "FAILED", detail: "SKILL_CHANNEL_VALIDATION_FAILED" });
    expect(updater.state().pendingActivation).toBe(false);
  });

  it("ustawienie i ostatni wynik przetrwają ponowne uruchomienie; domyślnie włączone", async () => {
    const file = settingsFile();
    const first = new SkillAutoUpdater(fake(), file);
    expect(first.state().enabled).toBe(true);
    await first.runOnce();
    first.setEnabled(false);
    const second = new SkillAutoUpdater(fake(), file);
    expect(second.state()).toMatchObject({ enabled: false, lastResult: { outcome: "UP_TO_DATE", source: "release" }, pendingActivation: false });
  });

  it("równoległe wywołania dzielą jedno sprawdzenie; ręczna zmiana czeka w kolejce", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const order: string[] = [];
    const m = fake({
      skillStatus: vi.fn(async () => {
        order.push("auto");
        await gate;
        return { status: "UP_TO_DATE", bundleReady: true };
      })
    });
    const updater = new SkillAutoUpdater(m, settingsFile());
    const a = updater.runOnce();
    const b = updater.runOnce();
    const manual = updater.exclusive(async () => order.push("manual"));
    await Promise.resolve();
    expect(updater.state().running).toBe(true);
    release();
    await Promise.all([a, b, manual]);
    expect(m.skillStatus).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["auto", "manual"]);
  });

  it("harmonogram: wyłączone nie sprawdza", async () => {
    vi.useFakeTimers();
    try {
      const m = fake();
      const updater = new SkillAutoUpdater(m, settingsFile());
      updater.setEnabled(false);
      updater.start(1000, 5000);
      await vi.advanceTimersByTimeAsync(1100);
      expect(m.skillStatus).not.toHaveBeenCalled();
      updater.setEnabled(true);
      await vi.advanceTimersByTimeAsync(5000);
      expect(m.skillStatus).toHaveBeenCalledTimes(1);
      updater.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
