import { describe, expect, it } from "vitest";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { isAnthropicModel, streamModel } from "../src/providers/ai-sdk-adapter.js";

// The request the provider sends, answered with a minimal SSE stream.
function capture(kind: "anthropic" | "openai") {
  const bodies: Array<Record<string, unknown>> = [];
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const events =
      kind === "anthropic"
        ? [
            { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "OK" } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
            { type: "message_stop" }
          ].map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
        : [
            `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`,
            `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
            "data: [DONE]\n\n"
          ];
    return new Response(events.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { bodies, fetch: fetch as typeof globalThis.fetch };
}

const params = { systemPrompt: "SYSTEM", messages: [{ role: "user" as const, content: "pytanie" }] } as never;

describe("prompt caching on the API path", () => {
  it("asks Anthropic to cache the prompt (top-level cache_control); the prompt itself is unchanged", async () => {
    const http = capture("anthropic");
    const model = createAnthropic({ apiKey: "test", fetch: http.fetch })("claude-test");
    expect(isAnthropicModel(model)).toBe(true);
    const result = await streamModel(model, params, "Anthropic");
    expect(result.fullText).toBe("OK");
    expect(http.bodies[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(JSON.stringify(http.bodies[0]!.system)).toContain("SYSTEM");
  });

  it("sends no Anthropic option to other providers", async () => {
    const http = capture("openai");
    const model = createOpenAI({ apiKey: "test", fetch: http.fetch }).chat("gpt-test");
    expect(isAnthropicModel(model)).toBe(false);
    await streamModel(model, params, "OpenAI");
    expect(JSON.stringify(http.bodies[0])).not.toContain("cache_control");
  });
});
