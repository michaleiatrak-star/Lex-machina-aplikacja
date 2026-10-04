import { describe, expect, it } from "vitest";
import {
  LENGTH_CONTINUATION_PROMPT,
  LENGTH_TRUNCATED_NOTE,
  continueAtLength
} from "../src/providers/ai-sdk-adapter.js";
import type { LlmMessage } from "../src/providers/types.js";

const question: LlmMessage[] = [{ role: "user", content: "Przeanalizuj akta." }];

describe("answer cut at the output limit", () => {
  it("continues from where the answer stopped", async () => {
    const sent: LlmMessage[][] = [];
    const result = await continueAtLength(
      { fullText: "Część pierwsza, zdanie prze", finishReason: "length" },
      async (messages) => {
        sent.push(messages);
        return { fullText: "rwane i koniec.", finishReason: "stop" };
      },
      question
    );
    expect(result.fullText).toBe("Część pierwsza, zdanie przerwane i koniec.");
    expect(sent).toEqual([
      [
        ...question,
        { role: "assistant", content: "Część pierwsza, zdanie prze" },
        { role: "user", content: LENGTH_CONTINUATION_PROMPT }
      ]
    ]);
  });

  it("says so when the answer is still cut after the last continuation", async () => {
    let calls = 0;
    const result = await continueAtLength(
      { fullText: "a", finishReason: "length" },
      async () => {
        calls += 1;
        return { fullText: "b", finishReason: "length" };
      },
      question
    );
    expect(calls).toBe(3);
    expect(result.fullText).toBe("abbb" + LENGTH_TRUNCATED_NOTE);
  });

  it("leaves a finished answer as it is", async () => {
    const result = await continueAtLength({ fullText: "Gotowe.", finishReason: "stop" }, async () => {
      throw new Error("not called");
    }, question);
    expect(result.fullText).toBe("Gotowe.");
  });
});
