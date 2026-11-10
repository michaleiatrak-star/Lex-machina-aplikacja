import { afterEach, describe, expect, it, vi } from "vitest";
import { streamLocalModel } from "../src/providers/ai-sdk-adapter.js";

// Bielik behind llama.cpp sometimes ends a turn with no text, or with only a reasoning block that
// Lex removes. That was reported as LOCAL_MODEL_INFERENCE_FAILED ("generation did not finish"),
// pointing at llama.cpp. Now: one more sample, then LOCAL_MODEL_EMPTY_ANSWER.
const sse = (content: string) =>
  new Response(
    [`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`, `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`, "data: [DONE]", ""].join("\n"),
    { headers: { "content-type": "text/event-stream" } }
  );

function fakeLlama(answers: string[]) {
  const chat: string[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const target = String(url);
    if (target.endsWith("/tokenize")) return new Response(JSON.stringify({ tokens: new Array(50).fill(1) }), { headers: { "content-type": "application/json" } });
    chat.push(target);
    return sse(answers[Math.min(chat.length - 1, answers.length - 1)]!);
  });
  return chat;
}

const params = { model: "local/bielik", systemPrompt: "Jesteś asystentem prawnym.", messages: [{ role: "user" as const, content: "Jaką odpowiedzialność karną ponosi sprawca?" }] };

afterEach(() => vi.unstubAllGlobals());

describe("pusta odpowiedź modelu lokalnego", () => {
  it("only a reasoning block: a second sample answers", async () => {
    const chat = fakeLlama(["<think>Analiza pytania</think>", "Odpowiada za kradzież (art. 278 § 1 k.k.)."]);
    const result = await streamLocalModel("http://127.0.0.1:1", "bielik", 8192, 3, params as never);
    expect(result.fullText).toContain("art. 278");
    expect(chat).toHaveLength(2);
  });

  it("empty twice: LOCAL_MODEL_EMPTY_ANSWER, not an inference failure", async () => {
    const chat = fakeLlama(["", ""]);
    await expect(streamLocalModel("http://127.0.0.1:1", "bielik", 8192, 3, params as never)).rejects.toThrow(/^LOCAL_MODEL_EMPTY_ANSWER/);
    // stream + JSON fallback per attempt, two attempts
    expect(chat.length).toBeGreaterThanOrEqual(2);
  });
});
