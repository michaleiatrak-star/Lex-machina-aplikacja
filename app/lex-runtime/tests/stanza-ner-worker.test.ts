import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LocalStanzaNamedEntityRecognizer } from "../src/privacy/stanza-ner.js";

// A stand-in for privacy/stanza_ner_worker.py with the same protocol: "--serve" answers
// one JSON line per text after {"ready":true}; "--input/--output" is one text per process.
// Every process start is appended to STARTS; the text "crash" ends the serving process.
const WORKER = `
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.STARTS, args.includes("--serve") ? "serve\\n" : "once\\n");
const persons = (text) => [...text.matchAll(/Jan Kowalski/g)].map((m) => ({ start: m.index, end: m.index + 12, value: "Jan Kowalski" }));
if (args.includes("--serve")) {
  if (process.env.NO_SERVE) { process.stderr.write("unrecognized arguments: --serve"); process.exit(2); }
  process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\\n")) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      const request = JSON.parse(line);
      if (request.text === "crash") process.exit(1);
      process.stdout.write(JSON.stringify({ id: request.id, spans: persons(request.text) }) + "\\n");
    }
  });
} else {
  const input = args[args.indexOf("--input") + 1], output = args[args.indexOf("--output") + 1];
  fs.writeFileSync(output, JSON.stringify(persons(fs.readFileSync(input, "utf8"))));
}
`;

function setup(env: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-stanza-test-"));
  const workerPath = path.join(dir, "worker.cjs");
  const starts = path.join(dir, "starts.txt");
  fs.writeFileSync(workerPath, WORKER);
  Object.assign(process.env, { STARTS: starts }, env);
  const recognizer = new LocalStanzaNamedEntityRecognizer({ python: process.execPath, workerPath, requestTimeoutMs: 10_000 });
  return { recognizer, starts: () => (fs.existsSync(starts) ? fs.readFileSync(starts, "utf8").trim().split("\n") : []) };
}

describe("Stanza NER worker", () => {
  it("loads the model once for many texts and reuses the answer for the same text", async () => {
    const { recognizer, starts } = setup();
    expect(await recognizer.recognize("Pisał Jan Kowalski.")).toEqual([{ start: 6, end: 18, kind: "PERSON", value: "Jan Kowalski" }]);
    expect(await recognizer.recognize("ok")).toEqual([]);
    await Promise.all([recognizer.recognize("a Jan Kowalski"), recognizer.recognize("b"), recognizer.recognize("Pisał Jan Kowalski.")]);
    expect(starts()).toEqual(["serve"]);
    recognizer.close();
  });

  it("starts a new worker after a crash", async () => {
    const { recognizer, starts } = setup();
    await recognizer.recognize("x");
    await expect(recognizer.recognize("crash")).rejects.toThrow(/exited/);
    expect(await recognizer.recognize("Jan Kowalski")).toHaveLength(1);
    expect(starts()).toEqual(["serve", "serve"]);
    recognizer.close();
  });

  it("falls back to one process per text when the worker cannot serve", async () => {
    const { recognizer, starts } = setup({ NO_SERVE: "1" });
    expect(await recognizer.recognize("Jan Kowalski")).toHaveLength(1);
    expect(await recognizer.recognize("inny tekst")).toEqual([]);
    expect(starts()).toEqual(["serve", "once", "once"]);
    delete process.env.NO_SERVE;
  });
});
