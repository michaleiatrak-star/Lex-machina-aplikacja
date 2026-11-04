import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { documentWork } from "../src/document-work.js";
import { LocalWhisperTranscriber, parseTranscriptionStats } from "../src/transcription.js";
import {
  compareTranscripts,
  CUDA_LIBRARIES,
  judgeSttBenchmark,
  nvidiaDriverPresent,
  TranscriptionAccelerationManager
} from "../src/transcription-acceleration.js";

let dir = "";
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
  delete process.env.LEX_STT_ACCEL_AUTO;
});

const TEXT = "Marley umarł, trzeba to przede wszystkim zaznaczyć. Co do tego nie ma żadnej wątpliwości.";

function fakeLibraries() {
  return CUDA_LIBRARIES.map((file) => {
    const content = `wheel:${file.filename}`;
    return { ...file, content, bytes: content.length, sha256: createHash("sha256").update(content).digest("hex") };
  });
}

function server(files: Array<{ url: string; content: string }>, online = () => true) {
  const served = new Map(files.map((file) => [file.url, file.content]));
  return async (url: string) =>
    online()
      ? { ok: true, status: 200, body: (async function* () { yield new TextEncoder().encode(served.get(url)!); })() }
      : { ok: false, status: 503, body: null };
}

// The DLLs a real NVIDIA wheel holds in its bin folder (the test writes empty files).
const fakeUnpack = async (_wheel: string, target: string) => {
  fs.mkdirSync(target, { recursive: true });
  for (const name of ["cublas64_12.dll", "cublasLt64_12.dll", "cudnn_ops64_9.dll", "cudnn_cnn64_9.dll"]) fs.writeFileSync(path.join(target, name), "");
};

describe("transkrypcja na karcie NVIDIA: decyzja z pomiaru", () => {
  it("słowa porównane w kolejności, bez interpunkcji i wielkości liter", () => {
    expect(compareTranscripts(TEXT, TEXT.toUpperCase().replace(/[,.]/gu, ""))).toEqual({ words: 14, same: 14 });
    expect(compareTranscripts("ala ma kota", "ala ma psa")).toEqual({ words: 3, same: 2 });
  });

  it("karta tylko gdy szybsza o 15% i te same słowa (90%); karta nieużyta to odrzucenie", () => {
    const cpu = { seconds: 30, text: TEXT };
    expect(judgeSttBenchmark({ cpu, cuda: { seconds: 3, text: TEXT, device: "cuda" } })).toMatchObject({ accepted: true, reason: "FASTER_SAME_TEXT" });
    expect(judgeSttBenchmark({ cpu, cuda: { seconds: 28, text: TEXT, device: "cuda" } })).toMatchObject({ accepted: false, reason: "NOT_FASTER" });
    expect(judgeSttBenchmark({ cpu, cuda: { seconds: 3, text: "zupełnie inny tekst nagrania", device: "cuda" } })).toMatchObject({ reason: "TEXT_DIFFERS" });
    expect(judgeSttBenchmark({ cpu, cuda: { seconds: 25, text: TEXT, device: "cpu", error: "RuntimeError:cublas64_12.dll" } })).toMatchObject({
      accepted: false,
      reason: "CUDA_NOT_USED",
      cudaError: "RuntimeError:cublas64_12.dll"
    });
  });

  it("karta NVIDIA: Windows x64 ze sterownikiem (nvcuda.dll), inaczej brak", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-nv-"));
    expect(nvidiaDriverPresent("win32", "x64", dir)).toBe(false);
    fs.mkdirSync(path.join(dir, "System32"));
    fs.writeFileSync(path.join(dir, "System32", "nvcuda.dll"), "");
    expect(nvidiaDriverPresent("win32", "x64", dir)).toBe(true);
    expect(nvidiaDriverPresent("darwin", "arm64", dir)).toBe(false);
    expect(nvidiaDriverPresent("win32", "arm64", dir)).toBe(false);
  });

  it("biblioteki NVIDIA przypięte: cuDNN w wersji ładowarki z ctranslate2 4.8.5 (9.10.2)", () => {
    expect(CUDA_LIBRARIES.map((file) => file.filename)).toEqual([
      "nvidia_cublas_cu12-12.6.4.1-py3-none-win_amd64.whl",
      "nvidia_cudnn_cu12-9.10.2.21-py3-none-win_amd64.whl",
      "nvidia_cuda_nvrtc_cu12-12.6.85-py3-none-win_amd64.whl"
    ]);
    for (const file of CUDA_LIBRARIES) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.url.startsWith("https://files.pythonhosted.org/packages/")).toBe(true);
    }
  });
});

