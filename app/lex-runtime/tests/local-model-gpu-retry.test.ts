import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalModelRuntime, type LocalAiConfig } from "../src/local-model-runtime.js";
import { CURRENT_APPLICATION_VERSION } from "../src/update-discovery.js";

let root = "";
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = "";
  delete process.env.LEX_LOCAL_GPU_RETRY;
});

function setup(): { runtime: LocalModelRuntime; cpu: string; gpu: string; config: LocalAiConfig } {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-gpu-retry-"));
  const engine = path.join(root, "engine", "llama", "b1");
  const cpu = path.join(engine, "CPU_X64_PORTABLE", "llama-server.exe");
  const gpu = path.join(engine, "VULKAN_X64", "llama-server.exe");
  for (const file of [cpu, gpu]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "");
  }
  const config = {
    schemaVersion: 1,
    configuredAt: "2026-10-01T08:00:00.000Z",
    model: { id: "local/bielik-11b-v3-q4km", displayName: "Bielik", filename: "b.gguf", path: path.join(root, "b.gguf"), sha256: "a".repeat(64), quantization: "Q4_K_M", nativeContext: 32768 },
    context: { requestedTokens: 16384, mode: "NATIVE_OR_REDUCED", extendedBeyondNative: false, ropeScale: 1 },
    engine: { type: "llama.cpp", backend: "CPU_X64_PORTABLE", selectionMode: "AUTO", gpuOffload: false, executable: cpu, fallbackBackend: null, fallbackExecutable: null, bind: "127.0.0.1" },
    network: { requiredForProvisioning: true, requiredForInference: false }
  } as unknown as LocalAiConfig;
  const runtime = new LocalModelRuntime({ rootDir: path.join(root, "local"), runtimeRoot: path.join(root, "runtime"), port: 54_331 });
  return { runtime, cpu, gpu, config };
}

describe("lokalny model: karta graficzna po wcześniejszym przejściu na procesor", () => {
  it("AUTO na procesorze z kartą: silnik Vulkan obok (VULKAN_X64), procesor jako zapas, raz na wersję aplikacji", () => {
    const { runtime, cpu, gpu, config } = setup();
    const retry = runtime.gpuRetryConfig(config, () => true)!;
    expect(retry.engine).toMatchObject({
      backend: "VULKAN_X64",
      gpuOffload: true,
      executable: gpu,
      fallbackBackend: "CPU_X64_PORTABLE",
      fallbackExecutable: cpu,
      gpuRetriedVersion: CURRENT_APPLICATION_VERSION
    });
    // Tried in this version already (success or failure): no second try until the next version.
    expect(runtime.gpuRetryConfig({ ...config, engine: { ...config.engine, gpuRetriedVersion: CURRENT_APPLICATION_VERSION } }, () => true)).toBeNull();
    expect(runtime.gpuRetryConfig({ ...config, engine: { ...config.engine, gpuRetriedVersion: "0.1.1" } }, () => true)).not.toBeNull();
  });

  it("bez karty, bez silnika Vulkan, przy wyborze ręcznym lub LEX_LOCAL_GPU_RETRY=off: bez próby", () => {
    const { runtime, gpu, config } = setup();
    expect(runtime.gpuRetryConfig(config, () => false)).toBeNull();
    expect(runtime.gpuRetryConfig({ ...config, engine: { ...config.engine, selectionMode: "CPU_X64_PORTABLE" } }, () => true)).toBeNull();
    process.env.LEX_LOCAL_GPU_RETRY = "off";
    expect(runtime.gpuRetryConfig(config, () => true)).toBeNull();
    delete process.env.LEX_LOCAL_GPU_RETRY;
    fs.rmSync(gpu);
    expect(runtime.gpuRetryConfig(config, () => true)).toBeNull();
  });

  it("zapisany silnik karty z nieudanego startu ma pierwszeństwo przed ścieżką wyliczoną", () => {
    const { runtime, config } = setup();
    const other = path.join(root, "custom", "llama-server.exe");
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, "");
    const retry = runtime.gpuRetryConfig({ ...config, engine: { ...config.engine, gpuExecutable: other, gpuFailure: { at: "x", error: "LOCAL_MODEL_START_TIMEOUT", appVersion: "0.1.50" } } }, () => true)!;
    expect(retry.engine.executable).toBe(other);
    expect(retry.engine.gpuFailure).toBeNull();
  });
});
