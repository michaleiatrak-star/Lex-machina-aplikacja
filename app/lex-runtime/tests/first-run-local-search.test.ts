import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { firstRunLocalSearch } from "../src/searxng-local.js";

const dir = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lex-first-")), "searxng");
const noFetch = async () => ({ ok: false, json: async () => ({}) });

describe("first start: local search and Chromium set up once when a container engine is here", () => {
  it("no engine: nothing written, nothing started", async () => {
    const directory = dir();
    const result = await firstRunLocalSearch({ directory, searxngUrl: "", run: async () => ({ code: 1, output: "" }), fetcher: noFetch, platform: "linux" });
    expect(result).toBeNull();
    expect(fs.existsSync(directory)).toBe(false);
  });
  it("an engine: set up and started once; the next start leaves it to the autostart", async () => {
    const directory = dir();
    const calls: string[] = [];
    const run = async (command: string, args: string[]) => {
      calls.push(`${command} ${args.join(" ")}`);
      return { code: 0, output: "" };
    };
    const first = await firstRunLocalSearch({ directory, searxngUrl: "", run, fetcher: noFetch, launch: () => false, platform: "linux" });
    expect(first).not.toBeNull();
    expect(calls.some((call) => /compose .*up/u.test(call))).toBe(true);
    expect(await firstRunLocalSearch({ directory, searxngUrl: "", run, fetcher: noFetch, platform: "linux" })).toBeNull();
  }, 120_000);
});
