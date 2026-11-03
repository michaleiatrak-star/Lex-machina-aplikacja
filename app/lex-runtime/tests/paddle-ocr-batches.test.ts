import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPaddleOcrEngine, OCR_BATCH_PAGES, OCR_WORKER_MEMORY_BYTES, ocrWorkerCount } from "../src/ocr/paddle-ocr-engine.js";
import { readOcrPages } from "../src/ocr/ocr-result.js";
import { documentWork } from "../src/document-work.js";

// Stand-in for paddle_worker.py: one JPEG-like evidence file and one boxed
// line per requested page; logs each invocation's page list.
const FAKE_WORKER = `
const fs = require("node:fs");
const path = require("node:path");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const pages = arg("--pages").split(",").map(Number);
const evidence = arg("--evidence-dir");
fs.mkdirSync(evidence, { recursive: true });
fs.appendFileSync(process.env.FAKE_OCR_LOG, pages.join(",") + (process.env.LEX_OCR_PAUSE_FILE ? " pause" : "") + (process.env.LEX_OCR_THREADS && process.env.FAKE_OCR_THREADS_LOG ? " t" + process.env.LEX_OCR_THREADS : "") + "\\n");
const out = pages.map((page) => {
  fs.writeFileSync(path.join(evidence, "p" + page + ".jpg"), Buffer.alloc(30, page));
  process.stderr.write("LEX_OCR_PAGE " + page + "\\n");
  return {
    page,
    text: "strona " + page,
    lines: [{ text: "strona " + page, score: 0.99, box: [0, 0, 10, 10] }],
    evidence: { file: "p" + page + ".jpg", width: 100, height: 100, unread: [] }
  };
});
fs.writeFileSync(arg("--output"), JSON.stringify(out));
`;

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  delete process.env.FAKE_OCR_LOG;
});

