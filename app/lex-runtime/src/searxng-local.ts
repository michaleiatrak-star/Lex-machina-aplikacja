import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * A SearXNG instance on this computer (Ustawienia > Wyszukiwarka internetowa, user 2026-11-15):
 * public SearXNG servers refuse an application's queries (limiter, bot check, JSON format off),
 * an own instance does not. The files are written to the application's data directory; with
 * Docker or Podman on this computer the container is started and the address is set once it
 * answers in the JSON format. Bound to 127.0.0.1 only: nothing is exposed to the network.
 */

export const LOCAL_SEARXNG_PORT = 8888;
export const LOCAL_SEARXNG_URL = `http://127.0.0.1:${LOCAL_SEARXNG_PORT}`;
// The image of the SearXNG project (Docker Hub); the container keeps the files of `searxng/`.
const IMAGE = "docker.io/searxng/searxng:latest";
const CONTAINER = "lex-machina-searxng";

export type LocalSearxngResult = {
  directory: string;
  url: string;
  /** The container engine found on this computer ("docker" or "podman"), or null. */
  engine: "docker" | "podman" | null;
  started: boolean;
  /** The instance answered a search in the JSON format (the address is then set). */
  reachable: boolean;
  /** Commands to start it by hand (shown when nothing could be started here). */
  commands: string[];
  error?: string;
};

type Runner = (command: string, args: string[], cwd: string, timeoutMs: number) => Promise<{ code: number; output: string }>;
/** Starts the engine's desktop application (Docker Desktop); false when there is none to start. */
type Launcher = (engine: "docker" | "podman") => boolean;
type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

const defaultRunner: Runner = (command, args, cwd, timeoutMs) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException).code === "number" ? Number((error as NodeJS.ErrnoException).code) : 1) : 0;
      resolve({ code, output: `${stdout ?? ""}${stderr ?? ""}`.slice(-2000) });
    });
  });

/**
 * Docker Desktop (Windows, macOS) installs the docker command but its engine runs only while the
 * application is open; `docker compose up` then fails with "failed to connect to the docker API"
 * (user, 2026-11-15). The application is started here and the engine awaited.
 */
