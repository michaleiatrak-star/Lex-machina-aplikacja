import { describe, expect, it } from "vitest";
import { claudeHeadlessArgs, claudeStableSystem } from "../src/providers/account-session.js";

const stable = "S".repeat(5_000);
const params = { model: "account/anthropic/default", systemPrompt: `${stable}\n\nKROK: CP-1a, pytanie`, systemPromptCachePrefix: stable.length + 2, messages: [] };

describe("the account's Claude caches the stable Lex instructions as its system prompt", () => {
  it("the engine's stable prefix goes to the system prompt, the rest stays in the message", () => {
    const split = claudeStableSystem(params);
    expect(split.stable).toBe(stable);
    expect(split.params.systemPrompt).toBe("KROK: CP-1a, pytanie");
  });

  it("no prefix (short or trimmed prompt): the whole prompt stays in the message", () => {
    expect(claudeStableSystem({ ...params, systemPromptCachePrefix: undefined }).stable).toBeUndefined();
  });

  it("with a system file the CLI gets --system-prompt-file instead of the inline prompt", () => {
    const args = claudeHeadlessArgs("Lex", [], "/tmp/x/lex-system.md");
    expect(args).toContain("--system-prompt-file");
    expect(args).not.toContain("--system-prompt");
    expect(claudeHeadlessArgs("Lex")).toContain("--system-prompt");
  });
});
