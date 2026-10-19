import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The anonymized version as a .docx: the original file with each anonymized value replaced
// by its token in the runs that held it, so the formatting, footnotes, comments, headers
// and footers stay. The worker (storage/office_extract_worker.py --anonymize) checks that
// the copy reads exactly as the anonymized version and that no value remains outside it.

export type DocxAnonymizationPlan = {
  source: string;
  expected: string;
  replacements: Array<[number, number, string]>;
  values: Array<[string, string]>;
};

const PROTECTED_PART = /(\[PII:[A-Z_]+:\d{4}(?:\|[A-Z]{2,4})?\])/;
const CHUNK_HEADER = /(?:^|\n\n)\[STRONA 1(?: · CZĘŚĆ \d+\/\d+)? · [A-Z_]+\]\n/u;

/** The one page's anonymized text from its chunks (headers out, parts joined losslessly). */
export function protectedPageText(chunks: Array<{ text: string }>): string {
  return chunks.map((chunk) => chunk.text.split(CHUNK_HEADER).join("")).join("");
}

const startsWithLoose = (text: string, part: string, at: number) =>
  text.slice(at, at + part.length).toLocaleLowerCase("pl") === part.toLocaleLowerCase("pl");

/**
 * Where each token of the anonymized text stands in the source: the text between tokens
 * must be the source's own, in order; a token covers what lies between. A known form of
 * the value is preferred where the next text could also begin inside it.
 */
export function alignProtected(
  source: string,
  protectedText: string,
  surfaces: (token: string) => string[]
): Array<[number, number, string]> {
  const parts = protectedText.split(PROTECTED_PART);
  const replacements: Array<[number, number, string]> = [];
  const literal = parts[0] ?? "";
  if (!source.startsWith(literal)) throw new Error("DOCX_ANONYMIZED_ALIGNMENT_FAILED");
  let cursor = literal.length;
  for (let index = 1; index < parts.length; index += 2) {
    // Tokens with nothing between them cover one stretch of the source together.
    let tokens = parts[index]!;
    while (index + 2 < parts.length && parts[index + 1] === "") {
      index += 2;
      tokens += parts[index]!;
    }
    const next = parts[index + 1] ?? "";
    let end = -1;
    if (!next && index + 2 >= parts.length) {
      end = source.length;
    } else {
      if (!tokens.slice(1).includes("[PII:")) {
        const base = tokens.replace(/\|[A-Z]{2,4}\]$/u, "]");
        for (const surface of surfaces(base).sort((a, b) => b.length - a.length)) {
          if (surface && startsWithLoose(source, surface, cursor) && source.startsWith(next, cursor + surface.length)) {
            end = cursor + surface.length;
            break;
          }
        }
      }
      if (end < 0) end = source.indexOf(next, cursor + 1);
    }
    if (end <= cursor) throw new Error("DOCX_ANONYMIZED_ALIGNMENT_FAILED");
    replacements.push([cursor, end, tokens]);
    cursor = end + next.length;
  }
  if (cursor !== source.length) throw new Error("DOCX_ANONYMIZED_ALIGNMENT_FAILED");
  return replacements;
}

function defaultWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../storage/office_extract_worker.py");
}

export async function anonymizeDocx(
  data: Uint8Array,
  plan: DocxAnonymizationPlan,
  options: { python?: string; workerPath?: string; timeoutMs?: number } = {}
): Promise<{ data: Buffer; warnings: string[] }> {
  const python = options.python ?? process.env.LEX_STORAGE_PYTHON ?? "python3";
  const worker = options.workerPath ?? process.env.LEX_OFFICE_EXTRACT_WORKER ?? defaultWorkerPath();
  const input = Buffer.from(JSON.stringify({ data: Buffer.from(data).toString("base64"), ...plan }), "utf8");
  const output = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      python,
      ["-X", "utf8", worker, "--media-type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "--anonymize"],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
    const chunks: Buffer[] = [];
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("DOCX_ANONYMIZED_TIMEOUT"));
    }, options.timeoutMs ?? 120_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-4000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(/(?:DOCX_ANONYMIZED|OFFICE_DOCUMENT)_[A-Z_]+(?::[\w/.\-]+)?/u.exec(stderr)?.[0] ?? `DOCX_ANONYMIZED_FAILED:${code}`));
    });
    child.stdin.end(input);
  });
  input.fill(0);
  const parsed = JSON.parse(output.toString("utf8")) as { data: string; warnings: string[] };
  return { data: Buffer.from(parsed.data, "base64"), warnings: parsed.warnings };
}
