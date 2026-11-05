import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadVerified, sizeOf, type FetchLike } from "./verified-download.js";

/**
 * Local speech-to-text of recordings (audio and video) uploaded to a case: faster-whisper
 * large-v3-turbo in a Python worker (app/ocr/whisper_worker.py), like the OCR worker. The
 * recording never leaves the computer. The model is downloaded once, on the administrator's
 * request, file by file against its SHA-256 (no network during transcription).
 *
 * Measured on 3 min of a Polish recording, 4 CPU cores: 7.0% wrong words, 49 s.
 */

// Media types of recordings: the upload is stored as it is, the text is the transcript.
export const RECORDING_MEDIA_TYPES = {
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/flac": ".flac",
  "audio/webm": ".webm",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi"
} as const;

export type RecordingMediaType = keyof typeof RECORDING_MEDIA_TYPES;

export function isRecordingMediaType(value: string): value is RecordingMediaType {
  return Object.prototype.hasOwnProperty.call(RECORDING_MEDIA_TYPES, value);
}

/** Media type of a recording by its file extension (a browser often sends none for .m4a, .mkv). */
export function recordingMediaTypeFor(filename: string): RecordingMediaType | null {
  const ext = path.extname(filename).toLowerCase();
  const byExt: Record<string, RecordingMediaType> = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/opus",
    ".flac": "audio/flac",
    ".weba": "audio/webm",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo"
  };
  return byExt[ext] ?? null;
}

// --- Model ------------------------------------------------------------------------------

export type TranscriptionModelFile = { filename: string; url: string; sha256: string; bytes: number };

// faster-whisper large-v3-turbo (CTranslate2), MIT; pinned to one revision of the repository.
const REVISION = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf";
const BASE = `https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo/resolve/${REVISION}`;

export const TRANSCRIPTION_MODEL = {
  id: "faster-whisper-large-v3-turbo",
  displayName: "Whisper large-v3-turbo (transkrypcja nagrań)",
  license: "MIT",
  revision: REVISION,
  files: [
    { filename: "config.json", bytes: 2263, sha256: "b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e" },
    { filename: "preprocessor_config.json", bytes: 340, sha256: "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711" },
    { filename: "tokenizer.json", bytes: 2710337, sha256: "297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd" },
    { filename: "vocabulary.json", bytes: 1068114, sha256: "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1" },
    { filename: "model.bin", bytes: 1617884929, sha256: "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da" }
  ].map((file) => ({ ...file, url: `${BASE}/${file.filename}` })) as TranscriptionModelFile[]
};

// Speakers of a recording (whisper_worker.py --diarize-dir): pyannote segmentation 3.0 (MIT) and
// a speaker embedding model, run by sherpa-onnx; small files next to the transcription model.
const SEGMENTATION_REVISION = "9403a6902bb58e3d5ae8c7e77c3422de279db2e0";
export const SPEAKER_MODEL = {
  id: "speakers-pyannote-seg3-campplus-zh-en",
  // Clustering threshold of the embedding model, measured 2026-11-05 on 2, 3 and 4 Polish readers
  // (LibriVox): 0.8 found 2/4/4 speakers at 94/77/79% of the time right; eres2netv2 was better
  // with three (83%) but three times slower, int8 models 3.5-6 times slower. With the number of
  // speakers given (a hearing: 3 or more) the models need not estimate it.
  threshold: 0.8,
  files: [
    {
      filename: "segmentation.onnx",
      bytes: 5992913,
      sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
      url: `https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/${SEGMENTATION_REVISION}/model.onnx`
    },
    {
      // 3D-Speaker CAM++ (Apache-2.0), trained on Chinese and English speech, 192-dim embeddings.
      filename: "embedding.onnx",
      bytes: 28281164,
      sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
      url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
    }
  ] as TranscriptionModelFile[]
};

export type TranscriptionModelStatus = {
  modelId: string;
  label: string;
  license: string;
  bytes: number;
  installed: boolean;
  state: "IDLE" | "DOWNLOADING" | "FAILED";
  progress: { file: string; received: number; total: number; percent: number } | null;
  error?: string;
  // Who speaks when: the speaker models next to the transcription model; count 0 = estimated.
  speakers: { installed: boolean; bytes: number; count: number };
};

/** The model folder holds every file of the pinned revision and the record written after the check. */
export function installedTranscriptionModel(dir: string, files: readonly TranscriptionModelFile[] = TRANSCRIPTION_MODEL.files, recordName = "transcription.json"): boolean {
  try {
    const record = JSON.parse(fs.readFileSync(path.join(dir, recordName), "utf8")) as { revision?: unknown; files?: Record<string, unknown> };
    return files.every((file) => record.files?.[file.filename] === file.sha256 && sizeOf(path.join(dir, file.filename)) === file.bytes);
  } catch {
    return false;
  }
}

