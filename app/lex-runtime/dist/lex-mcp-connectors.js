// Konektory MCP Lex Machina (audyt-systemu-v4/mcp-servers, pakiet dist/lex-mcp.mjs).
// Zastępują flotę @matematicsolutions/* i agregator prawo-pl-mcp. Lista, grupy i link do
// klucza CEIDG odpowiadają instaluj_serwery_mcp.py (FAZA 0E audytu) — tam jest źródło prawdy.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
export const LEX_MCP_SERVER_IDS = [
    "isap",
    "eurlex",
    "saos",
    "cbosa",
    "sn",
    "sp",
    "tk",
    "kio",
    "etpcz",
    "krs",
    "wl",
    "ceidg",
    "nbp",
    "eureka",
    "sudop",
    "uodo"
];
// Ten sam UA, którego serwer SN używa do zapytań snproxy (sn-mcp-server.js). Sonda musi
// wysłać go, gdy sesja nie zapamiętała UA, inaczej Incapsula może potraktować ją inaczej.
const SN_PROBE_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
export const LEX_MCP_CATALOG = [
    { id: "isap", group: "Akty prawne i orzecznictwo", label: "ISAP/ELI — tekst aktu i przepisu (Sejm ELI)" },
    { id: "eurlex", group: "Akty prawne i orzecznictwo", label: "EUR-Lex + TSUE — akty UE, status, wyroki" },
    { id: "saos", group: "Akty prawne i orzecznictwo", label: "SAOS — agregator orzeczeń (ranga najniższa; gdy źródło urzędowe nie działa), cytator" },
    { id: "cbosa", group: "Akty prawne i orzecznictwo", label: "CBOSA — orzeczenia NSA/WSA (snapshot 🟨)" },
    { id: "sn", group: "Akty prawne i orzecznictwo", label: "SN — orzeczenia Sądu Najwyższego (sn.pl, źródłem karta orzeczenia)" },
    { id: "sp", group: "Akty prawne i orzecznictwo", label: "Sądy powszechne — Portal Orzeczeń (stały link do orzeczenia)" },
    { id: "tk", group: "Akty prawne i orzecznictwo", label: "TK — orzeczenia Trybunału Konstytucyjnego (IPO, OTK ZU; bez SAOS)" },
    { id: "kio", group: "Akty prawne i orzecznictwo", label: "KIO — orzeczenia Krajowej Izby Odwoławczej (wyszukiwarka UZP)" },
    { id: "etpcz", group: "Akty prawne i orzecznictwo", label: "ETPCz — orzeczenia Europejskiego Trybunału Praw Człowieka (baza MS, etpcz.ms.gov.pl)" },
    { id: "krs", group: "Rejestry podmiotów", label: "KRS — odpis, reprezentacja (bez klucza)" },
    { id: "wl", group: "Rejestry podmiotów", label: "Biała lista VAT — status i rachunki (bez klucza)" },
    { id: "ceidg", group: "Rejestry podmiotów", label: "CEIDG — przedsiębiorcy-osoby fizyczne (WYMAGA KLUCZA)", requiresKey: "CEIDG_API_KEY" },
    { id: "nbp", group: "Podatki, finanse, dane osobowe", label: "NBP — kursy walut" },
    { id: "eureka", group: "Podatki, finanse, dane osobowe", label: "EUREKA — interpretacje podatkowe" },
    { id: "sudop", group: "Podatki, finanse, dane osobowe", label: "SUDOP — pomoc publiczna / de minimis" },
    { id: "uodo", group: "Podatki, finanse, dane osobowe", label: "UODO — decyzje Prezesa UODO" }
];
export const CEIDG_KEY_URL = "https://dane.biznes.gov.pl/pl/portal/034872";
// NIP spółki z KRS: 204 = token przyjęty (spółki nie są w CEIDG), 401 = token odrzucony.
const CEIDG_TEST_URL = "https://dane.biznes.gov.pl/api/ceidg/v3/firmy?nip=5261040828";
const DESKTOP_PREFIX = "lex-";
const PASSED_ENV = [
    "PATH",
    "Path",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "SystemRoot",
    "TEMP",
    "TMP",
    // macOS: the per-user temporary directory and the locale.
    "TMPDIR",
    "LANG",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    // Sesja sn.pl ustawiona ręcznie (poza oknem weryfikacji aplikacji); wartości nie logujemy.
    "SN_COOKIE",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS",
    "NODE_USE_ENV_PROXY"
];
export function isLexMcpServerId(value) {
    return LEX_MCP_SERVER_IDS.includes(value);
}
export function lexMcpPackagePath(skillsRoot) {
    const configured = process.env.LEX_MCP_PACKAGE?.trim();
    if (configured)
        return path.resolve(configured);
    return path.join(skillsRoot, "audyt-systemu-v4", "mcp-servers", "dist", "lex-mcp.mjs");
}
function defaultStateDir() {
    const configured = process.env.LEX_MCP_STATE_DIR?.trim();
    if (configured)
        return path.resolve(configured);
    const local = process.env.LOCALAPPDATA?.trim();
    if (local)
        return path.resolve(local, "LexMachina", "mcp");
    return path.resolve(os.homedir(), ".lex-machina", "mcp");
}
const DESKTOP_CONFIG_FILE = "claude_desktop_config.json";
// Claude ze Sklepu Microsoft / instalatora MSIX (np. Claude_pzs8sxrjxfjjc).
const DESKTOP_MSIX_PACKAGE = /^(?:Anthropic[^_]*\.)?Claude_[a-z0-9]+$/i;
function isFile(file) {
    try {
        return fs.statSync(file).isFile();
    }
    catch {
        return false;
    }
}
function msixPackageDirs(localAppData) {
    const packages = path.join(localAppData, "Packages");
    try {
        return fs.readdirSync(packages, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && DESKTOP_MSIX_PACKAGE.test(entry.name))
            .map((entry) => path.join(packages, entry.name));
    }
    catch {
        return [];
    }
}
function locateWindowsClaudeDesktop(env, homedir) {
    const appData = env.APPDATA?.trim() || path.join(homedir, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(homedir, "AppData", "Local");
    const packages = msixPackageDirs(localAppData);
    // MSIX przekierowuje zapisy do %APPDATA% na LocalCache\Roaming pakietu — tę kopię czyta Claude.
    const candidates = [
        ...packages.map((dir) => path.join(dir, "LocalCache", "Roaming", "Claude", DESKTOP_CONFIG_FILE)),
        path.join(appData, "Claude", DESKTOP_CONFIG_FILE)
    ];
    const existing = candidates
        .filter(isFile)
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    if (existing[0])
        return { configPath: existing[0], available: true };
    const withDir = candidates.find((file) => fs.existsSync(path.dirname(file)));
    if (withDir)
        return { configPath: withDir, available: true };
    // Zainstalowany, ale jeszcze nieuruchomiony — brak folderu konfiguracji.
    const msixConfig = candidates[0];
    if (packages.length && msixConfig)
        return { configPath: msixConfig, available: true };
    const installDirs = [
        path.join(localAppData, "AnthropicClaude"),
        path.join(localAppData, "Programs", "Claude"),
        ...[env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432]
            .filter((dir) => Boolean(dir?.trim()))
            .map((dir) => path.join(dir, "Claude"))
    ];
    return {
        configPath: path.join(appData, "Claude", DESKTOP_CONFIG_FILE),
        available: installDirs.some((dir) => fs.existsSync(dir))
    };
}
export function locateClaudeDesktop(probe = {
    platform: process.platform,
    env: process.env,
    homedir: os.homedir()
}) {
    const configured = probe.env.LEX_CLAUDE_DESKTOP_CONFIG?.trim();
    if (configured) {
        const configPath = path.resolve(configured);
        return { configPath, available: fs.existsSync(path.dirname(configPath)) };
    }
    if (probe.platform === "win32")
        return locateWindowsClaudeDesktop(probe.env, probe.homedir);
    const dir = probe.platform === "darwin"
        ? path.join(probe.homedir, "Library", "Application Support", "Claude")
        : path.join(probe.homedir, ".config", "Claude");
    return { configPath: path.join(dir, DESKTOP_CONFIG_FILE), available: fs.existsSync(dir) };
}
export function claudeDesktopConfigPath() {
    return locateClaudeDesktop().configPath;
}
function writePrivate(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temp, file);
    try {
        fs.chmodSync(file, 0o600);
    }
    catch {
        // Windows: ACL katalogu profilu użytkownika.
    }
}
// Kontrola kształtu JWT bez ujawniania treści: ładunek zawiera PESEL i nazwisko właściciela.
export function inspectCeidgKey(key) {
    const parts = key.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) {
        return { valid: false, fields: [], containsPersonalData: false };
    }
    try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return { valid: false, fields: [], containsPersonalData: false };
        }
        const fields = Object.keys(payload).sort();
        return {
            valid: true,
            fields,
            containsPersonalData: ["pesel", "given_name", "family_name"].some((field) => fields.includes(field))
        };
    }
    catch {
        return { valid: false, fields: [], containsPersonalData: false };
    }
}
export async function testCeidgKey(key, fetchImpl = fetch) {
    try {
        const response = await fetchImpl(CEIDG_TEST_URL, {
            headers: {
                Authorization: `Bearer ${key}`,
                Accept: "application/json",
                "User-Agent": "lex-machina-app/1"
            },
            signal: AbortSignal.timeout(20_000)
        });
        const httpStatus = response.status;
        if (httpStatus === 200 || httpStatus === 204)
            return { verification: "VERIFIED", httpStatus };
        if (httpStatus === 401 || httpStatus === 403)
            return { verification: "REJECTED", httpStatus };
        if (httpStatus === 429)
            return { verification: "RATE_LIMITED", httpStatus };
        return { verification: "UNREACHABLE", httpStatus };
    }
    catch {
        return { verification: "UNREACHABLE" };
    }
}
function readText(file) {
    try {
        return fs.readFileSync(file, "utf8");
    }
    catch {
        return null;
    }
}
// Pakiet leży w <skill>/mcp-servers/dist/lex-mcp.mjs; skill trzyma CHECKSUMS.sha256 i wersję w SKILL.md.
export function inspectLexMcpPackage(packagePath) {
    let bytes;
    try {
        bytes = fs.readFileSync(packagePath);
    }
    catch {
        return { integrity: "MISSING" };
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const serversDir = path.dirname(path.dirname(packagePath));
    const skillDir = path.dirname(serversDir);
    const relative = "./" + path.relative(skillDir, packagePath).split(path.sep).join("/");
    const expectedSha256 = readText(path.join(skillDir, "CHECKSUMS.sha256"))
        ?.split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .find((parts) => parts[1] === relative)?.[0]
        ?.toLowerCase();
    let version;
    try {
        const manifest = JSON.parse(readText(path.join(serversDir, "mcpb-manifest.json")) ?? "");
        if (typeof manifest.version === "string")
            version = manifest.version;
    }
    catch {
        // Brak manifestu MCPB — wersja nieznana.
    }
    const skillVersion = readText(path.join(skillDir, "SKILL.md"))
        ?.match(/^version:\s*"([^"]+)"/m)?.[1];
    return {
        integrity: !expectedSha256
            ? "UNVERIFIED"
            : expectedSha256 === sha256
                ? "MATCH"
                : "MISMATCH",
        sha256,
        ...(expectedSha256 ? { expectedSha256 } : {}),
        ...(version ? { version } : {}),
        ...(skillVersion ? { skillVersion } : {})
    };
}
export class LexMcpConnectorStore {
    skillsRoot;
    stateDir;
    desktopConfigOverride;
    nodeCommand;
    revisionValue = 0;
    constructor(skillsRoot, stateDir = defaultStateDir(), 
    // Bez jawnej ścieżki Claude Desktop jest wykrywany przy każdym odczycie (np. zainstalowany po starcie).
    desktopConfigOverride, nodeCommand = process.execPath) {
        this.skillsRoot = skillsRoot;
        this.stateDir = stateDir;
        this.desktopConfigOverride = desktopConfigOverride;
        this.nodeCommand = nodeCommand;
    }
    get packagePath() {
        return lexMcpPackagePath(this.skillsRoot);
    }
    get command() {
        return this.nodeCommand;
    }
    // Zmienia się przy każdej instalacji, deinstalacji i zmianie klucza — klient MCP startuje wtedy od nowa.
    get revision() {
        return this.revisionValue;
    }
    get stateFile() {
        return path.join(this.stateDir, "connectors.json");
    }
    get ceidgKeyFile() {
        return path.join(this.stateDir, "ceidg.token");
    }
    // Sesja sn.pl z weryfikacji (captcha) wykonanej przez użytkownika w oknie sn.pl aplikacji.
    get snSessionFile() {
        return path.join(this.stateDir, "sn-session.json");
    }
    snSessionSavedAt() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.snSessionFile, "utf8"));
            return typeof parsed.saved_at === "string" ? parsed.saved_at : null;
        }
        catch {
            return null;
        }
    }
    // Sesja sn.pl dla narzędzi czatu (search_case_law, verify_case_reference): te same
    // ciasteczka i przeglądarka, co serwer sn konektora po weryfikacji użytkownika.
    snSession() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.snSessionFile, "utf8"));
            if (typeof parsed.cookie !== "string" || !parsed.cookie)
                return null;
            return { cookie: parsed.cookie, userAgent: typeof parsed.userAgent === "string" ? parsed.userAgent : null };
        }
        catch {
            return null;
        }
    }
    // Serwer sn czyta plik przy każdym zapytaniu, więc klient MCP nie musi startować od nowa.
    setSnSession(rawCookie, rawUserAgent) {
        const cookies = rawCookie
            .split(";")
            .map((part) => part.trim())
            .filter((part) => /^[A-Za-z0-9_.-]{1,128}=[^;\r\n]{0,4096}$/.test(part));
        if (!cookies.length)
            throw new Error("SN_SESSION_EMPTY");
        const userAgent = /^Mozilla\/5\.0 [\x20-\x7e]{10,400}$/.test(rawUserAgent) ? rawUserAgent : null;
        const savedAt = new Date().toISOString();
        writePrivate(this.snSessionFile, JSON.stringify({ cookie: cookies.join("; "), userAgent, saved_at: savedAt }) + "\n");
        return { savedAt, cookies: cookies.length };
    }
    clearSnSession() {
        fs.rmSync(this.snSessionFile, { force: true });
    }
    // Lekka sonda snproxy z podanymi ciasteczkami — potwierdza, że weryfikacja sn.pl przeszła
    // (brak captchy albo rozwiązana przez użytkownika) DOKŁADNIE tak, jak późniejsze zapytania
    // serwera SN: ten sam PROXY, UA i task. JSON = gotowe; 403/HTML (strona wyzwania Incapsuli) =
    // wciąż blokada. Pozwala aplikacji ponowić zapytanie samej, bez ręcznego „Gotowe".
    async probeSnSession(rawCookie, rawUserAgent, fetchImpl = fetch) {
        const cookie = rawCookie
            .split(";")
            .map((part) => part.trim())
            .filter((part) => /^[A-Za-z0-9_.-]{1,128}=[^;\r\n]{0,4096}$/.test(part))
            .join("; ");
        if (!cookie)
            return { ready: false, status: 0 };
        const userAgent = /^Mozilla\/5\.0 [\x20-\x7e]{10,400}$/.test(rawUserAgent)
            ? rawUserAgent
            : SN_PROBE_USER_AGENT;
        const url = "https://www.sn.pl/pl/index.php?option=com_ajax&plugin=snproxy&format=json" +
            "&task=searchOrzeczenia&sygnatura=" +
            encodeURIComponent("III CZP 25/11");
        try {
            const resp = await fetchImpl(url, {
                headers: { cookie, "user-agent": userAgent, accept: "application/json" },
                signal: AbortSignal.timeout(15000)
            });
            if (resp.status !== 200)
                return { ready: false, status: resp.status };
            const body = await resp.text();
            // Incapsula serwuje stronę wyzwania jako HTML 200; JSON = snproxy odpowiedział.
            try {
                JSON.parse(body);
                return { ready: true, status: 200 };
            }
            catch {
                return { ready: false, status: 200 };
            }
        }
        catch {
            return { ready: false, status: 0 };
        }
    }
    readState() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
            if (parsed.schemaVersion === 1 && Array.isArray(parsed.installed)) {
                return {
                    schemaVersion: 1,
                    installed: parsed.installed.filter((id) => typeof id === "string" && isLexMcpServerId(id)),
                    ...(parsed.checks && typeof parsed.checks === "object" ? { checks: parsed.checks } : {})
                };
            }
        }
        catch {
            // Brak stanu = pierwsze uruchomienie.
        }
        // Domyślnie wszystkie serwery bez klucza — tak jak instaluj_serwery_mcp.py bez --serwery.
        return {
            schemaVersion: 1,
            installed: LEX_MCP_CATALOG.filter((server) => !server.requiresKey).map((server) => server.id)
        };
    }
    writeState(state) {
        writePrivate(this.stateFile, JSON.stringify(state, null, 2) + "\n");
        this.revisionValue += 1;
    }
    ceidgKey() {
        const fromEnv = process.env.CEIDG_API_KEY?.trim();
        if (fromEnv)
            return fromEnv;
        try {
            return fs.readFileSync(this.ceidgKeyFile, "utf8").trim() || null;
        }
        catch {
            return null;
        }
    }
    installedServers() {
        const installed = new Set(this.readState().installed);
        return LEX_MCP_SERVER_IDS.filter((id) => installed.has(id));
    }
    // Serwery, które klient MCP aplikacji faktycznie uruchamia.
    readyServers() {
        const key = this.ceidgKey();
        return this.installedServers().filter((id) => id !== "ceidg" || Boolean(key));
    }
    serverEnvironment() {
        const env = {};
        for (const name of PASSED_ENV) {
            const value = process.env[name];
            if (typeof value === "string" && value)
                env[name] = value;
        }
        const key = this.ceidgKey();
        if (key)
            env.CEIDG_API_KEY = key;
        env.SN_SESSION_FILE = this.snSessionFile;
        // Wbudowany fetch Node (>= 22.21) korzysta z HTTPS_PROXY tylko z tą flagą — bez niej konektory
        // za proxy firmowym łączyły się bezpośrednio i dostawały odmowę (pomiar 2026-10-06).
        if (!env.NODE_USE_ENV_PROXY && (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy)) {
            env.NODE_USE_ENV_PROXY = "1";
        }
        return env;
    }
    get desktopLocation() {
        if (this.desktopConfigOverride) {
            return {
                configPath: this.desktopConfigOverride,
                available: fs.existsSync(path.dirname(this.desktopConfigOverride))
            };
        }
        return locateClaudeDesktop();
    }
    get desktopConfig() {
        return this.desktopLocation.configPath;
    }
    readDesktop() {
        try {
            const text = fs.readFileSync(this.desktopConfig, "utf8");
            const parsed = JSON.parse(text || "{}");
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
                ? parsed
                : null;
        }
        catch (error) {
            if (error.code === "ENOENT")
                return {};
            throw new Error("CLAUDE_DESKTOP_CONFIG_INVALID");
        }
    }
    desktopAvailable() {
        return this.desktopLocation.available;
    }
    desktopEntries() {
        if (!this.desktopAvailable())
            return new Set();
        try {
            return new Set(Object.keys(this.readDesktop()?.mcpServers ?? {}));
        }
        catch {
            return new Set();
        }
    }
    writeDesktop(mutate) {
        if (!this.desktopAvailable()) {
            throw new Error("CLAUDE_DESKTOP_NOT_INSTALLED");
        }
        const current = this.readDesktop() ?? {};
        if (fs.existsSync(this.desktopConfig)) {
            fs.copyFileSync(this.desktopConfig, this.desktopConfig.replace(/\.json$/, ".json.kopia-przed-lex"));
        }
        const servers = { ...(current.mcpServers ?? {}) };
        mutate(servers);
        writePrivate(this.desktopConfig, JSON.stringify({ ...current, mcpServers: servers }, null, 2) + "\n");
    }
    desktopEntry(id) {
        const env = this.serverEnvironment();
        if (id !== "ceidg")
            delete env.CEIDG_API_KEY;
        if (id !== "sn") {
            delete env.SN_SESSION_FILE;
            delete env.SN_COOKIE;
        }
        return {
            command: this.nodeCommand,
            args: [this.packagePath, id],
            env
        };
    }
    status() {
        const installed = new Set(this.installedServers());
        const ready = new Set(this.readyServers());
        const desktop = this.desktopEntries();
        const checks = this.readState().checks ?? {};
        const packageInfo = inspectLexMcpPackage(this.packagePath);
        const desktopLocation = this.desktopLocation;
        return {
            packagePath: this.packagePath,
            packageAvailable: packageInfo.integrity !== "MISSING",
            package: packageInfo,
            ceidg: {
                keyConfigured: Boolean(this.ceidgKey()),
                keyUrl: CEIDG_KEY_URL
            },
            sn: {
                sessionSavedAt: this.snSessionSavedAt()
            },
            desktop: desktopLocation,
            servers: LEX_MCP_CATALOG.map((server) => ({
                ...server,
                installed: installed.has(server.id),
                ready: ready.has(server.id),
                desktopInstalled: desktop.has(DESKTOP_PREFIX + server.id),
                ...(checks[server.id] ? { lastCheck: checks[server.id] } : {})
            }))
        };
    }
    // Handshake MCP (initialize + tools/list) na samym serwerze — instalacja bez działającego serwera nie przechodzi.
    async probe(id) {
        if (!fs.existsSync(this.packagePath)) {
            throw new Error("LEX_MCP_PACKAGE_MISSING");
        }
        const client = new Client({ name: "lex-machina-mcp-installer", version: "1.0.0" });
        const transport = new StdioClientTransport({
            command: this.nodeCommand,
            args: [this.packagePath, id],
            env: this.serverEnvironment(),
            stderr: "pipe"
        });
        const timeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("LEX_MCP_PROBE_TIMEOUT")), 30_000).unref();
        });
        try {
            await Promise.race([client.connect(transport), timeout]);
            const listed = await Promise.race([client.listTools(), timeout]);
            const tools = listed.tools
                .map((tool) => tool.name)
                .filter((name) => name.startsWith(`${id}_`));
            if (!tools.length)
                throw new Error("LEX_MCP_PROBE_NO_TOOLS");
            return tools;
        }
        finally {
            await client.close().catch(() => undefined);
        }
    }
    async install(id, options = {}) {
        if (id === "ceidg" && !this.ceidgKey()) {
            throw new Error("CEIDG_KEY_REQUIRED");
        }
        if (options.desktop && !this.desktopAvailable()) {
            throw new Error("CLAUDE_DESKTOP_NOT_INSTALLED");
        }
        const tools = await this.probe(id);
        const state = this.readState();
        if (!state.installed.includes(id))
            state.installed.push(id);
        state.checks = { ...state.checks, [id]: { at: new Date().toISOString(), ok: true, tools } };
        this.writeState(state);
        if (options.desktop) {
            this.writeDesktop((servers) => {
                servers[DESKTOP_PREFIX + id] = this.desktopEntry(id);
            });
        }
        return { tools };
    }
    // Ponowny handshake zainstalowanego serwera; wynik trafia do stanu, instalacja się nie zmienia.
    async check(id) {
        let result;
        try {
            if (id === "ceidg" && !this.ceidgKey())
                throw new Error("CEIDG_KEY_REQUIRED");
            result = { at: new Date().toISOString(), ok: true, tools: await this.probe(id) };
        }
        catch (error) {
            result = {
                at: new Date().toISOString(),
                ok: false,
                error: error instanceof Error ? error.message.split(":", 1)[0] : "LEX_MCP_FAILED"
            };
        }
        const state = this.readState();
        state.checks = { ...state.checks, [id]: result };
        writePrivate(this.stateFile, JSON.stringify(state, null, 2) + "\n");
        return result;
    }
    uninstall(id, options = {}) {
        const state = this.readState();
        state.installed = state.installed.filter((installed) => installed !== id);
        if (state.checks)
            delete state.checks[id];
        this.writeState(state);
        if (options.desktop && this.desktopEntries().has(DESKTOP_PREFIX + id)) {
            this.writeDesktop((servers) => {
                delete servers[DESKTOP_PREFIX + id];
            });
        }
    }
    async setCeidgKey(rawKey, fetchImpl = fetch) {
        const key = rawKey.trim();
        const shape = inspectCeidgKey(key);
        if (!shape.valid)
            throw new Error("CEIDG_KEY_NOT_JWT");
        const tested = await testCeidgKey(key, fetchImpl);
        if (tested.verification === "REJECTED")
            throw new Error("CEIDG_KEY_REJECTED");
        writePrivate(this.ceidgKeyFile, key + "\n");
        this.revisionValue += 1;
        if (this.desktopEntries().has(DESKTOP_PREFIX + "ceidg")) {
            this.writeDesktop((servers) => {
                servers[DESKTOP_PREFIX + "ceidg"] = this.desktopEntry("ceidg");
            });
        }
        return {
            ...tested,
            containsPersonalData: shape.containsPersonalData
        };
    }
    clearCeidgKey() {
        fs.rmSync(this.ceidgKeyFile, { force: true });
        this.revisionValue += 1;
        if (this.desktopEntries().has(DESKTOP_PREFIX + "ceidg")) {
            this.writeDesktop((servers) => {
                delete servers[DESKTOP_PREFIX + "ceidg"];
            });
        }
    }
}
