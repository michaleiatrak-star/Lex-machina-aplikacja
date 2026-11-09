import fs from "node:fs";
import path from "node:path";
import type { SkillChannel } from "./skill-channel.js";

/**
 * Automatyczna aktualizacja skilli. Źródło wynika z tego, co jest zainstalowane:
 * - nakładka z kanału repozytorium (stabilny / rozwojowy) → ten sam kanał, gdy jego drzewo się zmieniło;
 * - skille wbudowane albo z wydania → podpisane wydanie skilli, tylko wersja nowsza
 *   (kanał stabilny bywa starszy od skilli wbudowanych; automat nie cofa wersji).
 * Instalacja idzie tą samą ścieżką co ręczna (weryfikacja sum, walidacja, nakładka z kopią
 * poprzedniej); nowe skille aktywują się przy następnym uruchomieniu, nieudany start wraca
 * do poprzednich.
 */

export type SkillAutoUpdateOutcome = "UP_TO_DATE" | "INSTALLED" | "BLOCKED" | "FAILED";

export type SkillAutoUpdateResult = {
  at: string;
  outcome: SkillAutoUpdateOutcome;
  source: "channel" | "release";
  channel?: SkillChannel;
  // Commit kanału albo wersja wydania skilli.
  target?: string;
  detail?: string;
};

export type SkillAutoUpdateState = {
  enabled: boolean;
  running: boolean;
  intervalHours: number;
  lastResult: SkillAutoUpdateResult | null;
  // Zainstalowano w tym uruchomieniu: aktywne po ponownym uruchomieniu programu.
  pendingActivation: boolean;
  nextCheckAt: string | null;
};

export type SkillAutoUpdateMaintenance = {
  installedChannel(): { channel: SkillChannel } | null;
  skillChannelStatus(channel: SkillChannel): Promise<{ status: string; latest?: { commit: string }; unavailableReason?: string }>;
  refreshSkillsFromChannel(channel: SkillChannel): Promise<{ commit: string }>;
  skillStatus(): Promise<{ status: string; latestVersion?: string; bundleReady: boolean; blockedReason?: string; unavailableReason?: string }>;
  applySkillUpdate(): Promise<{ installedVersion: string }>;
};

type Settings = { enabled: boolean; lastResult: SkillAutoUpdateResult | null };

export const SKILL_AUTO_UPDATE_FIRST_CHECK_MS = 4 * 60_000;
export const SKILL_AUTO_UPDATE_INTERVAL_HOURS = 6;

