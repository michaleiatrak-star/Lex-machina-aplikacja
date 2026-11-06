import { spawn } from "node:child_process";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadVerified, sizeOf } from "./verified-download.js";
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
};
export function isRecordingMediaType(value) {
    return Object.prototype.hasOwnProperty.call(RECORDING_MEDIA_TYPES, value);
}
/** Media type of a recording by its file extension (a browser often sends none for .m4a, .mkv). */
export function recordingMediaTypeFor(filename) {
    const ext = path.extname(filename).toLowerCase();
    const byExt = {
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
    ].map((file) => ({ ...file, url: `${BASE}/${file.filename}` }))
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
    ]
};
// macOS on Apple Silicon: the same model (large-v3-turbo, MIT) converted to MLX for the GPU
// (whisper_worker.py --mlx-dir, mlx-whisper). Used only after a measurement on that Mac.
const MLX_REVISION = "a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb";
export const MLX_MODEL = {
    id: "whisper-large-v3-turbo-mlx",
    files: [
        {
            filename: "config.json",
            bytes: 268,
            sha256: "b34fc29e4e11e0a25e812775dd67f4dd16fc2c8eb43d28ae25ff7d660ecb6379",
            url: `https://huggingface.co/mlx-community/whisper-large-v3-turbo/resolve/${MLX_REVISION}/config.json`
        },
        {
            filename: "weights.safetensors",
            bytes: 1613977612,
            sha256: "951ed3fc1203e6a62467abb2144a96ce7eafca8fa77e3704fdb8635ff3e7f8a6",
            url: `https://huggingface.co/mlx-community/whisper-large-v3-turbo/resolve/${MLX_REVISION}/weights.safetensors`
        }
    ]
};
/** The Apple GPU model applies on macOS with Apple Silicon only. */
export function mlxTranscriptionSupported(platform = process.platform, arch = process.arch) {
    return platform === "darwin" && arch === "arm64";
}
/** The model folder holds every file of the pinned revision and the record written after the check. */
export function installedTranscriptionModel(dir, files = TRANSCRIPTION_MODEL.files, recordName = "transcription.json") {
    try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, recordName), "utf8"));
        return files.every((file) => record.files?.[file.filename] === file.sha256 && sizeOf(path.join(dir, file.filename)) === file.bytes);
    }
    catch {
        return false;
    }
}
/** Downloads the files into `dir`, each checked against its SHA-256 and size before it is kept. */
export async function installTranscriptionModel(dir, onProgress, files = TRANSCRIPTION_MODEL.files, fetchImpl = fetch, model = { id: TRANSCRIPTION_MODEL.id, revision: TRANSCRIPTION_MODEL.revision, record: "transcription.json" }) {
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
    dir;
    mlxSupported;
    install = { state: "IDLE", progress: null };
    constructor(dir, mlxSupported = mlxTranscriptionSupported()) {
        this.dir = dir;
        this.mlxSupported = mlxSupported;
    }
    /** The MLX copy of the model for the Apple GPU. */
    get mlxDir() {
        return path.join(this.dir, "mlx");
    }
    mlxInstalled() {
        return installedTranscriptionModel(this.mlxDir, MLX_MODEL.files, "mlx.json");
    }
    /** Every model this computer uses: the GPU copy counts only where it applies. */
    complete() {
        return this.installed() && this.speakersInstalled() && (!this.mlxSupported || this.mlxInstalled());
    }
    installed() {
        return installedTranscriptionModel(this.dir);
    }
    /** The speaker models (a folder of the transcription model's). */
    get speakersDir() {
        return path.join(this.dir, "speakers");
    }
    speakersInstalled() {
        return installedTranscriptionModel(this.speakersDir, SPEAKER_MODEL.files, "speakers.json");
    }
    /** People speaking in recordings as set by the administrator: 0 = estimated by the models. */
    speakerCount() {
        try {
            const value = Number(JSON.parse(fs.readFileSync(path.join(this.dir, "speakers-setting.json"), "utf8")).count);
            return Number.isInteger(value) && value >= 0 && value <= 12 && value !== 1 ? value : 0;
        }
        catch {
            return 0;
        }
    }
    setSpeakerCount(count) {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(path.join(this.dir, "speakers-setting.json"), JSON.stringify({ count }));
    }
    status() {
        return {
            modelId: TRANSCRIPTION_MODEL.id,
            label: TRANSCRIPTION_MODEL.displayName,
            license: TRANSCRIPTION_MODEL.license,
            bytes: TRANSCRIPTION_MODEL.files.reduce((sum, file) => sum + file.bytes, 0),
            installed: this.installed(),
            speakers: { installed: this.speakersInstalled(), bytes: SPEAKER_MODEL.files.reduce((sum, file) => sum + file.bytes, 0), count: this.speakerCount() },
            gpu: this.mlxSupported ? { installed: this.mlxInstalled(), bytes: MLX_MODEL.files.reduce((sum, file) => sum + file.bytes, 0) } : null,
            state: this.install.state,
            progress: this.install.progress ? { ...this.install.progress } : null,
            ...(this.install.error ? { error: this.install.error } : {})
        };
    }
    /** Starts the download; the status reports the progress. */
    start(fetchImpl) {
        if (this.install.state === "DOWNLOADING")
            throw new Error("TRANSCRIPTION_MODEL_INSTALL_IN_PROGRESS");
        this.install = { state: "DOWNLOADING", progress: null };
        const progress = (value) => {
            this.install.progress = { ...value, percent: Math.min(100, Math.floor((value.received / Math.max(1, value.total)) * 100)) };
        };
        // The transcription model when missing, then the speaker models when missing.
        const task = (async () => {
            if (!this.installed())
                await installTranscriptionModel(this.dir, progress, TRANSCRIPTION_MODEL.files, fetchImpl);
            if (!this.speakersInstalled()) {
                await installTranscriptionModel(this.speakersDir, progress, SPEAKER_MODEL.files, fetchImpl, { id: SPEAKER_MODEL.id, revision: SEGMENTATION_REVISION, record: "speakers.json" });
            }
            if (this.mlxSupported && !this.mlxInstalled()) {
                await installTranscriptionModel(this.mlxDir, progress, MLX_MODEL.files, fetchImpl, { id: MLX_MODEL.id, revision: MLX_REVISION, record: "mlx.json" });
            }
        })();
        return task.then(() => {
            this.install = { state: "IDLE", progress: null };
        }, (error) => {
            this.install = { state: "FAILED", progress: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
        });
    }
    remove() {
        if (this.install.state === "DOWNLOADING")
            throw new Error("TRANSCRIPTION_MODEL_INSTALL_IN_PROGRESS");
        fs.rmSync(this.dir, { recursive: true, force: true });
    }
}
function defaultWorkerPath() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ocr/whisper_worker.py");
}
/** "[01:02:03]" (hours only when the recording is that long). */
export function timestamp(seconds, long) {
    const total = Math.max(0, Math.floor(seconds));
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    const two = (value) => String(value).padStart(2, "0");
    return long ? `[${two(hh)}:${two(mm)}:${two(ss)}]` : `[${two(mm)}:${two(ss)}]`;
}
/** The label of a speaker in the transcript; the user may rename it in the transcript's editor. */
export function speakerLabel(speaker) {
    return `Osoba ${speaker}`;
}
/** "[01:23] Osoba 1: tekst" (or "[01:23] tekst" without speakers): one line of the transcript. */
export function transcriptLine(segment, long) {
    return `${timestamp(segment.start, long)} ${segment.speaker ? `${speakerLabel(segment.speaker)}: ` : ""}${segment.text}`;
}
/**
 * The transcript as pages of the document: one page per `minutes` of the recording, each
 * segment on its own line with the time it starts, so a quotation can be found in the recording.
 */
