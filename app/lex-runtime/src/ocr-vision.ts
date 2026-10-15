import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { IngestedPage, OcrCorrection, OcrLine } from "./document-ingestion.js";

/**
 * Doubtful OCR lines read again by a local vision model (Qwen2.5-VL 3B through the
 * llama.cpp engine of the local AI), from the straightened image of the line.
 *
 * The model is never trusted on its own: on three real scans it added a date that is
 * not on the page, turned the stamp "Paweł Rak" into "Pawel Rafał" and dropped
 * diacritics. A deterministic arbiter takes from its reading only:
 * - an unknown word replaced by a dictionary word, a small edit ("prewnego" -> "prawnego");
 * - a diacritic added to a known word ("Pawla" -> "Pawła", "zadania" -> "żądania");
 * - a space ("jąlub" -> "ją lub");
 * - the same digits differently grouped ("810.2024" -> "8.10.2024").
 * Never: added or removed words, changed digits, removed diacritics, handwritten lines
 * (score below 0.85, which go to manual review). Measured on three scans: word accuracy
 * 97.1% -> 98.4%, critical fields (names, numbers, amounts) 88 -> 92 of 94; 26 changes,
 * one wrong ("Pracodawcyi" -> "Pracodawcy." instead of "Pracodawcy i").
 */

export type KnownWords = (words: string[]) => Promise<boolean[]>;
export type ReadLine = (jpegBase64: string, ocrText: string) => Promise<string>;
export type VisionProgress = (done: number, total: number) => void;

// Handwriting, stamps and signatures: manual review, never the model.
const HANDWRITING_SCORE = 0.85;
// A line read with less confidence than this is read again.
const DOUBT_SCORE = 0.95;
const WORD = /\p{L}{2,}/gu;
const CHECKED_WORD = /\p{L}{3,}/gu;

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

/** Runs of differing words: [from start, from end, to start, to end]. */
function differences(a: string[], b: string[]): Array<[number, number, number, number]> {
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      common[i]![j] = a[i] === b[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }
  const runs: Array<[number, number, number, number]> = [];
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
      if (j < b.length && (i >= a.length || common[i]![j + 1]! >= common[i + 1]![j]!)) j += 1;
      else i += 1;
    }
    runs.push([i0, i, j0, j]);
  }
  return runs;
}

const bare = (text: string) => text.replace(/\s+/gu, "");
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[łŁ]/gu, "l");
const marks = (text: string) => [...text].filter((letter) => plain(letter) !== letter).length;
const digits = (text: string) => text.replace(/\D/gu, "");
const EDGES = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su;
const core = (text: string) => EDGES.exec(text)![2]!;

/**
 * Punctuation at the edges stays as the OCR read it ("pracodawey," -> "pracodawcy,", not
 * "pracodawcy."); the model may only add a closing mark where the OCR read none
 * ("nięuprawnipn" -> "nieuprawnione.").
 */
function keepEdges(was: string, read: string): string {
  const [, leadWas, , trailWas] = EDGES.exec(was)!;
  const [, , core, trailRead] = EDGES.exec(read)!;
  const trail = trailWas || (/^[.,;:]$/u.test(trailRead!) ? trailRead : "");
  return `${leadWas}${core}${trail}`;
}

/**
 * The line with the changes the arbiter takes from the model's reading. `known` holds the
 * dictionary words among the words of both readings.
 */
