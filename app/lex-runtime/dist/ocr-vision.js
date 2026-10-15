import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
// Handwriting, stamps and signatures: manual review, never the model.
const HANDWRITING_SCORE = 0.85;
// A line read with less confidence than this is read again.
const DOUBT_SCORE = 0.95;
const WORD = /\p{L}{2,}/gu;
const CHECKED_WORD = /\p{L}{3,}/gu;
function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const current = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
            previous = current;
        }
    }
    return row[b.length];
}
/** Runs of differing words: [from start, from end, to start, to end]. */
function differences(a, b) {
    const common = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
        }
    }
    const runs = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            i += 1;
            j += 1;
            continue;
        }
        const [i0, j0] = [i, j];
        while ((i < a.length || j < b.length) && !(i < a.length && j < b.length && a[i] === b[j])) {
            if (j < b.length && (i >= a.length || common[i][j + 1] >= common[i + 1][j]))
                j += 1;
            else
                i += 1;
        }
        runs.push([i0, i, j0, j]);
    }
    return runs;
}
const bare = (text) => text.replace(/\s+/gu, "");
const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[łŁ]/gu, "l");
const marks = (text) => [...text].filter((letter) => plain(letter) !== letter).length;
const digits = (text) => text.replace(/\D/gu, "");
const EDGES = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;
const core = (text) => EDGES.exec(text)[2];
/**
 * Punctuation at the edges stays as the OCR read it ("pracodawey," -> "pracodawcy,", not
 * "pracodawcy."); the model may only add a closing mark where the OCR read none
 * ("nięuprawnipn" -> "nieuprawnione.").
 */
function keepEdges(was, read) {
    const [, leadWas, , trailWas] = EDGES.exec(was);
    const [, , core, trailRead] = EDGES.exec(read);
    const trail = trailWas || (/^[.,;:]$/u.test(trailRead) ? trailRead : "");
    return `${leadWas}${core}${trail}`;
}
/**
 * The line with the changes the arbiter takes from the model's reading. `known` holds the
 * dictionary words among the words of both readings.
 */
