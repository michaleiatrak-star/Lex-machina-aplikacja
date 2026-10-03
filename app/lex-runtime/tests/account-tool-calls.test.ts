import { describe, expect, it } from "vitest";
import { parseToolCalls } from "../src/providers/account-session.js";

const S = "LEX_TOOL_CALLS_JSON:";

describe("account session tool-call protocol", () => {
  it("keeps plain answers and a single block as before", () => {
    expect(parseToolCalls("Odpowiedź końcowa.")).toBeNull();
    expect(parseToolCalls("```json\n" + S + '{"calls":[{"id":"call_1","name":"read","input":{"path":"a"}}]}\n```')).toEqual([
      { id: "call_1", name: "read", input: { path: "a" } }
    ]);
  });

  it("merges several blocks in one round (Codex) and ignores trailing text", () => {
    const output = [
      S + '{"calls":[{"id":"call_1","name":"read","input":{"path":"prawny-router-v3/SKILL.md"}}]}',
      S + '{"calls":[{"id":"call_1","name":"verify","input":{"q":"brace } in \\"string\\""}}]}',
      "Czekam na wyniki."
    ].join("\n");
    expect(() => JSON.parse(output.slice(S.length))).toThrow(/after JSON/);
    expect(parseToolCalls(output)).toEqual([
      { id: "call_1", name: "read", input: { path: "prawny-router-v3/SKILL.md" } },
      { id: "call_1_2", name: "verify", input: { q: 'brace } in "string"' } }
    ]);
  });

  it("rejects a truncated or malformed block with the protocol code", () => {
    expect(() => parseToolCalls(S + '{"calls":[{"name":"read"}')).toThrow("ACCOUNT_SESSION_TOOL_PROTOCOL_INVALID");
    expect(() => parseToolCalls(S + '{"calls":{}}')).toThrow("ACCOUNT_SESSION_TOOL_PROTOCOL_INVALID");
  });
});
