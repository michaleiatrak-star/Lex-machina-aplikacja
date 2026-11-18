import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configureUsageLog, recordTurnUsage, usageOwner, usageSummary } from "../src/usage-log.js";

const usage = (input: number, output: number, unmetered = 0) => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWriteTokens: 0, modelCalls: 2, unmeteredCalls: unmetered });

describe("Ustawienia > Zużycie", () => {
  it("adds each turn's tokens under its account, month and model; other accounts apart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-usage-"));
    configureUsageLog(dir);
    const now = new Date("2026-11-18T10:00:00Z");
    await usageOwner.run("user_a", () => Promise.all([recordTurnUsage("openai", "gpt-x", usage(1000, 200), now), recordTurnUsage("openai", "gpt-x", usage(500, 100), now)]));
    await usageOwner.run("user_a", () => recordTurnUsage("anthropic", "claude-y", usage(0, 0, 2), now));
    await usageOwner.run("user_b", () => recordTurnUsage("openai", "gpt-x", usage(7, 7), now));
    // Without an account (no chat route) nothing is written.
    await recordTurnUsage("openai", "gpt-x", usage(9, 9), now);
    const [november, october] = usageSummary("user_a", 2, now);
    expect(november!.month).toBe("2026-11");
    expect(november!.total).toMatchObject({ inputTokens: 1500, outputTokens: 300, turns: 3, unmeteredCalls: 2 });
    expect(november!.models[0]).toMatchObject({ model: "openai/gpt-x", inputTokens: 1500, turns: 2 });
    expect(october!.total.turns).toBe(0);
    expect(usageSummary("user_b", 1, now)[0]!.total.inputTokens).toBe(7);
    // An account id never becomes a path outside the folder.
    expect(usageSummary("../etc", 1, now)[0]!.total.turns).toBe(0);
    configureUsageLog(null);
  });
});
