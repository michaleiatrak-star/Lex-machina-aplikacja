import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_SEARXNG_URL, autostartLocalSearxng, installDockerDesktop, installDockerEngineLinux, setupLocalSearxng, writeLocalSearxng } from "./searxng-local.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function temp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-searxng-"));
  dirs.push(dir);
  return path.join(dir, "searxng");
}
const answering = async () => ({ ok: true, json: async () => ({ results: [] }) });
const silent = async () => {
  throw new Error("ECONNREFUSED");
};

describe("local SearXNG (Ustawienia > Wyszukiwarka internetowa)", () => {
  it("writes the JSON format, no limiter, 127.0.0.1 only; keeps the secret on a second run", () => {
    const dir = temp();
    writeLocalSearxng(dir);
    const settings = fs.readFileSync(path.join(dir, "searxng", "settings.yml"), "utf8");
    expect(settings).toContain("    - json");
    expect(settings).toContain("limiter: false");
    expect(fs.readFileSync(path.join(dir, "docker-compose.yml"), "utf8")).toContain('"127.0.0.1:8888:8080"');
    expect(fs.readFileSync(path.join(dir, "docker-compose.yml"), "utf8")).toContain("GRANIAN_HOST=0.0.0.0");
    const secret = /secret_key: "([0-9a-f]{64})"/.exec(settings)?.[1];
    expect(secret).toBeTruthy();
    writeLocalSearxng(dir);
    expect(fs.readFileSync(path.join(dir, "searxng", "settings.yml"), "utf8")).toContain(secret!);
  });

  it("no Docker or Podman: files and the commands, not started", async () => {
    const result = await setupLocalSearxng({ directory: temp(), start: true, platform: "win32", run: async () => ({ code: 127, output: "" }), fetcher: silent });
    expect(result).toMatchObject({ engine: null, started: false, reachable: false, error: "CONTAINER_ENGINE_MISSING" });
    // A Linux server: the result says so (the settings offer the Docker Engine, not Docker Desktop).
    const linux = await setupLocalSearxng({ directory: temp(), start: true, platform: "linux", target: "browser", run: async () => ({ code: 127, output: "" }), fetcher: silent });
    expect(linux).toMatchObject({ error: "CONTAINER_ENGINE_MISSING", platform: "linux" });
    expect(linux.commands.at(-1)).toBe("docker compose up -d browser");
    expect(result.commands.join(" ")).toContain("compose up -d");
  });

  it("starts it with the found engine and reports it reachable once it answers in JSON", async () => {
    const calls: string[] = [];
    let up = false;
    const result = await setupLocalSearxng({
      directory: temp(),
      start: true,
      run: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "docker") return { code: 1, output: "" };
        if (args[1] === "up") up = true;
        return { code: 0, output: "" };
      },
      fetcher: async () => (up ? answering() : silent()),
      pollMs: 1
    });
    expect(calls).toEqual(["docker compose version", "podman compose version", "podman info", "podman compose up -d"]);
    expect(result).toMatchObject({ engine: "podman", started: true, reachable: true, url: LOCAL_SEARXNG_URL });
  });

  it("an instance already answering: only the address, nothing started", async () => {
    const calls: string[] = [];
    const result = await setupLocalSearxng({
      directory: temp(),
      start: true,
      run: async (command) => {
        calls.push(command);
        return { code: 0, output: "" };
      },
      fetcher: answering
    });
    expect(calls).toEqual([]);
    expect(result.reachable).toBe(true);
  });

  it("Docker installed, Docker Desktop closed: it is started and the engine awaited", async () => {
    let desktop = false;
    const calls: string[] = [];
    const result = await setupLocalSearxng({
      directory: temp(),
      start: true,
      run: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "podman") return { code: 127, output: "" };
        if (args[0] === "info") return { code: desktop ? 0 : 1, output: "" };
        return { code: 0, output: "" };
      },
      launch: () => (desktop = true),
      fetcher: async () => (calls.includes("docker compose up -d") ? answering() : silent()),
      pollMs: 1
    });
    expect(result).toMatchObject({ engine: "docker", started: true, reachable: true });
  });

  it("Docker Desktop cannot be started: a clear error, nothing run", async () => {
    const calls: string[] = [];
    const result = await setupLocalSearxng({
      directory: temp(),
      start: true,
      run: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        if (command === "podman") return { code: 127, output: "" };
        return { code: args[0] === "info" ? 1 : 0, output: "" };
      },
      launch: () => false,
      fetcher: silent
    });
    expect(result).toMatchObject({ engine: "docker", started: false, error: "CONTAINER_ENGINE_NOT_RUNNING" });
    expect(calls).not.toContain("docker compose up -d");
  });

  it("installs Docker Desktop with winget on Windows, Homebrew on macOS; reports a missing installer", async () => {
    const calls: string[] = [];
    const ok = async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { code: 0, output: "" };
    };
    expect(await installDockerDesktop(ok, ".", "win32")).toEqual({ ok: true });
    expect(calls[1]).toContain("winget install --exact --id Docker.DockerDesktop");
    expect(await installDockerDesktop(ok, ".", "darwin")).toEqual({ ok: true });
    expect(calls.at(-1)).toBe("brew install --cask docker");
    expect(await installDockerDesktop(async () => ({ code: 1, output: "" }), ".", "win32")).toEqual({ ok: false, error: "INSTALLER_MISSING:winget" });
    expect((await installDockerDesktop(async () => ({ code: 1, output: "" }), ".", "linux")).error).toBe("INSTALLER_MISSING:linux");
  });

  it("no engine and no install request: nothing installed", async () => {
    const calls: string[] = [];
    const result = await setupLocalSearxng({
      directory: temp(),
      start: true,
      platform: "win32",
      run: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        return { code: 127, output: "" };
      },
      fetcher: silent
    });
    expect(result.error).toBe("CONTAINER_ENGINE_MISSING");
    expect(calls.some((call) => call.startsWith("winget") || call.startsWith("brew"))).toBe(false);
  });
  it("autostart z aplikacją: SearXNG utworzony przez aplikację pod lokalnym adresem, przy innym SearXNG sama przeglądarka; zamknięty Docker Desktop jest uruchamiany", async () => {
    const dir = temp();
    const never = async () => ({ code: 0, output: "" });
    expect(await autostartLocalSearxng({ directory: dir, searxngUrl: LOCAL_SEARXNG_URL, run: never, fetcher: silent })).toBeNull();
    writeLocalSearxng(dir);
    // Another SearXNG: only the browser for reading pages starts with the application.
    const browserCalls: string[] = [];
    let browserUp = false;
    const browser = await autostartLocalSearxng({
      directory: dir,
      searxngUrl: "https://searx.example.org",
      run: async (command, args) => {
        browserCalls.push(`${command} ${args.join(" ")}`);
        if (args[0] === "compose" && args[1] === "up") browserUp = true;
        return { code: command === "docker" ? 0 : 127, output: "" };
      },
      fetcher: async () => (browserUp ? answering() : silent()),
      launch: () => true,
      engineWaitMs: 50,
      waitMs: 50,
      pollMs: 1
    });
    expect(browserCalls).toContain("docker compose up -d browser");
    expect(browserCalls).not.toContain("docker compose up -d");
    expect(browser).toMatchObject({ reachable: true });
    const calls: string[] = [];
    let engineUp = false;
    let launched = 0;
    let up = false;
    const run = async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (args[0] === "info") return { code: engineUp ? 0 : 1, output: "" };
      if (args[0] === "compose" && args[1] === "up") up = true;
      return { code: command === "docker" ? 0 : 127, output: "" };
    };
    const result = await autostartLocalSearxng({
      directory: dir,
      searxngUrl: `${LOCAL_SEARXNG_URL}/`,
      run,
      fetcher: async () => (up ? answering() : silent()),
      launch: () => {
        launched += 1;
        engineUp = true;
        return true;
      },
      engineWaitMs: 50,
      waitMs: 50,
      pollMs: 1
    });
    expect(launched).toBe(1);
    expect(calls).toContain("docker compose up -d");
    expect(calls.some((call) => /winget|brew/u.test(call))).toBe(false);
    expect(result).toMatchObject({ reachable: true, started: true });
  });

  it("more source engines and the official portals first; a running instance restarts on new settings", async () => {
    const dir = temp();
    writeLocalSearxng(dir);
    const settings = fs.readFileSync(path.join(dir, "searxng", "settings.yml"), "utf8");
    for (const name of ["google", "bing", "brave", "qwant", "mojeek"]) expect(settings).toContain(`  - name: ${name}\n    disabled: false`);
    expect(settings).toContain("    inactive: false");
    expect(settings).toContain("hostnames:\n  high_priority:\n    - '(.*\\.)?gov\\.pl$'");
    // An earlier version's file (no engines section): the answering instance is restarted once.
    fs.writeFileSync(path.join(dir, "searxng", "settings.yml"), settings.split("engines:")[0]!, "utf8");
    const calls: string[] = [];
    await setupLocalSearxng({ directory: dir, start: true, run: async (command, args) => (calls.push(`${command} ${args.join(" ")}`), { code: 0, output: "" }), fetcher: answering });
    expect(calls).toEqual(["docker compose restart searxng"]);
    calls.length = 0;
    await setupLocalSearxng({ directory: dir, start: true, run: async (command, args) => (calls.push(`${command} ${args.join(" ")}`), { code: 0, output: "" }), fetcher: answering });
    expect(calls).toEqual([]);
  });
  it("przeglądarka do czytania stron obok SearXNG; starszy plik compose bez niej: działająca instalacja dostaje ją przez up -d", async () => {
    const dir = temp();
    writeLocalSearxng(dir);
    const compose = fs.readFileSync(path.join(dir, "docker-compose.yml"), "utf8");
    expect(compose).toContain("  browser:\n    image: docker.io/chromedp/headless-shell:latest");
    expect(compose).toContain('      - "127.0.0.1:9223:9222"');
    fs.writeFileSync(path.join(dir, "docker-compose.yml"), compose.split("  browser:")[0]!, "utf8");
    const calls: string[] = [];
    await setupLocalSearxng({ directory: dir, start: true, run: async (command, args) => (calls.push(`${command} ${args.join(" ")}`), { code: 0, output: "" }), fetcher: answering });
    expect(calls).toEqual(["docker compose up -d"]);
  });

  it("sama przeglądarka (inna wyszukiwarka niż SearXNG): uruchamiana tylko usługa browser, gotowa po odpowiedzi DevTools; działająca nie jest ruszana; bez Dockera polecenie i zgoda na instalację", async () => {
    const calls: string[] = [];
    let up = false;
    const browserFetcher = async (url: string) => {
      if (url.includes(":9223/json/version") && up) return { ok: true, json: async () => ({}) };
      throw new Error("ECONNREFUSED");
    };
    const run = async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (args.join(" ") === "compose up -d browser") up = true;
      return { code: 0, output: "" };
    };
    const result = await setupLocalSearxng({ directory: temp(), start: true, target: "browser", run, fetcher: browserFetcher, pollMs: 1 });
    expect(result).toMatchObject({ reachable: true, started: true, url: "http://127.0.0.1:9223" });
    expect(calls).toContain("docker compose up -d browser");
    expect(calls).not.toContain("docker compose up -d");

    const again: string[] = [];
    const ready = await setupLocalSearxng({ directory: temp(), start: true, target: "browser", run: async (c, a) => (again.push(`${c} ${a.join(" ")}`), { code: 0, output: "" }), fetcher: browserFetcher });
    expect(ready.reachable).toBe(true);
    expect(again).toEqual([]);

    const none = await setupLocalSearxng({ directory: temp(), start: true, target: "browser", platform: "darwin", run: async () => ({ code: 127, output: "" }), fetcher: silent });
    expect(none.error).toBe("CONTAINER_ENGINE_MISSING");
    expect(none.commands.at(-1)).toBe("docker compose up -d browser");
  });

  it("serwer Linux: Docker Engine z pakietów systemu przez sudo bez hasła, bez Docker Desktop", async () => {
    const calls: string[] = [];
    const run = async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      if (command === "dnf") return { code: 127, output: "" };
      return { code: 0, output: "" };
    };
    expect(await installDockerEngineLinux(run, "/tmp", 1000)).toEqual({ ok: true });
    expect(calls).toContain("sudo -n true");
    expect(calls).toContain("sudo -n apt-get install -y docker.io docker-compose-v2");
    expect(calls).toContain("sudo -n systemctl enable --now docker");
    expect(calls.some((call) => call.startsWith("sudo -n usermod -aG docker "))).toBe(true);
    // No root and no passwordless sudo: nothing installed, the settings show the commands.
    const none: string[] = [];
    const refused = await installDockerEngineLinux(async (command, args) => (none.push(`${command} ${args.join(" ")}`), { code: command === "sudo" ? 1 : 0, output: "" }), "/tmp", 1000);
    expect(refused).toEqual({ ok: false, error: "INSTALLER_MISSING:linux" });
    expect(none).toEqual(["sudo -n true"]);
    // Root on Fedora: Podman with podman-compose, no sudo.
    const fedora: string[] = [];
    expect(await installDockerEngineLinux(async (command, args) => (fedora.push(`${command} ${args.join(" ")}`), { code: command === "apt-get" ? 127 : 0, output: "" }), "/tmp", 0)).toEqual({ ok: true });
    expect(fedora).toContain("dnf install -y podman podman-compose");
    expect(fedora.some((call) => call.startsWith("sudo"))).toBe(false);
  });
});
