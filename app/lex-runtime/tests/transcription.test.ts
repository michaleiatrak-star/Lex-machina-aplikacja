import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { hasRecordingSignature, storedDocumentMediaType } from "../src/stored-document-source.js";
import {
  installTranscriptionModel,
  installedTranscriptionModel,
  isRecordingMediaType,
  LocalWhisperTranscriber,
  recordingMediaTypeFor,
  timestamp,
  transcriptionFailure,
  transcriptPages,
  SPEAKER_MODEL,
  TranscriptionModelManager,
  type RecordingTranscriber,
  type TranscriptionModelFile
} from "../src/transcription.js";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const body = (data: string) => ({
  ok: true,
  status: 200,
  body: (async function* () {
    yield new TextEncoder().encode(data);
  })()
});

describe("transkrypcja nagrań: tekst dokumentu", () => {
  it("strony po 10 minut, każda linia z czasem początku; godziny tylko przy nagraniu od godziny", () => {
    const pages = transcriptPages({
      duration: 1500,
      segments: [
        { start: 3.2, end: 9, text: "Otwieram posiedzenie." },
        { start: 65, end: 70, text: "Proszę o zeznania." },
        { start: 1210.5, end: 1220, text: "Zamykam rozprawę." }
      ]
    });
    expect(pages).toEqual([
      { page: 1, text: "[00:03] Otwieram posiedzenie.\n[01:05] Proszę o zeznania." },
      { page: 2, text: "" },
      { page: 3, text: "[20:10] Zamykam rozprawę." }
    ]);
    expect(timestamp(3725, true)).toBe("[01:02:05]");
    expect(transcriptPages({ duration: 3700, segments: [{ start: 3650, end: 3660, text: "x" }] }).at(-1)!.text).toBe("[01:00:50] x");
  });

  it("typy plików nagrań: po rozszerzeniu i po sygnaturze bajtów zapisanego pliku", () => {
    expect(recordingMediaTypeFor("rozprawa.M4A")).toBe("audio/mp4");
    expect(recordingMediaTypeFor("spotkanie.mkv")).toBe("video/x-matroska");
    expect(recordingMediaTypeFor("pismo.pdf")).toBeNull();
    expect(isRecordingMediaType("video/quicktime")).toBe(true);
    expect(isRecordingMediaType("application/pdf")).toBe(false);
    expect(storedDocumentMediaType("audio/mpeg")).toBe("audio/mpeg");
    const pad = (head: number[] | string) => {
      const bytes = typeof head === "string" ? [...Buffer.from(head, "latin1")] : head;
      return new Uint8Array([...bytes, ...new Array(16).fill(0)]);
    };
    expect(hasRecordingSignature(pad("ID3\x04"))).toBe(true);
    expect(hasRecordingSignature(pad("RIFF\0\0\0\0WAVE"))).toBe(true);
    expect(hasRecordingSignature(pad("\0\0\0\x18ftypM4A "))).toBe(true);
    expect(hasRecordingSignature(pad([0x1a, 0x45, 0xdf, 0xa3]))).toBe(true);
    expect(hasRecordingSignature(pad("OggS"))).toBe(true);
    expect(hasRecordingSignature(pad("%PDF-1.7"))).toBe(false);
  });

  it("błędy workera nazwane dla użytkownika", () => {
    expect(transcriptionFailure("LEX_STT_MODEL_MISSING\n", 3).message).toBe("TRANSCRIPTION_MODEL_MISSING");
    expect(transcriptionFailure("LEX_STT_DECODE_FAILED:InvalidDataError:bad\n", 4).message).toMatch(/^TRANSCRIPTION_DECODE_FAILED:InvalidDataError/u);
    expect(transcriptionFailure("ModuleNotFoundError: No module named 'faster_whisper'", 1).message).toBe("TRANSCRIPTION_ENGINE_MISSING");
  });
});

describe("model transkrypcji: pobieranie", () => {
  it("zapisuje pliki tylko po zgodnej sumie SHA-256 i rozmiarze; rekord instalacji po wszystkich", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-model-"));
    const files: TranscriptionModelFile[] = [
      { filename: "config.json", url: "https://example.test/config.json", bytes: 2, sha256: sha("{}") },
      { filename: "model.bin", url: "https://example.test/model.bin", bytes: 5, sha256: sha("model") }
    ];
    const served: Record<string, string> = { "https://example.test/config.json": "{}", "https://example.test/model.bin": "model" };
    await installTranscriptionModel(dir, undefined, files, async (url) => body(served[url]!));
    expect(installedTranscriptionModel(dir, files)).toBe(true);

    const bad = await mkdtemp(path.join(os.tmpdir(), "lex-stt-bad-"));
    try {
      await expect(
        installTranscriptionModel(bad, undefined, files, async (url) => body(url.endsWith("model.bin") ? "MODEL" : "{}"))
      ).rejects.toThrow("TRANSCRIPTION_MODEL_CHECKSUM_MISMATCH:model.bin");
      expect(fs.existsSync(path.join(bad, "model.bin"))).toBe(false);
      expect(installedTranscriptionModel(bad, files)).toBe(false);
    } finally {
      await rm(bad, { recursive: true, force: true });
    }
  });
});

