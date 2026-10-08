import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSessionManager } from "../src/providers/account-session.js";

// ChatGPT (Codex) client scenarios with stand-in executables: a system-wide `codex`
// on PATH, the pinned client downloaded by a stand-in npm, a failed download.
// The stand-in codex reports "Logged in using ChatGPT" once $LEX_TEST_LOGGED_IN exists.
const KEYS = ["LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT", "PATH", "HOME", "LEX_CODEX_CLI", "LEX_NPM_CLI", "LEX_RUNTIME_ROOT", "LEX_TEST_LOGGED_IN", "LEX_TEST_LABEL"] as const;
const previous = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const roots: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-codex-"));
  roots.push(dir);
  return dir;
}

function fakeCodex(file: string, label: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `#!/bin/sh\necho "${label}" >> "$LEX_TEST_LABEL"\nif [ "$1" = login ] && [ "$2" = status ]; then\n  if [ -e "$LEX_TEST_LOGGED_IN" ]; then echo "Logged in using ChatGPT"; exit 0; fi\n  echo "Not logged in"; exit 1\nfi\nexit 0\n`,
    { mode: 0o755 }
  );
}

// npm install --prefix <root> ... @openai/codex@<version>
function fakeNpm(dir: string, fail: boolean): string {
  const file = path.join(dir, "npm");
  fs.writeFileSync(
    file,
    fail
      ? "#!/bin/sh\necho 'npm error network' >&2\nexit 1\n"
      : [
          "#!/bin/sh",
          "while [ \"$1\" != --prefix ]; do shift; done",
          "root=\"$2\"",
          "for last; do :; done",
          "version=\"${last##*@}\"",
          "mkdir -p \"$root/node_modules/.bin\" \"$root/node_modules/@openai/codex\"",
          "printf '{\"version\":\"%s\"}' \"$version\" > \"$root/node_modules/@openai/codex/package.json\"",
          `cp "${path.join(dir, "pinned-codex")}" "$root/node_modules/.bin/codex"`,
          "exit 0",
          ""
        ].join("\n"),
    { mode: 0o755 }
  );
  return file;
}

function setup({ systemCodex, npm }: { systemCodex: boolean; npm?: "ok" | "fail" }) {
  const bin = tempDir();
  const tools = tempDir();
  const home = tempDir();
  const label = path.join(tempDir(), "runs.txt");
  if (systemCodex) fakeCodex(path.join(bin, "codex"), "system");
  fakeCodex(path.join(tools, "pinned-codex"), "pinned");
  // `which` stays reachable; nothing else named codex is.
  const which = path.dirname(fs.realpathSync("/usr/bin/which"));
  Object.assign(process.env, {
    LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT: tempDir(),
    PATH: `${bin}:${which}:/bin`,
    HOME: home,
    LEX_TEST_LOGGED_IN: path.join(home, "logged-in"),
    LEX_TEST_LABEL: label
  });
  delete process.env.LEX_CODEX_CLI;
  delete process.env.LEX_RUNTIME_ROOT;
  if (npm) process.env.LEX_NPM_CLI = fakeNpm(tools, npm === "fail");
  else delete process.env.LEX_NPM_CLI;
  return {
    sessions: new AccountSessionManager(),
    logIn: () => fs.writeFileSync(path.join(home, "logged-in"), ""),
    runs: () => (fs.existsSync(label) ? fs.readFileSync(label, "utf8").trim().split("\n") : [])
  };
}

async function provision(sessions: AccountSessionManager) {
  let progress = sessions.startProvision("openai");
  while (progress.stage !== "READY" && progress.stage !== "FAILED") {
    await new Promise((resolve) => setTimeout(resolve, 20));
    progress = sessions.provisionProgress("openai");
  }
  return progress;
}

afterEach(() => {
  for (const key of KEYS) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("klient ChatGPT (Codex)", () => {
  it("brak klienta: status bez instalacji, bez pobierania w trakcie odpytywania", async () => {
    const { sessions } = setup({ systemCodex: false, npm: "ok" });
    const status = await sessions.status("openai");
    expect(status).toMatchObject({ installed: false, authenticated: false, managedClientInstalled: false });
    expect(fs.readdirSync(process.env.LEX_OPTIONAL_ACCOUNT_CLIENTS_ROOT!)).toEqual([]);
  });

  it("brak klienta: Połącz konto pobiera klienta Lex, status i deinstalacja go widzą", async () => {
    const { sessions, logIn, runs } = setup({ systemCodex: false, npm: "ok" });
    const progress = await provision(sessions);
    expect(progress.stage).toBe("READY");
    expect(progress.status).toMatchObject({ installed: true, authenticated: false, managedClientInstalled: true });
    logIn();
    expect(await sessions.status("openai")).toMatchObject({ installed: true, authenticated: true });
    expect(runs().at(-1)).toBe("pinned");
    const removed = await sessions.uninstall("openai");
    expect(removed.removed).toBe(true);
    expect(removed.status).toMatchObject({ installed: false, managedClientInstalled: false });
  });

  it("systemowy Codex zalogowany: status go łapie (wcześniej: niezainstalowany)", async () => {
    const { sessions, logIn, runs } = setup({ systemCodex: true });
    logIn();
    expect(await sessions.status("openai")).toMatchObject({ installed: true, authenticated: true, managedClientInstalled: false });
    expect(runs()).toEqual(["system"]);
  });

  it("systemowy Codex: Połącz konto i tak pobiera klienta Lex (do odinstalowania), potem używa jego", async () => {
    const { sessions, logIn, runs } = setup({ systemCodex: true, npm: "ok" });
    const progress = await provision(sessions);
    expect(progress.stage).toBe("READY");
    expect(progress.status?.managedClientInstalled).toBe(true);
    logIn();
    expect((await sessions.status("openai")).authenticated).toBe(true);
    expect(runs().at(-1)).toBe("pinned");
  });

  it("nieudane pobranie przy systemowym Codexie: logowanie działa na systemowym", async () => {
    const { sessions, logIn } = setup({ systemCodex: true, npm: "fail" });
    const progress = await provision(sessions);
    expect(progress.stage).toBe("READY");
    expect(progress.status).toMatchObject({ installed: true, managedClientInstalled: false });
    logIn();
    expect((await sessions.status("openai")).authenticated).toBe(true);
  });

  it("nieudane pobranie bez żadnego klienta: błąd z opisem npm", async () => {
    const { sessions } = setup({ systemCodex: false, npm: "fail" });
    const progress = await provision(sessions);
    expect(progress.stage).toBe("FAILED");
    expect(progress.error).toMatch(/ACCOUNT_SESSION_CLI_PROVISION_FAILED/);
  });
});
