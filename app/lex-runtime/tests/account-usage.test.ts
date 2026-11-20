import { describe, expect, it } from "vitest";
import { cliUsageOf } from "../src/providers/account-session.js";

describe("tokens a signed-in client prints with its answer (2026-11-20)", () => {
  it("Codex: every turn.completed, input with the cached part", () => {
    const stdout = [
      '{"type":"item.completed","item":{"type":"agent_message","text":"A"}}',
      '{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":800,"output_tokens":300}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":0,"output_tokens":20}}'
    ].join("\n");
    expect(cliUsageOf(stdout)).toEqual({ inputTokens: 1300, outputTokens: 320, cacheReadTokens: 800, cacheWriteTokens: 0 });
  });

  it("Claude: the result's usage, cache read and written added to the input", () => {
    const stdout = '{"type":"system","subtype":"init"}\n{"type":"result","result":"ok","usage":{"input_tokens":50,"cache_read_input_tokens":4000,"cache_creation_input_tokens":1000,"output_tokens":700}}';
    expect(cliUsageOf(stdout)).toEqual({ inputTokens: 5050, outputTokens: 700, cacheReadTokens: 4000, cacheWriteTokens: 1000 });
  });

  it("a client that prints no usage stays unmetered", () => {
    expect(cliUsageOf("plain answer text")).toBeNull();
  });
});
