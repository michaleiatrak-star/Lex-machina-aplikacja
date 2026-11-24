// Without Docker (declined in the installer, or no container engine) pages built by JavaScript were
// unreadable: the browser for reading pages ran only as a container (task 08.3). The system's own
// Chromium-family browser (Edge is always on Windows; Chrome or Edge on macOS; chromium on Linux)
// runs headless with DevTools on the same 127.0.0.1 port, with its own profile in the app's data, so
// CdpPageRenderer and cdpChromium work unchanged.
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LOCAL_BROWSER_PORT } from "./browser-render.js";
import { localBrowserAnswers } from "./searxng-local.js";

type Env = Record<string, string | undefined>;
type Spawner = (command: string, args: string[]) => Pick<ChildProcess, "kill" | "once" | "pid">;

/** Marker the Windows installer (0.2.9) leaves when the user declined Docker. */
export function containerEngineDeclined(env: Env = process.env, exists: (file: string) => boolean = fs.existsSync): boolean {
  const local = env.LOCALAPPDATA?.trim();
  if (local && exists(path.join(local, "LexMachina", "container-engine-declined"))) return true;
  return env.LEX_CONTAINER_ENGINE_DECLINED === "1";
}

/** Installed Chromium-family browsers, preferred first. */
export function systemBrowserCandidates(platform: NodeJS.Platform = process.platform, env: Env = process.env): string[] {
  const own = env.LEX_SYSTEM_BROWSER_PATH?.trim();
  return [...(own ? [own] : []), ...platformCandidates(platform, env)];
}

function platformCandidates(platform: NodeJS.Platform, env: Env): string[] {
  if (platform === "win32") {
    const roots = [env["ProgramFiles(x86)"], env.ProgramFiles, env.LOCALAPPDATA].filter((root): root is string => Boolean(root?.trim()));
    return [
      ...roots.map((root) => path.win32.join(root, "Microsoft", "Edge", "Application", "msedge.exe")),
      ...roots.map((root) => path.win32.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }
  return ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/microsoft-edge"];
}

export function systemBrowserArgs(profileDirectory: string, port = LOCAL_BROWSER_PORT, asRoot = process.platform === "linux" && process.getuid?.() === 0): string[] {
  return [
    // Chromium refuses to start as root with its sandbox (a Linux server run by root).
    ...(asRoot ? ["--no-sandbox"] : []),
    "--headless=new",
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "about:blank"
  ];
}

export type SystemBrowserResult =
  | { started: true; executable: string; pid: number | undefined; stop: () => void }
  | { started: false; reason: "ALREADY_ANSWERING" | "NO_SYSTEM_BROWSER" | "NOT_ANSWERING"; executable?: string };

let running: ChildProcess | null = null;

/** Starts the system browser headless and waits for its DevTools endpoint. */
export async function startSystemBrowser(args: {
  dataDirectory: string;
  platform?: NodeJS.Platform;
  env?: Env;
  exists?: (file: string) => boolean;
  spawn?: Spawner;
  answers?: () => Promise<boolean>;
  waitMs?: number;
  pollMs?: number;
}): Promise<SystemBrowserResult> {
  const answers = args.answers ?? (() => localBrowserAnswers());
  if (await answers()) return { started: false, reason: "ALREADY_ANSWERING" };
  const exists = args.exists ?? fs.existsSync;
  const executable = systemBrowserCandidates(args.platform, args.env).find((candidate) => exists(candidate));
  if (!executable) return { started: false, reason: "NO_SYSTEM_BROWSER" };
  const profile = path.join(args.dataDirectory, "browser-profile");
  if (!args.spawn) fs.mkdirSync(profile, { recursive: true });
  const spawn: Spawner = args.spawn ?? ((command, argv) => nodeSpawn(command, argv, { stdio: "ignore", windowsHide: true }));
  const child = spawn(executable, systemBrowserArgs(profile));
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  child.once("error", () => {
    exited = true;
  });
  const stop = () => {
    if (!exited) child.kill();
  };
  const deadline = Date.now() + (args.waitMs ?? 20_000);
  const pollMs = args.pollMs ?? 500;
  while (Date.now() < deadline && !exited) {
    if (await answers()) {
      if (!args.spawn) {
        running = child as ChildProcess;
        process.once("exit", stop);
      }
      return { started: true, executable, pid: child.pid, stop };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  stop();
  return { started: false, reason: "NOT_ANSWERING", executable };
}

/**
 * The fallback is wanted when no container browser can come: Docker declined, or the local search
 * found no engine or a stopped one. A slow container (NOT_ANSWERING) keeps the port for itself.
 */
export function systemBrowserWanted(args: { declined: boolean; autostartError: string | null | undefined; autostartRan: boolean }): boolean {
  if (args.declined) return true;
  if (!args.autostartRan) return true;
  return args.autostartError === "CONTAINER_ENGINE_MISSING" || args.autostartError === "CONTAINER_ENGINE_NOT_RUNNING";
}

export function systemBrowserRunning(): boolean {
  return running !== null && running.exitCode === null;
}
