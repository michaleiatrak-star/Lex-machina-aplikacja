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
    "kio",
    "krs",
    "wl",
    "ceidg",
    "nbp",
    "eureka",
    "sudop",
    "uodo"
];
export const LEX_MCP_CATALOG = [
    { id: "isap", group: "Akty prawne i orzecznictwo", label: "ISAP/ELI — tekst aktu i przepisu (Sejm ELI)" },
    { id: "eurlex", group: "Akty prawne i orzecznictwo", label: "EUR-Lex + TSUE — akty UE, status, wyroki" },
    { id: "saos", group: "Akty prawne i orzecznictwo", label: "SAOS — orzeczenia sądów powszechnych i SN, cytator" },
    { id: "cbosa", group: "Akty prawne i orzecznictwo", label: "CBOSA — orzeczenia NSA/WSA (snapshot 🟨)" },
    { id: "kio", group: "Akty prawne i orzecznictwo", label: "KIO — orzeczenia Krajowej Izby Odwoławczej (wyszukiwarka UZP)" },
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
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "NODE_EXTRA_CA_CERTS"
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
export function claudeDesktopConfigPath() {
    const configured = process.env.LEX_CLAUDE_DESKTOP_CONFIG?.trim();
    if (configured)
        return path.resolve(configured);
    if (process.platform === "win32") {
        return path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
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
    desktopConfig;
    nodeCommand;
    revisionValue = 0;
    constructor(skillsRoot, stateDir = defaultStateDir(), desktopConfig = claudeDesktopConfigPath(), nodeCommand = process.execPath) {
        this.skillsRoot = skillsRoot;
        this.stateDir = stateDir;
        this.desktopConfig = desktopConfig;
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
        return env;
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
        return fs.existsSync(path.dirname(this.desktopConfig));
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
        return {
            packagePath: this.packagePath,
            packageAvailable: packageInfo.integrity !== "MISSING",
            package: packageInfo,
            ceidg: {
                keyConfigured: Boolean(this.ceidgKey()),
                keyUrl: CEIDG_KEY_URL
            },
            desktop: {
                configPath: this.desktopConfig,
                available: this.desktopAvailable()
            },
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
