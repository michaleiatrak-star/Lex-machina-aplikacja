// Konektory MCP Lex Machina (audyt-systemu-v4/mcp-servers, pakiet dist/lex-mcp.mjs).
// Zastępują flotę @matematicsolutions/* i agregator prawo-pl-mcp. Lista, grupy i link do
// klucza CEIDG odpowiadają instaluj_serwery_mcp.py (FAZA 0E audytu) — tam jest źródło prawdy.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Client
} from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport
} from "@modelcontextprotocol/sdk/client/stdio.js";

export const LEX_MCP_SERVER_IDS = [
  "isap",
  "eurlex",
  "saos",
  "cbosa",
  "krs",
  "wl",
  "ceidg",
  "nbp",
  "eureka",
  "sudop",
  "uodo"
] as const;

export type LexMcpServerId =
  (typeof LEX_MCP_SERVER_IDS)[number];

export type LexMcpServerInfo = {
  id: LexMcpServerId;
  group: string;
  label: string;
  requiresKey?: "CEIDG_API_KEY";
};

export const LEX_MCP_CATALOG: LexMcpServerInfo[] = [
  { id: "isap", group: "Akty prawne i orzecznictwo", label: "ISAP/ELI — tekst aktu i przepisu (Sejm ELI)" },
  { id: "eurlex", group: "Akty prawne i orzecznictwo", label: "EUR-Lex + TSUE — akty UE, status, wyroki" },
  { id: "saos", group: "Akty prawne i orzecznictwo", label: "SAOS — orzeczenia sądów powszechnych i SN, cytator" },
  { id: "cbosa", group: "Akty prawne i orzecznictwo", label: "CBOSA — orzeczenia NSA/WSA (snapshot 🟨)" },
  { id: "krs", group: "Rejestry podmiotów", label: "KRS — odpis, reprezentacja (bez klucza)" },
  { id: "wl", group: "Rejestry podmiotów", label: "Biała lista VAT — status i rachunki (bez klucza)" },
  { id: "ceidg", group: "Rejestry podmiotów", label: "CEIDG — przedsiębiorcy-osoby fizyczne (WYMAGA KLUCZA)", requiresKey: "CEIDG_API_KEY" },
  { id: "nbp", group: "Podatki, finanse, dane osobowe", label: "NBP — kursy walut" },
  { id: "eureka", group: "Podatki, finanse, dane osobowe", label: "EUREKA — interpretacje podatkowe" },
  { id: "sudop", group: "Podatki, finanse, dane osobowe", label: "SUDOP — pomoc publiczna / de minimis" },
  { id: "uodo", group: "Podatki, finanse, dane osobowe", label: "UODO — decyzje Prezesa UODO" }
];

export const CEIDG_KEY_URL =
  "https://dane.biznes.gov.pl/pl/portal/034872";
// NIP spółki z KRS: 204 = token przyjęty (spółki nie są w CEIDG), 401 = token odrzucony.
const CEIDG_TEST_URL =
  "https://dane.biznes.gov.pl/api/ceidg/v3/firmy?nip=5261040828";
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

export function isLexMcpServerId(
  value: string
): value is LexMcpServerId {
  return (LEX_MCP_SERVER_IDS as readonly string[]).includes(value);
}

export function lexMcpPackagePath(
  skillsRoot: string
): string {
  const configured = process.env.LEX_MCP_PACKAGE?.trim();
  if (configured) return path.resolve(configured);
  return path.join(
    skillsRoot,
    "audyt-systemu-v4",
    "mcp-servers",
    "dist",
    "lex-mcp.mjs"
  );
}

function defaultStateDir(): string {
  const configured = process.env.LEX_MCP_STATE_DIR?.trim();
  if (configured) return path.resolve(configured);
  const local = process.env.LOCALAPPDATA?.trim();
  if (local) return path.resolve(local, "LexMachina", "mcp");
  return path.resolve(os.homedir(), ".lex-machina", "mcp");
}

export function claudeDesktopConfigPath(): string {
  const configured = process.env.LEX_CLAUDE_DESKTOP_CONFIG?.trim();
  if (configured) return path.resolve(configured);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function writePrivate(
  file: string,
  content: string
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Windows: ACL katalogu profilu użytkownika.
  }
}

export type CeidgKeyShape = {
  valid: boolean;
  fields: string[];
  containsPersonalData: boolean;
};

