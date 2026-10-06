import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterEach,
  describe,
  expect,
  it
} from "vitest";
import {
  CEIDG_KEY_URL,
  LexMcpConnectorStore,
  inspectCeidgKey,
  inspectLexMcpPackage,
  lexMcpPackagePath,
  locateClaudeDesktop
} from "../src/lex-mcp-connectors.js";
import {
  LegalFederationToolRuntime
} from "../src/legal-federation-tool-runtime.js";

const skillsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../Wersja rozwojowa rozpakowana"
);

const temporary: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-mcp-"));
  temporary.push(dir);
  return dir;
}

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(payload)}.podpis`;
}

function fakeFetch(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as typeof fetch;
}

function store(options: { desktop?: boolean } = {}) {
  const root = tempDir();
  const desktopDir = path.join(root, "Claude");
  if (options.desktop) fs.mkdirSync(desktopDir);
  return new LexMcpConnectorStore(
    skillsRoot,
    path.join(root, "state"),
    path.join(desktopDir, "claude_desktop_config.json")
  );
}

afterEach(() => {
  delete process.env.CEIDG_API_KEY;
  for (const dir of temporary.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("LexMcpConnectorStore", () => {
  it("installs every keyless server by default and keeps CEIDG off until a key is given", () => {
    const status = store().status();

    expect(status.packageAvailable).toBe(true);
    expect(status.ceidg).toEqual({ keyConfigured: false, keyUrl: CEIDG_KEY_URL });
    expect(CEIDG_KEY_URL).toBe("https://dane.biznes.gov.pl/pl/portal/034872");
    expect(status.servers.map((server) => server.id)).toEqual([
      "isap", "eurlex", "saos", "cbosa", "sn", "kio", "krs", "wl", "ceidg", "nbp", "eureka", "sudop", "uodo"
    ]);
    expect(status.servers.filter((server) => !server.installed).map((server) => server.id)).toEqual(["ceidg"]);
  });

  it("uninstalls and reinstalls a server after a real MCP handshake, mirroring Claude Desktop", async () => {
    const connectors = store({ desktop: true });
    const desktopFile = connectors.status().desktop.configPath;
    fs.writeFileSync(desktopFile, JSON.stringify({ mcpServers: { inny: { command: "x" } }, theme: "dark" }));

    const { tools } = await connectors.install("nbp", { desktop: true });
    expect(tools).toEqual(["nbp_kurs_waluty"]);
    const written = JSON.parse(fs.readFileSync(desktopFile, "utf8"));
    expect(written.theme).toBe("dark");
    expect(written.mcpServers.inny).toEqual({ command: "x" });
    expect(written.mcpServers["lex-nbp"].args).toEqual([connectors.packagePath, "nbp"]);
    expect(written.mcpServers["lex-nbp"].env.CEIDG_API_KEY).toBeUndefined();
    expect(fs.existsSync(desktopFile + ".kopia-przed-lex")).toBe(true);

    const revision = connectors.revision;
    connectors.uninstall("nbp", { desktop: true });
    expect(connectors.revision).toBeGreaterThan(revision);
    expect(connectors.installedServers()).not.toContain("nbp");
    const after = JSON.parse(fs.readFileSync(desktopFile, "utf8"));
    expect(after.mcpServers["lex-nbp"]).toBeUndefined();
    expect(after.mcpServers.inny).toEqual({ command: "x" });
  }, 60_000);

  it("refuses CEIDG without a key and never writes Claude Desktop when it is absent", async () => {
    const connectors = store();
    await expect(connectors.install("ceidg")).rejects.toThrow("CEIDG_KEY_REQUIRED");
    expect(connectors.status().desktop.available).toBe(false);
  });

  it("validates, tests and stores the CEIDG key privately", async () => {
    const connectors = store();
    const key = jwt({ pesel: "00000000000", given_name: "Jan", family_name: "Test" });

    await expect(connectors.setCeidgKey("nie-jwt", fakeFetch(204))).rejects.toThrow("CEIDG_KEY_NOT_JWT");
    await expect(connectors.setCeidgKey(key, fakeFetch(401))).rejects.toThrow("CEIDG_KEY_REJECTED");
    expect(connectors.ceidgKey()).toBeNull();

    const saved = await connectors.setCeidgKey(`  ${key}\n`, fakeFetch(204));
    expect(saved).toEqual({ verification: "VERIFIED", httpStatus: 204, containsPersonalData: true });
    expect(connectors.ceidgKey()).toBe(key);
    expect(connectors.serverEnvironment().CEIDG_API_KEY).toBe(key);
    expect(JSON.stringify(connectors.status())).not.toContain(key);

    connectors.clearCeidgKey();
    expect(connectors.ceidgKey()).toBeNull();
  });

  it("keeps a syntactically valid key when the CEIDG API cannot be reached", async () => {
    const connectors = store();
    const unreachable = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const saved = await connectors.setCeidgKey(jwt({ sub: "x" }), unreachable);
    expect(saved.verification).toBe("UNREACHABLE");
    expect(connectors.status().ceidg.keyConfigured).toBe(true);
  });

  it("inspects the JWT shape without echoing personal data", () => {
    expect(inspectCeidgKey(jwt({ pesel: "1", sub: "2" }))).toEqual({
      valid: true,
      fields: ["pesel", "sub"],
      containsPersonalData: true
    });
    expect(inspectCeidgKey("a.b").valid).toBe(false);
  });
});

describe("Lex MCP package integrity and readiness checks", () => {
  it("matches the bundled package against CHECKSUMS.sha256 of audyt-systemu-v4", () => {
    const info = inspectLexMcpPackage(lexMcpPackagePath(skillsRoot));
    expect(info.integrity).toBe("MATCH");
    expect(info.sha256).toBe(info.expectedSha256);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(info.skillVersion).toMatch(/^\d+\.\d+$/);
    expect(store().status().package.integrity).toBe("MATCH");
  });

  it("flags a package that differs from the skill checksum, or is missing", () => {
    const skill = path.join(tempDir(), "audyt-systemu-v4");
    const dist = path.join(skill, "mcp-servers", "dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "lex-mcp.mjs"), "// podmieniony\n");
    fs.writeFileSync(path.join(skill, "CHECKSUMS.sha256"), `${"0".repeat(64)}  ./mcp-servers/dist/lex-mcp.mjs\n`);
    expect(inspectLexMcpPackage(path.join(dist, "lex-mcp.mjs")).integrity).toBe("MISMATCH");

    fs.rmSync(path.join(skill, "CHECKSUMS.sha256"));
    expect(inspectLexMcpPackage(path.join(dist, "lex-mcp.mjs")).integrity).toBe("UNVERIFIED");
    expect(inspectLexMcpPackage(path.join(dist, "brak.mjs"))).toEqual({ integrity: "MISSING" });
  });

  it("records a live handshake per server and forgets it on uninstall", async () => {
    const connectors = store();
    const nbp = await connectors.check("nbp");
    expect(nbp).toMatchObject({ ok: true, tools: ["nbp_kurs_waluty"] });
    expect(connectors.status().servers.find((server) => server.id === "nbp")?.lastCheck).toEqual(nbp);

    expect(await connectors.check("ceidg")).toMatchObject({ ok: false, error: "CEIDG_KEY_REQUIRED" });

    const revision = connectors.revision;
    connectors.uninstall("nbp");
    expect(connectors.revision).toBeGreaterThan(revision);
    expect(connectors.status().servers.find((server) => server.id === "nbp")?.lastCheck).toBeUndefined();
  }, 60_000);
});

describe("LegalFederationToolRuntime on Lex MCP connectors", () => {
  it("serves the search tab directly with the same source gates and no session audit", async () => {
    const connectors = store();
    connectors.uninstall("cbosa");
    const runtime = new LegalFederationToolRuntime(undefined, undefined, connectors);
    try {
      const listed = await runtime.direct({ source: "nbp" });
      expect(listed.ok).toBe(true);
      expect((listed.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual(["nbp_kurs_waluty"]);

      const mismatch = await runtime.direct({ source: "isap", tool: "krs_lookup" });
      expect(mismatch).toMatchObject({ ok: false, result: { error: "FEDERATED_NATIVE_TOOL_SOURCE_MISMATCH" } });

      const missing = await runtime.direct({ source: "cbosa", tool: "cbosa_szukaj", arguments: { query: "II FSK 1/20" } });
      expect(missing).toMatchObject({ ok: false, result: { status: "SOURCE_UNAVAILABLE" } });
      expect(runtime.auditEvents()).toEqual([]);
    } finally {
      await runtime.close();
    }
  }, 60_000);

  it("lists native tools of an installed server through lex-mcp.mjs", async () => {
    const runtime = new LegalFederationToolRuntime(undefined, undefined, store());
    try {
      const [result] = await runtime.runTools([
        { id: "list-nbp", name: "list_federated_legal_sources", input: { sourceId: "nbp" } }
      ]);
      const payload = JSON.parse(result!.content) as { status: string; tools: Array<{ name: string }> };
      expect(payload.status).toBe("OK");
      expect(payload.tools.map((tool) => tool.name)).toEqual(["nbp_kurs_waluty"]);
    } finally {
      await runtime.close();
    }
  }, 60_000);

  it("reports an uninstalled source as unavailable, never as absent", async () => {
    const connectors = store();
    connectors.uninstall("cbosa");
    const runtime = new LegalFederationToolRuntime(undefined, undefined, connectors);
    const [search, ceidg] = await runtime.runTools([
      { id: "s", name: "search_federated_legal_sources", input: { source: "cbosa", query: "II FSK 1/20" } },
      { id: "c", name: "search_federated_legal_sources", input: { source: "ceidg", query: "5261040828" } }
    ]);
    expect(JSON.parse(search!.content)).toMatchObject({
      status: "SOURCE_UNAVAILABLE",
      error: "FEDERATED_SOURCE_NOT_INSTALLED:cbosa"
    });
    expect(JSON.parse(ceidg!.content).error).toContain("Konektory MCP");
  });

  it("rejects a native tool that belongs to another source", async () => {
    const runtime = new LegalFederationToolRuntime(undefined, undefined, store());
    const [result] = await runtime.runTools([
      { id: "x", name: "call_federated_legal_source", input: { source: "isap", tool: "krs_lookup", arguments: {} } }
    ]);
    expect(JSON.parse(result!.content).error).toBe("FEDERATED_NATIVE_TOOL_SOURCE_MISMATCH");
  });
});

describe("Claude Desktop detection on Windows", () => {
  function windows() {
    const home = tempDir();
    const appData = path.join(home, "AppData", "Roaming");
    const local = path.join(home, "AppData", "Local");
    fs.mkdirSync(appData, { recursive: true });
    fs.mkdirSync(local, { recursive: true });
    const locate = (extra: NodeJS.ProcessEnv = {}) =>
      locateClaudeDesktop({
        platform: "win32",
        env: { APPDATA: appData, LOCALAPPDATA: local, ...extra },
        homedir: home
      });
    return { home, appData, local, locate };
  }

  it("reports Claude Desktop absent when nothing is installed", () => {
    const { appData, locate } = windows();
    expect(locate()).toEqual({
      configPath: path.join(appData, "Claude", "claude_desktop_config.json"),
      available: false
    });
  });

  it("finds the classic %APPDATA%\\Claude config", () => {
    const { appData, locate } = windows();
    fs.mkdirSync(path.join(appData, "Claude"));
    expect(locate()).toEqual({
      configPath: path.join(appData, "Claude", "claude_desktop_config.json"),
      available: true
    });
  });

  it("finds the Microsoft Store / MSIX config in LocalCache\\Roaming", () => {
    const { local, locate } = windows();
    const dir = path.join(local, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "claude_desktop_config.json"), "{}");
    expect(locate()).toEqual({
      configPath: path.join(dir, "claude_desktop_config.json"),
      available: true
    });
  });

  it("prefers the most recently written config when both copies exist", () => {
    const { appData, local, locate } = windows();
    const msix = path.join(local, "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude");
    const classic = path.join(appData, "Claude");
    fs.mkdirSync(msix, { recursive: true });
    fs.mkdirSync(classic);
    fs.writeFileSync(path.join(msix, "claude_desktop_config.json"), "{}");
    fs.writeFileSync(path.join(classic, "claude_desktop_config.json"), "{}");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(path.join(msix, "claude_desktop_config.json"), old, old);
    expect(locate().configPath).toBe(path.join(classic, "claude_desktop_config.json"));
  });

  it("detects an installed but never started Claude Desktop", () => {
    const squirrel = windows();
    fs.mkdirSync(path.join(squirrel.local, "AnthropicClaude"));
    expect(squirrel.locate()).toEqual({
      configPath: path.join(squirrel.appData, "Claude", "claude_desktop_config.json"),
      available: true
    });

    const msix = windows();
    const pkg = path.join(msix.local, "Packages", "Claude_pzs8sxrjxfjjc");
    fs.mkdirSync(pkg, { recursive: true });
    expect(msix.locate()).toEqual({
      configPath: path.join(pkg, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"),
      available: true
    });
  });

  it("falls back to the user profile when APPDATA is not inherited", () => {
    const { home, appData } = windows();
    fs.mkdirSync(path.join(appData, "Claude"));
    expect(locateClaudeDesktop({ platform: "win32", env: {}, homedir: home })).toEqual({
      configPath: path.join(appData, "Claude", "claude_desktop_config.json"),
      available: true
    });
  });

  it("honours LEX_CLAUDE_DESKTOP_CONFIG", () => {
    const { home, locate } = windows();
    const file = path.join(home, "wlasny", "claude_desktop_config.json");
    expect(locate({ LEX_CLAUDE_DESKTOP_CONFIG: file })).toEqual({ configPath: file, available: false });
  });
});
