import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { documentWork } from "./document-work.js";
import { lastTranscriptionStats } from "./transcription.js";
import { CURRENT_APPLICATION_VERSION } from "./update-discovery.js";
import { downloadVerified } from "./verified-download.js";
/**
 * Transcription on an NVIDIA card (app/ocr/whisper_worker.py, LEX_STT_DEVICE=cuda). The
 * CTranslate2 wheel for Windows is built with CUDA 12 and ships the cuDNN 9.10.2 loader
 * (cudnn64_9.dll); what it loads besides (cuBLAS, the cuDNN sub-libraries of the same version,
 * NVRTC for cuDNN's runtime-compiled engines) comes from NVIDIA's wheels on PyPI, each checked
 * against its SHA-256, and only their DLLs are kept.
 *
 * As with OCR nothing is assumed about the card: the app transcribes the same recording both
 * ways once and uses the card only when it was faster and wrote the same words. AMD, Intel and
 * Apple cards are not supported by CTranslate2 (no DirectML or Metal build).
 */
export const CUDA_LIBRARIES = [
    {
        filename: "nvidia_cublas_cu12-12.6.4.1-py3-none-win_amd64.whl",
        url: "https://files.pythonhosted.org/packages/84/f7/985e9bdbe3e0ac9298fcc8cfa51a392862a46a0ffaccbbd56939b62a9c83/nvidia_cublas_cu12-12.6.4.1-py3-none-win_amd64.whl",
        bytes: 434535301,
        sha256: "9e4fa264f4d8a4eb0cdbd34beadc029f453b3bafae02401e999cf3d5a5af75f8"
    },
    {
        // The version of the cudnn64_9.dll loader inside the ctranslate2 4.8.5 wheel.
        filename: "nvidia_cudnn_cu12-9.10.2.21-py3-none-win_amd64.whl",
        url: "https://files.pythonhosted.org/packages/3d/90/0bd6e586701b3a890fd38aa71c387dab4883d619d6e5ad912ccbd05bfd67/nvidia_cudnn_cu12-9.10.2.21-py3-none-win_amd64.whl",
        bytes: 692992268,
        sha256: "c6288de7d63e6cf62988f0923f96dc339cea362decb1bf5b3141883392a7d65e"
    },
    {
        filename: "nvidia_cuda_nvrtc_cu12-12.6.85-py3-none-win_amd64.whl",
        url: "https://files.pythonhosted.org/packages/0c/f7/472414aee887d626373d0b2140a59ac4308e3eaed815060e5410fc83305a/nvidia_cuda_nvrtc_cu12-12.6.85-py3-none-win_amd64.whl",
        bytes: 39026436,
        sha256: "a419e2c95e75b88b602f8bb66f82a6c5651e8475a509841c958486b1b71510bf"
    }
];
// The card counts as faster when it takes at most this share of the processor's time.
export const STT_ACCEL_MIN_GAIN = 0.85;
// Share of the processor's words (in order) the card must write the same: float16 on the card
// and int8 on the processor may choose a different word now and then, never a different text.
export const STT_ACCEL_MIN_SAME_WORDS = 0.9;
function words(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/u)
        .filter(Boolean);
}
/** Words of the processor's text the card wrote too, in order (longest common subsequence). */
export function compareTranscripts(cpu, cuda) {
    const a = words(cpu);
    const b = words(cuda);
    let previous = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i += 1) {
        const current = new Array(b.length + 1).fill(0);
        for (let j = 1; j <= b.length; j += 1) {
            current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
        }
        previous = current;
    }
    return { words: Math.max(a.length, b.length), same: previous[b.length] };
}
export function judgeSttBenchmark(args) {
    const { words: total, same } = compareTranscripts(args.cpu.text, args.cuda.text);
    const sameText = total > 0 && same / total >= STT_ACCEL_MIN_SAME_WORDS;
    const faster = args.cuda.seconds <= args.cpu.seconds * STT_ACCEL_MIN_GAIN;
    const reason = args.cuda.device !== "cuda" ? "CUDA_NOT_USED" : !sameText ? "TEXT_DIFFERS" : !faster ? "NOT_FASTER" : "FASTER_SAME_TEXT";
    return {
        cpuSeconds: Math.round(args.cpu.seconds * 10) / 10,
        cudaSeconds: Math.round(args.cuda.seconds * 10) / 10,
        words: total,
        sameWords: same,
        accepted: reason === "FASTER_SAME_TEXT",
        reason,
        ...(args.cuda.error ? { cudaError: args.cuda.error.slice(0, 300) } : {}),
        measuredAt: (args.now ?? new Date()).toISOString()
    };
}
/** Windows x64 with the NVIDIA driver (its nvcuda.dll is what CTranslate2 talks to). */
export function nvidiaDriverPresent(platform = process.platform, arch = process.arch, systemRoot = process.env.SystemRoot ?? "C:\\Windows") {
    return platform === "win32" && arch === "x64" && fs.existsSync(path.join(systemRoot, "System32", "nvcuda.dll"));
}
function benchmarkFixture() {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../ocr/fixtures/stt-benchmark.opus");
}
/** The DLLs of a wheel's bin folder into `target` (flat), with the runtime's Python. */
function unpackDlls(python, wheel, target) {
    const script = [
        "import os, sys, zipfile",
        "z = zipfile.ZipFile(sys.argv[1])",
        "os.makedirs(sys.argv[2], exist_ok=True)",
        "for info in z.infolist():",
        "    name = info.filename.rsplit('/', 1)[-1]",
        "    if '/bin/' in info.filename and name.lower().endswith('.dll') and not name.lower().endswith('.alt.dll') and not name.lower().startswith('nvblas'):",
        "        with z.open(info) as src, open(os.path.join(sys.argv[2], name), 'wb') as dst:",
        "            while True:",
        "                chunk = src.read(1 << 20)",
        "                if not chunk: break",
        "                dst.write(chunk)"
    ].join("\n");
    return new Promise((resolve, reject) => {
        const child = spawn(python, ["-I", "-c", script, wheel, target], { stdio: ["ignore", "ignore", "pipe"] });
        let err = "";
        child.stderr.on("data", (chunk) => (err = (err + chunk.toString("utf8")).slice(-2000)));
        child.once("error", (error) => reject(new Error(`STT_ACCEL_UNPACK_FAILED:${error.message}`)));
        child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`STT_ACCEL_UNPACK_FAILED:${err.trim().split("\n").at(-1) ?? code}`))));
    });
}
export class TranscriptionAccelerationManager {
    dir;
    supported;
    job = { state: "IDLE", progress: null };
    python;
    fixture;
    reader = null;
    // Measured only where recordings are transcribed at all: with the speech model installed.
    modelInstalled = () => false;
    constructor(dir, options = {}) {
        this.dir = dir;
        this.supported = options.supported ?? nvidiaDriverPresent();
        this.python = options.python ?? process.env.LEX_OCR_PYTHON ?? "python3";
        this.fixture = options.fixture ?? benchmarkFixture();
        this.libraries = options.libraries ?? CUDA_LIBRARIES;
        this.unpack = options.unpack ?? ((wheel, target) => unpackDlls(this.python, wheel, target));
    }
    libraries;
    unpack;
    get libraryDir() {
        return path.join(this.dir, "cuda");
    }
    get recordPath() {
        return path.join(this.dir, "transcription-acceleration.json");
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
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(`${this.recordPath}.tmp`, `${JSON.stringify(content, null, 2)}\n`);
        fs.renameSync(`${this.recordPath}.tmp`, this.recordPath);
    }
    installed() {
        if (!this.supported)
            return false;
        const record = this.record();
        return (this.libraries.every((file) => record?.files?.[file.filename] === file.sha256) &&
            ["cublas64_12.dll", "cublasLt64_12.dll", "cudnn_ops64_9.dll", "cudnn_cnn64_9.dll"].every((name) => fs.existsSync(path.join(this.libraryDir, name))));
    }
    environmentFor() {
        return { LEX_STT_DEVICE: "cuda", LEX_STT_CUDA_DIR: this.libraryDir };
    }
    /** The worker environment while the card is on (installed and measured faster here). */
    environment() {
        if (!this.installed())
            return null;
        return this.record()?.benchmark?.accepted ? this.environmentFor() : null;
    }
    status() {
        const installed = this.installed();
        return {
            supported: this.supported,
            bytes: this.libraries.reduce((sum, file) => sum + file.bytes, 0),
            installed,
            active: this.environment() !== null,
            state: this.job.state,
            progress: this.job.progress ? { ...this.job.progress } : null,
            benchmark: installed ? (this.record()?.benchmark ?? null) : null,
            auto: this.autoEnabled,
            lastRun: lastTranscriptionStats(),
            ...(this.job.error ? { error: this.job.error } : {})
        };
    }
    busy() {
        return this.job.state === "DOWNLOADING" || this.job.state === "MEASURING";
    }
    fail(error) {
        this.job = { state: "FAILED", progress: null, error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) };
    }
    /** Downloads what is missing, then measures. The status reports the progress. */
    start(fetchImpl) {
        if (!this.supported)
            throw new Error("STT_ACCEL_UNSUPPORTED");
        if (this.busy())
            throw new Error("STT_ACCEL_IN_PROGRESS");
        this.job = { state: "DOWNLOADING", progress: null };
        return this.install(fetchImpl)
            .then(() => this.runMeasure())
            .then(() => {
            this.job = { state: "IDLE", progress: null };
        }, (error) => this.fail(error));
    }
    /** Measures again (after a driver or card change). */
    measure() {
        if (!this.installed())
            throw new Error("STT_ACCEL_NOT_INSTALLED");
        if (this.busy())
            throw new Error("STT_ACCEL_IN_PROGRESS");
        return this.runMeasure().then(() => {
            this.job = { state: "IDLE", progress: null };
        }, (error) => this.fail(error));
    }
    async install(fetchImpl) {
        if (this.installed())
            return;
        fs.mkdirSync(this.dir, { recursive: true });
        fs.rmSync(this.recordPath, { force: true });
        fs.rmSync(this.libraryDir, { recursive: true, force: true });
        const progress = (value) => {
            this.job.progress = { ...value, percent: Math.min(100, Math.floor((value.received / Math.max(1, value.total)) * 100)) };
        };
        // One wheel at a time: downloaded, checked, its DLLs kept, the wheel removed (about 1.2 GB
        // would otherwise sit on the disk twice).
        for (const file of this.libraries) {
            const wheel = path.join(this.dir, file.filename);
            await downloadVerified(file, wheel, "STT_ACCEL", progress, fetchImpl);
            try {
                await this.unpack(wheel, this.libraryDir);
            }
            finally {
                fs.rmSync(wheel, { force: true });
            }
        }
        this.writeRecord({
            schemaVersion: 1,
            installedAt: new Date().toISOString(),
            files: Object.fromEntries(this.libraries.map((file) => [file.filename, file.sha256]))
        });
    }
    async runMeasure() {
        if (!this.reader)
            throw new Error("STT_ACCEL_READER_MISSING");
        if (!this.modelInstalled())
            throw new Error("STT_ACCEL_MODEL_MISSING");
        const reader = this.reader;
        this.job = { state: "MEASURING", progress: null };
        const data = new Uint8Array(fs.readFileSync(this.fixture));
        // Background work, like the OCR measurement: the user's own work started meanwhile skews
        // the times, so that measurement does not count.
        const benchmark = await documentWork.background(async () => {
            const before = documentWork.foregroundStarts;
            const cpu = await reader(data, null);
            const cuda = await reader(data, this.environmentFor());
            if (documentWork.foregroundStarts !== before)
                throw new Error("STT_ACCEL_MEASURE_INTERRUPTED");
            return judgeSttBenchmark({ cpu, cuda: { seconds: cuda.seconds, text: cuda.text, device: cuda.device, ...(cuda.cudaError ? { error: cuda.cudaError } : {}) } });
        });
        this.writeRecord({ ...(this.record() ?? {}), benchmark: { ...benchmark, appVersion: CURRENT_APPLICATION_VERSION } });
    }
    get autoEnabled() {
        return this.supported && process.env.LEX_STT_ACCEL_AUTO !== "off";
    }
    get autoPath() {
        return path.join(this.dir, "auto.json");
    }
    /**
     * Nothing to set by hand: on a computer with an NVIDIA card and the speech model, the NVIDIA
     * libraries are downloaded, both ways are measured once and the faster one with the same
     * text stays. Only a failed attempt is tried again: a day later, an hour later when the
     * measurement was interrupted by the user's work.
     */
    async autoSetup(fetchImpl, now = new Date()) {
        if (!this.autoEnabled || this.busy() || !this.modelInstalled())
            return "SKIPPED";
        if (this.installed() && this.record()?.benchmark)
            return "SKIPPED";
        let last = {};
        try {
            last = JSON.parse(fs.readFileSync(this.autoPath, "utf8"));
        }
        catch {
            last = {};
        }
        if (last.failedAt) {
            const wait = last.error?.startsWith("STT_ACCEL_MEASURE_INTERRUPTED") ? 60 * 60_000 : 24 * 60 * 60_000;
            if (now.getTime() - Date.parse(last.failedAt) < wait)
                return "SKIPPED";
        }
        await (this.installed() ? this.measure() : this.start(fetchImpl));
        if (this.job.state === "FAILED") {
            fs.mkdirSync(this.dir, { recursive: true });
            fs.writeFileSync(this.autoPath, JSON.stringify({ failedAt: now.toISOString(), error: this.job.error ?? "" }));
            return "FAILED";
        }
        fs.rmSync(this.autoPath, { force: true });
        return "DONE";
    }
    remove() {
        if (this.busy())
            throw new Error("STT_ACCEL_IN_PROGRESS");
        fs.rmSync(this.dir, { recursive: true, force: true });
        this.job = { state: "IDLE", progress: null };
    }
}