describe("LocalPaddleOcrEngine: long scans", () => {
  it("runs the worker in batches of 30 pages and keeps an image for every page", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-batch-test-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(worker, FAKE_WORKER);
    process.env.FAKE_OCR_LOG = path.join(dir, "calls.log");
    const engine = new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker, workers: 1 });
    const pages = Array.from({ length: 75 }, (_, index) => index + 1);
    const progress: number[] = [];

    const results = await engine.recognizePages(new Uint8Array([37, 80, 68, 70]), pages, (done) => progress.push(done));

    const calls = (await readFile(process.env.FAKE_OCR_LOG, "utf8")).trim().split("\n");
    expect(OCR_BATCH_PAGES).toBe(30);
    expect(calls.map((line) => line.split(",").length)).toEqual([30, 30, 15]);
    expect(results.map((result) => result.page)).toEqual(pages);
    expect(results.every((result) => result.image?.jpeg)).toBe(true);
    expect(progress.at(-1)).toBe(75);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("several workers read a long scan at once, each with its share of the threads; pages and progress stay in order", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-parallel-test-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(worker, FAKE_WORKER);
    process.env.FAKE_OCR_LOG = path.join(dir, "calls.log");
    process.env.FAKE_OCR_THREADS_LOG = "1";
    try {
      const engine = new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker, workers: 2 });
      const pages = Array.from({ length: 10 }, (_, index) => index + 1);
      const progress: number[] = [];
      const results = await engine.recognizePages(new Uint8Array([37, 80, 68, 70]), pages, (done) => progress.push(done));
      const calls = (await readFile(process.env.FAKE_OCR_LOG, "utf8")).trim().split("\n").sort();
      expect(calls.map((line) => line.split(" ")[0]!.split(",").length)).toEqual([5, 5]);
      if (!process.env.LEX_OCR_THREADS) expect(calls.every((line) => / t\d+$/u.test(line))).toBe(true);
      expect(results.map((result) => result.page)).toEqual(pages);
      expect(results.every((result) => result.image?.jpeg)).toBe(true);
      expect(progress.at(-1)).toBe(10);
    } finally {
      delete process.env.FAKE_OCR_THREADS_LOG;
    }
  });

  it("worker count: one for short or background reads, limited by cores and free memory", () => {
    const plenty = 16 * 1024 ** 3;
    expect(ocrWorkerCount({ pages: 3, cpus: 16, freeMemory: plenty })).toBe(1);
    expect(ocrWorkerCount({ pages: 40, cpus: 16, freeMemory: plenty, background: true })).toBe(1);
    expect(ocrWorkerCount({ pages: 40, cpus: 2, freeMemory: plenty })).toBe(1);
    expect(ocrWorkerCount({ pages: 40, cpus: 4, freeMemory: plenty })).toBe(2);
    expect(ocrWorkerCount({ pages: 40, cpus: 8, freeMemory: plenty })).toBe(4);
    expect(ocrWorkerCount({ pages: 40, cpus: 16, freeMemory: plenty })).toBe(4);
    expect(ocrWorkerCount({ pages: 4, cpus: 16, freeMemory: plenty })).toBe(2);
    expect(ocrWorkerCount({ pages: 40, cpus: 16, freeMemory: OCR_WORKER_MEMORY_BYTES * 1.5 })).toBe(1);
    expect(ocrWorkerCount({ pages: 40, cpus: 16, freeMemory: plenty, env: "1" })).toBe(1);
    expect(ocrWorkerCount({ pages: 40, cpus: 32, freeMemory: plenty, env: "4" })).toBe(4);
  });

  it("stops attaching images once the byte budget is spent, without gaps", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-budget-test-"));
    const raw = [1, 2, 3].map((page) => ({
      page,
      text: "x",
      lines: [{ text: "x", box: [0, 0, 1, 1] }],
      evidence: { file: `p${page}.jpg`, width: 10, height: 10, unread: [] }
    }));
    for (const page of [1, 2, 3]) await writeFile(path.join(dir, `p${page}.jpg`), Buffer.alloc(30, page));
    // 30 bytes → 40 base64 chars per page; room for two pages.
    const budget = { bytesLeft: 100 };
    const first = await readOcrPages(raw.slice(0, 2), dir, budget);
    const second = await readOcrPages(raw.slice(2), dir, budget);
    expect(first.every((page) => page.image)).toBe(true);
    expect(second[0]!.image).toBeUndefined();
    expect(second[0]!.text).toBe("x");
    expect(budget.bytesLeft).toBe(0);
  });

  it("only background OCR gets the pause file (it waits there while the user's document is worked on)", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-pause-test-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(worker, FAKE_WORKER);
    process.env.FAKE_OCR_LOG = path.join(dir, "calls.log");
    const engine = new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker });
    await engine.recognizePages(new Uint8Array([37, 80, 68, 70]), [1]);
    await documentWork.background(() => engine.recognizePages(new Uint8Array([37, 80, 68, 70]), [2]));
    const calls = (await readFile(process.env.FAKE_OCR_LOG, "utf8")).trim().split("\n");
    expect(calls).toEqual(["1", "2 pause"]);
  });

  it("background OCR stops after the page it reads while the user's work runs; the pause is not timed out", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-pause-e2e-"));
    const worker = path.join(dir, "worker.cjs");
    // Like paddle_worker.py: before each page, waits while the pause file exists; ~150 ms a page.
    await writeFile(
      worker,
      `
const fs = require("node:fs");
const path = require("node:path");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const pages = arg("--pages").split(",").map(Number);
const evidence = arg("--evidence-dir");
fs.mkdirSync(evidence, { recursive: true });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const out = [];
for (const page of pages) {
  while (process.env.LEX_OCR_PAUSE_FILE && fs.existsSync(process.env.LEX_OCR_PAUSE_FILE)) sleep(20);
  sleep(150);
  fs.appendFileSync(process.env.FAKE_OCR_LOG, page + " " + Date.now() + "\\n");
  process.stderr.write("LEX_OCR_PAGE " + page + "\\n");
  out.push({ page, text: "strona " + page, lines: [] });
}
fs.writeFileSync(arg("--output"), JSON.stringify(out));
`
    );
    process.env.FAKE_OCR_LOG = path.join(dir, "pages.log");
    // 1.5 s of OCR allowed; the user's work holds it for 2 s: only the paused time exceeds it.
    const engine = new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker, timeoutMs: 1_500 });
    let firstPage!: () => void;
    const pageOne = new Promise<void>((resolve) => (firstPage = resolve));
    const reading = documentWork.background(() =>
      engine.recognizePages(new Uint8Array([37, 80, 68, 70]), [1, 2, 3, 4], (done) => done === 1 && firstPage())
    );
    await pageOne;
    let held: { start: number; end: number } = { start: 0, end: 0 };
    await documentWork.foreground(async () => {
      const start = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      held = { start, end: Date.now() };
    });
    const results = await reading;
    expect(results.map((result) => result.page)).toEqual([1, 2, 3, 4]);
    const finished = (await readFile(process.env.FAKE_OCR_LOG, "utf8")).trim().split("\n").map((line) => Number(line.split(" ")[1]));
    // At most the page being read when the user's work started finishes during it.
    expect(finished.filter((at) => at > held.start + 200 && at < held.end).length).toBe(0);
    expect(finished.filter((at) => at >= held.end).length).toBeGreaterThanOrEqual(2);
  }, 15_000);
});
