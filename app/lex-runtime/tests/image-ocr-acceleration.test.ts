import fs from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalPaddleImageOcrEngine } from "../src/ocr/paddle-image-ocr-engine.js";

describe("OCR zdjęć i obrazów: karta graficzna jak przy PDF", () => {
  it("bez włączonej karty LEX_OCR_ACCEL=off; z kartą jej środowisko", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lex-image-accel-"));
    try {
      const worker = path.join(dir, "worker.cjs");
      await writeFile(
        worker,
        `
const fs = require("node:fs");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
fs.writeFileSync(arg("--output"), JSON.stringify([{ page: 1, text: [process.env.LEX_OCR_ACCEL, process.env.LEX_OCR_ONNX_DIR || "-"].join("|") }]));
`
      );
      let accel: { env: Record<string, string>; maxWorkers: number } | null = null;
      const engine = new LocalPaddleImageOcrEngine({ python: process.execPath, workerPath: worker, acceleration: () => accel });
      expect((await engine.recognizeImage(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).text).toBe("off|-");
      accel = { env: { LEX_OCR_ACCEL: "dml", LEX_OCR_ONNX_DIR: "C:\\models" }, maxWorkers: 3 };
      expect((await engine.recognizeImage(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).text).toBe("dml|C:\\models");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
