import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_SEARXNG_URL, setupLocalSearxng, writeLocalSearxng } from "./searxng-local.js";
const dirs = [];
afterEach(() => {
    for (const dir of dirs.splice(0))
        fs.rmSync(dir, { recursive: true, force: true });
});
function temp() {
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
        expect(fs.readFileSync(path.join(dir, "searxng", "settings.yml"), "utf8")).toContain(secret);
    });
    it("no Docker or Podman: files and the commands, not started", async () => {
        const result = await setupLocalSearxng({ directory: temp(), start: true, run: async () => ({ code: 127, output: "" }), fetcher: silent });
        expect(result).toMatchObject({ engine: null, started: false, reachable: false, error: "CONTAINER_ENGINE_MISSING" });
        expect(result.commands.join(" ")).toContain("compose up -d");
    });
    it("starts it with the found engine and reports it reachable once it answers in JSON", async () => {
        const calls = [];
        let up = false;
        const result = await setupLocalSearxng({
            directory: temp(),
            start: true,
            run: async (command, args) => {
                calls.push(`${command} ${args.join(" ")}`);
                if (command === "docker")
                    return { code: 1, output: "" };
                if (args[1] === "up")
                    up = true;
                return { code: 0, output: "" };
            },
            fetcher: async () => (up ? answering() : silent()),
            pollMs: 1
        });
        expect(calls).toEqual(["docker compose version", "podman compose version", "podman compose up -d"]);
        expect(result).toMatchObject({ engine: "podman", started: true, reachable: true, url: LOCAL_SEARXNG_URL });
    });
    it("an instance already answering: only the address, nothing started", async () => {
        const calls = [];
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
});
