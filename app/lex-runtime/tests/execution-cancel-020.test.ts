import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createLexHttpApp } from "../src/http/app.js";
import type { SessionExecutor } from "../src/session-executor.js";
import { LexSkillRegistry } from "../src/registry.js";
import { ProviderGateway, ProviderRegistry } from "../src/providers/gateway.js";

const DR = "dr-02-prawo-cywilne-rodzinne-gospodarcze";
function registry(): LexSkillRegistry {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-cancel-"));
  for (const name of ["prawo-polskie-v2", DR]) {
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, "SKILL.md"), `---\nname: ${name}\n---\n# test\n`);
  }
  fs.writeFileSync(path.join(root, "prawo-polskie-v2", "ROUTING-MAP.md"), DR + "\n");
  const result = new LexSkillRegistry(root);
  result.scan();
  return result;
}

describe("Zatrzymaj: the user stops a running turn", () => {
  it("the model call in progress ends, the turn answers EXECUTION_CANCELLED, a stranger cannot stop it", async () => {
    const providers = new ProviderRegistry();
    let started!: () => void;
    const inCall = new Promise<void>((resolve) => (started = resolve));
    providers.register({
      id: "openai",
      label: "slow",
      capabilities: { streaming: true, tools: false, reasoning: false, modelDiscovery: false },
      stream: (params) =>
        new Promise((_, reject) => {
          started();
          params.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    });
    const gateway = new ProviderGateway(providers);
    let secondCall = "";
    const executor: SessionExecutor = {
      execute: async (input) => {
        try {
          await gateway.stream("openai", { model: input.model, systemPrompt: "", messages: [{ role: "user", content: "x" }] });
        } catch {
          // An executor that swallows the failure and tries again: the next call is refused at once.
          await gateway.stream("openai", { model: input.model, systemPrompt: "", messages: [{ role: "user", content: "x" }] }).catch((error) => (secondCall = error.code));
        }
        throw new Error("no answer");
      }
    };
    const app = createLexHttpApp({ registry: registry(), modelCatalog: { list: async () => [] }, sessionExecutor: executor });
    const executionId = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f9";
    const running = request(app)
      .post("/api/sessions/execute")
      .set("X-Lex-Execution-Id", executionId)
      .send({ query: "Pytanie", provider: "openai", model: "gpt-test", primarySkill: DR, mode: "PRAWNIK" })
      .then((response) => response);
    await inCall;
    await request(app).post("/api/sessions/cancel/0f1e2d3c-4b5a-6978-8796-000000000000").expect(404);
    await request(app).post(`/api/sessions/cancel/${executionId}`).expect(200, { cancelled: true });
    const final = await running;
    expect(final.status).toBe(409);
    expect(final.body).toEqual({ error: "EXECUTION_CANCELLED" });
    expect(secondCall).toBe("EXECUTION_CANCELLED");
    // Finished: nothing left to stop.
    await request(app).post(`/api/sessions/cancel/${executionId}`).expect(404);
  });
});
