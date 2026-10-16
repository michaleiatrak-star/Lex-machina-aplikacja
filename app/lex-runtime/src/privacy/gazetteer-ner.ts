import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonLineWorker, WorkerStartBackoff, WorkerStartError } from "./json-line-worker.js";
import { mayContainPersonalNames } from "./name-candidates.js";
import type { NamedEntityRecognizer, PiiKind, PiiSpan } from "./pseudonymizer.js";

type GazetteerSpan = { start: number; end: number; kind: string; value: string; ambiguous?: boolean };

const CACHE_ENTRIES = 32;

function defaultWorkerPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../privacy/polish_pii_gazetteer.py");
}

/**
 * Persons from the SGJP dictionary (Morfeusz2) and addresses by structure.
 * Complements Stanza: it knows every Polish given name and surname in every
 * case and finds street addresses, which Stanza does not report at all.
 */
export class LocalGazetteerRecognizer implements NamedEntityRecognizer {
  private readonly python: string;
  private readonly workerPath: string;
  // A worker kept alive (Morfeusz, the PESEL surname base and TERYT loaded once): a
  // message costs a few ms instead of starting Python (~0.15 s on Linux, more on Windows).
  private readonly persistent: boolean;
  private readonly backoff = new WorkerStartBackoff();
  private readonly worker: JsonLineWorker<GazetteerSpan[]>;
  private readonly cache = new Map<string, GazetteerSpan[]>();

  constructor(
    options: { python?: string; workerPath?: string; persistent?: boolean } = {},
    private readonly timeoutMs = 5 * 60 * 1000
  ) {
    this.python = options.python ?? process.env.LEX_NER_PYTHON ?? "python3";
    this.workerPath =
      options.workerPath ?? process.env.LEX_GAZETTEER_WORKER ?? defaultWorkerPath();
    this.persistent = options.persistent ?? process.env.LEX_GAZETTEER_PERSISTENT !== "0";
    this.worker = new JsonLineWorker("Gazetteer", this.python, ["-X", "utf8", this.workerPath, "--serve"], 2 * 60 * 1000, timeoutMs);
  }

  /** Starts the worker in the background (server start), so no message waits for it. */
  warmUp(): void {
    if (this.persistent) void this.recognize("Jan Kowalski").catch(() => undefined);
  }

  close(): void {
    this.worker.close();
  }

  async recognize(text: string): Promise<PiiSpan[]> {
    if (!text.trim()) return [];
    // The same text is checked several times in one turn (message, history, auxiliary text).
    const key = createHash("sha256").update(text).digest("hex");
    let raw = this.cache.get(key);
    if (raw) {
      this.cache.delete(key);
    } else {
      raw = await this.spans(text);
      while (this.cache.size >= CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, raw);
    return raw
      .filter(
        (item) =>
          (item.kind === "PERSON" || item.kind === "ADDRESS") &&
          Number.isInteger(item.start) &&
          Number.isInteger(item.end) &&
          text.slice(item.start, item.end) === item.value
      )
      .map((item) => ({
        start: item.start,
        end: item.end,
        kind: item.kind as PiiKind,
        value: item.value,
        confidence: 0.9,
        source: "AUTO" as const,
        ...(item.ambiguous ? { ambiguous: true } : {})
      }));
  }

  private async spans(text: string): Promise<GazetteerSpan[]> {
    if (this.persistent && this.backoff.usable()) {
      try {
        const spans = await this.worker.ask(text);
        this.backoff.started();
        return spans;
      } catch (error) {
        // A worker that cannot start (Python missing, a slow first start) is not retried on
        // every message: one process per text for a while, then the worker again.
        if (error instanceof WorkerStartError) {
          this.backoff.failed();
          process.stderr.write(`LOCAL_GAZETTEER_PERSISTENT_UNAVAILABLE:${error.message.slice(0, 300)}\n`);
        } else {
          // A worker that broke mid-run is started again once for this text (a fresh process).
          process.stderr.write(`LOCAL_GAZETTEER_RETRY:${(error instanceof Error ? error.message : String(error)).slice(0, 300)}\n`);
          this.worker.close();
        }
      }
    }
    return this.oneShot(text);
  }

  private async oneShot(text: string): Promise<GazetteerSpan[]> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "lex-gazetteer-"));
    const input = path.join(tempRoot, "input.txt");
    const output = path.join(tempRoot, "output.json");
    try {
      await writeFile(input, text, "utf8");
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          this.python,
          ["-X", "utf8", this.workerPath, "--input", input, "--output", output],
          { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
        );
        let stderr = "";
        child.stderr?.on("data", (chunk) => {
          stderr = (stderr + String(chunk)).slice(-4000);
        });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("GAZETTEER_TIMEOUT"));
        }, this.timeoutMs);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`GAZETTEER_FAILED:${code}:${stderr.trim().slice(-400)}`));
        });
      });
      return JSON.parse(await readFile(output, "utf8")) as GazetteerSpan[];
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