export function arbitrateLine(ocrText, visionText, known) {
    const vision = visionText.replace(/\s+/gu, " ").trim();
    // A reading of another line, or made up: nothing is taken.
    if (!vision || editDistance(ocrText, vision) > Math.max(4, 0.5 * ocrText.length))
        return { text: ocrText, fixes: [] };
    const from = ocrText.split(/\s+/u).filter(Boolean);
    const to = vision.split(/\s+/u).filter(Boolean);
    const allKnown = (text) => (text.match(WORD) ?? []).every((word) => known.has(word));
    const anyUnknown = (text) => (text.match(WORD) ?? []).some((word) => !known.has(word));
    const result = [...from];
    const fixes = [];
    let shift = 0;
    for (const [i0, i1, j0, j1] of differences(from, to)) {
        const was = from.slice(i0, i1).join(" ");
        const read = to.slice(j0, j1).join(" ");
        if (!was || !read)
            continue;
        let take = false;
        if (/\d/u.test(was + read)) {
            take = digits(was) === digits(read) && (bare(was) === bare(read) || /^\d{1,2}\.\d{1,2}\.\d{4}$/u.test(read));
        }
        else if (bare(core(was)) === bare(core(read))) {
            take = allKnown(read);
        }
        else if (plain(core(was)) === plain(core(read))) {
            take = marks(read) > marks(was) && allKnown(read);
        }
        else {
            take =
                anyUnknown(was) &&
                    allKnown(read) &&
                    editDistance(was.toLocaleLowerCase("pl"), read.toLocaleLowerCase("pl")) <= Math.max(2, Math.ceil(0.34 * was.length));
        }
        if (!take)
            continue;
        const taken = keepEdges(was, read);
        if (taken === was)
            continue;
        const words = taken.split(" ");
        result.splice(i0 + shift, i1 - i0, ...words);
        shift += words.length - (i1 - i0);
        fixes.push({ from: was, to: taken });
    }
    return fixes.length ? { text: result.join(" "), fixes } : { text: ocrText, fixes: [] };
}
/** Lines worth reading again: read with doubt, or with a word the dictionary does not know. */
export function doubtfulLines(lines, known) {
    return lines.flatMap((line, index) => {
        const score = typeof line.score === "number" ? line.score : 1;
        if (!line.crop || score < HANDWRITING_SCORE)
            return [];
        const unknown = (line.text.match(CHECKED_WORD) ?? []).some((word) => !known.has(word));
        return score < DOUBT_SCORE || unknown ? [index] : [];
    });
}
/** OCR pages with the doubtful lines read again (original words kept in page.corrections). */
export async function correctWithVision(pages, readLine, knownWords, onProgress) {
    const ocrPages = pages.filter((page) => page.source === "OCR" && page.lines?.some((line) => line.crop));
    if (!ocrPages.length)
        return [...pages];
    const vocabulary = [...new Set(ocrPages.flatMap((page) => page.lines.flatMap((line) => line.text.match(WORD) ?? [])))];
    const flags = await knownWords(vocabulary);
    const known = new Set(vocabulary.filter((_, index) => flags[index]));
    const todo = ocrPages.map((page) => ({ page, lines: doubtfulLines(page.lines, known) }));
    const total = todo.reduce((sum, item) => sum + item.lines.length, 0);
    const readings = new Map();
    let done = 0;
    onProgress?.(0, total);
    for (const { page, lines } of todo) {
        const read = new Map();
        for (const index of lines) {
            const line = page.lines[index];
            read.set(index, await readLine(line.crop, line.text));
            done += 1;
            onProgress?.(done, total);
        }
        readings.set(page, read);
    }
    // Words of the model's readings checked against the dictionary in one call.
    const newWords = [
        ...new Set([...readings.values()].flatMap((read) => [...read.values()].flatMap((text) => text.match(WORD) ?? [])))
    ].filter((word) => !vocabulary.includes(word));
    const newFlags = newWords.length ? await knownWords(newWords) : [];
    newWords.forEach((word, index) => newFlags[index] && known.add(word));
    return pages.map((page) => {
        const read = readings.get(page);
        if (!read?.size)
            return page;
        const corrections = [...(page.corrections ?? [])];
        const lines = page.lines.map((line, index) => {
            const vision = read.get(index);
            if (vision === undefined)
                return line;
            const decided = arbitrateLine(line.text, vision, known);
            corrections.push(...decided.fixes.map((fix) => ({ line: index, ...fix })));
            return decided.text === line.text ? line : { ...line, text: decided.text };
        });
        if (corrections.length === (page.corrections ?? []).length)
            return page;
        return { ...page, lines, text: lines.map((line) => line.text).join("\n"), corrections };
    });
}
/** The page without line images: they live only for the vision step, never stored. */
export function withoutLineCrops(page) {
    if (!page.lines?.some((line) => line.crop))
        return page;
    return { ...page, lines: page.lines.map(({ crop: _crop, ...line }) => line) };
}
// --- the model files and the llama.cpp server ---
export const VISION_MODEL_FILES = [
    {
        name: "Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf",
        url: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf?download=true",
        sha256: "d02fe9b69ad8cadbbd228e387667af66612c44bed29ffc8eb1e7caf9ac486c12",
        bytes: 1929901056
    },
    {
        name: "mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf",
        url: "https://huggingface.co/ggml-org/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf?download=true",
        sha256: "980c9b2f78c04e6cff93d277ada09e768394f112d75db3b4e9dea8a69f9fb904",
        bytes: 844757728
    }
];
export const VISION_MODEL_LABEL = "Qwen2.5-VL 3B (odczyt wątpliwych linii OCR)";
// The model needs about 3.3 GB while it runs. Started only for the document and only with this
// much free memory: next to a running Bielik (about 7 GB) and the OCR worker (about 3.6 GB)
// a 16 GB machine runs out, and the system kills processes.
const MIN_FREE_BYTES = Number(process.env.LEX_OCR_VISION_MIN_FREE_MB ?? 4096) * 1024 * 1024;
export function enoughMemoryForVision(free = os.freemem()) {
    return free >= MIN_FREE_BYTES;
}
export function visionModelInstalled(dir) {
    return VISION_MODEL_FILES.every((file) => {
        try {
            return fs.statSync(path.join(dir, file.name)).size === file.bytes;
        }
        catch {
            return false;
        }
    });
}
/** Downloads the two model files into `dir`, each checked against its SHA-256. */
export async function installVisionModel(dir, onProgress) {
    fs.mkdirSync(dir, { recursive: true });
    for (const file of VISION_MODEL_FILES) {
        const target = path.join(dir, file.name);
        try {
            if (fs.statSync(target).size === file.bytes)
                continue;
        }
        catch {
            // Not there yet.
        }
        const partial = `${target}.part`;
        const response = await fetch(file.url);
        if (!response.ok || !response.body)
            throw new Error(`VISION_MODEL_DOWNLOAD_FAILED:${file.name}:${response.status}`);
        const hash = createHash("sha256");
        const out = fs.createWriteStream(partial);
        let received = 0;
        try {
            for await (const chunk of response.body) {
                hash.update(chunk);
                received += chunk.length;
                if (!out.write(chunk))
                    await new Promise((resolve) => out.once("drain", () => resolve()));
                onProgress?.({ file: file.name, received, total: file.bytes });
            }
        }
        finally {
            await new Promise((resolve) => out.end(() => resolve()));
        }
        if (hash.digest("hex") !== file.sha256 || received !== file.bytes) {
            fs.rmSync(partial, { force: true });
            throw new Error(`VISION_MODEL_CHECKSUM_MISMATCH:${file.name}`);
        }
        fs.renameSync(partial, target);
    }
}
async function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            server.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("NO_PORT"))));
        });
    });
}
const PROMPT = [
    "Obrazek to jedna linia polskiego dokumentu prawnego (skan lub zdjęcie).",
    "Program OCR odczytał ją tak: «{ocr}». Odczyt może mieć błędne litery, brak polskich znaków lub zbędne słowa.",
    "Przepisz tę linię dokładnie tak, jak jest napisana na obrazku, z polskimi znakami, liczbami i interpunkcją.",
    "Nie poprawiaj autora, nie dodawaj komentarzy. Gdy linii nie da się odczytać, zwróć odczyt OCR bez zmian. Zwróć wyłącznie tekst linii."
].join(" ");
/**
 * A llama.cpp server with the vision model, started for one document and stopped after it.
 * Local only: it listens on 127.0.0.1 and gets nothing but line images of the document.
 */
