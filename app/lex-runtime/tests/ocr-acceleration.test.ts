import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareReadings,
  judgeBenchmark,
  OCR_ACCEL_MODELS,
  OCR_COREML_ENGINE_REVISION,
  OcrAccelerationManager,
  ocrAccelProvider,
  type OcrAccelEnvironment
} from "../src/ocr/ocr-acceleration.js";
import { lastOcrRunStats, LocalPaddleOcrEngine, parseOcrStats } from "../src/ocr/paddle-ocr-engine.js";
import { documentWork } from "../src/document-work.js";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("OCR na karcie graficznej: decyzja z pomiaru", () => {
  it("karta: DirectML na Windows x64, CoreML na Apple Silicon, inaczej brak", () => {
    expect(ocrAccelProvider("win32", "x64")).toBe("dml");
    expect(ocrAccelProvider("darwin", "arm64")).toBe("coreml");
    expect(ocrAccelProvider("darwin", "x64")).toBeNull();
    expect(ocrAccelProvider("linux", "x64")).toBeNull();
  });

  it("porównanie linii bez odstępów: inna spacja to ta sama linia, inna litera nie", () => {
    expect(compareReadings(["Ala ma kota.Kot\nPies"], ["Ala ma kota. Kot\nPies"])).toEqual({ lines: 2, same: 2 });
    expect(compareReadings(["Ala ma kota\nPies"], ["Ala ma kola\nPies"])).toEqual({ lines: 2, same: 1 });
  });

  it("włączona tylko gdy szybsza o 15% i ten sam tekst; karta nieużyta to odrzucenie", () => {
    const text = [Array.from({ length: 40 }, (_, i) => `linia ${i}`).join("\n")];
    const ok = judgeBenchmark({ provider: "dml", cpu: { seconds: 100, pages: text }, accel: { seconds: 40, pages: text, used: true } });
    expect(ok).toMatchObject({ accepted: true, reason: "FASTER_SAME_TEXT", lines: 40, sameLines: 40 });
    expect(judgeBenchmark({ provider: "dml", cpu: { seconds: 100, pages: text }, accel: { seconds: 90, pages: text, used: true } }).reason).toBe("NOT_FASTER");
    const other = [text[0]!.replace(/linia [0-4]\b/gu, "linja")];
    expect(judgeBenchmark({ provider: "dml", cpu: { seconds: 100, pages: text }, accel: { seconds: 10, pages: other, used: true } }).reason).toBe("TEXT_DIFFERS");
    expect(judgeBenchmark({ provider: "coreml", cpu: { seconds: 100, pages: text }, accel: { seconds: 10, pages: text, used: false } }).reason).toBe("ACCEL_NOT_USED");
  });
});

describe("OCR na karcie graficznej: instalacja i pomiar", () => {
  const fakeModels = () =>
    OCR_ACCEL_MODELS.map((file) => {
      const content = `onnx:${file.filename}`;
      return { ...file, content, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
    });

  it("pobiera modele, mierzy oba odczyty i włącza kartę tylko po wygranym pomiarze", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-accel-"));
    const models = fakeModels();
    // The pinned list is replaced by the fake files for this test.
    OCR_ACCEL_MODELS.splice(0, OCR_ACCEL_MODELS.length, ...models);
    const fixture = path.join(dir, "bench.pdf");
    fs.writeFileSync(fixture, "%PDF-1.7");
    const manager = new OcrAccelerationManager(path.join(dir, "accel"), { platform: "darwin", arch: "arm64", fixture });
    const calls: Array<OcrAccelEnvironment | null> = [];
    let accelSeconds = 20;
    manager.reader = async (_data, pages, acceleration) => {
      calls.push(acceleration);
      expect(pages).toEqual([1, 2, 3, 4]);
      return { seconds: acceleration ? accelSeconds : 60, pages: ["Pozew o zapłatę\nkwota 100 zł"], used: true };
    };
    const served = new Map(models.map((file) => [file.url, file.content]));
    const fetchImpl = async (url: string) => ({
      ok: true,
      status: 200,
      body: (async function* () {
        yield new TextEncoder().encode(served.get(url)!);
      })()
    });
    expect(manager.status()).toMatchObject({ supported: true, provider: "coreml", installed: false, active: false });
    await manager.start(fetchImpl);
    expect(calls[0]).toBeNull();
    expect(calls[1]!.env).toMatchObject({ LEX_OCR_ACCEL: "coreml", LEX_OCR_ONNX_DIR: path.join(dir, "accel", "models") });
    expect(manager.status()).toMatchObject({ installed: true, active: true, state: "IDLE", benchmark: { accepted: true, cpuSeconds: 60, accelSeconds: 20 } });
    expect(manager.environment()!.maxWorkers).toBe(1);
    expect(manager.status().benchmark?.engineRevision).toBe(OCR_COREML_ENGINE_REVISION);

    // Neither an old acceptance nor an old rejection describes the new backend.
    const recordPath = path.join(dir, "accel", "ocr-acceleration.json");
    for (const accepted of [true, false]) {
      const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
      delete record.benchmark.engineRevision;
      record.benchmark.accepted = accepted;
      fs.writeFileSync(recordPath, JSON.stringify(record));
      fs.writeFileSync(path.join(dir, "accel", "auto.json"), JSON.stringify({
        failedAt: new Date().toISOString(), error: "OCR_ACCEL_OLD_BACKEND_FAILED"
      }));
      expect(manager.environment()).toBeNull();
      const before = calls.length;
      expect(await manager.autoSetup()).toBe("DONE");
      expect(calls.length).toBe(before + 2);
      expect(manager.status()).toMatchObject({ active: true, benchmark: { engineRevision: OCR_COREML_ENGINE_REVISION } });
    }
    const measuredCalls = calls.length;
    expect(await manager.autoSetup()).toBe("SKIPPED");
    expect(calls.length).toBe(measuredCalls);

    accelSeconds = 58;
    await manager.measure();
    expect(manager.status()).toMatchObject({ installed: true, active: false, benchmark: { accepted: false, reason: "NOT_FASTER" } });
    expect(manager.environment()).toBeNull();

    manager.remove();
    expect(manager.status()).toMatchObject({ installed: false, active: false, benchmark: null });
    expect(new OcrAccelerationManager(dir, { platform: "linux", arch: "x64" }).status().supported).toBe(false);
    expect(() => new OcrAccelerationManager(dir, { platform: "linux", arch: "x64" }).start()).toThrow("OCR_ACCEL_UNSUPPORTED");
  });
});

