import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LEX_MCP_SERVERS, writeNativeAgentMacos } from "../src/llama-native-macos.js";

const INSTALLER = path.resolve(__dirname, "../../installer");
let dir = "";

afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

function runtimeRoot(skills = 32): string {
  const root = path.join(dir, "runtime");
  fs.mkdirSync(path.join(root, "bootstrap"), { recursive: true });
  for (const file of [
    "llama-web-mcp.py",
    "llama-legal-skills-mcp.py",
    "llama-local-documents-mcp.py",
    "llama-native-system-message.txt",
    "mistral-nemo-web-grounded.jinja",
    "bielik-web-grounded.jinja"
  ]) {
    fs.copyFileSync(path.join(INSTALLER, file), path.join(root, "bootstrap", file));
  }
  for (let index = 0; index < skills; index += 1) {
    fs.mkdirSync(path.join(root, "corpus", `skill-${index}`), { recursive: true });
    fs.writeFileSync(path.join(root, "corpus", `skill-${index}`, "SKILL.md"), "# skill\n");
  }
  fs.mkdirSync(path.join(root, "corpus", "audyt-systemu-v4", "mcp-servers", "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "corpus", "audyt-systemu-v4", "mcp-servers", "dist", "lex-mcp.mjs"), "");
  fs.mkdirSync(path.join(root, "app", "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "app", "dist", "uodo-official-mcp-server.js"), "");
  return root;
}

describe("standalone llama.cpp server with tools on macOS", () => {
  it("writes the MCP tools, the Web UI policy and a launcher, as configure-llama-native-web.ps1 does", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-native-mac-"));
    const localRoot = path.join(dir, "local-ai");
    const result = writeNativeAgentMacos({
      runtimeRoot: runtimeRoot(),
      localRoot,
      python: process.execPath,
      node: process.execPath,
      modelsRoot: path.join(dir, "components", "models")
    });
    const mcp = JSON.parse(fs.readFileSync(result.mcpConfig, "utf8")) as { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> };
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["documents", "legal", "uodo_official", "web", ...LEX_MCP_SERVERS].sort());
    const documents = mcp.mcpServers.documents!;
    expect(documents.args).toEqual(expect.arrayContaining(["--models-root", path.join(dir, "components", "models"), "--python", process.execPath]));
    expect(documents.env.STANZA_RESOURCES_DIR).toBe(path.join(dir, "components", "models", "stanza"));
    expect(fs.existsSync(path.join(localRoot, "mcp", "llama-local-documents-mcp.py"))).toBe(true);
    expect(fs.existsSync(path.join(localRoot, "bielik-web-grounded.jinja"))).toBe(true);

    const ui = JSON.parse(fs.readFileSync(result.uiConfig, "utf8")) as { systemMessage: string; agenticMaxTurns: number };
    expect(ui.agenticMaxTurns).toBe(12);
    expect(ui.systemMessage).toMatch(/^LEX_WEB_GROUNDED_POLICY_V1/u);
    expect(ui.systemMessage).toContain("pęku kluczy macOS");
    expect(ui.systemMessage).not.toContain("DPAPI");

    expect(fs.statSync(result.launcher).mode & 0o111).not.toBe(0);
    expect(spawnSync("bash", ["-n", result.launcher]).status).toBe(0);
  });

  it("refuses a corpus without the 32 legal skills", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-native-mac-"));
    expect(() =>
      writeNativeAgentMacos({ runtimeRoot: runtimeRoot(5), localRoot: path.join(dir, "ai"), python: process.execPath, node: process.execPath, modelsRoot: dir })
    ).toThrow(/LLAMA_NATIVE_LEGAL_SKILL_COUNT_INVALID:expected=32:actual=5/u);
  });

  it("the policy file is the Windows configurator's text", () => {
    const script = fs.readFileSync(path.join(INSTALLER, "configure-llama-native-web.ps1"), "utf8");
    const start = script.indexOf("$systemMessage = @'\n") + "$systemMessage = @'\n".length;
    const windows = script.slice(start, script.indexOf("\n'@", start)).trim();
    expect(fs.readFileSync(path.join(INSTALLER, "llama-native-system-message.txt"), "utf8").trim()).toBe(windows);
  });
});
