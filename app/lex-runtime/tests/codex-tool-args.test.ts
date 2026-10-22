import { describe, expect, it } from "vitest";
import { codexToolArgs } from "../src/providers/account-session.js";

describe("ChatGPT (Codex CLI) with the Lex tools in one process", () => {
  it("adds only the lex MCP server, auto-approved, without host tools", () => {
    const args = codexToolArgs("/w", "/w/out.txt", "gpt-5.5", { command: "C:\\node.exe", args: ["/srv/lex-tools-mcp.js"], env: { LEX_TOOL_PIPE: "\\\\.\\pipe\\x", LEX_TOOL_TOKEN: "t" } });
    expect(args).not.toContain("mcp_servers={}");
    const server = args[args.indexOf("--config") + 1]!;
    expect(server).toBe(
      'mcp_servers.lex={command="C:\\\\node.exe",args=["/srv/lex-tools-mcp.js"],env={LEX_TOOL_PIPE="\\\\\\\\.\\\\pipe\\\\x",LEX_TOOL_TOKEN="t"},startup_timeout_sec=30,tool_timeout_sec=900,default_tools_approval_mode="approve"}'
    );
    for (const expected of ['approval_policy="never"', 'web_search="disabled"', "read-only", "shell_tool", "unified_exec"]) expect(args).toContain(expected);
    expect(args.at(-1)).toBe("-");
  });
});