export function arbitrateLine(
  ocrText: string,
  visionText: string,
  known: ReadonlySet<string>
): { text: string; fixes: Array<{ from: string; to: string }> } {
  const vision = visionText.replace(/\s+/gu, " ").trim();
  // A reading of another line, or made up: nothing is taken.
  if (!vision || editDistance(ocrText, vision) > Math.max(4, 0.5 * ocrText.length)) return { text: ocrText, fixes: [] };
  const from = ocrText.split(/\s+/u).filter(Boolean);
  const to = vision.split(/\s+/u).filter(Boolean);
  const allKnown = (text: string) => (text.match(WORD) ?? []).every((word) => known.has(word));
  const anyUnknown = (text: string) => (text.match(WORD) ?? []).some((word) => !known.has(word));
  const result = [...from];
  const fixes: Array<{ from: string; to: string }> = [];
  let shift = 0;
  for (const [i0, i1, j0, j1] of differences(from, to)) {
    const was = from.slice(i0, i1).join(" ");
    const read = to.slice(j0, j1).join(" ");
    if (!was || !read) continue;
    let take = false;
    if (/\d/u.test(was + read)) {
      take = digits(was) === digits(read) && (bare(was) === bare(read) || /^\d{1,2}\.\d{1,2}\.\d{4}$/u.test(read));
    } else if (bare(core(was)) === bare(core(read))) {
      take = allKnown(read);
    } else if (plain(core(was)) === plain(core(read))) {
      take = marks(read) > marks(was) && allKnown(read);
    } else {
      take =
        anyUnknown(was) &&
        allKnown(read) &&
        editDistance(was.toLocaleLowerCase("pl"), read.toLocaleLowerCase("pl")) <= Math.max(2, Math.ceil(0.34 * was.length));
    }
    if (!take) continue;
    const taken = keepEdges(was, read);
    if (taken === was) continue;
    const words = taken.split(" ");
    result.splice(i0 + shift, i1 - i0, ...words);
    shift += words.length - (i1 - i0);
    fixes.push({ from: was, to: taken });
  }
  return fixes.length ? { text: result.join(" "), fixes } : { text: ocrText, fixes: [] };
}

/** Lines worth reading again: read with doubt, or with a word the dictionary does not know. */
export function doubtfulLines(lines: readonly OcrLine[], known: ReadonlySet<string>): number[] {
  return lines.flatMap((line, index) => {
    const score = typeof line.score === "number" ? line.score : 1;
    if (!line.crop || score < HANDWRITING_SCORE) return [];
    const unknown = (line.text.match(CHECKED_WORD) ?? []).some((word) => !known.has(word));
    return score < DOUBT_SCORE || unknown ? [index] : [];
  });
}

/** OCR pages with the doubtful lines read again (original words kept in page.corrections). */
export async function correctWithVision(
  pages: readonly IngestedPage[],
  readLine: ReadLine,
  knownWords: KnownWords,
  onProgress?: VisionProgress
): Promise<IngestedPage[]> {
  const ocrPages = pages.filter((page) => page.source === "OCR" && page.lines?.some((line) => line.crop));
  if (!ocrPages.length) return [...pages];
  const vocabulary = [...new Set(ocrPages.flatMap((page) => page.lines!.flatMap((line) => line.text.match(WORD) ?? [])))];
  const flags = await knownWords(vocabulary);
  const known = new Set(vocabulary.filter((_, index) => flags[index]));
  const todo = ocrPages.map((page) => ({ page, lines: doubtfulLines(page.lines!, known) }));
  const total = todo.reduce((sum, item) => sum + item.lines.length, 0);
  const readings = new Map<IngestedPage, Map<number, string>>();
  let done = 0;
  onProgress?.(0, total);
  for (const { page, lines } of todo) {
    const read = new Map<number, string>();
    for (const index of lines) {
      const line = page.lines![index]!;
      read.set(index, await readLine(line.crop!, line.text));
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
    if (!read?.size) return page;
    const corrections: OcrCorrection[] = [...(page.corrections ?? [])];
    const lines = page.lines!.map((line, index) => {
      const vision = read.get(index);
      if (vision === undefined) return line;
      const decided = arbitrateLine(line.text, vision, known);
      corrections.push(...decided.fixes.map((fix) => ({ line: index, ...fix })));
      return decided.text === line.text ? line : { ...line, text: decided.text };
    });
    if (corrections.length === (page.corrections ?? []).length) return page;
    return { ...page, lines, text: lines.map((line) => line.text).join("\n"), corrections };
  });
}

