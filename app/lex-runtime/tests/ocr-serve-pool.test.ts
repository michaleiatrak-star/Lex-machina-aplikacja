import fs from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OcrServePool } from "../src/ocr/ocr-serve-pool.js";
import { LocalPaddleOcrEngine, lastOcrRunStats } from "../src/ocr/paddle-ocr-engine.js";

// A worker like paddle_worker.py --serve: one process, many jobs; the "models" load once.
const SERVE_WORKER = `
const fs = require("node:fs");
const readline = require("node:readline");
let loaded = false;
console.log("noise from a library");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const job = JSON.parse(line);
  if (job.input === "crash") process.exit(7);
  if (job.input === "bad") {
    process.stderr.write("ValueError: broken page\\n");
    console.log("LEX_OCR_JOB_FAILED " + job.id + " ValueError");
    return;
  }
  const pages = String(job.pages).split(",").map(Number);
  for (const page of pages) process.stderr.write("LEX_OCR_PAGE " + page + "\\n");
  process.stderr.write("LEX_OCR_STATS " + JSON.stringify({ loadSeconds: loaded ? 0 : 5, pageSeconds: pages.map(() => 0.1), threads: 4, mkldnn: true, accel: null }) + "\\n");
  loaded = true;
  fs.writeFileSync(job.output, JSON.stringify(pages.map((page) => ({ page, text: "pid " + process.pid }))));
  console.log("LEX_OCR_JOB_DONE " + job.id);
});
`;

let dir = "";
afterEach(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("stały proces OCR", () => {
  it("kolejne zadania w tym samym procesie; błąd zadania nie kończy procesu; awaria odrzuca zadanie", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-serve-"));
    const worker = path.join(dir, "serve.cjs");
    await writeFile(worker, SERVE_WORKER);
    const pool = new OcrServePool(60_000);
    const run = (input: string, output: string) =>
      pool.run({ key: "k", python: process.execPath, workerArgs: [worker], env: process.env, job: { input, output, pages: "1" }, onStderr: () => undefined });
    await run("a", path.join(dir, "a.json")).done;
    await run("b", path.join(dir, "b.json")).done;
    const pid = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))[0].text;
    expect(pid("a.json")).toBe(pid("b.json"));
    await expect(run("bad", path.join(dir, "c.json")).done).rejects.toThrow("OCR_SERVE_JOB_FAILED:ValueError");
    expect(pool.size).toBe(1);
    await expect(run("crash", path.join(dir, "d.json")).done).rejects.toThrow("OCR_SERVE_WORKER_EXITED:7");
    expect(pool.size).toBe(0);
    await run("e", path.join(dir, "e.json")).done;
    expect(pid("e.json")).not.toBe(pid("a.json"));
    // Idle longer than the limit: closed.
    pool.reap(Date.now() + 61_000);
    expect(pool.size).toBe(0);
    pool.closeAll();
    // Real processes: slower than the default 5 s while the whole suite runs.
  }, 30_000);

  it("silnik PDF: drugi dokument bez wczytywania modeli (ten sam proces), statystyka i postęp stron", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-serve-engine-"));
    const worker = path.join(dir, "serve.cjs");
    await writeFile(worker, SERVE_WORKER);
    const engine = new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker, workers: 1, persistent: true });
    const progress: number[] = [];
    const first = await engine.recognizePages(new Uint8Array([37]), [1, 2], (done) => progress.push(done));
    expect(lastOcrRunStats()).toMatchObject({ loadSeconds: 5, pages: 2 });
    const second = await engine.recognizePages(new Uint8Array([37]), [1]);
    expect(lastOcrRunStats()).toMatchObject({ loadSeconds: 0, pages: 1 });
    expect(second[0]!.text).toBe(first[0]!.text);
    expect(progress.at(-1)).toBe(2);
  }, 30_000);
});
