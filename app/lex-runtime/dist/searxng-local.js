import { execFile } from "node:child_process";
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
const defaultRunner = (command, args, cwd, timeoutMs) => new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? Number(error.code) : 1) : 0;
        resolve({ code, output: `${stdout ?? ""}${stderr ?? ""}`.slice(-2000) });
    });
});
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
        ""
    ].join("\n");
}
/** SearXNG settings: the project's defaults plus the JSON format, no limiter, Polish results first. */
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
    fs.writeFileSync(settingsPath, settingsFile(secret || randomBytes(32).toString("hex")), { encoding: "utf8", mode: 0o600 });
    fs.writeFileSync(path.join(directory, "docker-compose.yml"), composeFile(), "utf8");
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
export async function setupLocalSearxng(args) {
    const run = args.run ?? defaultRunner;
    const fetcher = args.fetcher ?? fetch;
    // An instance already answering on the port (started before, or by the user): only the address.
    if (await localSearxngAnswers(fetcher)) {
        const commands = writeLocalSearxng(args.directory);
        return { directory: args.directory, url: LOCAL_SEARXNG_URL, engine: null, started: false, reachable: true, commands };
    }
    let engine = null;
    for (const candidate of ["docker", "podman"]) {
        if ((await run(candidate, ["compose", "version"], args.directory.length ? path.dirname(args.directory) : ".", 20_000)).code === 0) {
            engine = candidate;
            break;
        }
    }
    const commands = writeLocalSearxng(args.directory, engine ?? "docker");
    const base = { directory: args.directory, url: LOCAL_SEARXNG_URL, engine, started: false, reachable: false, commands };
    if (!engine)
        return { ...base, error: "CONTAINER_ENGINE_MISSING" };
    if (!args.start)
        return base;
    // The first start downloads the image (a few hundred MB): up to 10 minutes.
    const up = await run(engine, ["compose", "up", "-d"], args.directory, 600_000);
    if (up.code !== 0)
        return { ...base, error: `START_FAILED: ${up.output.trim().split("\n").slice(-3).join(" ").slice(0, 300)}` };
    const deadline = Date.now() + (args.waitMs ?? 90_000);
    while (Date.now() < deadline) {
        if (await localSearxngAnswers(fetcher))
            return { ...base, started: true, reachable: true };
        await new Promise((resolve) => setTimeout(resolve, args.pollMs ?? 2000));
    }
    return { ...base, started: true, error: "NOT_ANSWERING" };
}