/** The page without line images: they live only for the vision step, never stored. */
export function withoutLineCrops(page: IngestedPage): IngestedPage {
  if (!page.lines?.some((line) => line.crop)) return page;
  return { ...page, lines: page.lines.map(({ crop: _crop, ...line }) => line) };
}

// --- the model files and the llama.cpp server ---

/** One entry of models.localVision in the release manifest: the model and its projector (mmproj). */
export type VisionModelFile = { filename: string; url: string; sha256: string; bytes: number };
export type VisionModelSpec = VisionModelFile & { id: string; displayName: string; license?: string; projector: VisionModelFile };

/** The installed model, as recorded in <local-ai>/vision/vision.json by the installer. */
export type InstalledVisionModel = { id: string; model: string; projector: string; bytes: number };

function validFile(value: unknown): value is VisionModelFile {
  const record = value as Record<string, unknown> | null;
  return Boolean(
    record &&
      typeof record.filename === "string" &&
      /^[A-Za-z0-9._-]+\.gguf$/.test(record.filename) &&
      typeof record.url === "string" &&
      record.url.startsWith("https://") &&
      typeof record.sha256 === "string" &&
      /^[0-9a-fA-F]{64}$/.test(record.sha256) &&
      typeof record.bytes === "number" &&
      Number.isSafeInteger(record.bytes) &&
      record.bytes > 0
  );
}

/** The first valid models.localVision entry of a release manifest, or null. */
export function visionModelFromManifest(manifest: unknown): VisionModelSpec | null {
  const models = (manifest as { models?: { localVision?: unknown } } | null)?.models?.localVision;
  for (const entry of Array.isArray(models) ? models : []) {
    const record = entry as Record<string, unknown>;
    const projector = record.projector;
    if (typeof record.id !== "string" || !validFile(entry) || !validFile(projector)) continue;
    return {
      id: record.id,
      displayName: typeof record.displayName === "string" ? record.displayName : record.id,
      filename: entry.filename,
      url: entry.url,
      sha256: entry.sha256.toLowerCase(),
      bytes: entry.bytes,
      ...(typeof record.license === "string" ? { license: record.license } : {}),
      projector: { filename: projector.filename, url: projector.url, sha256: projector.sha256.toLowerCase(), bytes: projector.bytes }
    };
  }
  return null;
}