describe("transkrypcja na karcie NVIDIA: instalacja, pomiar, tryb automatyczny", () => {
  it("pobiera biblioteki, mierzy oba przebiegi i włącza kartę tylko po wygranym pomiarze", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-accel-"));
    const libraries = fakeLibraries();
    const fixture = path.join(dir, "bench.opus");
    fs.writeFileSync(fixture, "OggS");
    const manager = new TranscriptionAccelerationManager(path.join(dir, "accel"), { supported: true, fixture, libraries, unpack: fakeUnpack });
    manager.modelInstalled = () => true;
    const calls: Array<Record<string, string> | null> = [];
    let cudaSeconds = 4;
    manager.reader = async (_data, env) => {
      calls.push(env);
      return env ? { seconds: cudaSeconds, text: TEXT, device: "cuda" } : { seconds: 30, text: TEXT, device: "cpu" };
    };
    expect(manager.status()).toMatchObject({ supported: true, installed: false, active: false, bytes: libraries.reduce((sum, file) => sum + file.bytes, 0) });
    await manager.start(server(libraries));
    expect(calls[0]).toBeNull();
    expect(calls[1]).toEqual({ LEX_STT_DEVICE: "cuda", LEX_STT_CUDA_DIR: path.join(dir, "accel", "cuda") });
    expect(manager.status()).toMatchObject({ installed: true, active: true, state: "IDLE", benchmark: { accepted: true, cpuSeconds: 30, cudaSeconds: 4 } });
    // The wheels are not kept, only their DLLs.
    expect(fs.readdirSync(path.join(dir, "accel")).filter((name) => name.endsWith(".whl"))).toEqual([]);

    cudaSeconds = 29;
    await manager.measure();
    expect(manager.status()).toMatchObject({ active: false, benchmark: { accepted: false, reason: "NOT_FASTER" } });
    expect(manager.environment()).toBeNull();

    manager.remove();
    expect(manager.status()).toMatchObject({ installed: false, active: false, benchmark: null });
    const unsupported = new TranscriptionAccelerationManager(path.join(dir, "x"), { supported: false });
    expect(unsupported.status().supported).toBe(false);
    expect(() => unsupported.start()).toThrow("STT_ACCEL_UNSUPPORTED");
  });

  it("bez modelu transkrypcji nic się nie pobiera; z modelem raz; przerwany pomiar ponawia po godzinie, brak sieci po dobie", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-auto-"));
    const libraries = fakeLibraries();
    const fixture = path.join(dir, "bench.opus");
    fs.writeFileSync(fixture, "OggS");
    let online = false;
    const fetchImpl = server(libraries, () => online);
    const manager = new TranscriptionAccelerationManager(path.join(dir, "accel"), { supported: true, fixture, libraries, unpack: fakeUnpack });
    let model = false;
    manager.modelInstalled = () => model;
    let interrupt = false;
    let reads = 0;
    manager.reader = async (_data, env) => {
      reads += 1;
      if (interrupt && env) await documentWork.foreground(async () => undefined);
      return env ? { seconds: 3, text: TEXT, device: "cuda" } : { seconds: 30, text: TEXT, device: "cpu" };
    };
    expect(await manager.autoSetup(fetchImpl, new Date("2026-11-04T08:00:00Z"))).toBe("SKIPPED");
    expect(fs.existsSync(path.join(dir, "accel"))).toBe(false);
    model = true;
    expect(await manager.autoSetup(fetchImpl, new Date("2026-11-04T08:00:00Z"))).toBe("FAILED");
    expect(await manager.autoSetup(fetchImpl, new Date("2026-11-04T20:00:00Z"))).toBe("SKIPPED");
    online = true;
    interrupt = true;
    expect(await manager.autoSetup(fetchImpl, new Date("2026-11-05T09:00:00Z"))).toBe("FAILED");
    expect(manager.status().error).toBe("STT_ACCEL_MEASURE_INTERRUPTED");
    expect(await manager.autoSetup(fetchImpl, new Date("2026-11-05T09:30:00Z"))).toBe("SKIPPED");
    interrupt = false;
    expect(await manager.autoSetup(fetchImpl, new Date("2026-11-05T10:01:00Z"))).toBe("DONE");
    expect(manager.status()).toMatchObject({ auto: true, active: true });
    const before = reads;
    expect(await manager.autoSetup(fetchImpl, new Date("2026-11-06T10:00:00Z"))).toBe("SKIPPED");
    expect(reads).toBe(before);
    process.env.LEX_STT_ACCEL_AUTO = "off";
    expect(new TranscriptionAccelerationManager(path.join(dir, "y"), { supported: true }).autoEnabled).toBe(false);
  });
});