export function transcriptPages(transcript, minutes = 10) {
    const long = transcript.duration >= 3600;
    const span = minutes * 60;
    const pages = new Map();
    for (const segment of transcript.segments) {
        const page = Math.floor(segment.start / span) + 1;
        const lines = pages.get(page) ?? [];
        lines.push(transcriptLine(segment, long));
        pages.set(page, lines);
    }
    const last = Math.max(1, Math.ceil(transcript.duration / span));
    return Array.from({ length: last }, (_, index) => ({ page: index + 1, text: (pages.get(index + 1) ?? []).join("\n") }));
}
export function transcriptionFailure(stderr, code) {
    if (/LEX_STT_MODEL_MISSING/u.test(stderr))
        return new Error("TRANSCRIPTION_MODEL_MISSING");
    const decode = /LEX_STT_DECODE_FAILED:([^\n]*)/u.exec(stderr);
    if (decode)
        return new Error(`TRANSCRIPTION_DECODE_FAILED:${decode[1].slice(0, 200)}`);
    if (/No module named ['"]?(faster_whisper|av|ctranslate2)/u.test(stderr))
        return new Error("TRANSCRIPTION_ENGINE_MISSING");
    return new Error(`TRANSCRIPTION_FAILED:${code ?? "signal"}:${stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`);
}
let lastRun = null;
/** The last transcription on this computer (for the panel of local models). */
export function lastTranscriptionStats() {
    return lastRun ? { ...lastRun } : null;
}
export function parseTranscriptionStats(stderr, now = new Date()) {
    const line = stderr.split("\n").reverse().find((item) => item.startsWith("LEX_STT_STATS "));
    if (!line)
        return null;
    try {
        const raw = JSON.parse(line.slice("LEX_STT_STATS ".length));
        if ((raw.device !== "cpu" && raw.device !== "cuda") || typeof raw.seconds !== "number" || typeof raw.audioSeconds !== "number")
            return null;
        return {
            device: raw.device,
            seconds: raw.seconds,
            audioSeconds: raw.audioSeconds,
            ...(typeof raw.cudaError === "string" && raw.cudaError ? { cudaError: raw.cudaError.slice(0, 300) } : {}),
            at: now.toISOString()
        };
    }
    catch {
        return null;
    }
}
export class LocalWhisperTranscriber {
    modelDir;
    python;
    workerPath;
    timeoutMs;
    acceleration;
    speakersDir;
    speakerCount;
    mlxDir;
    constructor(modelDir, options = {}) {
        this.modelDir = modelDir;
        this.python = options.python ?? process.env.LEX_OCR_PYTHON ?? "python3";
        this.workerPath = options.workerPath ?? process.env.LEX_STT_WORKER ?? defaultWorkerPath();
        // Hours of a hearing at about a third of real time; the limit only stops a hung worker.
        this.timeoutMs = options.timeoutMs ?? 6 * 60 * 60 * 1000;
        this.acceleration = options.acceleration ?? (() => null);
        this.speakersDir = options.speakersDir ?? (() => null);
        this.speakerCount = options.speakerCount ?? (() => 0);
        this.mlxDir = options.mlxDir ?? (() => null);
    }
    available() {
        return installedTranscriptionModel(this.modelDir());
    }
    async transcribe(data, mediaType, onProgress, options = {}) {
        const { transcript, stats } = await this.run(data, mediaType, this.acceleration(), onProgress, options.speakers);
        if (stats)
            lastRun = stats;
        return transcript;
    }
    /** One reading for the processor-or-card measurement: the given environment, not the chosen one. */
    async benchmark(data, mediaType, env) {
        const started = Date.now();
        const { transcript, stats } = await this.run(data, mediaType, env);
        return {
            seconds: stats?.seconds ?? (Date.now() - started) / 1000,
            text: transcript.segments.map((segment) => segment.text).join(" "),
            device: stats?.device ?? "cpu",
            ...(stats?.cudaError ? { cudaError: stats.cudaError } : {})
        };
    }
    async run(data, mediaType, acceleration, onProgress, speakerCount) {
        if (!this.available())
            throw new Error("TRANSCRIPTION_MODEL_MISSING");
        const dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-"));
        try {
            const input = path.join(dir, `recording${RECORDING_MEDIA_TYPES[mediaType]}`);
            const output = path.join(dir, "transcript.json");
            await writeFile(input, data);
            const stderrAll = await new Promise((resolve, reject) => {
                const env = { ...process.env, PYTHONUNBUFFERED: "1", ...(acceleration ?? {}) };
                if (!acceleration)
                    delete env.LEX_STT_DEVICE;
                const speakers = this.speakersDir();
                const args = [this.workerPath, "--input", input, "--output", output, "--model-dir", this.modelDir()];
                if (speakers)
                    args.push("--diarize-dir", speakers, "--diarize-threshold", String(SPEAKER_MODEL.threshold), "--speakers", String(speakerCount ?? this.speakerCount()));
                const mlx = this.mlxDir();
                if (mlx)
                    args.push("--mlx-dir", mlx);
                const child = spawn(this.python, args, {
                    stdio: ["ignore", "ignore", "pipe"],
                    env
                });
                let stderr = "";
                const timer = setTimeout(() => {
                    child.kill("SIGKILL");
                    reject(new Error("TRANSCRIPTION_TIMEOUT"));
                }, this.timeoutMs);
                child.stderr.on("data", (chunk) => {
                    const text = chunk.toString("utf8");
                    for (const match of text.matchAll(/^LEX_STT_PROGRESS (\d+) (\d+)$/gmu))
                        onProgress?.(Number(match[1]), Number(match[2]));
                    stderr = (stderr + text).slice(-32_000);
                });
                child.once("error", (error) => {
                    clearTimeout(timer);
                    reject(new Error(`TRANSCRIPTION_START_FAILED:${error.message}`));
                });
                child.once("exit", (code) => {
                    clearTimeout(timer);
                    if (code === 0)
                        resolve(stderr);
                    else
                        reject(transcriptionFailure(stderr, code));
                });
            });
            const raw = JSON.parse(await readFile(output, "utf8"));
            const segments = Array.isArray(raw.segments)
                ? raw.segments.flatMap((item) => {
                    const segment = item;
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
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
}