// Kontrola kształtu JWT bez ujawniania treści: ładunek zawiera PESEL i nazwisko właściciela.
export function inspectCeidgKey(
  key: string
): CeidgKeyShape {
  const parts = key.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    return { valid: false, fields: [], containsPersonalData: false };
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8")
    ) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { valid: false, fields: [], containsPersonalData: false };
    }
    const fields = Object.keys(payload).sort();
    return {
      valid: true,
      fields,
      containsPersonalData: ["pesel", "given_name", "family_name"].some((field) => fields.includes(field))
    };
  } catch {
    return { valid: false, fields: [], containsPersonalData: false };
  }
}

export type CeidgKeyVerification =
  | "VERIFIED"
  | "REJECTED"
  | "RATE_LIMITED"
  | "UNREACHABLE";

export async function testCeidgKey(
  key: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ verification: CeidgKeyVerification; httpStatus?: number }> {
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
    if (httpStatus === 200 || httpStatus === 204) return { verification: "VERIFIED", httpStatus };
    if (httpStatus === 401 || httpStatus === 403) return { verification: "REJECTED", httpStatus };
    if (httpStatus === 429) return { verification: "RATE_LIMITED", httpStatus };
    return { verification: "UNREACHABLE", httpStatus };
  } catch {
    return { verification: "UNREACHABLE" };
  }
}

type StoredState = {
  schemaVersion: 1;
  installed: LexMcpServerId[];
};

