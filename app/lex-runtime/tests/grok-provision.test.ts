import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSessionManager } from "../src/providers/account-session.js";

const roots: string[] = [];
const previous = {
  clients: process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT,
  path: process.env.PATH
};

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-grok-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const [key, value] of [
    ["LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT", previous.clients],
    ["PATH", previous.path]
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("Grok Build: klient pobierany na żądanie", () => {
  it("bez klienta: status podaje, że Lex Machina pobierze klienta", async () => {
    process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT = tempDir();
    process.env.PATH = tempDir();
    const status = await new AccountSessionManager().status("xai");
    expect(status.installed).toBe(false);
    expect(status.installHint).toContain("pobierze przypiętą wersję");
  });

  it.skipIf(process.platform === "win32")(
    "przypięty klient z katalogu Lex Machina jest używany bez instalacji systemowej",
    async () => {
      const root = tempDir();
      process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT = root;
      process.env.PATH = `${tempDir()}${path.delimiter}${path.dirname(process.execPath)}`;
      const packageDir = path.join(root, "xai", "node_modules", "@xai-official", "grok");
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify({ version: "1.0.44" }));
      const binDir = path.join(root, "xai", "node_modules", ".bin");
      fs.mkdirSync(binDir, { recursive: true });
      const marker = path.join(root, "called.txt");
      const bin = path.join(binDir, "grok");
      fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$@" > '${marker}'\nexit 1\n`);
      fs.chmodSync(bin, 0o755);

      const status = await new AccountSessionManager().status("xai").catch(() => null);
      expect(status?.installed ?? true).toBe(true);
      expect(fs.readFileSync(marker, "utf8")).toContain("agent");
    }
  );
});
