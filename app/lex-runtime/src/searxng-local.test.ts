import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_SEARXNG_URL, installDockerDesktop, setupLocalSearxng, writeLocalSearxng } from "./searxng-local.js";

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
    const secret = /secret_key: "([0-9a-f]{64})"/.exec(settings)?.[1];
    expect(secret).toBeTruthy();
    writeLocalSearxng(dir);
    expect(fs.readFileSync(path.join(dir, "searxng", "settings.yml"), "utf8")).toContain(secret!);
  });

  it("no Docker or Podman: files and the commands, not started", async () => {
    const result = await setupLocalSearxng({ directory: temp(), start: true, run: async () => ({ code: 127, output: "" }), fetcher: silent });
    expect(result).toMatchObject({ engine: null, started: false, reachable: false, error: "CONTAINER_ENGINE_MISSING" });
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
    expect((await installDockerDesktop(ok, ".", "linux")).error).toBe("INSTALLER_MISSING:linux");
  });

  it("no engine and no install request: nothing installed", async () => {
    const calls: string[] = [];
    const result = await setupLocalSearxng({
      directory: temp(),
      start: true,
      run: async (command, args) => {
        calls.push(`${command} ${args.join(" ")}`);
        return { code: 127, output: "" };
      },
      fetcher: silent
    });
    expect(result.error).toBe("CONTAINER_ENGINE_MISSING");
    expect(calls.some((call) => call.startsWith("winget") || call.startsWith("brew"))).toBe(false);
  });
});