type DesktopConfig = {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

export type LexMcpServerStatus = LexMcpServerInfo & {
  installed: boolean;
  ready: boolean;
  desktopInstalled: boolean;
};

export type LexMcpConnectorStatus = {
  packagePath: string;
  packageAvailable: boolean;
  // Wersja pakietu serwerów z mcpb-manifest.json obok dist/ (null, gdy brak manifestu).
  packageVersion: string | null;
  ceidg: {
    keyConfigured: boolean;
    keyUrl: string;
  };
  desktop: {
    configPath: string;
    available: boolean;
  };
  servers: LexMcpServerStatus[];
};

export class LexMcpConnectorStore {
  private revisionValue = 0;

  constructor(
    private readonly skillsRoot: string,
    private readonly stateDir: string = defaultStateDir(),
    private readonly desktopConfig: string = claudeDesktopConfigPath(),
    private readonly nodeCommand: string = process.execPath
  ) {}

  get packagePath(): string {
    return lexMcpPackagePath(this.skillsRoot);
  }

  get command(): string {
    return this.nodeCommand;
  }

  // Zmienia się przy każdej instalacji, deinstalacji i zmianie klucza — klient MCP startuje wtedy od nowa.
  get revision(): number {
    return this.revisionValue;
  }

  private get stateFile(): string {
    return path.join(this.stateDir, "connectors.json");
  }

  private get ceidgKeyFile(): string {
    return path.join(this.stateDir, "ceidg.token");
  }

  private readState(): StoredState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as Partial<StoredState>;
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.installed)) {
        return {
          schemaVersion: 1,
          installed: parsed.installed.filter((id): id is LexMcpServerId => typeof id === "string" && isLexMcpServerId(id))
        };
      }
    } catch {
      // Brak stanu = pierwsze uruchomienie.
    }
    // Domyślnie wszystkie serwery bez klucza — tak jak instaluj_serwery_mcp.py bez --serwery.
    return {
      schemaVersion: 1,
      installed: LEX_MCP_CATALOG.filter((server) => !server.requiresKey).map((server) => server.id)
    };
  }

  private writeState(state: StoredState): void {
    writePrivate(this.stateFile, JSON.stringify(state, null, 2) + "\n");
    this.revisionValue += 1;
  }

  ceidgKey(): string | null {
    const fromEnv = process.env.CEIDG_API_KEY?.trim();
    if (fromEnv) return fromEnv;
    try {
      return fs.readFileSync(this.ceidgKeyFile, "utf8").trim() || null;
    } catch {
      return null;
    }
  }

  installedServers(): LexMcpServerId[] {
    const installed = new Set(this.readState().installed);
    return LEX_MCP_SERVER_IDS.filter((id) => installed.has(id));
  }

  // Serwery, które klient MCP aplikacji faktycznie uruchamia.
  readyServers(): LexMcpServerId[] {
    const key = this.ceidgKey();
    return this.installedServers().filter((id) => id !== "ceidg" || Boolean(key));
  }

  serverEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const name of PASSED_ENV) {
      const value = process.env[name];
      if (typeof value === "string" && value) env[name] = value;
    }
    const key = this.ceidgKey();
    if (key) env.CEIDG_API_KEY = key;
    return env;
  }

  private readDesktop(): DesktopConfig | null {
    try {
      const text = fs.readFileSync(this.desktopConfig, "utf8");
      const parsed = JSON.parse(text || "{}") as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as DesktopConfig
        : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error("CLAUDE_DESKTOP_CONFIG_INVALID");
    }
  }

  desktopAvailable(): boolean {
    return fs.existsSync(path.dirname(this.desktopConfig));
  }

  private desktopEntries(): Set<string> {
    if (!this.desktopAvailable()) return new Set();
    try {
      return new Set(Object.keys(this.readDesktop()?.mcpServers ?? {}));
    } catch {
      return new Set();
    }
  }

  private writeDesktop(
    mutate: (servers: Record<string, unknown>) => void
  ): void {
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

  private desktopEntry(id: LexMcpServerId): Record<string, unknown> {
    const env = this.serverEnvironment();
    if (id !== "ceidg") delete env.CEIDG_API_KEY;
    return {
      command: this.nodeCommand,
      args: [this.packagePath, id],
      env
    };
  }

  status(): LexMcpConnectorStatus {
    const installed = new Set(this.installedServers());
    const ready = new Set(this.readyServers());
    const desktop = this.desktopEntries();
    return {
      packagePath: this.packagePath,
      packageAvailable: fs.existsSync(this.packagePath),
      packageVersion: this.packageVersion(),
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
        desktopInstalled: desktop.has(DESKTOP_PREFIX + server.id)
      }))
    };
  }

  packageVersion(): string | null {
    try {
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(path.dirname(path.dirname(this.packagePath)), "mcpb-manifest.json"),
          "utf8"
        )
      ) as { version?: unknown };
      return typeof manifest.version === "string" ? manifest.version : null;
    } catch {
      return null;
    }
  }

  // Handshake MCP (initialize + tools/list) na samym serwerze — instalacja bez działającego serwera nie przechodzi.
  async probe(id: LexMcpServerId): Promise<string[]> {
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
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("LEX_MCP_PROBE_TIMEOUT")), 30_000).unref();
    });
    try {
      await Promise.race([client.connect(transport), timeout]);
      const listed = await Promise.race([client.listTools(), timeout]);
      const tools = listed.tools
        .map((tool) => tool.name)
        .filter((name) => name.startsWith(`${id}_`));
      if (!tools.length) throw new Error("LEX_MCP_PROBE_NO_TOOLS");
      return tools;
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  async install(
    id: LexMcpServerId,
    options: { desktop?: boolean } = {}
  ): Promise<{ tools: string[] }> {
    if (id === "ceidg" && !this.ceidgKey()) {
      throw new Error("CEIDG_KEY_REQUIRED");
    }
    if (options.desktop && !this.desktopAvailable()) {
      throw new Error("CLAUDE_DESKTOP_NOT_INSTALLED");
    }
    const tools = await this.probe(id);
    const state = this.readState();
    if (!state.installed.includes(id)) state.installed.push(id);
    this.writeState(state);
    if (options.desktop) {
      this.writeDesktop((servers) => {
        servers[DESKTOP_PREFIX + id] = this.desktopEntry(id);
      });
    }
    return { tools };
  }

  uninstall(
    id: LexMcpServerId,
    options: { desktop?: boolean } = {}
  ): void {
    const state = this.readState();
    state.installed = state.installed.filter((installed) => installed !== id);
    this.writeState(state);
    if (options.desktop && this.desktopEntries().has(DESKTOP_PREFIX + id)) {
      this.writeDesktop((servers) => {
        delete servers[DESKTOP_PREFIX + id];
      });
    }
  }

  async setCeidgKey(
    rawKey: string,
    fetchImpl: typeof fetch = fetch
  ): Promise<{
    verification: CeidgKeyVerification;
    httpStatus?: number;
    containsPersonalData: boolean;
  }> {
    const key = rawKey.trim();
    const shape = inspectCeidgKey(key);
    if (!shape.valid) throw new Error("CEIDG_KEY_NOT_JWT");
    const tested = await testCeidgKey(key, fetchImpl);
    if (tested.verification === "REJECTED") throw new Error("CEIDG_KEY_REJECTED");
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

  clearCeidgKey(): void {
    fs.rmSync(this.ceidgKeyFile, { force: true });
    this.revisionValue += 1;
    if (this.desktopEntries().has(DESKTOP_PREFIX + "ceidg")) {
      this.writeDesktop((servers) => {
        delete servers[DESKTOP_PREFIX + "ceidg"];
      });
    }
  }
}