export class LocalVisionLineReader {
    executable;
    dir;
    options;
    child = null;
    port = 0;
    constructor(executable, dir, options = {}) {
        this.executable = executable;
        this.dir = dir;
        this.options = options;
    }
    async start() {
        if (this.child)
            return;
        this.port = await freePort();
        const args = [
            "--model", path.join(this.dir, VISION_MODEL_FILES[0].name),
            "--mmproj", path.join(this.dir, VISION_MODEL_FILES[1].name),
            "--host", "127.0.0.1",
            "--port", String(this.port),
            "--ctx-size", "4096",
            "--parallel", "1",
            "--temp", "0"
        ];
        if (this.options.gpuOffload)
            args.push("--n-gpu-layers", "999");
        if (this.options.threads)
            args.push("--threads", String(this.options.threads));
        const child = spawn(this.executable, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
        this.child = child;
        let stderr = "";
        child.stderr?.on("data", (chunk) => {
            stderr = (stderr + chunk.toString("utf8")).slice(-4000);
        });
        const deadline = Date.now() + (this.options.startTimeoutMs ?? 180_000);
        while (Date.now() < deadline) {
            if (child.exitCode !== null)
                throw new Error(`VISION_MODEL_START_FAILED:${stderr.trim().split("\n").at(-1) ?? ""}`);
            try {
                const health = await fetch(`http://127.0.0.1:${this.port}/health`);
                if (health.ok)
                    return;
            }
            catch {
                // Not listening yet.
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        this.stop();
        throw new Error("VISION_MODEL_START_TIMEOUT");
    }
    readLine = async (jpegBase64, ocrText) => {
        await this.start();
        const response = await fetch(`http://127.0.0.1:${this.port}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${jpegBase64}` } },
                            { type: "text", text: PROMPT.replace("{ocr}", ocrText) }
                        ]
                    }
                ],
                temperature: 0,
                max_tokens: 200
            })
        });
        if (!response.ok)
            throw new Error(`VISION_MODEL_FAILED:${response.status}`);
        const body = (await response.json());
        const text = body.choices?.[0]?.message?.content ?? "";
        // Without the quotes the prompt puts around the OCR reading.
        return text.replace(/^```\w*\s*|\s*```$/gu, "").trim().replace(/^[«»"„”]+|[«»"„”]+$/gu, "").trim();
    };
    stop() {
        this.child?.kill();
        this.child = null;
    }
}
