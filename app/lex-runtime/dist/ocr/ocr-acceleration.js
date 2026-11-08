import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { documentWork } from "../document-work.js";
import { CURRENT_APPLICATION_VERSION } from "../update-discovery.js";
import { lastOcrRunStats } from "./paddle-ocr-engine.js";
import { downloadVerified, sizeOf } from "../verified-download.js";
// Converted by .github/workflows/ocr-onnx-models.yml (paddle2onnx 2.1.0, opset 14, the
// official PaddleX models the installer downloads); the conversion is deterministic.
const MODELS_RELEASE = "https://github.com/michaleiatrak-star/lex-machina-aplikacja/releases/download/ocr-onnx-v1";
export const OCR_ACCEL_MODELS = [
    { filename: "PP-OCRv6_medium_det.onnx", bytes: 62119542, sha256: "363bff8850064024234760b29543d113354221aa336327e107f2530f263f5b09" },
    { filename: "PP-OCRv6_medium_rec.onnx", bytes: 76555610, sha256: "d586cb851b35391d1dda84ff6ff387752ba25ec1ad79a9ad7ea60b1e44765c1b" },
    { filename: "latin_PP-OCRv5_mobile_rec.onnx", bytes: 8064539, sha256: "995b0f5f28d2073896a78c03b5b863eae6af3744bafa0245b8522beea6994927" },
    { filename: "PP-LCNet_x1_0_doc_ori.onnx", bytes: 6783057, sha256: "881d7103e2fafdeaaa9e949504025591b021a84b7373db1e27bb42e9180ed7d0" }
].map((file) => ({ ...file, url: `${MODELS_RELEASE}/${file.filename}` }));
// Windows: the DirectML build of ONNX Runtime, unpacked into its own folder (the CPU build the
// transcription uses stays installed; both are the "onnxruntime" module).
export const DIRECTML_RUNTIME = {
    filename: "onnxruntime_directml-1.24.4-cp313-cp313-win_amd64.whl",
    url: "https://files.pythonhosted.org/packages/60/53/2bd2696fac19cf8ca55496a0bcfe431f3aff9579eabbb0e231dc238acf6f/onnxruntime_directml-1.24.4-cp313-cp313-win_amd64.whl",
    bytes: 25112253,
    sha256: "2f1031cb2281e5b27cca9efe0b9399317c7286e4d226f7a79d4ab79bbd94d19e"
};
// The card counts as faster when it takes at most this share of the processor's time.
export const OCR_ACCEL_MIN_GAIN = 0.85;
// Lines (whitespace ignored) that must read the same as on the processor.
export const OCR_ACCEL_MIN_SAME_LINES = 0.95;
// Worker processes sharing one card.
export const OCR_ACCEL_MAX_WORKERS = 3;
// A CoreML worker also keeps the ONNX CPU detector and the Paddle fallback.
// Avoid multiplying memory and competing for the same GPU on long documents.
export const OCR_COREML_MAX_WORKERS = 1;
export const OCR_COREML_ENGINE_REVISION = "onnx-cpu-detection-mlprogram-recognition-v3";
const BENCHMARK_PAGES = [1, 2, 3, 4];
export function ocrAccelProvider(platform = process.platform, arch = process.arch) {
    if (platform === "win32" && arch === "x64")
        return "dml";
    // The macOS build of ONNX Runtime with CoreML is installed for Apple Silicon only.
    if (platform === "darwin" && arch === "arm64")
        return "coreml";
    return null;
}
/** Line by line, whitespace ignored (the card may set a space differently, never a letter). */
export function compareReadings(cpu, accel) {
    const split = (pages) => pages.join("\n").split("\n").map((line) => line.replace(/\s+/gu, "")).filter(Boolean);
    const a = split(cpu);
    const b = split(accel);
    const lines = Math.max(a.length, b.length);
    let same = 0;
    for (let index = 0; index < Math.min(a.length, b.length); index += 1)
        if (a[index] === b[index])
            same += 1;
    return { lines, same };
}
export function judgeBenchmark(args) {
    const { lines, same } = compareReadings(args.cpu.pages, args.accel.pages);
    const sameText = lines > 0 && same / lines >= OCR_ACCEL_MIN_SAME_LINES;
    const faster = args.accel.seconds <= args.cpu.seconds * OCR_ACCEL_MIN_GAIN;
    const reason = !args.accel.used ? "ACCEL_NOT_USED" : !sameText ? "TEXT_DIFFERS" : !faster ? "NOT_FASTER" : "FASTER_SAME_TEXT";
    return {
        provider: args.provider,
        cpuSeconds: Math.round(args.cpu.seconds * 10) / 10,
        accelSeconds: Math.round(args.accel.seconds * 10) / 10,
        lines,
        sameLines: same,
        accepted: reason === "FASTER_SAME_TEXT",
        reason,
        measuredAt: (args.now ?? new Date()).toISOString()
    };
}
function benchmarkFixture() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../ocr/fixtures/ocr-benchmark.pdf");
}
/** Unpacks a wheel (a ZIP) with the runtime's Python into `target`. */
function unpackWheel(python, wheel, target) {
    return new Promise((resolve, reject) => {
        const child = spawn(python, ["-I", "-c", "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", wheel, target], {
            stdio: ["ignore", "ignore", "pipe"]
        });
        let err = "";
        child.stderr.on("data", (chunk) => (err = (err + chunk.toString("utf8")).slice(-2000)));
        child.once("error", (error) => reject(new Error(`OCR_ACCEL_UNPACK_FAILED:${error.message}`)));
        child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`OCR_ACCEL_UNPACK_FAILED:${err.trim().split("\n").at(-1) ?? code}`))));
    });
}
export class OcrAccelerationManager {
    dir;
    provider;
    job = { state: "IDLE", progress: null };
    python;
    fixture;
    reader = null;
    constructor(dir, options = {}) {
        this.dir = dir;
        this.provider = ocrAccelProvider(options.platform, options.arch);
        this.python = options.python ?? process.env.LEX_OCR_PYTHON ?? "python3";
        this.fixture = options.fixture ?? benchmarkFixture();
    }
    get modelDir() {
        return path.join(this.dir, "models");
    }
    get runtimeDir() {
        return path.join(this.dir, "onnxruntime-directml");
    }
    get recordPath() {
        return path.join(this.dir, "ocr-acceleration.json");
    }
    files() {
        return this.provider === "dml" ? [...OCR_ACCEL_MODELS, DIRECTML_RUNTIME] : [...OCR_ACCEL_MODELS];
    }
    record() {
        try {
            return JSON.parse(fs.readFileSync(this.recordPath, "utf8"));
        }
        catch {
            return null;
        }
    }
    writeRecord(content) {
        fs.writeFileSync(`${this.recordPath}.tmp`, `${JSON.stringify(content, null, 2)}\n`);
        fs.renameSync(`${this.recordPath}.tmp`, this.recordPath);
    }
    installed() {
        if (!this.provider)
            return false;
        const record = this.record();
        const models = OCR_ACCEL_MODELS.every((file) => record?.files?.[file.filename] === file.sha256 && sizeOf(path.join(this.modelDir, file.filename)) === file.bytes);
        const runtime = this.provider !== "dml" ||
            (record?.files?.[DIRECTML_RUNTIME.filename] === DIRECTML_RUNTIME.sha256 && fs.existsSync(path.join(this.runtimeDir, "onnxruntime", "__init__.py")));
        return models && runtime;
    }
    environmentFor() {
        return {
            env: {
                LEX_OCR_ACCEL: this.provider,
                LEX_OCR_ONNX_DIR: this.modelDir,
                ...(this.provider === "dml" ? { LEX_OCR_ORT_DIR: this.runtimeDir } : {})
            },
            maxWorkers: this.provider === "coreml" ? OCR_COREML_MAX_WORKERS : OCR_ACCEL_MAX_WORKERS
        };
    }
    currentBenchmark(benchmark) {
        return benchmark?.provider === this.provider &&
            (this.provider !== "coreml" || benchmark.engineRevision === OCR_COREML_ENGINE_REVISION);
    }
    /** The worker environment while the card is on (installed and measured faster here). */
    environment() {
        if (!this.installed())
            return null;
        const benchmark = this.record()?.benchmark;
        return benchmark?.accepted && this.currentBenchmark(benchmark) ? this.environmentFor() : null;
    }
    status() {
        const installed = this.installed();
        return {
            supported: this.provider !== null,
            provider: this.provider,
            bytes: this.files().reduce((sum, file) => sum + file.bytes, 0),
            installed,
            active: this.environment() !== null,
            state: this.job.state,
            progress: this.job.progress ? { ...this.job.progress } : null,
            benchmark: installed ? (this.record()?.benchmark ?? null) : null,
            auto: this.autoEnabled,
            lastRun: lastOcrRunStats(),
            ...(this.job.error ? { error: this.job.error } : {})
        };
    }
    busy() {
        return this.job.state === "DOWNLOADING" || this.job.state === "MEASURING";
    }
    /** Downloads what is missing, then measures. The status reports the progress. */
    start(fetchImpl) {
        if (!this.provider)
            throw new Error("OCR_ACCEL_UNSUPPORTED");
        if (this.busy())
            throw new Error("OCR_ACCEL_IN_PROGRESS");
        this.job = { state: "DOWNLOADING", progress: null };
        return this.install(fetchImpl)
            .then(() => this.runMeasure())
            .then(() => {
            this.job = { state: "IDLE", progress: null };
        }, (error) => {
            this.job = { state: "FAILED", progress: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
        });
    }
    /** Measures again (after a driver or card change). */
    measure() {
        if (!this.installed())
            throw new Error("OCR_ACCEL_NOT_INSTALLED");
        if (this.busy())
            throw new Error("OCR_ACCEL_IN_PROGRESS");
        return this.runMeasure().then(() => {
            this.job = { state: "IDLE", progress: null };
        }, (error) => {
            this.job = { state: "FAILED", progress: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
        });
    }
    async install(fetchImpl) {
        if (this.installed())
            return;
        fs.mkdirSync(this.modelDir, { recursive: true });
        fs.rmSync(this.recordPath, { force: true });
        const progress = (value) => {
            this.job.progress = { ...value, percent: Math.min(100, Math.floor((value.received / Math.max(1, value.total)) * 100)) };
        };
        for (const file of OCR_ACCEL_MODELS) {
            await downloadVerified(file, path.join(this.modelDir, file.filename), "OCR_ACCEL", progress, fetchImpl);
        }
        if (this.provider === "dml") {
            const wheel = path.join(this.dir, DIRECTML_RUNTIME.filename);
            await downloadVerified(DIRECTML_RUNTIME, wheel, "OCR_ACCEL", progress, fetchImpl);
            fs.rmSync(this.runtimeDir, { recursive: true, force: true });
            await unpackWheel(this.python, wheel, this.runtimeDir);
            fs.rmSync(wheel, { force: true });
        }
        this.writeRecord({
            schemaVersion: 1,
            provider: this.provider,
            installedAt: new Date().toISOString(),
            files: Object.fromEntries(this.files().map((file) => [file.filename, file.sha256]))
        });
    }
    async runMeasure() {
        if (!this.reader)
            throw new Error("OCR_ACCEL_READER_MISSING");
        const reader = this.reader;
        this.job = { state: "MEASURING", progress: null };
        const data = new Uint8Array(fs.readFileSync(this.fixture));
        // Background work: it waits while the user's own document work runs; work of the user
        // started during the measurement skews the times, so that measurement does not count.
        const benchmark = await documentWork.background(async () => {
            const before = documentWork.foregroundStarts;
            const cpu = await reader(data, BENCHMARK_PAGES, null);
            const accel = await reader(data, BENCHMARK_PAGES, this.environmentFor());
            if (documentWork.foregroundStarts !== before)
                throw new Error("OCR_ACCEL_MEASURE_INTERRUPTED");
            return judgeBenchmark({ provider: this.provider, cpu, accel });
        });
        this.writeRecord({ ...(this.record() ?? {}), benchmark: {
                ...benchmark,
                appVersion: CURRENT_APPLICATION_VERSION,
                ...(this.provider === "coreml" ? { engineRevision: OCR_COREML_ENGINE_REVISION } : {})
            } });
    }
    get autoEnabled() {
        return this.provider !== null && process.env.LEX_OCR_ACCEL_AUTO !== "off";
    }
    get autoPath() {
        return path.join(this.dir, "auto.json");
    }
    /**
     * Nothing to set by hand: on a computer with a card the app can use, the models are
     * downloaded, both ways are measured once and the faster one with the same text is used
     * from then on. Only a failed attempt is tried again: a day later (no network), an hour later
     * (measurement interrupted by the user's work).
     */
    async autoSetup(fetchImpl, now = new Date()) {
        if (!this.autoEnabled || this.busy())
            return "SKIPPED";
        const benchmark = this.installed() ? this.record()?.benchmark : undefined;
        // Once measured, the choice stays: no further measurement (the "Zmierz ponownie" button
        // remains for an administrator after a new card).
        if (this.currentBenchmark(benchmark))
            return "SKIPPED";
        let last = {};
        try {
            last = JSON.parse(fs.readFileSync(this.autoPath, "utf8"));
        }
        catch {
            last = {};
        }
        if (last.failedAt && (this.provider !== "coreml" || last.engineRevision === OCR_COREML_ENGINE_REVISION)) {
            const wait = last.error?.startsWith("OCR_ACCEL_MEASURE_INTERRUPTED") ? 60 * 60_000 : 24 * 60 * 60_000;
            if (now.getTime() - Date.parse(last.failedAt) < wait)
                return "SKIPPED";
        }
        await (this.installed() ? this.measure() : this.start(fetchImpl));
        if (this.job.state === "FAILED") {
            fs.mkdirSync(this.dir, { recursive: true });
            fs.writeFileSync(this.autoPath, JSON.stringify({
                failedAt: now.toISOString(), error: this.job.error ?? "",
                ...(this.provider === "coreml" ? { engineRevision: OCR_COREML_ENGINE_REVISION } : {})
            }));
            return "FAILED";
        }
        fs.rmSync(this.autoPath, { force: true });
        return "DONE";
    }
    remove() {
        if (this.busy())
            throw new Error("OCR_ACCEL_IN_PROGRESS");
        fs.rmSync(this.dir, { recursive: true, force: true });
        this.job = { state: "IDLE", progress: null };
    }
}