describe("OCR na karcie graficznej: worker", () => {
  it("bez włączonej karty worker dostaje LEX_OCR_ACCEL=off; z kartą jej środowisko i wykrycie użycia", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-accel-worker-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(
      worker,
      `
const fs = require("node:fs");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const pages = arg("--pages").split(",").map(Number);
if (process.env.LEX_OCR_ACCEL !== "off") process.stderr.write("LEX_OCR_ACCEL CoreMLExecutionProvider 4\\n");
process.stderr.write('LEX_OCR_STATS {"loadSeconds": 5.5, "pageSeconds": [21.0, 19.5], "threads": 28, "mkldnn": true, "accel": null}\\n');
fs.writeFileSync(arg("--output"), JSON.stringify(pages.map((page) => ({ page, text: process.env.LEX_OCR_ACCEL + " " + (process.env.LEX_OCR_ONNX_DIR || "-") }))));
`
    );
    const engine = new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker, workers: 1 });
    const off = await engine.benchmarkRead(new Uint8Array([37]), [1, 2], null);
    expect(off.pages).toEqual(["off -", "off -"]);
    expect(off.used).toBe(false);
    const on = await engine.benchmarkRead(new Uint8Array([37]), [1], { env: { LEX_OCR_ACCEL: "coreml", LEX_OCR_ONNX_DIR: "/m" }, maxWorkers: 3 });
    expect(on.pages).toEqual(["coreml /m"]);
    expect(on.used).toBe(true);
    const active = new LocalPaddleOcrEngine({
      python: process.execPath,
      workerPath: worker,
      workers: 1,
      acceleration: () => ({ env: { LEX_OCR_ACCEL: "dml", LEX_OCR_ONNX_DIR: "/x" }, maxWorkers: 3 })
    });
    expect((await active.recognizePages(new Uint8Array([37]), [1]))[0]!.text).toBe("dml /x");
  });
});

describe("statystyka OCR z workera", () => {
  it("linia LEX_OCR_STATS: czasy, wątki, oneDNN; zapamiętana po odczycie", async () => {
    expect(parseOcrStats('LEX_OCR_STATS {"loadSeconds": 1, "pageSeconds": [2, "x", 3], "threads": 8, "mkldnn": false, "accel": "DmlExecutionProvider"}', 2, new Date("2026-11-03T00:00:00Z"))).toEqual({
      at: "2026-11-03T00:00:00.000Z",
      loadSeconds: 1,
      pageSeconds: [2, 3],
      threads: 8,
      mkldnn: false,
      mkldnnError: null,
      accel: "DmlExecutionProvider",
      workers: 2
    });
    expect(parseOcrStats("LEX_OCR_PAGE 1", 1)).toBeNull();
    expect(lastOcrRunStats()).toMatchObject({ loadSeconds: 5.5, pageSeconds: [21, 19.5], threads: 28, mkldnn: true });
  });
});

