import { describe, expect, it } from "vitest";
import { claudeCorpusArgs, reportNativeReads } from "../src/providers/account-session.js";

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

describe("account model web search (task 8.1)", () => {
  it("is off by default: WebSearch and WebFetch stay disallowed", () => {
    const args = claudeCorpusArgs("sys", "/tmp/mcp.json");
    expect(value(args, "--tools")).toBe("Read,Glob,Grep");
    expect(value(args, "--disallowedTools")).toContain("WebSearch");
    expect(value(args, "--allowedTools")).not.toContain("WebFetch");
  });

  it("when enabled, both tools are allowed and no longer disallowed", () => {
    const args = claudeCorpusArgs("sys", "/tmp/mcp.json", [], undefined, true);
    expect(value(args, "--tools")).toContain("WebSearch");
    expect(value(args, "--allowedTools")).toContain("WebFetch");
    expect(value(args, "--disallowedTools")).not.toMatch(/Web/u);
  });

  it("reports each web use with its query or url", () => {
    const uses: Array<{ tool: string; query?: string; url?: string }> = [];
    const line = (name: string, input: Record<string, unknown>) =>
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
    reportNativeReads(
      { root: "/nonexistent", onWebUse: (use: { tool: string; query?: string; url?: string }) => uses.push(use) } as never,
      [line("WebSearch", { query: "art. 415 kc wina" }), line("WebFetch", { url: "https://example.org/a" })].join("\n")
    );
    expect(uses).toEqual([
      { tool: "WebSearch", query: "art. 415 kc wina" },
      { tool: "WebFetch", url: "https://example.org/a" }
    ]);
  });
});