function sizeOf(file: string): number | null {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

/**
 * The model recorded in vision.json, when both files are still there with the sizes the manifest
 * gives (a model from another manifest entry or a half-copied file does not count).
 */
export function installedVisionModel(dir: string, spec: VisionModelSpec | null): InstalledVisionModel | null {
  let config: { model?: { id?: unknown; path?: unknown; sha256?: unknown }; projector?: { path?: unknown; sha256?: unknown } };
  try {
    config = JSON.parse(fs.readFileSync(path.join(dir, "vision.json"), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
  const model = config.model;
  const projector = config.projector;
  if (!spec || !model || !projector || model.id !== spec.id) return null;
  if (typeof model.path !== "string" || typeof projector.path !== "string") return null;
  if (String(model.sha256).toLowerCase() !== spec.sha256 || String(projector.sha256).toLowerCase() !== spec.projector.sha256) return null;
  if (sizeOf(model.path) !== spec.bytes || sizeOf(projector.path) !== spec.projector.bytes) return null;
  return { id: spec.id, model: model.path, projector: projector.path, bytes: spec.bytes + spec.projector.bytes };
}

// While it runs the model takes about its file sizes plus the context and image buffers. Started
// only for the document and only with this much free memory: next to a running text model and
// the OCR worker a 16 GB machine runs out, and the system kills processes.
const RUNTIME_OVERHEAD_BYTES = Number(process.env.LEX_OCR_VISION_OVERHEAD_MB ?? 1024) * 1024 * 1024;

export function enoughMemoryForVision(modelBytes: number, free: number = os.freemem()): boolean {
  return free >= modelBytes + RUNTIME_OVERHEAD_BYTES;
}

export type VisionInstallProgress = { file: string; received: number; total: number };

/**
 * Outside Windows (development, macOS): downloads both files into `dir`, each checked against its
 * SHA-256, and writes vision.json the way install-local-vision.ps1 does.
 */
export async function installVisionModel(
  dir: string,
  spec: VisionModelSpec,
  onProgress?: (progress: VisionInstallProgress) => void
): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const config = path.join(dir, "vision.json");
  fs.rmSync(config, { force: true });
  const paths: string[] = [];
  for (const file of [spec, spec.projector]) {
    const target = path.join(dir, file.filename);
    paths.push(target);
    if (sizeOf(target) === file.bytes) continue;
    const partial = `${target}.part`;
    const response = await fetch(file.url);
    if (!response.ok || !response.body) throw new Error(`VISION_MODEL_DOWNLOAD_FAILED:${file.filename}:${response.status}`);
    const hash = createHash("sha256");
    const out = fs.createWriteStream(partial);
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        onProgress?.({ file: file.filename, received, total: file.bytes });
      }
    } finally {
      await new Promise<void>((resolve) => out.end(() => resolve()));
    }
    if (hash.digest("hex") !== file.sha256 || received !== file.bytes) {
      fs.rmSync(partial, { force: true });
      throw new Error(`VISION_MODEL_CHECKSUM_MISMATCH:${file.filename}`);
    }
    fs.renameSync(partial, target);
  }
  const record = {
    schemaVersion: 1,
    installedAt: new Date().toISOString(),
    model: { id: spec.id, displayName: spec.displayName, filename: spec.filename, path: paths[0], sha256: spec.sha256 },
    projector: { filename: spec.projector.filename, path: paths[1], sha256: spec.projector.sha256 }
  };
  fs.writeFileSync(`${config}.tmp`, `${JSON.stringify(record, null, 2)}\n`);
  fs.renameSync(`${config}.tmp`, config);
}

async function freePort(): Promise<number> {
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
  private child: ChildProcess | null = null;
  private port = 0;

  constructor(
    private readonly executable: string,
    private readonly model: InstalledVisionModel,
    private readonly options: { gpuOffload?: boolean; threads?: number; startTimeoutMs?: number } = {}
  ) {}

  /** Bytes of both model files: the memory the server takes beyond its buffers. */
  get modelBytes(): number {
    return this.model.bytes;
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.port = await freePort();
    const args = [
      "--model", this.model.model,
      "--mmproj", this.model.projector,
      "--host", "127.0.0.1",
      "--port", String(this.port),
      "--ctx-size", "4096",
      "--parallel", "1",
      "--temp", "0"
    ];
    if (this.options.gpuOffload) args.push("--n-gpu-layers", "999");
    if (this.options.threads) args.push("--threads", String(this.options.threads));
    const child = spawn(this.executable, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    this.child = child;
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });
    const deadline = Date.now() + (this.options.startTimeoutMs ?? 180_000);
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`VISION_MODEL_START_FAILED:${stderr.trim().split("\n").at(-1) ?? ""}`);
      try {
        const health = await fetch(`http://127.0.0.1:${this.port}/health`);
        if (health.ok) return;
      } catch {
        // Not listening yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    this.stop();
    throw new Error("VISION_MODEL_START_TIMEOUT");
  }

  readonly readLine: ReadLine = async (jpegBase64, ocrText) => {
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
    if (!response.ok) throw new Error(`VISION_MODEL_FAILED:${response.status}`);
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? "";
    // Without the quotes the prompt puts around the OCR reading.
    return text.replace(/^```\w*\s*|\s*```$/gu, "").trim().replace(/^[«»"„”]+|[«»"„”]+$/gu, "").trim();
  };

  stop(): void {
    this.child?.kill();
    this.child = null;
  }
}
