import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAC_BACKEND, provisionLocalAiMacos } from "../src/local-ai-provision-macos.js";

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
let dir = "";

function archive(build: (root: string) => void): Buffer {
  const source = fs.mkdtempSync(path.join(dir, "src-"));
  build(source);
  const file = path.join(dir, `engine-${Math.random().toString(36).slice(2)}.tar.gz`);
  expect(spawnSync("tar", ["-czf", file, "-C", source, "."]).status).toBe(0);
  return fs.readFileSync(file);
}

function setup(engine: Buffer, model: Buffer, modelSha = sha(model)) {
  const manifest = {
    applicationVersion: "0.1.71",
    runtime: { llamaCpp: { version: "b1", backends: [{ id: MAC_BACKEND, url: "https://engine.test/llama.tar.gz", sha256: sha(engine), gpuOffload: true }] } },
    models: {
      localLlm: [
        { id: "local/bielik", displayName: "Bielik", filename: "bielik.gguf", url: "https://model.test/bielik.gguf", sha256: modelSha, nativeContext: 32768, minimumContext: 32000, maximumRuntimeContext: 200000, contextExtension: { enabled: true } }
      ]
    },
    localAi: { contextSelection: { minimum: 32000, maximum: 200000, step: 1000 } }
  };
  const manifestPath = path.join(dir, "release-source.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const fetched: string[] = [];
  const fetchImpl = async (url: string) => {
    fetched.push(url);
    const body = url.includes("engine") ? engine : model;
    return {
      ok: true,
      status: 200,
      headers: { get: (name: string) => (name === "content-length" ? String(body.length) : null) },
      body: (async function* () {
        yield new Uint8Array(body);
      })()
    };
  };
  return { manifestPath, fetchImpl, fetched, localRoot: path.join(dir, "local-ai") };
}

const engineTree = (root: string) => {
  fs.mkdirSync(path.join(root, "llama-b1"));
  fs.writeFileSync(path.join(root, "llama-b1", "llama-server"), "#!/bin/sh\n");
  fs.writeFileSync(path.join(root, "llama-b1", "libllama.0.1.dylib"), "lib");
  fs.symlinkSync("libllama.0.1.dylib", path.join(root, "llama-b1", "libllama.dylib"));
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-mac-ai-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("provisionLocalAiMacos", () => {
  it("installs the Metal engine and the model, writes the config Windows writes", async () => {
    const model = Buffer.from("gguf model bytes");
    const { manifestPath, fetchImpl, fetched, localRoot } = setup(archive(engineTree), model);
    const progress: string[] = [];
    const result = await provisionLocalAiMacos({
      manifestPath,
      localRoot,
      modelId: "local/bielik",
      contextTokens: 64000,
      backendMode: "AUTO",
      fetchImpl,
      tar: "tar",
      onProgress: (item) => progress.push(`${item.phase}:${item.label}`)
    });
    const config = JSON.parse(fs.readFileSync(result.configPath, "utf8"));
    expect(config.engine).toMatchObject({ backend: MAC_BACKEND, gpuOffload: true, fallbackBackend: null, selectionMode: "AUTO" });
    expect(fs.existsSync(config.engine.executable)).toBe(true);
    expect(fs.statSync(config.engine.executable).mode & 0o111).not.toBe(0);
    expect(fs.readlinkSync(path.join(path.dirname(config.engine.executable), "libllama.dylib"))).toBe("libllama.0.1.dylib");
    expect(config.model).toMatchObject({ id: "local/bielik", sha256: sha(model), nativeContext: 32768 });
    expect(fs.readFileSync(config.model.path, "utf8")).toBe("gguf model bytes");
    expect(config.context).toMatchObject({ requestedTokens: 64000, mode: "YARN_EXTENDED", extendedBeyondNative: true });
    expect(config.engine.launchArgs).toEqual(expect.arrayContaining(["--n-gpu-layers", "999", "--rope-scaling", "yarn"]));
    expect(progress).toContain(`VERIFIED:model:local/bielik`);
    expect(fetched).toHaveLength(2);

    // A second run (another context) keeps the engine and the verified model: nothing downloaded.
    await provisionLocalAiMacos({ manifestPath, localRoot, modelId: "local/bielik", contextTokens: 32000, backendMode: "AUTO", fetchImpl, tar: "tar" });
    expect(fetched).toHaveLength(2);
  });

  it("refuses a model whose checksum differs and keeps no partial file", async () => {
    const { manifestPath, fetchImpl, localRoot } = setup(archive(engineTree), Buffer.from("tampered"), "0".repeat(64));
    await expect(
      provisionLocalAiMacos({ manifestPath, localRoot, modelId: "local/bielik", contextTokens: 32000, backendMode: "AUTO", fetchImpl, tar: "tar" })
    ).rejects.toThrow(/LOCAL_LLM_HASH_MISMATCH:model:local\/bielik/u);
    expect(fs.readdirSync(path.join(localRoot, "models"))).toEqual([]);
    expect(fs.existsSync(path.join(localRoot, "config.json"))).toBe(false);
  });

  it("refuses an engine archive with a link leading outside it", async () => {
    const engine = archive((root) => {
      engineTree(root);
      fs.symlinkSync("/etc/passwd", path.join(root, "llama-b1", "evil.dylib"));
    });
    const { manifestPath, fetchImpl, localRoot } = setup(engine, Buffer.from("m"));
    await expect(
      provisionLocalAiMacos({ manifestPath, localRoot, modelId: "local/bielik", contextTokens: 32000, backendMode: "AUTO", fetchImpl, tar: "tar" })
    ).rejects.toThrow(/LOCAL_LLM_ENGINE_ARCHIVE_UNSAFE/u);
    expect(fs.existsSync(path.join(localRoot, "engine", "llama", "b1", MAC_BACKEND))).toBe(false);
  });

  it("checks the context against the model and the policy", async () => {
    const { manifestPath, fetchImpl, localRoot } = setup(archive(engineTree), Buffer.from("m"));
    await expect(
      provisionLocalAiMacos({ manifestPath, localRoot, modelId: "local/bielik", contextTokens: 32500, backendMode: "AUTO", fetchImpl, tar: "tar" })
    ).rejects.toThrow(/LOCAL_LLM_CONTEXT_STEP_INVALID/u);
    await expect(
      provisionLocalAiMacos({ manifestPath, localRoot, modelId: "local/other", contextTokens: 32000, backendMode: "AUTO", fetchImpl, tar: "tar" })
    ).rejects.toThrow(/LOCAL_LLM_MODEL_UNKNOWN/u);
  });
});