describe("LocalWhisperTranscriber", () => {
  it("uruchamia worker z plikiem nagrania i folderem modelu, przekazuje postęp", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-worker-"));
    const modelDir = path.join(dir, "model");
    fs.mkdirSync(modelDir);
    // The installed model as the record names it (only what installedTranscriptionModel reads).
    const { TRANSCRIPTION_MODEL } = await import("../src/transcription.js");
    for (const file of TRANSCRIPTION_MODEL.files) {
      const handle = fs.openSync(path.join(modelDir, file.filename), "w");
      fs.ftruncateSync(handle, file.bytes);
      fs.closeSync(handle);
    }
    fs.writeFileSync(
      path.join(modelDir, "transcription.json"),
      JSON.stringify({ files: Object.fromEntries(TRANSCRIPTION_MODEL.files.map((file) => [file.filename, file.sha256])) })
    );
    const worker = path.join(dir, "worker.cjs");
    await writeFile(
      worker,
      `
const fs = require("node:fs");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
if (!arg("--input").endsWith(".m4a") || !fs.existsSync(arg("--model-dir"))) process.exit(9);
process.stderr.write("LEX_STT_PROGRESS 30 60\\nLEX_STT_PROGRESS 60 60\\n");
fs.writeFileSync(arg("--output"), JSON.stringify({ duration: 60, segments: [{ start: 1, end: 5, text: " Dzień dobry. " }, { start: 6, end: 7, text: "  " }] }));
`
    );
    const transcriber = new LocalWhisperTranscriber(() => modelDir, { python: process.execPath, workerPath: worker });
    expect(transcriber.available()).toBe(true);
    const progress: number[] = [];
    const result = await transcriber.transcribe(new Uint8Array([1, 2, 3]), "audio/mp4", (done) => progress.push(done));
    expect(result).toEqual({ duration: 60, segments: [{ start: 1, end: 5, text: "Dzień dobry." }] });
    expect(progress).toEqual([30, 60]);
    expect(new LocalWhisperTranscriber(() => path.join(dir, "brak")).available()).toBe(false);
  });
});

describe("nagranie w sprawie: dokument z transkrypcji", () => {
  it("nagranie przechodzi jak dokument: tekst z czasem, dane osobowe zastąpione w chunkach", async () => {
    const transcriber: RecordingTranscriber = {
      available: () => true,
      async transcribe() {
        return { duration: 90, segments: [{ start: 2, end: 8, text: "Jan Kowalski zeznaje w sprawie." }] };
      }
    };
    const namedEntities = {
      async recognize(text: string) {
        const start = text.indexOf("Jan Kowalski");
        return start < 0 ? [] : [{ start, end: start + 12, kind: "PERSON" as const, value: "Jan Kowalski", confidence: 0.99 }];
      }
    };
    const unused = { async extract() { throw new Error("unused"); } };
    const ocr = { async recognizePages() { throw new Error("unused"); } };
    const service = new LocalPrivateDocumentService(
      new CompleteDocumentIngestor(unused, ocr),
      namedEntities,
      24_000,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      transcriber
    );
    const review = await service.review(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), "audio/mpeg");
    expect(review.pages[0]!.text).toBe("[00:02] Jan Kowalski zeznaje w sprawie.");
    expect(review.pages[0]!.source).toBe("DIGITAL");
    expect(review.suggestions.some((item) => item.kind === "PERSON")).toBe(true);
    const done = await service.finalizeReview(review.documentId, []);
    expect(done.chunks.map((chunk) => chunk.text).join("\n")).not.toContain("Jan Kowalski");

    const missing = new LocalPrivateDocumentService(new CompleteDocumentIngestor(unused, ocr), namedEntities);
    await expect(missing.review(new Uint8Array([1]), "audio/mpeg")).rejects.toThrow("TRANSCRIPTION_UNAVAILABLE");
  });
});