export class SkillAutoUpdater {
  private settings: Settings;
  private running: Promise<SkillAutoUpdateResult> | null = null;
  private pendingActivation = false;
  private timer: NodeJS.Timeout | null = null;
  private nextCheckAt: number | null = null;
  // Ręczne i automatyczne zmiany nakładki idą po kolei: obie przestawiają skills/current.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly maintenance: SkillAutoUpdateMaintenance,
    private readonly settingsPath: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.settings = this.load();
  }

  private load(): Settings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.settingsPath, "utf8")) as Partial<Settings>;
      return {
        // Domyślnie włączone; wyłączyć może tylko jawny wybór administratora.
        enabled: raw.enabled !== false,
        lastResult: raw.lastResult && typeof raw.lastResult === "object" ? raw.lastResult : null
      };
    } catch {
      return { enabled: true, lastResult: null };
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
      const tmp = `${this.settingsPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), "utf8");
      fs.renameSync(tmp, this.settingsPath);
    } catch (error) {
      process.stderr.write(`SKILL_AUTO_UPDATE_SETTINGS_WRITE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  state(): SkillAutoUpdateState {
    return {
      enabled: this.settings.enabled,
      running: this.running !== null,
      intervalHours: SKILL_AUTO_UPDATE_INTERVAL_HOURS,
      lastResult: this.settings.lastResult,
      pendingActivation: this.pendingActivation,
      nextCheckAt: this.settings.enabled && this.nextCheckAt ? new Date(this.nextCheckAt).toISOString() : null
    };
  }

  setEnabled(enabled: boolean): SkillAutoUpdateState {
    this.settings.enabled = enabled;
    this.save();
    return this.state();
  }

  /** Ręczna operacja na nakładce skilli: czeka na trwającą automatyczną i odwrotnie. */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  markInstalledManually(): void {
    this.pendingActivation = true;
  }

  /** Jedno sprawdzenie; równoległe wywołanie dostaje wynik trwającego. */
  runOnce(): Promise<SkillAutoUpdateResult> {
    if (this.running) return this.running;
    const run = this.exclusive(() => this.check()).finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  private async check(): Promise<SkillAutoUpdateResult> {
    const at = this.now().toISOString();
    const installed = this.maintenance.installedChannel();
    let result: SkillAutoUpdateResult;
    try {
      result = installed ? await this.fromChannel(at, installed.channel) : await this.fromRelease(at);
    } catch (error) {
      result = {
        at,
        outcome: "FAILED",
        source: installed ? "channel" : "release",
        ...(installed ? { channel: installed.channel } : {}),
        detail: error instanceof Error ? error.message : String(error)
      };
    }
    if (result.outcome === "INSTALLED") this.pendingActivation = true;
    this.settings.lastResult = result;
    this.save();
    return result;
  }

  private async fromChannel(at: string, channel: SkillChannel): Promise<SkillAutoUpdateResult> {
    const status = await this.maintenance.skillChannelStatus(channel);
    if (status.status === "UNAVAILABLE") {
      return { at, outcome: "FAILED", source: "channel", channel, detail: status.unavailableReason ?? "UNAVAILABLE" };
    }
    if (status.status !== "AVAILABLE") {
      return { at, outcome: "UP_TO_DATE", source: "channel", channel, ...(status.latest ? { target: status.latest.commit } : {}) };
    }
    const installed = await this.maintenance.refreshSkillsFromChannel(channel);
    return { at, outcome: "INSTALLED", source: "channel", channel, target: installed.commit };
  }

  private async fromRelease(at: string): Promise<SkillAutoUpdateResult> {
    const status = await this.maintenance.skillStatus();
    if (status.status === "UNAVAILABLE") {
      return { at, outcome: "FAILED", source: "release", detail: status.unavailableReason ?? "UNAVAILABLE" };
    }
    if (status.status !== "AVAILABLE") {
      return { at, outcome: "UP_TO_DATE", source: "release", ...(status.latestVersion ? { target: status.latestVersion } : {}) };
    }
    if (!status.bundleReady) {
      return {
        at,
        outcome: "BLOCKED",
        source: "release",
        ...(status.latestVersion ? { target: status.latestVersion } : {}),
        detail: status.blockedReason ?? "BUNDLE_NOT_READY"
      };
    }
    const installed = await this.maintenance.applySkillUpdate();
    return { at, outcome: "INSTALLED", source: "release", target: installed.installedVersion };
  }

  /** Harmonogram: pierwsze sprawdzenie po kilku minutach od startu, potem co kilka godzin. */
  start(firstCheckMs = SKILL_AUTO_UPDATE_FIRST_CHECK_MS, intervalMs = SKILL_AUTO_UPDATE_INTERVAL_HOURS * 3_600_000): void {
    if (this.timer) return;
    const tick = (delay: number) => {
      this.nextCheckAt = this.now().getTime() + delay;
      this.timer = setTimeout(() => {
        const work = this.settings.enabled ? this.runOnce().then(() => undefined) : Promise.resolve();
        void work
          .catch((error: unknown) => {
            process.stderr.write(`SKILL_AUTO_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
          })
          .finally(() => tick(intervalMs));
      }, delay);
      this.timer.unref();
    };
    tick(firstCheckMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextCheckAt = null;
  }
}
