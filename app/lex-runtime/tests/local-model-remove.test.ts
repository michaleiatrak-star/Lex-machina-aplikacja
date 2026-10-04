import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalModelRuntime } from "../src/local-model-runtime.js";

const filename = "Mistral-Nemo-Instruct-2407-Q4_K_M.gguf";
const previousCache = process.env.LEX_LOCAL_LLM_CACHE_ROOT;

afterEach(() => {
  if (previousCache === undefined) delete process.env.LEX_LOCAL_LLM_CACHE_ROOT;
  else process.env.LEX_LOCAL_LLM_CACHE_ROOT = previousCache;
});

describe("removing a local model frees the disk", () => {
  it("deletes the model, its unfinished downloads and the installer's verified cache copy", async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "lex-remove-"));
    const root = path.join(base, "local-ai");
    const cache = path.join(base, "bootstrap-cache");
    fs.mkdirSync(path.join(root, "models"), { recursive: true });
    fs.mkdirSync(cache, { recursive: true });
    process.env.LEX_LOCAL_LLM_CACHE_ROOT = cache;
    const files = [
      path.join(root, "models", filename),
      path.join(root, "models", `${filename}.part`),
      path.join(cache, filename),
      path.join(cache, `${filename}.part`)
    ];
    for (const file of files) fs.writeFileSync(file, "gguf");
    const runtime = new LocalModelRuntime({ rootDir: root, runtimeRoot: path.join(base, "runtime"), port: 54331 });
    const result = await runtime.remove("local/mistral-nemo-12b-q4km");
    expect(result.removedModelId).toBe("local/mistral-nemo-12b-q4km");
    expect(files.filter((file) => fs.existsSync(file))).toEqual([]);
    fs.rmSync(base, { recursive: true, force: true });
  });
});