/** Downloads the files into `dir`, each checked against its SHA-256 and size before it is kept. */
export async function installTranscriptionModel(
  dir: string,
  onProgress?: (progress: { file: string; received: number; total: number }) => void,
  files: readonly TranscriptionModelFile[] = TRANSCRIPTION_MODEL.files,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  model: { id: string; revision: string; record: string } = { id: TRANSCRIPTION_MODEL.id, revision: TRANSCRIPTION_MODEL.revision, record: "transcription.json" }
): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const record = path.join(dir, model.record);
  fs.rmSync(record, { force: true });
  for (const file of files) {
    await downloadVerified(file, path.join(dir, file.filename), "TRANSCRIPTION_MODEL", onProgress, fetchImpl);
  }
  const content = {
    schemaVersion: 1,
    id: model.id,
    revision: model.revision,
    installedAt: new Date().toISOString(),
    files: Object.fromEntries(files.map((file) => [file.filename, file.sha256]))
  };
  fs.writeFileSync(`${record}.tmp`, `${JSON.stringify(content, null, 2)}\n`);
  fs.renameSync(`${record}.tmp`, record);
}

/** The model folder with its install state, for the panel of local models. */
export class TranscriptionModelManager {
  private install: { state: TranscriptionModelStatus["state"]; progress: TranscriptionModelStatus["progress"]; error?: string } = { state: "IDLE", progress: null };

  constructor(readonly dir: string) {}

  installed(): boolean {
    return installedTranscriptionModel(this.dir);
  }

  /** The speaker models (a folder of the transcription model's). */
  get speakersDir(): string {
    return path.join(this.dir, "speakers");
  }

  speakersInstalled(): boolean {
    return installedTranscriptionModel(this.speakersDir, SPEAKER_MODEL.files, "speakers.json");
  }

  /** People speaking in recordings as set by the administrator: 0 = estimated by the models. */
  speakerCount(): number {
    try {
      const value = Number((JSON.parse(fs.readFileSync(path.join(this.dir, "speakers-setting.json"), "utf8")) as { count?: unknown }).count);
      return Number.isInteger(value) && value >= 0 && value <= 12 && value !== 1 ? value : 0;
    } catch {
      return 0;
    }
  }