const defaultLauncher: Launcher = (engine) => {
  try {
    if (engine !== "docker") return false;
    if (process.platform === "win32") {
      const roots = [process.env.ProgramFiles, process.env.ProgramW6432, "C:\\Program Files"].filter(Boolean) as string[];
      const exe = roots.map((root) => path.join(root, "Docker", "Docker", "Docker Desktop.exe")).find((file) => fs.existsSync(file));
      if (!exe) return false;
      spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      return true;
    }
    if (process.platform === "darwin") {
      spawn("open", ["-a", "Docker"], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
  } catch {
    return false;
  }
  return false;
};

/**
 * No Docker or Podman (user, 2026-11-15: "w razie braku dockera powinny go instalować"): Docker Desktop is
 * installed on the administrator's explicit request — winget on Windows (the system asks for elevation),
 * Homebrew on macOS. Docker Desktop is free for small businesses only (Docker subscription terms); the
 * settings screen says so next to the button.
 */
export async function installDockerDesktop(run: Runner, cwd: string, platform = process.platform): Promise<{ ok: boolean; error?: string }> {
  if (platform === "win32") {
    if ((await run("winget", ["--version"], cwd, 30_000)).code !== 0) return { ok: false, error: "INSTALLER_MISSING:winget" };
    const done = await run(
      "winget",
      ["install", "--exact", "--id", "Docker.DockerDesktop", "--accept-package-agreements", "--accept-source-agreements", "--silent"],
      cwd,
      45 * 60_000
    );
    // winget: 0 installed; -1978335189 (0x8A15002B) "no applicable upgrade" when it is already there.
    return done.code === 0 || /already installed|bereits installiert|już zainstalowan/iu.test(done.output)
      ? { ok: true }
      : { ok: false, error: `INSTALL_FAILED: ${done.output.trim().split("\n").slice(-2).join(" ").slice(0, 300)}` };
  }
  if (platform === "darwin") {
    if ((await run("brew", ["--version"], cwd, 30_000)).code !== 0) return { ok: false, error: "INSTALLER_MISSING:brew" };
    const done = await run("brew", ["install", "--cask", "docker"], cwd, 45 * 60_000);
    return done.code === 0 ? { ok: true } : { ok: false, error: `INSTALL_FAILED: ${done.output.trim().split("\n").slice(-2).join(" ").slice(0, 300)}` };
  }
  return { ok: false, error: "INSTALLER_MISSING:linux" };
}

/** Where Docker Desktop puts the docker command when the running process' PATH predates the install. */
function dockerAfterInstall(platform = process.platform): string {
  if (platform === "win32") {
    const root = process.env.ProgramFiles ?? "C:\\Program Files";
    const cli = path.join(root, "Docker", "Docker", "resources", "bin", "docker.exe");
    return fs.existsSync(cli) ? cli : "docker";
  }
  if (platform === "darwin" && fs.existsSync("/Applications/Docker.app/Contents/Resources/bin/docker")) {
    return "/Applications/Docker.app/Contents/Resources/bin/docker";
  }
  return "docker";
}

async function engineRunning(run: Runner, engine: string, cwd: string): Promise<boolean> {
  return (await run(engine, ["info"], cwd, 30_000)).code === 0;
}

export function composeFile(): string {
  return [
    "# Lex Machina — lokalna wyszukiwarka SearXNG (tylko ten komputer: 127.0.0.1).",
    "services:",
    "  searxng:",
    `    image: ${IMAGE}`,
    `    container_name: ${CONTAINER}`,
    "    restart: unless-stopped",
    "    ports:",
    `      - "127.0.0.1:${LOCAL_SEARXNG_PORT}:8080"`,
    "    volumes:",
    "      - ./searxng:/etc/searxng:rw",
    "    environment:",
    `      - SEARXNG_BASE_URL=${LOCAL_SEARXNG_URL}/`,
    ""
  ].join("\n");
}

/** SearXNG settings: the project's defaults plus the JSON format, no limiter, Polish results first. */
export function settingsFile(secret: string): string {
  return [
    "# Lex Machina — ustawienia lokalnego SearXNG (domyślne ustawienia projektu + poniższe zmiany).",
    "use_default_settings: true",
    "general:",
    '  instance_name: "Lex Machina (lokalny)"',
    "server:",
    `  secret_key: "${secret}"`,
    "  limiter: false",
    "  image_proxy: false",
    "search:",
    "  safe_search: 0",
    '  default_lang: "pl"',
    "  formats:",
    "    - html",
    "    - json",
    ""
  ].join("\n");
}

function readme(engine: string): string {
  return [
    "Lokalna wyszukiwarka SearXNG dla Lex Machina",
    "",
    "Uruchomienie (w tym katalogu):",
    `  ${engine} compose up -d`,
    "Zatrzymanie:",
    `  ${engine} compose down`,
    "",
    `Adres w Lex Machina (Ustawienia > Wyszukiwarka internetowa): ${LOCAL_SEARXNG_URL}`,
    "Wyszukiwarka działa tylko na tym komputerze (127.0.0.1) i nie jest dostępna z sieci.",
    ""
  ].join("\n");
}

/** Writes the files (an existing secret key is kept); returns the commands to start it by hand. */
export function writeLocalSearxng(directory: string, engine = "docker"): string[] {
  const config = path.join(directory, "searxng");
  fs.mkdirSync(config, { recursive: true, mode: 0o700 });
  const settingsPath = path.join(config, "settings.yml");
  let secret = "";
  try {
    secret = /secret_key:\s*"([0-9a-f]{64})"/u.exec(fs.readFileSync(settingsPath, "utf8"))?.[1] ?? "";
  } catch {
    secret = "";
  }
  fs.writeFileSync(settingsPath, settingsFile(secret || randomBytes(32).toString("hex")), { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(path.join(directory, "docker-compose.yml"), composeFile(), "utf8");
  fs.writeFileSync(path.join(directory, "README.txt"), readme(engine), "utf8");
  return [`cd "${directory}"`, `${engine} compose up -d`];
}

/** The instance answers a search in the JSON format. */
export async function localSearxngAnswers(fetcher: Fetcher = fetch as unknown as Fetcher, url = LOCAL_SEARXNG_URL): Promise<boolean> {
  try {
    const response = await fetcher(`${url}/search?q=kodeks+cywilny&format=json`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const payload = (await response.json()) as { results?: unknown };
    return Array.isArray(payload.results);
  } catch {
    return false;
  }
}

export async function setupLocalSearxng(args: {
  directory: string;
  start: boolean;
  run?: Runner;
  fetcher?: Fetcher;
  launch?: Launcher;
  /** Install Docker Desktop when no container engine is found (an explicit administrator action). */
  install?: boolean;
  waitMs?: number;
  engineWaitMs?: number;
  pollMs?: number;
}): Promise<LocalSearxngResult> {
  const run = args.run ?? defaultRunner;
  const launch = args.launch ?? defaultLauncher;
  const fetcher = args.fetcher ?? (fetch as unknown as Fetcher);
  // An instance already answering on the port (started before, or by the user): only the address.
  if (await localSearxngAnswers(fetcher)) {
    const commands = writeLocalSearxng(args.directory);
    return { directory: args.directory, url: LOCAL_SEARXNG_URL, engine: null, started: false, reachable: true, commands };
  }
  const cwd = args.directory.length ? path.dirname(args.directory) : ".";
  // An installed engine whose service runs is preferred; an installed one that is stopped is kept
  // as the fallback (Docker Desktop closed).
  const installed: Array<"docker" | "podman"> = [];
  let engine: "docker" | "podman" | null = null;
  for (const candidate of ["docker", "podman"] as const) {
    if ((await run(candidate, ["compose", "version"], cwd, 20_000)).code !== 0) continue;
    installed.push(candidate);
    if (!args.start || (await engineRunning(run, candidate, cwd))) {
      engine = candidate;
      break;
    }
  }
  let stopped: "docker" | "podman" | null = !engine && installed.length ? installed[0]! : null;
  let dockerCommand = "docker";
  if (!engine && !stopped && args.start && args.install) {
    writeLocalSearxng(args.directory);
    const done = await installDockerDesktop(run, cwd);
    const base0: LocalSearxngResult = { directory: args.directory, url: LOCAL_SEARXNG_URL, engine: null, started: false, reachable: false, commands: [`cd "${args.directory}"`, "docker compose up -d"] };
    if (!done.ok) return { ...base0, error: done.error ?? "INSTALL_FAILED" };
    dockerCommand = dockerAfterInstall();
    if ((await run(dockerCommand, ["compose", "version"], cwd, 20_000)).code !== 0) return { ...base0, error: "INSTALLED_RESTART_NEEDED" };
    stopped = "docker";
  }
  const commands = writeLocalSearxng(args.directory, engine ?? stopped ?? "docker");
  const base: LocalSearxngResult = { directory: args.directory, url: LOCAL_SEARXNG_URL, engine: engine ?? stopped, started: false, reachable: false, commands };
  if (!engine && !stopped) return { ...base, error: "CONTAINER_ENGINE_MISSING" };
  if (!args.start) return base;
  if (!engine && stopped) {
    if (!launch(stopped)) return { ...base, error: "CONTAINER_ENGINE_NOT_RUNNING" };
    // Docker Desktop needs up to a few minutes to start its engine.
    const until = Date.now() + (args.engineWaitMs ?? 180_000);
    const command = stopped === "docker" ? dockerCommand : stopped;
    while (Date.now() < until && !(await engineRunning(run, command, cwd))) {
      await new Promise((resolve) => setTimeout(resolve, args.pollMs ?? 3000));
    }
    if (!(await engineRunning(run, command, cwd))) return { ...base, error: "CONTAINER_ENGINE_NOT_RUNNING" };
    engine = stopped;
  }
  // The first start downloads the image (a few hundred MB): up to 10 minutes.
  const up = await run(engine === "docker" ? dockerCommand : engine!, ["compose", "up", "-d"], args.directory, 600_000);
  if (up.code !== 0) return { ...base, error: `START_FAILED: ${up.output.trim().split("\n").slice(-3).join(" ").slice(0, 300)}` };
  const deadline = Date.now() + (args.waitMs ?? 90_000);
  while (Date.now() < deadline) {
    if (await localSearxngAnswers(fetcher)) return { ...base, started: true, reachable: true };
    await new Promise((resolve) => setTimeout(resolve, args.pollMs ?? 2000));
  }
  return { ...base, started: true, error: "NOT_ANSWERING" };
}

/**
 * SearXNG created by the application starts with it (user, 2026-11-15): when the address is the
 * local one and the files are here but the instance does not answer, the container engine is
 * started (Docker Desktop opened when closed) and the container brought up. Never installs anything.
 */
export async function autostartLocalSearxng(args: {
  directory: string;
  searxngUrl: string;
  run?: Runner;
  fetcher?: Fetcher;
  launch?: Launcher;
  engineWaitMs?: number;
  waitMs?: number;
  pollMs?: number;
}): Promise<LocalSearxngResult | null> {
  if (args.searxngUrl.replace(/\/+$/u, "") !== LOCAL_SEARXNG_URL) return null;
  if (!fs.existsSync(path.join(args.directory, "docker-compose.yml"))) return null;
  const { searxngUrl: _url, ...rest } = args;
  return setupLocalSearxng({ ...rest, start: true, install: false });
}
