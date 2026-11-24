import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { containerEngineDeclined, startSystemBrowser, systemBrowserArgs, systemBrowserCandidates, systemBrowserWanted } from "../src/system-browser.js";

function fakeProcess() {
  const events = new EventEmitter();
  const child = {
    pid: 4242,
    killed: false,
    kill() {
      child.killed = true;
      events.emit("exit", 0);
      return true;
    },
    once(name: string, listener: (...args: unknown[]) => void) {
      events.once(name, listener);
      return child;
    }
  };
  return child;
}

describe("system browser without Docker (task 08.3)", () => {
  it("reads the installer's decline marker", () => {
    expect(containerEngineDeclined({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, (file) => file.endsWith("container-engine-declined"))).toBe(true);
    expect(containerEngineDeclined({ LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, () => false)).toBe(false);
  });

  it("prefers Edge on Windows and uses its own profile on 127.0.0.1", () => {
    const candidates = systemBrowserCandidates("win32", { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" });
    expect(candidates[0]).toBe("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe");
    const args = systemBrowserArgs("/data/browser-profile", 9223);
    expect(args).toContain("--headless=new");
    expect(args).toContain("--remote-debugging-port=9223");
    expect(args).toContain("--remote-debugging-address=127.0.0.1");
    expect(args).toContain("--user-data-dir=/data/browser-profile");
  });

  it("starts the found browser and waits for DevTools", async () => {
    let calls = 0;
    const spawned: Array<{ command: string; args: string[] }> = [];
    const result = await startSystemBrowser({
      dataDirectory: "/data",
      platform: "darwin",
      env: {},
      exists: (file) => file.includes("Microsoft Edge"),
      spawn: (command, args) => {
        spawned.push({ command, args });
        return fakeProcess() as never;
      },
      answers: async () => ++calls > 2,
      pollMs: 1
    });
    expect(result.started).toBe(true);
    expect(spawned[0]!.command).toContain("Microsoft Edge");
    if (result.started) result.stop();
  });

  it("reports a missing browser and stops one that never answers", async () => {
    expect(await startSystemBrowser({ dataDirectory: "/d", platform: "linux", env: {}, exists: () => false, answers: async () => false })).toEqual({ started: false, reason: "NO_SYSTEM_BROWSER" });
    const child = fakeProcess();
    const result = await startSystemBrowser({ dataDirectory: "/d", platform: "linux", env: {}, exists: () => true, spawn: () => child as never, answers: async () => false, waitMs: 20, pollMs: 5 });
    expect(result).toMatchObject({ started: false, reason: "NOT_ANSWERING" });
    expect(child.killed).toBe(true);
  });

  it("does not start when the browser already answers", async () => {
    expect(await startSystemBrowser({ dataDirectory: "/d", answers: async () => true })).toEqual({ started: false, reason: "ALREADY_ANSWERING" });
  });

  it("is wanted only when no container browser can come", () => {
    expect(systemBrowserWanted({ declined: true, autostartError: null, autostartRan: true })).toBe(true);
    expect(systemBrowserWanted({ declined: false, autostartError: "CONTAINER_ENGINE_MISSING", autostartRan: true })).toBe(true);
    expect(systemBrowserWanted({ declined: false, autostartError: "NOT_ANSWERING", autostartRan: true })).toBe(false);
    expect(systemBrowserWanted({ declined: false, autostartError: null, autostartRan: true })).toBe(false);
    expect(systemBrowserWanted({ declined: false, autostartError: null, autostartRan: false })).toBe(true);
  });
});