describe("ten sam plik w sprawie: zapisany odczyt zamiast ponownego OCR", () => {
  it("drugie wgranie tego samego pliku nie uruchamia odczytu; inny plik i korekta AI uruchamiają", async () => {
    let reads = 0;
    const transcriber: RecordingTranscriber = {
      available: () => true,
      async transcribe() {
        reads += 1;
        return { duration: 30, segments: [{ start: 1, end: 3, text: "Treść nagrania." }] };
      }
    };
    const saved = new Map<string, unknown>();
    const store = {
      async saveSource(args: { documentId: string; source: unknown }) {
        saved.set(args.documentId, args.source);
      },
      async loadSource(args: { documentId: string }) {
        if (!saved.has(args.documentId)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        return { mediaType: "audio/mpeg", source: saved.get(args.documentId) };
      },
      async saveProtected() {},
      async loadProtected() {
        throw new Error("unused");
      }
    };
    const unused = { async extract() { throw new Error("unused"); } };
    const ocr = { async recognizePages() { throw new Error("unused"); } };
    const service = new LocalPrivateDocumentService(
      new CompleteDocumentIngestor(unused, ocr),
      { async recognize() { return []; } },
      24_000,
      undefined, undefined,
      store as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      transcriber
    );
    const security = { caseId: "case_" + "a".repeat(32), caseDataKey: Buffer.alloc(32), keyVersion: 1 };
    const file = new Uint8Array([0x49, 0x44, 0x33, 7, 7, 7]);
    const first = await service.review(file, "audio/mpeg", security);
    const again = await service.review(file, "audio/mpeg", security);
    expect(reads).toBe(1);
    expect(again.documentId).toBe(first.documentId);
    expect(again.pages[0]!.text).toBe("[00:01] Treść nagrania.");
    await service.review(new Uint8Array([0x49, 0x44, 0x33, 8]), "audio/mpeg", security);
    expect(reads).toBe(2);
    await service.review(file, "audio/mpeg", { ...security, ocrFix: true } as never);
    expect(reads).toBe(3);
  });
});

describe("transkrypcja: rozmówcy i znaczniki czasu", () => {
  it("linie protokołu z osobą; bez modeli mówców jak dotąd", () => {
    const pages = transcriptPages({
      duration: 30,
      speakers: 2,
      segments: [
        { start: 0, end: 3, text: "Otwieram rozprawę.", speaker: 1 },
        { start: 4, end: 7, text: "Dzień dobry.", speaker: 2 },
        { start: 9, end: 11, text: "Bez osoby." }
      ]
    });
    expect(pages[0]!.text).toBe("[00:00] Osoba 1: Otwieram rozprawę.\n[00:04] Osoba 2: Dzień dobry.\n[00:09] Bez osoby.");
  });

  it("worker dostaje modele mówców tylko po ich instalacji; wynik niesie numer osoby", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-speakers-"));
    const modelDir = path.join(dir, "model");
    const fake = (folder: string, files: readonly TranscriptionModelFile[], record: string) => {
      fs.mkdirSync(folder, { recursive: true });
      for (const file of files) {
        const handle = fs.openSync(path.join(folder, file.filename), "w");
        fs.ftruncateSync(handle, file.bytes);
        fs.closeSync(handle);
      }
      fs.writeFileSync(path.join(folder, record), JSON.stringify({ files: Object.fromEntries(files.map((file) => [file.filename, file.sha256])) }));
    };
    const { TRANSCRIPTION_MODEL } = await import("../src/transcription.js");
    fake(modelDir, TRANSCRIPTION_MODEL.files, "transcription.json");
    const manager = new TranscriptionModelManager(modelDir);
    expect(manager.speakersInstalled()).toBe(false);
    expect(manager.status().speakers).toEqual({ installed: false, bytes: SPEAKER_MODEL.files.reduce((sum, file) => sum + file.bytes, 0), count: 0 });
    const worker = path.join(dir, "worker.cjs");
    await writeFile(
      worker,
      `
const fs = require("node:fs");
const at = process.argv.indexOf("--diarize-dir");
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
fs.writeFileSync(arg("--output"), JSON.stringify({ duration: 9, speakers: at > 0 ? 2 : 0, segments: [{ start: 0, end: 2, text: at > 0 ? arg("--diarize-threshold") + "/" + arg("--speakers") : "bez", speaker: at > 0 ? 2 : undefined }] }));
`
    );
    const transcriber = new LocalWhisperTranscriber(() => modelDir, {
      python: process.execPath,
      workerPath: worker,
      speakersDir: () => (manager.speakersInstalled() ? manager.speakersDir : null),
      speakerCount: () => manager.speakerCount()
    });
    expect(await transcriber.transcribe(new Uint8Array([1]), "audio/mp4")).toEqual({ duration: 9, segments: [{ start: 0, end: 2, text: "bez" }] });
    fake(manager.speakersDir, SPEAKER_MODEL.files, "speakers.json");
    expect(manager.speakersInstalled()).toBe(true);
    expect(await transcriber.transcribe(new Uint8Array([1]), "audio/mp4")).toEqual({
      duration: 9,
      speakers: 2,
      segments: [{ start: 0, end: 2, text: `${SPEAKER_MODEL.threshold}/0`, speaker: 2 }]
    });
    // The administrator's default (a hearing: 3), and a recording's own number over it.
    manager.setSpeakerCount(3);
    expect(manager.status().speakers.count).toBe(3);
    expect((await transcriber.transcribe(new Uint8Array([1]), "audio/mp4")).segments[0]!.text).toBe(`${SPEAKER_MODEL.threshold}/3`);
    expect((await transcriber.transcribe(new Uint8Array([1]), "audio/mp4", undefined, { speakers: 5 })).segments[0]!.text).toBe(`${SPEAKER_MODEL.threshold}/5`);
  });
});
