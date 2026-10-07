import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSessionManager } from "../src/providers/account-session.js";

const roots: string[] = [];
const previous = {
  clients: process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT,
  path: process.env.PATH,
  claude: process.env.LEX_CLAUDE_CLI,
  codex: process.env.LEX_CODEX_CLI
};

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-uninstall-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const [key, value] of [
    ["LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT", previous.clients],
    ["PATH", previous.path],
    ["LEX_CLAUDE_CLI", previous.claude],
    ["LEX_CODEX_CLI", previous.codex]
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("deinstalacja klienta konta", () => {
  for (const provider of ["openai", "anthropic", "google", "xai"] as const) {
    it(`${provider}: usuwa tylko katalog klienta Lex Machina`, async () => {
      const root = tempDir();
      process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT = root;
      process.env.PATH = tempDir();
      delete process.env.LEX_CLAUDE_CLI;
      delete process.env.LEX_CODEX_CLI;
      const clientDir = path.join(root, provider, "node_modules", "pkg");
      fs.mkdirSync(clientDir, { recursive: true });
      fs.writeFileSync(path.join(clientDir, "package.json"), "{}");
      const sibling = path.join(root, "other-provider");
      fs.mkdirSync(sibling);

      const sessions = new AccountSessionManager();
      expect((await sessions.status(provider)).managedClientInstalled).toBe(true);

      const result = await sessions.uninstall(provider);
      expect(result.removed).toBe(true);
      expect(result.status.managedClientInstalled).toBe(false);
      expect(result.status.installed).toBe(false);
      expect(fs.existsSync(path.join(root, provider))).toBe(false);
      expect(fs.existsSync(sibling)).toBe(true);
    });
  }

  it("bez klienta: removed=false, bez błędu", async () => {
    process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT = tempDir();
    process.env.PATH = tempDir();
    const result = await new AccountSessionManager().uninstall("xai");
    expect(result.removed).toBe(false);
    expect(result.status.managedClientInstalled).toBe(false);
  });
});
