import { afterEach, describe, expect, it } from "vitest";
import { claudeCorpusArgs, claudeEffortArgs, claudeEffortRejected, claudeHeadlessArgs, resetClaudeEffortSupport } from "../src/providers/account-session.js";

// Claude through the account gets --effort (task 01): a step or an analysis medium (user 2026-11-24; the case card can set it), completing a
// step's contract medium, a simple question low. An older CLI that rejects it: once without, remembered.
describe("claude --effort", () => {
  afterEach(() => resetClaudeEffortSupport());

  it("the level goes to both CLI forms; none without a level", () => {
    expect(claudeHeadlessArgs("Lex", claudeEffortArgs("high"))).toEqual(expect.arrayContaining(["--effort", "high"]));
    expect(claudeCorpusArgs("Lex", "/tmp/mcp.json", claudeEffortArgs("medium"))).toEqual(expect.arrayContaining(["--effort", "medium"]));
    expect(claudeEffortArgs(undefined)).toEqual([]);
  });

  it("an older CLI rejecting the option: the next calls go without it", () => {
    expect(claudeEffortRejected(new Error("error: unknown option '--effort'"))).toBe(true);
    expect(claudeEffortArgs("high")).toEqual([]);
    // Another error is not taken for it.
    resetClaudeEffortSupport();
    expect(claudeEffortRejected(new Error("ACCOUNT_SESSION_TIMEOUT"))).toBe(false);
    expect(claudeEffortArgs("low")).toEqual(["--effort", "low"]);
  });
});

describe("the turn's effort", () => {
  it("a simple question goes low, an analysis medium, the user's choice wins", async () => {
    const path = await import("node:path");
    const { ProviderGateway, ProviderRegistry } = await import("../src/providers/gateway.js");
    const { LexSkillRegistry } = await import("../src/registry.js");
    const { SafeSessionExecutor } = await import("../src/session-executor.js");
    const registry = new LexSkillRegistry(path.resolve(__dirname, "../../../Wersja rozwojowa rozpakowana"));
    registry.scan();
    const efforts: Array<string | undefined> = [];
    const providers = new ProviderRegistry();
    providers.register({
      id: "openai",
      label: "sim",
      capabilities: { streaming: true, tools: true, reasoning: true, modelDiscovery: false },
      async stream(request) {
        if (!request.systemPrompt.startsWith("Jesteś klasyfikatorem")) efforts.push(request.accountEffort);
        return { fullText: "Odpowiedź symulowana." };
      }
    });
    const executor = new SafeSessionExecutor(registry, new ProviderGateway(providers));
    const ask = (query: string, effort?: string) =>
      executor.execute({ query: `Użytkownik: ${query}`, provider: "openai", model: "account/openai/default", primarySkill: "dr-02-prawo-cywilne-rodzinne-gospodarcze", modelSelectsSkills: true, mode: "PRAWNIK", ...(effort ? { effort } : {}) } as never);
    await ask("Jaki jest termin na wniesienie apelacji?");
    expect(efforts[0]).toBe("low");
    efforts.length = 0;
    await ask("Przeanalizuj odpowiedzialność wykonawcy za wady robót budowlanych i przygotuj warianty roszczeń.");
    expect(efforts[0]).toBe("medium");
    efforts.length = 0;
    await ask("Przeanalizuj odpowiedzialność wykonawcy za wady robót budowlanych i przygotuj warianty roszczeń.", "high");
    expect(efforts[0]).toBe("high");
  }, 120_000);
});
