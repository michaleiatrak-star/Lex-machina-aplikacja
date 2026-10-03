import { describe, expect, it } from "vitest";
import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";

type StreamPart =
  Awaited<ReturnType<InstanceType<typeof MockLanguageModelV4>["doStream"]>>["stream"] extends ReadableStream<infer Part> ? Part : never;
import {
  LENGTH_CONTINUATION_PROMPT,
  TOOL_LIMIT_FINAL_PROMPT,
  answerAfterToolLimit,
  streamModel
} from "../src/providers/ai-sdk-adapter.js";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined }
};

function text(id: string, value: string, reason: "stop" | "length") {
  return convertArrayToReadableStream<StreamPart>([
    { type: "stream-start", warnings: [] },
    { type: "text-start", id },
    { type: "text-delta", id, delta: value },
    { type: "text-end", id },
    { type: "finish", finishReason: { unified: reason, raw: reason }, usage }
  ]);
}

function toolCall(id: string) {
  return convertArrayToReadableStream<StreamPart>([
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: id, toolName: "search_case_files", input: JSON.stringify({ query: "termin" }) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_use" }, usage }
  ]);
}

const tools = [{
  type: "function" as const,
  function: {
    name: "search_case_files",
    description: "search",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
  }
}];

describe("hosted model stream limits", () => {
  it("asks for the answer without tools when the tool steps run out", async () => {
    const calls: Array<{ toolChoice: unknown; prompt: string }> = [];
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        calls.push({ toolChoice: options.toolChoice, prompt: JSON.stringify(options.prompt) });
        step += 1;
        return { stream: step <= 2 ? toolCall(`c${step}`) : text("t", "Odpowiedź z wyników.", "stop") };
      }
    });
    const result = await streamModel(model, {
      model: "m",
      systemPrompt: "s",
      messages: [{ role: "user", content: "Pytanie" }],
      tools,
      maxIterations: 2,
      runTools: async (toolCalls) => toolCalls.map((call) => ({ tool_use_id: call.id, content: "WYNIK_NARZEDZIA" }))
    }, "Test");
    expect(result.fullText).toBe("Odpowiedź z wyników.");
    // Two tool steps and the final pass, one input and one output token each.
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 3 });
    expect(calls).toHaveLength(3);
    expect(calls[2]!.toolChoice).toEqual({ type: "none" });
    expect(calls[2]!.prompt).toContain("WYNIK_NARZEDZIA");
    expect(calls[2]!.prompt).toContain(TOOL_LIMIT_FINAL_PROMPT);
  });

  it("continues an answer cut at the output limit", async () => {
    const prompts: string[] = [];
    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        step += 1;
        return { stream: step === 1 ? text("a", "Początek ", "length") : text("b", "i koniec.", "stop") };
      }
    });
    const result = await streamModel(model, { model: "m", systemPrompt: "s", messages: [{ role: "user", content: "Pytanie" }] }, "Test");
    expect(result.fullText).toBe("Początek i koniec.");
    expect(prompts[1]).toContain(LENGTH_CONTINUATION_PROMPT);
  });

  it("leaves an answer that ended normally", async () => {
    const result = await answerAfterToolLimit({ fullText: "Gotowe.", finishReason: "stop" }, async () => {
      throw new Error("not called");
    });
    expect(result.fullText).toBe("Gotowe.");
  });
});

describe("usage meter", () => {
  it("adds up the tokens of every call in a metered turn and counts calls without tokens", async () => {
    const { meterUsage, reportUsage } = await import("../src/providers/usage-meter.js");
    const { usage } = await meterUsage(async () => {
      reportUsage({ inputTokens: 100, outputTokens: 20 });
      await Promise.resolve();
      reportUsage({ inputTokens: 50, outputTokens: 5 });
      reportUsage(null);
    });
    expect(usage).toEqual({ inputTokens: 150, outputTokens: 25, modelCalls: 3, unmeteredCalls: 1 });
    reportUsage({ inputTokens: 1, outputTokens: 1 });
  });
});