  setSpeakerCount(count: number): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, "speakers-setting.json"), JSON.stringify({ count }));
  }

  status(): TranscriptionModelStatus {
    return {
      modelId: TRANSCRIPTION_MODEL.id,
      label: TRANSCRIPTION_MODEL.displayName,
      license: TRANSCRIPTION_MODEL.license,
      bytes: TRANSCRIPTION_MODEL.files.reduce((sum, file) => sum + file.bytes, 0),
      installed: this.installed(),
      speakers: { installed: this.speakersInstalled(), bytes: SPEAKER_MODEL.files.reduce((sum, file) => sum + file.bytes, 0), count: this.speakerCount() },
      state: this.install.state,
      progress: this.install.progress ? { ...this.install.progress } : null,
      ...(this.install.error ? { error: this.install.error } : {})
    };
  }

  /** Starts the download; the status reports the progress. */
  start(fetchImpl?: FetchLike): Promise<void> {
    if (this.install.state === "DOWNLOADING") throw new Error("TRANSCRIPTION_MODEL_INSTALL_IN_PROGRESS");
    this.install = { state: "DOWNLOADING", progress: null };
    const progress = (value: { file: string; received: number; total: number }) => {
      this.install.progress = { ...value, percent: Math.min(100, Math.floor((value.received / Math.max(1, value.total)) * 100)) };
    };
    // The transcription model when missing, then the speaker models when missing.
    const task = (async () => {
      if (!this.installed()) await installTranscriptionModel(this.dir, progress, TRANSCRIPTION_MODEL.files, fetchImpl);
      if (!this.speakersInstalled()) {
        await installTranscriptionModel(this.speakersDir, progress, SPEAKER_MODEL.files, fetchImpl, { id: SPEAKER_MODEL.id, revision: SEGMENTATION_REVISION, record: "speakers.json" });
      }
    })();
    return task.then(
      () => {
        this.install = { state: "IDLE", progress: null };
      },
      (error: unknown) => {
        this.install = { state: "FAILED", progress: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
      }
    );
  }

  remove(): void {
    if (this.install.state === "DOWNLOADING") throw new Error("TRANSCRIPTION_MODEL_INSTALL_IN_PROGRESS");
    fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

// --- Transcription ----------------------------------------------------------------------

// speaker: 1, 2, … in order of first appearance, when the speaker models ran.
export type TranscriptSegment = { start: number; end: number; text: string; speaker?: number };
export type Transcript = { duration: number; segments: TranscriptSegment[]; speakers?: number };

export type TranscribeOptions = { speakers?: number };

export interface RecordingTranscriber {
  available(): boolean;
  transcribe(data: Uint8Array, mediaType: RecordingMediaType, onProgress?: (seconds: number, total: number) => void, options?: TranscribeOptions): Promise<Transcript>;
}

function defaultWorkerPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ocr/whisper_worker.py");
}

/** "[01:02:03]" (hours only when the recording is that long). */
export function timestamp(seconds: number, long: boolean): string {
  const total = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return long ? `[${two(hh)}:${two(mm)}:${two(ss)}]` : `[${two(mm)}:${two(ss)}]`;
}

/** The label of a speaker in the transcript; the user may rename it in the transcript's editor. */
export function speakerLabel(speaker: number): string {
  return `Osoba ${speaker}`;
}

/** "[01:23] Osoba 1: tekst" (or "[01:23] tekst" without speakers): one line of the transcript. */
export function transcriptLine(segment: TranscriptSegment, long: boolean): string {
  return `${timestamp(segment.start, long)} ${segment.speaker ? `${speakerLabel(segment.speaker)}: ` : ""}${segment.text}`;
}

/**
 * The transcript as pages of the document: one page per `minutes` of the recording, each
 * segment on its own line with the time it starts, so a quotation can be found in the recording.
 */
export function transcriptPages(transcript: Transcript, minutes = 10): Array<{ page: number; text: string }> {
  const long = transcript.duration >= 3600;
  const span = minutes * 60;
  const pages = new Map<number, string[]>();
  for (const segment of transcript.segments) {
    const page = Math.floor(segment.start / span) + 1;
    const lines = pages.get(page) ?? [];
    lines.push(transcriptLine(segment, long));
    pages.set(page, lines);
  }
  const last = Math.max(1, Math.ceil(transcript.duration / span));
  return Array.from({ length: last }, (_, index) => ({ page: index + 1, text: (pages.get(index + 1) ?? []).join("\n") }));
}

export function transcriptionFailure(stderr: string, code: number | null): Error {
  if (/LEX_STT_MODEL_MISSING/u.test(stderr)) return new Error("TRANSCRIPTION_MODEL_MISSING");
  const decode = /LEX_STT_DECODE_FAILED:([^\n]*)/u.exec(stderr);
  if (decode) return new Error(`TRANSCRIPTION_DECODE_FAILED:${decode[1]!.slice(0, 200)}`);
  if (/No module named ['"]?(faster_whisper|av|ctranslate2)/u.test(stderr)) return new Error("TRANSCRIPTION_ENGINE_MISSING");
  return new Error(`TRANSCRIPTION_FAILED:${code ?? "signal"}:${stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`);
}

/** What the worker reports on its last stderr line: which device read and how long it took. */
export type TranscriptionRunStats = {
  device: "cpu" | "cuda";
  seconds: number;
  audioSeconds: number;
  cudaError?: string;
  at: string;
};

let lastRun: TranscriptionRunStats | null = null;

/** The last transcription on this computer (for the panel of local models). */
export function lastTranscriptionStats(): TranscriptionRunStats | null {
  return lastRun ? { ...lastRun } : null;
}

export function parseTranscriptionStats(stderr: string, now: Date = new Date()): TranscriptionRunStats | null {
  const line = stderr.split("\n").reverse().find((item) => item.startsWith("LEX_STT_STATS "));
  if (!line) return null;
  try {
    const raw = JSON.parse(line.slice("LEX_STT_STATS ".length)) as Record<string, unknown>;
    if ((raw.device !== "cpu" && raw.device !== "cuda") || typeof raw.seconds !== "number" || typeof raw.audioSeconds !== "number") return null;
    return {
      device: raw.device,
      seconds: raw.seconds,
      audioSeconds: raw.audioSeconds,
      ...(typeof raw.cudaError === "string" && raw.cudaError ? { cudaError: raw.cudaError.slice(0, 300) } : {}),
      at: now.toISOString()
    };
  } catch {
    return null;
  }
}

export class LocalWhisperTranscriber implements RecordingTranscriber {
  private readonly python: string;
  private readonly workerPath: string;
  private readonly timeoutMs: number;
  private readonly acceleration: () => Record<string, string> | null;
  private readonly speakersDir: () => string | null;
  private readonly speakerCount: () => number;

  constructor(
    private readonly modelDir: () => string,
    options: {
      python?: string;
      workerPath?: string;
      timeoutMs?: number;
      acceleration?: () => Record<string, string> | null;
      // The speaker models' folder when installed (null: a transcript without speakers).
      speakersDir?: () => string | null;
      // People speaking: 0 = estimated.
      speakerCount?: () => number;
    } = {}
  ) {
    this.python = options.python ?? process.env.LEX_OCR_PYTHON ?? "python3";
    this.workerPath = options.workerPath ?? process.env.LEX_STT_WORKER ?? defaultWorkerPath();
    // Hours of a hearing at about a third of real time; the limit only stops a hung worker.
    this.timeoutMs = options.timeoutMs ?? 6 * 60 * 60 * 1000;
    this.acceleration = options.acceleration ?? (() => null);
    this.speakersDir = options.speakersDir ?? (() => null);
    this.speakerCount = options.speakerCount ?? (() => 0);
  }

  available(): boolean {
    return installedTranscriptionModel(this.modelDir());
  }

  async transcribe(
    data: Uint8Array,
    mediaType: RecordingMediaType,
    onProgress?: (seconds: number, total: number) => void,
    options: TranscribeOptions = {}
  ): Promise<Transcript> {
    const { transcript, stats } = await this.run(data, mediaType, this.acceleration(), onProgress, options.speakers);
    if (stats) lastRun = stats;
    return transcript;
  }

  /** One reading for the processor-or-card measurement: the given environment, not the chosen one. */
  async benchmark(data: Uint8Array, mediaType: RecordingMediaType, env: Record<string, string> | null): Promise<{ seconds: number; text: string; device: "cpu" | "cuda"; cudaError?: string }> {
    const started = Date.now();
    const { transcript, stats } = await this.run(data, mediaType, env);
    return {
      seconds: stats?.seconds ?? (Date.now() - started) / 1000,
      text: transcript.segments.map((segment) => segment.text).join(" "),
      device: stats?.device ?? "cpu",
      ...(stats?.cudaError ? { cudaError: stats.cudaError } : {})
    };
  }

  private async run(
    data: Uint8Array,
    mediaType: RecordingMediaType,
    acceleration: Record<string, string> | null,
    onProgress?: (seconds: number, total: number) => void,
    speakerCount?: number
  ): Promise<{ transcript: Transcript; stats: TranscriptionRunStats | null }> {
    if (!this.available()) throw new Error("TRANSCRIPTION_MODEL_MISSING");
    const dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-"));
    try {
      const input = path.join(dir, `recording${RECORDING_MEDIA_TYPES[mediaType]}`);
      const output = path.join(dir, "transcript.json");
      await writeFile(input, data);
      const stderrAll = await new Promise<string>((resolve, reject) => {
        const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: "1", ...(acceleration ?? {}) };
        if (!acceleration) delete env.LEX_STT_DEVICE;
        const speakers = this.speakersDir();
        const args = [this.workerPath, "--input", input, "--output", output, "--model-dir", this.modelDir()];
        if (speakers) args.push("--diarize-dir", speakers, "--diarize-threshold", String(SPEAKER_MODEL.threshold), "--speakers", String(speakerCount ?? this.speakerCount()));
        const child = spawn(this.python, args, {
          stdio: ["ignore", "ignore", "pipe"],
          env
        });
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("TRANSCRIPTION_TIMEOUT"));
        }, this.timeoutMs);
        child.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString("utf8");
          for (const match of text.matchAll(/^LEX_STT_PROGRESS (\d+) (\d+)$/gmu)) onProgress?.(Number(match[1]), Number(match[2]));
          stderr = (stderr + text).slice(-32_000);
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(new Error(`TRANSCRIPTION_START_FAILED:${error.message}`));
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(stderr);
          else reject(transcriptionFailure(stderr, code));
        });
      });
      const raw = JSON.parse(await readFile(output, "utf8")) as { duration?: unknown; segments?: unknown; speakers?: unknown };
      const segments = Array.isArray(raw.segments)
        ? raw.segments.flatMap((item) => {
            const segment = item as Record<string, unknown>;
            return typeof segment.start === "number" && typeof segment.end === "number" && typeof segment.text === "string" && segment.text.trim()
              ? [
                  {
                    start: segment.start,
                    end: segment.end,
                    text: segment.text.trim(),
                    ...(typeof segment.speaker === "number" && Number.isInteger(segment.speaker) && segment.speaker > 0 ? { speaker: segment.speaker } : {})
                  }
                ]
              : [];
          })
        : [];
      return {
        transcript: {
          duration: typeof raw.duration === "number" ? raw.duration : 0,
          segments,
          ...(typeof raw.speakers === "number" && raw.speakers > 0 ? { speakers: raw.speakers } : {})
        },
        stats: parseTranscriptionStats(stderrAll)
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
