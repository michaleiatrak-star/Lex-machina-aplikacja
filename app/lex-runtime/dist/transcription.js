import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
function sizeOf(file) {
    try {
        return fs.statSync(file).size;
    }
    catch {
        return -1;
    }
}
/** The model folder holds every file of the pinned revision and the record written after the check. */
export function installedTranscriptionModel(dir, files = TRANSCRIPTION_MODEL.files) {
    try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, "transcription.json"), "utf8"));
        return files.every((file) => record.files?.[file.filename] === file.sha256 && sizeOf(path.join(dir, file.filename)) === file.bytes);
    }
    catch {
        return false;
    }
}
/** Downloads the files into `dir`, each checked against its SHA-256 and size before it is kept. */
export async function installTranscriptionModel(dir, onProgress, files = TRANSCRIPTION_MODEL.files, fetchImpl = fetch) {
    fs.mkdirSync(dir, { recursive: true });
    const record = path.join(dir, "transcription.json");
    fs.rmSync(record, { force: true });
    for (const file of files) {
        const target = path.join(dir, file.filename);
        if (sizeOf(target) === file.bytes) {
            const hash = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
            if (hash === file.sha256)
                continue;
        }
        const partial = `${target}.part`;
        const response = await fetchImpl(file.url);
        if (!response.ok || !response.body)
            throw new Error(`TRANSCRIPTION_MODEL_DOWNLOAD_FAILED:${file.filename}:${response.status}`);
        const hash = createHash("sha256");
        const out = fs.createWriteStream(partial);
        let received = 0;
        try {
            for await (const chunk of response.body) {
                hash.update(chunk);
                received += chunk.length;
                if (!out.write(chunk))
                    await new Promise((resolve) => out.once("drain", () => resolve()));
                onProgress?.({ file: file.filename, received, total: file.bytes });
            }
        }
        finally {
            await new Promise((resolve) => out.end(() => resolve()));
        }
        if (hash.digest("hex") !== file.sha256 || received !== file.bytes) {
            fs.rmSync(partial, { force: true });
            throw new Error(`TRANSCRIPTION_MODEL_CHECKSUM_MISMATCH:${file.filename}`);
        }
        fs.renameSync(partial, target);
    }
    const content = {
        schemaVersion: 1,
        id: TRANSCRIPTION_MODEL.id,
        revision: TRANSCRIPTION_MODEL.revision,
        installedAt: new Date().toISOString(),
        files: Object.fromEntries(files.map((file) => [file.filename, file.sha256]))
    };
    fs.writeFileSync(`${record}.tmp`, `${JSON.stringify(content, null, 2)}\n`);
    fs.renameSync(`${record}.tmp`, record);
}
/** The model folder with its install state, for the panel of local models. */
export class TranscriptionModelManager {
    dir;
    install = { state: "IDLE", progress: null };
    constructor(dir) {
        this.dir = dir;
    }
    installed() {
        return installedTranscriptionModel(this.dir);
    }
    status() {
        return {
            modelId: TRANSCRIPTION_MODEL.id,
            label: TRANSCRIPTION_MODEL.displayName,
            license: TRANSCRIPTION_MODEL.license,
            bytes: TRANSCRIPTION_MODEL.files.reduce((sum, file) => sum + file.bytes, 0),
            installed: this.installed(),
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
        const task = installTranscriptionModel(this.dir, (progress) => {
            this.install.progress = { ...progress, percent: Math.min(100, Math.floor((progress.received / Math.max(1, progress.total)) * 100)) };
        }, TRANSCRIPTION_MODEL.files, fetchImpl);
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
        lines.push(`${timestamp(segment.start, long)} ${segment.text}`);
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
export class LocalWhisperTranscriber {
    modelDir;
    python;
    workerPath;
    timeoutMs;
    constructor(modelDir, options = {}) {
        this.modelDir = modelDir;
        this.python = options.python ?? process.env.LEX_OCR_PYTHON ?? "python3";
        this.workerPath = options.workerPath ?? process.env.LEX_STT_WORKER ?? defaultWorkerPath();
        // Hours of a hearing at about a third of real time; the limit only stops a hung worker.
        this.timeoutMs = options.timeoutMs ?? 6 * 60 * 60 * 1000;
    }
    available() {
        return installedTranscriptionModel(this.modelDir());
    }
    async transcribe(data, mediaType, onProgress) {
        if (!this.available())
            throw new Error("TRANSCRIPTION_MODEL_MISSING");
        const dir = await mkdtemp(path.join(os.tmpdir(), "lex-stt-"));
        try {
            const input = path.join(dir, `recording${RECORDING_MEDIA_TYPES[mediaType]}`);
            const output = path.join(dir, "transcript.json");
            await writeFile(input, data);
            await new Promise((resolve, reject) => {
                const child = spawn(this.python, [this.workerPath, "--input", input, "--output", output, "--model-dir", this.modelDir()], {
                    stdio: ["ignore", "ignore", "pipe"],
                    env: { ...process.env, PYTHONUNBUFFERED: "1" }
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
                        resolve();
                    else
                        reject(transcriptionFailure(stderr, code));
                });
            });
            const raw = JSON.parse(await readFile(output, "utf8"));
            const segments = Array.isArray(raw.segments)
                ? raw.segments.flatMap((item) => {
                    const segment = item;
                    return typeof segment.start === "number" && typeof segment.end === "number" && typeof segment.text === "string" && segment.text.trim()
                        ? [{ start: segment.start, end: segment.end, text: segment.text.trim() }]
                        : [];
                })
                : [];
            return { duration: typeof raw.duration === "number" ? raw.duration : 0, segments };
        }
        finally {
            await rm(dir, { recursive: true, force: true });
        }
    }
}
