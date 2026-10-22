import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalModelRuntime, externalLocalEndpoint } from "../src/local-model-runtime.js";

const ENV = ["LEX_LOCAL_LLM_ENDPOINT", "LEX_LOCAL_LLM_ENDPOINT_MODEL", "LEX_LOCAL_LLM_ENDPOINT_CONTEXT"] as const;
const roots: string[] = [];

afterEach(() => {
  for (const name of ENV) delete process.env[name];
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function runtime(): LocalModelRuntime {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-external-llm-"));
  roots.push(root);
  return new LocalModelRuntime({ rootDir: path.join(root, "data"), runtimeRoot: path.join(root, "runtime") });
}

describe("external llama.cpp server (server mode on Linux or a GPU machine)", () => {
  it("reads the endpoint and adds /v1", () => {
    expect(externalLocalEndpoint({})).toBeNull();
    expect(externalLocalEndpoint({ LEX_LOCAL_LLM_ENDPOINT: "http://10.0.0.5:8080", LEX_LOCAL_LLM_ENDPOINT_MODEL: "local/bielik-11b-v3-q4km" })).toEqual({
      endpoint: "http://10.0.0.5:8080/v1",
      modelId: "local/bielik-11b-v3-q4km",
      contextTokens: null
    });
    expect(externalLocalEndpoint({ LEX_LOCAL_LLM_ENDPOINT: "http://gpu:8080/v1/", LEX_LOCAL_LLM_ENDPOINT_MODEL: "local/bielik-11b-v3-q4km", LEX_LOCAL_LLM_ENDPOINT_CONTEXT: "32768" })?.endpoint).toBe("http://gpu:8080/v1");
    expect(() => externalLocalEndpoint({ LEX_LOCAL_LLM_ENDPOINT: "file:///x", LEX_LOCAL_LLM_ENDPOINT_MODEL: "local/x" })).toThrow("LOCAL_MODEL_ENDPOINT_INVALID");
  });

  it("serves its one model as ready without starting llama.cpp; install and other models refused", async () => {
    process.env.LEX_LOCAL_LLM_ENDPOINT = "http://127.0.0.1:18080";
    process.env.LEX_LOCAL_LLM_ENDPOINT_MODEL = "local/bielik-11b-v3-q4km";
    process.env.LEX_LOCAL_LLM_ENDPOINT_CONTEXT = "32768";
    const local = runtime();
    const status = local.status();
    expect(status).toMatchObject({ configured: true, state: "READY", endpoint: "http://127.0.0.1:18080/v1", selectedModelId: "local/bielik-11b-v3-q4km", configuredContextTokens: 32768 });
    expect(local.configuredModelId()).toBe("local/bielik-11b-v3-q4km");
    const model = await local.ensureRunning("local/bielik-11b-v3-q4km");
    expect(model).toMatchObject({ id: "local/bielik-11b-v3-q4km", installed: true, contextWindow: 32768 });
    expect(local.listModels().filter((item) => item.installed).map((item) => item.id)).toEqual(["local/bielik-11b-v3-q4km"]);
    await expect(local.ensureRunning("local/mistral-nemo-12b-q4km")).rejects.toThrow("LOCAL_MODEL_ENDPOINT_SERVES_OTHER");
    await expect(local.provision("local/bielik-11b-v3-q4km", 32768)).rejects.toThrow("LOCAL_MODEL_ENDPOINT_EXTERNAL");
    await local.stop();
    expect(local.status().state).toBe("READY");
  });
});
