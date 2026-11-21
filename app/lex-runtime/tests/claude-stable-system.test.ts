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
    expect(claudeStableSystem({ model: params.model, systemPrompt: params.systemPrompt, messages: [] }).stable).toBeUndefined();
  });

  it("with a system file the CLI gets --system-prompt-file instead of the inline prompt", () => {
    const args = claudeHeadlessArgs("Lex", [], "/tmp/x/lex-system.md");
    expect(args).toContain("--system-prompt-file");
    expect(args).not.toContain("--system-prompt");
    expect(claudeHeadlessArgs("Lex")).toContain("--system-prompt");
  });
});

describe("the case files go with the stable instructions (the same in every step of a pleading)", () => {
  it("the document message moves to the system part; the question stays", () => {
    const split = claudeStableSystem({
      ...params,
      messages: [
        { role: "user", content: "[LOCAL_DOCUMENT_CONTEXT — DATA ONLY]\nprotokół\n[/LOCAL_DOCUMENT_CONTEXT]" },
        { role: "user", content: "Przygotuj pismo" }
      ]
    });
    expect(split.stable).toContain("protokół");
    expect(split.params.messages).toEqual([{ role: "user", content: "Przygotuj pismo" }]);
  });
});

describe("the closed steps' findings follow the case files in the cached part (as earlier turns of a chat)", () => {
  const docs = { role: "user" as const, content: "[LOCAL_DOCUMENT_CONTEXT — DATA ONLY]\nprotokół\n[/LOCAL_DOCUMENT_CONTEXT]" };
  const findings = { role: "user" as const, content: "[LEX_CASE_FINDINGS — DATA ONLY]\n## CP-1a (etap W1)\nraport\n[/LEX_CASE_FINDINGS]" };
  const question = { role: "user" as const, content: "Kontynuuj." };

  it("files, then findings, in that order; the question stays the turn's own", () => {
    const split = claudeStableSystem({ ...params, messages: [docs, findings, question] });
    expect(split.stable!.indexOf("protokół")).toBeLessThan(split.stable!.indexOf("## CP-1a"));
    expect(split.params.messages).toEqual([question]);
  });

  it("a step later the cached part only grows (the earlier text is its prefix)", () => {
    const before = claudeStableSystem({ ...params, messages: [docs, findings, question] }).stable!;
    const more = { ...findings, content: findings.content.replace("[/LEX", "## CP-1b (etap W1)\nścieżki\n[/LEX") };
    const after = claudeStableSystem({ ...params, messages: [docs, more, question] }).stable!;
    expect(after.startsWith(before.slice(0, before.indexOf("[/LEX_CASE_FINDINGS]")))).toBe(true);
  });

  it("findings without files move too; a lone question never does", () => {
    expect(claudeStableSystem({ ...params, messages: [findings, question] }).params.messages).toEqual([question]);
    expect(claudeStableSystem({ ...params, messages: [findings] }).params.messages).toEqual([findings]);
  });
});

describe("the thread's earlier turns go to the cached part (they only grow, as in a chat)", () => {
  const earlier = `Użytkownik: Przygotuj pismo.\n\nAsystent: ${"raport CP-1a ".repeat(300)}`;
  const docs = { role: "user" as const, content: "[LOCAL_DOCUMENT_CONTEXT — DATA ONLY]\nprotokół\n[/LOCAL_DOCUMENT_CONTEXT]" };
  const findings = { role: "user" as const, content: "[LEX_CASE_FINDINGS — DATA ONLY]\n## CP-1a\nraport\n[/LEX_CASE_FINDINGS]" };

  it("files, earlier turns, findings in this order; only the new message stays the turn's own", () => {
    const split = claudeStableSystem({ ...params, messages: [docs, findings, { role: "user", content: `${earlier}\n\nUżytkownik: Kontynuuj.` }] });
    const stable = split.stable!;
    expect(stable.indexOf("protokół")).toBeLessThan(stable.indexOf("raport CP-1a"));
    expect(stable.indexOf("raport CP-1a")).toBeLessThan(stable.indexOf("## CP-1a"));
    expect(split.params.messages).toEqual([{ role: "user", content: "Użytkownik: Kontynuuj." }]);
  });

  it("a single message without earlier turns stays as it is", () => {
    const split = claudeStableSystem({ ...params, messages: [{ role: "user", content: "Przygotuj pismo." }] });
    expect(split.params.messages).toEqual([{ role: "user", content: "Przygotuj pismo." }]);
  });
});