/**
 * Union of several recognizers; one failing never hides the others. When all of them
 * fail on a text that may hold a name or an address, it throws: an empty result would
 * send them to the model in plain text (fail closed). A text with no such candidate
 * ("wyszukaj wyrok SN dotyczący grupy przestępczej") goes on with the deterministic
 * identifiers masked, so a broken NER runtime does not stop every question.
 */
// Which local recognizer is down now (its last call failed): the preview says so, since
// what it finds (addresses, surnames in every case) is then missing from the suggestions.
const RECOGNIZER_LABEL: Record<string, string> = {
  LocalGazetteerRecognizer: "Morfeusz (słownik imion, nazwisk i adresów)",
  LocalStanzaNamedEntityRecognizer: "Stanza (rozpoznawanie nazw w zdaniu)"
};
const recognizerDown = new Map<string, string>();

/** Local recognizers whose last call failed, with the reason (empty when all work). */
export function degradedRecognizers(): Array<{ name: string; reason: string }> {
  return [...recognizerDown].map(([name, reason]) => ({ name, reason }));
}

// A sample every working recognizer reads: a person and, for the gazetteer, an address.
const SELF_TEST_TEXT = "Pozwany Jan Kowalski, zamieszkały przy ul. Długiej 5 w Krakowie, nie stawił się.";

export class CompositeRecognizer implements NamedEntityRecognizer {
  constructor(private readonly recognizers: NamedEntityRecognizer[]) {}

  /**
   * Start check (server start): each recognizer reads a sample; one that fails or runs but
   * finds no person (a missing dictionary) is reported as down with the reason, so the first
   * document preview already says so. Its next call starts it again.
   */
  async selfTest(): Promise<Array<{ name: string; ok: boolean; reason?: string }>> {
    return Promise.all(
      this.recognizers.map(async (recognizer) => {
        const name = RECOGNIZER_LABEL[recognizer.constructor.name] ?? recognizer.constructor.name;
        try {
          const spans = await recognizer.recognize(SELF_TEST_TEXT);
          if (!spans.some((span) => span.kind === "PERSON")) {
            recognizerDown.set(name, "SELF_TEST_NO_PERSON");
            return { name, ok: false, reason: "SELF_TEST_NO_PERSON" };
          }
          recognizerDown.delete(name);
          return { name, ok: true };
        } catch (error) {
          const reason = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").slice(0, 200);
          recognizerDown.set(name, reason);
          return { name, ok: false, reason };
        }
      })
    );
  }

  async recognize(text: string): Promise<PiiSpan[]> {
    const reasons: string[] = [];
    const results = await Promise.all(
      this.recognizers.map((recognizer) => {
        const name = RECOGNIZER_LABEL[recognizer.constructor.name] ?? recognizer.constructor.name;
        return recognizer.recognize(text).then(
          (spans) => {
            recognizerDown.delete(name);
            return spans;
          },
          (error: unknown) => {
            const reason = error instanceof Error ? error.message : String(error);
            reasons.push(reason.replace(/\s+/g, " ").slice(0, 160));
            recognizerDown.set(name, reason.replace(/\s+/g, " ").slice(0, 200));
            process.stderr.write(`PRIVACY_RECOGNIZER_DEGRADED:${reason}\n`);
            return [] as PiiSpan[];
          }
        );
      })
    );
    if (this.recognizers.length > 0 && reasons.length === this.recognizers.length && text.trim()) {
      if (mayContainPersonalNames(text)) throw new Error(`PRIVACY_RECOGNIZER_UNAVAILABLE:${reasons.join(" | ")}`);
      process.stderr.write("PRIVACY_RECOGNIZER_UNAVAILABLE_NO_NAME_CANDIDATES\n");
    }
    const seen = new Set<string>();
    return results.flat().filter((span) => {
      const key = `${span.kind}:${span.start}:${span.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