describe("transkrypcja: worker i statystyka", () => {
  it("linia LEX_STT_STATS: urządzenie, czas, długość nagrania, błąd karty", () => {
    expect(parseTranscriptionStats('LEX_STT_PROGRESS 5 90\nLEX_STT_STATS {"device": "cuda", "seconds": 3.1, "audioSeconds": 90.0}\n', new Date("2026-11-04T12:00:00Z"))).toEqual({
      device: "cuda",
      seconds: 3.1,
      audioSeconds: 90,
      at: "2026-11-04T12:00:00.000Z"
    });
    expect(parseTranscriptionStats('LEX_STT_STATS {"device": "cpu", "seconds": 30, "audioSeconds": 90, "cudaError": "NO_CUDA_DEVICE"}')).toMatchObject({ device: "cpu", cudaError: "NO_CUDA_DEVICE" });
    expect(parseTranscriptionStats("LEX_STT_STATS {zepsute")).toBeNull();
  });

  it("środowisko karty trafia do workera tylko gdy włączona; pomiar dostaje swoje środowisko", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-worker-"));
    const modelDir = path.join(dir, "model");
    fs.mkdirSync(modelDir);
    const files = [{ filename: "model.bin", content: "MODEL" }];
    for (const file of files) fs.writeFileSync(path.join(modelDir, file.filename), file.content);
    const worker = path.join(dir, "worker.mjs");
    await writeFile(
      worker,
      `import fs from "node:fs";
const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const device = process.env.LEX_STT_DEVICE === "cuda" ? "cuda" : "cpu";
fs.writeFileSync(arg("--output"), JSON.stringify({ duration: 90, segments: [{ start: 0, end: 5, text: device }] }));
process.stderr.write("LEX_STT_STATS " + JSON.stringify({ device, seconds: device === "cuda" ? 3 : 30, audioSeconds: 90 }) + "\\n");
`
    );
    let accel: Record<string, string> | null = null;
    const transcriber = new LocalWhisperTranscriber(() => modelDir, { python: process.execPath, workerPath: worker, acceleration: () => accel });
    // The installed-model check reads the record of the pinned files; the test uses its own.
    (transcriber as unknown as { available: () => boolean }).available = () => true;
    const cpu = await transcriber.transcribe(new Uint8Array([1]), "audio/opus");
    expect(cpu.segments[0]!.text).toBe("cpu");
    accel = { LEX_STT_DEVICE: "cuda", LEX_STT_CUDA_DIR: dir };
    const cuda = await transcriber.transcribe(new Uint8Array([1]), "audio/opus");
    expect(cuda.segments[0]!.text).toBe("cuda");
    expect(await transcriber.benchmark(new Uint8Array([1]), "audio/opus", null)).toEqual({ seconds: 30, text: "cpu", device: "cpu" });
    // An LEX_STT_DEVICE of the app's own environment never turns the card on by itself.
    process.env.LEX_STT_DEVICE = "cuda";
    try {
      accel = null;
      expect((await transcriber.transcribe(new Uint8Array([1]), "audio/opus")).segments[0]!.text).toBe("cpu");
    } finally {
      delete process.env.LEX_STT_DEVICE;
    }
  });
});
