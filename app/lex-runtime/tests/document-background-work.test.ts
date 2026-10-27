import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CompleteDocumentIngestor, type OcrEngine } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { DocumentWorkScheduler } from "../src/document-work.js";
import type { PersonMorphology } from "../src/privacy/person-morphology.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("background OCR and the user's own document work", () => {
  it("background work waits while foreground work runs; the OCR worker sees the pause file only then", async () => {
    const work = new DocumentWorkScheduler(path.join(os.tmpdir(), `lex-ocr-pause-test-${process.pid}`));
    const events: string[] = [];
    let finishForeground!: () => void;
    const foreground = work.foreground(async () => {
      events.push("foreground start");
      expect(existsSync(work.pauseFile)).toBe(true);
      await new Promise<void>((resolve) => (finishForeground = resolve));
      events.push("foreground end");
    });
    const background = work.background(async () => {
      events.push(`background start, in background: ${work.inBackground()}`);
    });
    await tick();
    expect(events).toEqual(["foreground start"]);
    finishForeground();
    await Promise.all([foreground, background]);
    expect(events).toEqual(["foreground start", "foreground end", "background start, in background: true"]);
    expect(existsSync(work.pauseFile)).toBe(false);
    expect(work.inBackground()).toBe(false);
  });

  it("foreground work runs one at a time, in the order asked", async () => {
    const work = new DocumentWorkScheduler(path.join(os.tmpdir(), `lex-ocr-pause-test2-${process.pid}`));
    const events: string[] = [];
    let releaseFirst!: () => void;
    const first = work.foreground(async () => {
      events.push("first");
      await new Promise<void>((resolve) => (releaseFirst = resolve));
      events.push("first done");
    });
    const second = work.foreground(async () => {
      events.push("second");
    });
    await tick();
    expect(events).toEqual(["first"]);
    expect(work.paused()).toBe(true);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first", "first done", "second"]);
    expect(work.paused()).toBe(false);
  });
});

describe("correction chosen after a background read", () => {
  const morphology: PersonMorphology = {
    analyze: async (surfaces) => surfaces.map(() => null),
    knownWords: async (words) => words.map((word) => ["radcy", "prawnego", "Pawła", "Raka"].includes(word))
  };
  const ocr: OcrEngine = {
    async recognizePages(_data, pages) {
      return pages.map((page) => ({
        page,
        text: "radcy prawnego Pawla Raka",
        confidence: 0.99,
        lineCount: 1,
        engine: "test",
        lines: [{ text: "radcy prawnego Pawla Raka", score: 0.99, crop: "img" }]
      }));
    }
  };

  function service(asked: string[]) {
    return new LocalPrivateDocumentService(
      new CompleteDocumentIngestor({ async extract(data) { return { bytes: data.byteLength, pages: [{ page: 1, text: "" }] }; } }, ocr),
      { recognize: async () => [] },
      24_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      morphology,
      undefined,
      undefined,
      () => ({
        readLine: async (_image: string, text: string) => {
          asked.push(text);
          return "radcy prawnego Pawła Raka";
        },
        stop: () => undefined,
        modelBytes: 1
      }),
      async () => undefined,
      async () => undefined
    );
  }

  it("the background read keeps the OCR as read; correct() runs the vision model once, on the user's choice", async () => {
    const asked: string[] = [];
    const documents = service(asked);
    const read = await documents.review(Buffer.from("%PDF-1.4 skan"), "application/pdf", { caseId: "case-1", detect: false, background: true });
    expect(asked).toEqual([]);
    expect(read.pages[0]!.text).toContain("Pawla");
    const corrected = await documents.correct(read.documentId, { caseId: "case-1" });
    expect(asked).toEqual(["radcy prawnego Pawla Raka"]);
    expect(corrected.pages[0]!.text).toContain("Pawła");
    // Line images are gone after the correction: asked again, nothing runs.
    await documents.correct(read.documentId, { caseId: "case-1" });
    expect(asked).toHaveLength(1);
  });

  it("a page the user corrected by hand keeps the user's text", async () => {
    const asked: string[] = [];
    const documents = service(asked);
    const read = await documents.review(Buffer.from("%PDF-1.4 skan 2"), "application/pdf", { caseId: "case-1", detect: false, background: true });
    await documents.editPage!(read.documentId, 1, "radcy prawnego Pawła Raka (poprawione ręcznie)", { caseId: "case-1" });
    const corrected = await documents.correct(read.documentId, { caseId: "case-1" });
    expect(corrected.pages[0]!.text).toBe("radcy prawnego Pawła Raka (poprawione ręcznie)");
  });
});
