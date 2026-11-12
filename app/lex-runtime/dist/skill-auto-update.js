import fs from "node:fs";
import path from "node:path";
export const SKILL_AUTO_UPDATE_FIRST_CHECK_MS = 4 * 60_000;
export const SKILL_AUTO_UPDATE_INTERVAL_HOURS = 6;
export class SkillAutoUpdater {
    maintenance;
    settingsPath;
    now;
    settings;
    running = null;
    pendingActivation = false;
    timer = null;
    nextCheckAt = null;
    // Ręczne i automatyczne zmiany nakładki idą po kolei: obie przestawiają skills/current.
    queue = Promise.resolve();
    constructor(maintenance, settingsPath, now = () => new Date()) {
        this.maintenance = maintenance;
        this.settingsPath = settingsPath;
        this.now = now;
        this.settings = this.load();
    }
    load() {
        try {
            const raw = JSON.parse(fs.readFileSync(this.settingsPath, "utf8"));
            return {
                // Domyślnie włączone; wyłączyć może tylko jawny wybór administratora.
                enabled: raw.enabled !== false,
                lastResult: raw.lastResult && typeof raw.lastResult === "object" ? raw.lastResult : null
            };
        }
        catch {
            return { enabled: true, lastResult: null };
        }
    }
    save() {
        try {
            fs.mkdirSync(path.dirname(this.settingsPath), { recursive: true });
            const tmp = `${this.settingsPath}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), "utf8");
            fs.renameSync(tmp, this.settingsPath);
        }
        catch (error) {
            process.stderr.write(`SKILL_AUTO_UPDATE_SETTINGS_WRITE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
        }
    }
    state() {
        return {
            enabled: this.settings.enabled,
            running: this.running !== null,
            intervalHours: SKILL_AUTO_UPDATE_INTERVAL_HOURS,
            lastResult: this.settings.lastResult,
            pendingActivation: this.pendingActivation,
            nextCheckAt: this.settings.enabled && this.nextCheckAt ? new Date(this.nextCheckAt).toISOString() : null
        };
    }
    setEnabled(enabled) {
        this.settings.enabled = enabled;
        this.save();
        return this.state();
    }
    /** Ręczna operacja na nakładce skilli: czeka na trwającą automatyczną i odwrotnie. */
    exclusive(work) {
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }
    markInstalledManually() {
        this.pendingActivation = true;
    }
    /** Jedno sprawdzenie; równoległe wywołanie dostaje wynik trwającego. */
    runOnce() {
        if (this.running)
            return this.running;
        const run = this.exclusive(() => this.check()).finally(() => {
            this.running = null;
        });
        this.running = run;
        return run;
    }
    async check() {
        const at = this.now().toISOString();
        const installed = this.maintenance.installedChannel();
        let result;
        try {
            result = installed ? await this.fromChannel(at, installed.channel) : await this.fromRelease(at);
        }
        catch (error) {
            result = {
                at,
                outcome: "FAILED",
                source: installed ? "channel" : "release",
                ...(installed ? { channel: installed.channel } : {}),
                detail: error instanceof Error ? error.message : String(error)
            };
        }
        if (result.outcome === "INSTALLED")
            this.pendingActivation = true;
        this.settings.lastResult = result;
        this.save();
        return result;
    }
    async fromChannel(at, channel) {
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
    async fromRelease(at) {
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
    start(firstCheckMs = SKILL_AUTO_UPDATE_FIRST_CHECK_MS, intervalMs = SKILL_AUTO_UPDATE_INTERVAL_HOURS * 3_600_000) {
        if (this.timer)
            return;
        const tick = (delay) => {
            this.nextCheckAt = this.now().getTime() + delay;
            this.timer = setTimeout(() => {
                const work = this.settings.enabled ? this.runOnce().then(() => undefined) : Promise.resolve();
                void work
                    .catch((error) => {
                    process.stderr.write(`SKILL_AUTO_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
                })
                    .finally(() => tick(intervalMs));
            }, delay);
            this.timer.unref();
        };
        tick(firstCheckMs);
    }
    stop() {
        if (this.timer)
            clearTimeout(this.timer);
        this.timer = null;
        this.nextCheckAt = null;
    }
}
