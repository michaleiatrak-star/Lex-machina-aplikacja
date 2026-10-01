import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AccountSessionManager,
  countNpmFetches,
  npmCliScript,
  npmFailureDetail,
  npmInstallEnvironment,
  windowsShimCommandLine
} from "../src/providers/account-session.js";

const roots: string[] = [];
const previous = {
  clients: process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT,
  path: process.env.PATH,
  npm: process.env.LEX_NPM_CLI
};

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-grok-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const [key, value] of [
    ["LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT", previous.clients],
    ["PATH", previous.path],
    ["LEX_NPM_CLI", previous.npm]
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

  it("liczy pobrane pakiety z logu npm --loglevel=http", () => {
    expect(
      countNpmFetches(
        "npm http fetch GET 200 https://registry.npmjs.org/a 12ms (cache miss)\nnpm http fetch GET 304 https://registry.npmjs.org/b 3ms\nnpm http fetch GET 200 https://registry.npmjs.org/c.tgz 40ms\n"
      )
    ).toBe(2);
  });

  it.skipIf(process.platform === "win32")(
    "pobieranie klienta w tle: etap, liczba pakietów i gotowość przed logowaniem",
    async () => {
      const root = tempDir();
      process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT = root;
      // No Node on PATH, like a Windows PC with only the bundled runtime.
      process.env.PATH = ["/usr/bin", "/bin"].join(path.delimiter);
      const npm = path.join(tempDir(), "npm");
      fs.writeFileSync(
        npm,
        [
          "#!/bin/sh",
          'prefix="$3"',
          'mkdir -p "$prefix/node_modules/@xai-official/grok" "$prefix/node_modules/.bin"',
          "echo 'npm http fetch GET 200 https://registry.npmjs.org/@xai-official%2fgrok 10ms' >&2",
          "echo 'npm http fetch GET 200 https://registry.npmjs.org/@xai-official/grok/-/grok-1.0.44.tgz 20ms' >&2",
          // Like the package's "postinstall: node bin/postinstall.js".
          `node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ version: "1.0.44" }))' "$prefix/node_modules/@xai-official/grok/package.json" || exit 9`,
          `printf '#!/bin/sh\\nexit 1\\n' > "$prefix/node_modules/.bin/grok"`,
          'chmod +x "$prefix/node_modules/.bin/grok"',
          "exit 0"
        ].join("\n")
      );
      fs.chmodSync(npm, 0o755);
      process.env.LEX_NPM_CLI = npm;

      const sessions = new AccountSessionManager();
      expect(sessions.provisionProgress("xai").stage).toBe("IDLE");
      const started = sessions.startProvision("xai");
      expect(started.stage).toBe("CHECKING");
      // A second click while running returns the same job.
      expect(sessions.startProvision("xai").startedAt).toBe(started.startedAt);

      let progress = sessions.provisionProgress("xai");
      for (let i = 0; i < 100 && !["READY", "FAILED"].includes(progress.stage); i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        progress = sessions.provisionProgress("xai");
      }
      expect(progress.error).toBeUndefined();
      expect(progress.stage).toBe("READY");
      expect(progress.packagesFetched).toBe(2);
      expect(progress.status?.installed).toBe(true);
      expect(fs.existsSync(path.join(root, "xai", "node_modules", ".bin", "grok"))).toBe(true);
    }
  );

  it("npm dostaje Node z pakietu aplikacji w PATH i bez powielania wpisów", () => {
    const env = npmInstallEnvironment(
      path.join("/app", "node", "npm"),
      { Path: ["/usr/bin", "/app/node"].join(path.delimiter), OTHER: "1" },
      path.join("/app", "node", "node")
    );
    expect(env.Path?.split(path.delimiter)).toEqual(["/app/node", "/usr/bin"]);
    expect(env.npm_config_update_notifier).toBe("false");
    expect(env.OTHER).toBe("1");
  });

  it("szczegół błędu to linie błędu npm, nie linie pobierania", () => {
    expect(
      npmFailureDetail(
        "npm http fetch GET 200 https://registry.npmjs.org/a 5ms\nnpm error code 1\nnpm error 'node' is not recognized\n"
      )
    ).toBe("npm error code 1\nnpm error 'node' is not recognized");
  });

  it("linia cmd.exe dla npm.cmd w katalogu ze spacją: cudzysłowy zewnętrzne, bez \\\"", () => {
    const line = windowsShimCommandLine(
      "C:\\Users\\Mi9chal\\AppData\\Local\\Lex Machina\\runtime\\node\\npm.cmd",
      ["install", "--prefix", "C:\\Users\\x\\Lex Machina\\clients", "-p", "", 'a"b', "100%"]
    );
    expect(line).toBe(
      '""C:\\Users\\Mi9chal\\AppData\\Local\\Lex Machina\\runtime\\node\\npm.cmd" "install" "--prefix" "C:\\Users\\x\\Lex Machina\\clients" "-p" "" "a""b" "100%""'
    );
    expect(line).not.toContain('\\"');
  });

  it("npm uruchamiany przez Node i npm-cli.js obok npm.cmd", () => {
    const dir = tempDir();
    expect(npmCliScript(path.join(dir, "npm.cmd"))).toBeNull();
    const cli = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "");
    expect(npmCliScript(path.join(dir, "npm.cmd"))).toBe(cli);
  });
});
