import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPaddleOcrEngine, OCR_BATCH_PAGES } from "../src/ocr/paddle-ocr-engine.js";
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
fs.appendFileSync(process.env.FAKE_OCR_LOG, pages.join(",") + (process.env.LEX_OCR_PAUSE_FILE ? " pause" : "") + "\\n");
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
    const engine = new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker });
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
});