describe("statystyka OCR: linia rozcięta na dwie porcje wyjścia", () => {
  it("odczytana po zakończeniu procesu; dziennik przebiegu zapisany", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-split-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(
      worker,
      `
const fs = require("node:fs");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
process.stderr.write('LEX_OCR_STATS {"loadSeconds": 7.5, "pageSec');
setTimeout(() => {
  process.stderr.write('onds": [61.0], "threads": 28, "mkldnn": false, "mkldnnError": "RuntimeError:x", "accel": null}\\n');
  fs.writeFileSync(arg("--output"), JSON.stringify([{ page: 1, text: "x" }]));
}, 50);
`
    );
    const previous = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = dir;
    try {
      await new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker, workers: 1 }).recognizePages(new Uint8Array([37]), [1]);
      expect(lastOcrRunStats()).toMatchObject({ loadSeconds: 7.5, pageSeconds: [61], threads: 28, mkldnn: false, mkldnnError: "RuntimeError:x" });
      expect(fs.readFileSync(path.join(dir, "LexMachina", "ocr-last-run.log"), "utf8")).toMatch(/pages 1-1 exit 0/u);
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("OCR na karcie graficznej: tryb automatyczny", () => {
  it("bez przycisku: pobiera i mierzy raz; przerwany przez pracę użytkownika ponawia po godzinie; brak sieci po dobie", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-auto-"));
    try {
      const models = OCR_ACCEL_MODELS.map((file) => {
        const content = `auto:${file.filename}`;
        return { ...file, content, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
      });
      OCR_ACCEL_MODELS.splice(0, OCR_ACCEL_MODELS.length, ...models);
      const fixture = path.join(dir, "bench.pdf");
      fs.writeFileSync(fixture, "%PDF-1.7");
      const served = new Map(models.map((file) => [file.url, file.content]));
      let online = false;
      const fetchImpl = async (url: string) =>
        online
          ? { ok: true, status: 200, body: (async function* () { yield new TextEncoder().encode(served.get(url)!); })() }
          : { ok: false, status: 503, body: null };
      const manager = new OcrAccelerationManager(path.join(dir, "accel"), { platform: "darwin", arch: "arm64", fixture });
      let interrupt = false;
      let reads = 0;
      manager.reader = async (_data, _pages, acceleration) => {
        reads += 1;
        // The user confirms a document while the benchmark runs.
        if (interrupt && acceleration) await documentWork.foreground(async () => undefined);
        return { seconds: acceleration ? 10 : 40, pages: ["Pozew\nkwota"], used: true };
      };
      const t0 = new Date("2026-11-04T08:00:00Z");
      expect(await manager.autoSetup(fetchImpl, t0)).toBe("FAILED");
      expect(await manager.autoSetup(fetchImpl, new Date("2026-11-04T20:00:00Z"))).toBe("SKIPPED");
      online = true;
      interrupt = true;
      expect(await manager.autoSetup(fetchImpl, new Date("2026-11-05T09:00:00Z"))).toBe("FAILED");
      expect(manager.status().error).toBe("OCR_ACCEL_MEASURE_INTERRUPTED");
      expect(manager.environment()).toBeNull();
      expect(await manager.autoSetup(fetchImpl, new Date("2026-11-05T09:30:00Z"))).toBe("SKIPPED");
      interrupt = false;
      expect(await manager.autoSetup(fetchImpl, new Date("2026-11-05T10:01:00Z"))).toBe("DONE");
      expect(manager.status()).toMatchObject({ auto: true, active: true, benchmark: { accepted: true, cpuSeconds: 40, accelSeconds: 10 } });
      const before = reads;
      expect(await manager.autoSetup(fetchImpl, new Date("2026-11-06T10:00:00Z"))).toBe("SKIPPED");
      expect(reads).toBe(before);
      process.env.LEX_OCR_ACCEL_AUTO = "off";
      expect(new OcrAccelerationManager(path.join(dir, "x"), { platform: "darwin", arch: "arm64" }).autoEnabled).toBe(false);
    } finally {
      delete process.env.LEX_OCR_ACCEL_AUTO;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("statystyka OCR: cały dokument z kilku procesów", () => {
  it("strony wszystkich przebiegów, czas od startu do ostatniej strony, liczba procesów", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lex-ocr-merge-"));
    const worker = path.join(dir, "worker.cjs");
    await writeFile(
      worker,
      `
const fs = require("node:fs");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const pages = arg("--pages").split(",").map(Number);
process.stderr.write("LEX_OCR_STATS " + JSON.stringify({ loadSeconds: pages[0] === 1 ? 3 : 4, pageSeconds: pages.map(() => 0.05), threads: 7, mkldnn: true, accel: "DmlExecutionProvider" }) + "\\n");
setTimeout(() => fs.writeFileSync(arg("--output"), JSON.stringify(pages.map((page) => ({ page, text: "x" })))), 60);
`
    );
    const previous = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = dir;
    try {
      await new LocalPaddleOcrEngine({ python: process.execPath, workerPath: worker, workers: 2 }).recognizePages(new Uint8Array([37]), [1, 2, 3, 4]);
      const run = lastOcrRunStats()!;
      expect(run).toMatchObject({ pages: 4, workers: 2, loadSeconds: 4, threads: 7, accel: "DmlExecutionProvider" });
      expect(run.pageSeconds).toHaveLength(4);
      expect(run.wallSeconds).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previous;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
