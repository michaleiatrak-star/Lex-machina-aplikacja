import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LOCAL_BROWSER_PORT, LOCAL_BROWSER_URL } from "./browser-render.js";
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
// chromedp/headless-shell: Chrome's headless shell with the DevTools protocol on 9222 (about 550 MB).
const BROWSER_IMAGE = "docker.io/chromedp/headless-shell:latest";
const BROWSER_CONTAINER = "lex-machina-browser";
const defaultRunner = (command, args, cwd, timeoutMs) => new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? Number(error.code) : 1) : 0;
        resolve({ code, output: `${stdout ?? ""}${stderr ?? ""}`.slice(-2000) });
    });
});
/**
 * Docker Desktop (Windows, macOS) installs the docker command but its engine runs only while the
 * application is open; `docker compose up` then fails with "failed to connect to the docker API"
 * (user, 2026-11-15). The application is started here and the engine awaited.
 */
const defaultLauncher = (engine) => {
    try {
        if (engine !== "docker")
            return false;
        // In the background, no window (user 2026-11-15: the user does not use Docker Desktop's
        // window): `docker desktop start` starts the engine without the application window
        // (Docker Desktop CLI); an older Docker Desktop without it is opened hidden.
        const cli = spawnSync("docker", ["desktop", "start", "--detach"], { windowsHide: true, timeout: 30_000, stdio: "ignore" });
        if (cli.status === 0)
            return true;
        if (process.platform === "win32") {
            const roots = [process.env.ProgramFiles, process.env.ProgramW6432, "C:\\Program Files"].filter(Boolean);
            const exe = roots.map((root) => path.join(root, "Docker", "Docker", "Docker Desktop.exe")).find((file) => fs.existsSync(file));
            if (!exe)
                return false;
            spawn(exe, [], { detached: true, stdio: "ignore", windowsHide: true }).unref();
            return true;
        }
        if (process.platform === "linux") {
            // A server: the Docker service (needs the right to start it; otherwise the administrator starts it).
            return spawnSync("systemctl", ["start", "docker"], { timeout: 60_000, stdio: "ignore" }).status === 0;
        }
        if (process.platform === "darwin") {
            // -g: not brought to the foreground, -j: launched hidden (open(1)).
            spawn("open", ["-g", "-j", "-a", "Docker"], { detached: true, stdio: "ignore" }).unref();
            return true;
        }
    }
    catch {
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
export async function installDockerDesktop(run, cwd, platform = process.platform) {
    if (platform === "win32") {
        if ((await run("winget", ["--version"], cwd, 30_000)).code !== 0)
            return { ok: false, error: "INSTALLER_MISSING:winget" };
        const done = await run("winget", ["install", "--exact", "--id", "Docker.DockerDesktop", "--accept-package-agreements", "--accept-source-agreements", "--silent"], cwd, 45 * 60_000);
        // winget: 0 installed; -1978335189 (0x8A15002B) "no applicable upgrade" when it is already there.
        return done.code === 0 || /already installed|bereits installiert|już zainstalowan/iu.test(done.output)
            ? { ok: true }
            : { ok: false, error: `INSTALL_FAILED: ${done.output.trim().split("\n").slice(-2).join(" ").slice(0, 300)}` };
    }
    if (platform === "darwin") {
        if ((await run("brew", ["--version"], cwd, 30_000)).code !== 0)
            return { ok: false, error: "INSTALLER_MISSING:brew" };
        const done = await run("brew", ["install", "--cask", "docker"], cwd, 45 * 60_000);
        return done.code === 0 ? { ok: true } : { ok: false, error: `INSTALL_FAILED: ${done.output.trim().split("\n").slice(-2).join(" ").slice(0, 300)}` };
    }
    return { ok: false, error: "INSTALLER_MISSING:linux" };
}
/** Where Docker Desktop puts the docker command when the running process' PATH predates the install. */
function dockerAfterInstall(platform = process.platform) {
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
async function engineRunning(run, engine, cwd) {
    return (await run(engine, ["info"], cwd, 30_000)).code === 0;
}
export function composeFile() {
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
        // The image listens on IPv6 ("::") by default; with no IPv6 in the container engine it does
        // not start ("Address family not supported by protocol", checked 2026-11-15). IPv4 is enough:
        // the port is published on 127.0.0.1 only.
        "      - GRANIAN_HOST=0.0.0.0",
        // The browser for reading pages built by JavaScript (browser-render.ts): Chromium with the
        // DevTools protocol, published on 127.0.0.1 only (user 2026-11-15).
        "  browser:",
        `    image: ${BROWSER_IMAGE}`,
        `    container_name: ${BROWSER_CONTAINER}`,
        "    restart: unless-stopped",
        '    shm_size: "512m"',
        "    ports:",
        `      - "127.0.0.1:${LOCAL_BROWSER_PORT}:9222"`,
        ""
    ].join("\n");
}
/** SearXNG settings: the project's defaults plus the JSON format, no limiter, Polish results first. */
export const SOURCE_ENGINES = ["google", "bing", "brave", "qwant", "mojeek", "duckduckgo", "startpage"];
export const OFFICIAL_HOST_PATTERNS = [
    "(.*\\.)?gov\\.pl$",
    "(.*\\.)?sn\\.pl$",
    "(.*\\.)?trybunal\\.gov\\.pl$",
    "(.*\\.)?nsa\\.gov\\.pl$",
    "(.*\\.)?sejm\\.gov\\.pl$",
    "(.*\\.)?zus\\.pl$",
    "(.*\\.)?eur-lex\\.europa\\.eu$",
    "(.*\\.)?curia\\.europa\\.eu$",
    "(.*\\.)?hudoc\\.echr\\.coe\\.int$",
    "(.*\\.)?wsd\\.adwokatura\\.pl$",
    "(.*\\.)?saos\\.org\\.pl$"
];
export function settingsFile(secret) {
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
        // More source engines than the project's defaults (user 2026-11-15): Google, Bing, Brave,
        // Qwant and Mojeek beside DuckDuckGo and Startpage; an engine that refuses is skipped by SearXNG.
        "engines:",
        ...SOURCE_ENGINES.flatMap((name) => [`  - name: ${name}`, "    disabled: false", ...(name === "mojeek" ? ["    inactive: false"] : [])]),
        // The courts' and the authorities' portals first in the results (hostnames plugin).
        "hostnames:",
        "  high_priority:",
        ...OFFICIAL_HOST_PATTERNS.map((pattern) => `    - '${pattern}'`),
        ""
    ].join("\n");
}
function readme(engine) {
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
/** Whether the last writeLocalSearxng changed settings.yml (a running instance then restarts). */
let settingsChanged = false;
/** Whether it changed docker-compose.yml (a new service, the browser: brought up with `up -d`). */
let composeChanged = false;
/** Writes the files (an existing secret key is kept); returns the commands to start it by hand. */
export function writeLocalSearxng(directory, engine = "docker") {
    const config = path.join(directory, "searxng");
    fs.mkdirSync(config, { recursive: true, mode: 0o700 });
    const settingsPath = path.join(config, "settings.yml");
    let secret = "";
    try {
        secret = /secret_key:\s*"([0-9a-f]{64})"/u.exec(fs.readFileSync(settingsPath, "utf8"))?.[1] ?? "";
    }
    catch {
        secret = "";
    }
    let before = "";
    try {
        before = fs.readFileSync(settingsPath, "utf8");
    }
    catch {
        before = "";
    }
    const next = settingsFile(secret || randomBytes(32).toString("hex"));
    settingsChanged = Boolean(before) && before !== next;
    fs.writeFileSync(settingsPath, next, { encoding: "utf8", mode: 0o600 });
    const composePath = path.join(directory, "docker-compose.yml");
    let composeBefore = "";
    try {
        composeBefore = fs.readFileSync(composePath, "utf8");
    }
    catch {
        composeBefore = "";
    }
    composeChanged = Boolean(composeBefore) && composeBefore !== composeFile();
    fs.writeFileSync(composePath, composeFile(), "utf8");
    fs.writeFileSync(path.join(directory, "README.txt"), readme(engine), "utf8");
    return [`cd "${directory}"`, `${engine} compose up -d`];
}
/** The instance answers a search in the JSON format. */
export async function localSearxngAnswers(fetcher = fetch, url = LOCAL_SEARXNG_URL) {
    try {
        const response = await fetcher(`${url}/search?q=kodeks+cywilny&format=json`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok)
            return false;
        const payload = (await response.json());
        return Array.isArray(payload.results);
    }
    catch {
        return false;
    }
}
/** The browser for reading pages (chromedp/headless-shell) answers on its DevTools port. */
export async function localBrowserAnswers(fetcher = fetch, url = LOCAL_BROWSER_URL) {
    try {
        const response = await fetcher(`${url}/json/version`, { signal: AbortSignal.timeout(3000) });
        return response.ok;
    }
    catch {
        return false;
    }
}
export async function setupLocalSearxng(args) {
    const run = args.run ?? defaultRunner;
    const launch = args.launch ?? defaultLauncher;
    const fetcher = args.fetcher ?? fetch;
    const browserOnly = args.target === "browser";
    const ready = () => (browserOnly ? localBrowserAnswers(fetcher) : localSearxngAnswers(fetcher));
    const resultUrl = browserOnly ? LOCAL_BROWSER_URL : LOCAL_SEARXNG_URL;
    if (browserOnly && (await localBrowserAnswers(fetcher))) {
        return { directory: args.directory, url: resultUrl, engine: null, started: false, reachable: true, commands: [] };
    }
    // An instance already answering on the port (started before, or by the user): only the address.
    if (!browserOnly && (await localSearxngAnswers(fetcher))) {
        const commands = writeLocalSearxng(args.directory);
        // New settings (an earlier version's file: fewer engines, no preferred official hosts): the
        // container reads them only on a restart.
        // A new compose file (the browser added next to SearXNG): `up -d` creates what is missing.
        if ((settingsChanged || composeChanged) && fs.existsSync(path.join(args.directory, "docker-compose.yml"))) {
            for (const candidate of ["docker", "podman"]) {
                const restarted = settingsChanged ? (await run(candidate, ["compose", "restart", "searxng"], args.directory, 120_000)).code === 0 : true;
                const upped = composeChanged ? (await run(candidate, ["compose", "up", "-d"], args.directory, 600_000)).code === 0 : true;
                if (restarted && upped)
                    break;
            }
        }
        return { directory: args.directory, url: LOCAL_SEARXNG_URL, engine: null, started: false, reachable: true, commands };
    }
    const cwd = args.directory.length ? path.dirname(args.directory) : ".";
    // An installed engine whose service runs is preferred; an installed one that is stopped is kept
    // as the fallback (Docker Desktop closed).
    const installed = [];
    let engine = null;
    for (const candidate of ["docker", "podman"]) {
        if ((await run(candidate, ["compose", "version"], cwd, 20_000)).code !== 0)
            continue;
        installed.push(candidate);
        if (!args.start || (await engineRunning(run, candidate, cwd))) {
            engine = candidate;
            break;
        }
    }
    let stopped = !engine && installed.length ? installed[0] : null;
    let dockerCommand = "docker";
    if (!engine && !stopped && args.start && args.install) {
        writeLocalSearxng(args.directory);
        const done = await installDockerDesktop(run, cwd);
        const base0 = { directory: args.directory, url: resultUrl, engine: null, started: false, reachable: false, commands: [`cd "${args.directory}"`, browserOnly ? "docker compose up -d browser" : "docker compose up -d"] };
        if (!done.ok)
            return { ...base0, error: done.error ?? "INSTALL_FAILED" };
        dockerCommand = dockerAfterInstall();
        if ((await run(dockerCommand, ["compose", "version"], cwd, 20_000)).code !== 0)
            return { ...base0, error: "INSTALLED_RESTART_NEEDED" };
        stopped = "docker";
    }
    const written = writeLocalSearxng(args.directory, engine ?? stopped ?? "docker");
    const commands = browserOnly ? [written[0], `${written[1]} browser`] : written;
    const base = { directory: args.directory, url: resultUrl, engine: engine ?? stopped, started: false, reachable: false, commands };
    if (!engine && !stopped)
        return { ...base, error: "CONTAINER_ENGINE_MISSING" };
    if (!args.start)
        return base;
    if (!engine && stopped) {
        if (!launch(stopped))
            return { ...base, error: "CONTAINER_ENGINE_NOT_RUNNING" };
        // Docker Desktop needs up to a few minutes to start its engine.
        const until = Date.now() + (args.engineWaitMs ?? 180_000);
        const command = stopped === "docker" ? dockerCommand : stopped;
        while (Date.now() < until && !(await engineRunning(run, command, cwd))) {
            await new Promise((resolve) => setTimeout(resolve, args.pollMs ?? 3000));
        }
        if (!(await engineRunning(run, command, cwd)))
            return { ...base, error: "CONTAINER_ENGINE_NOT_RUNNING" };
        engine = stopped;
    }
    // The first start downloads the image (a few hundred MB): up to 10 minutes.
    const up = await run(engine === "docker" ? dockerCommand : engine, ["compose", "up", "-d", ...(browserOnly ? ["browser"] : [])], args.directory, 600_000);
    if (up.code !== 0)
        return { ...base, error: `START_FAILED: ${up.output.trim().split("\n").slice(-3).join(" ").slice(0, 300)}` };
    const deadline = Date.now() + (args.waitMs ?? 90_000);
    while (Date.now() < deadline) {
        if (await ready())
            return { ...base, started: true, reachable: true };
        await new Promise((resolve) => setTimeout(resolve, args.pollMs ?? 2000));
    }
    return { ...base, started: true, error: "NOT_ANSWERING" };
}
/**
 * SearXNG created by the application starts with it (user, 2026-11-15): when the address is the
 * local one and the files are here but the instance does not answer, the container engine is
 * started (Docker Desktop opened when closed) and the container brought up. Never installs anything.
 */
export async function autostartLocalSearxng(args) {
    if (args.searxngUrl.replace(/\/+$/u, "") !== LOCAL_SEARXNG_URL)
        return null;
    if (!fs.existsSync(path.join(args.directory, "docker-compose.yml")))
        return null;
    const { searxngUrl: _url, ...rest } = args;
    return setupLocalSearxng({ ...rest, start: true, install: false });
}
