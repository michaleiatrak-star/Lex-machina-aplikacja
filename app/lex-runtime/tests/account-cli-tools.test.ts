import { afterEach, describe, expect, it } from "vitest";
import { acpClientReply, geminiToolSettings, grokAgentProfile } from "../src/providers/account-session.js";
import { startHttpToolServer, type HttpToolServer } from "../src/providers/lex-tool-bridge.js";

const servers: HttpToolServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

const post = (server: HttpToolServer, body: unknown, token = server.token) =>
  fetch(server.url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

describe("Lex tools over loopback HTTP MCP (Grok under --sandbox strict)", () => {
  it("lists and runs the run's tools behind the bearer token", async () => {
    const calls: string[] = [];
    const server = await startHttpToolServer(
      [{ name: "read_legal_resource", description: "Czyta moduł", parameters: { type: "object", properties: { path: { type: "string" } } } }],
      async (batch) => batch.map((call) => (calls.push(`${call.name}:${JSON.stringify(call.input)}`), { tool_use_id: call.id, content: "TREŚĆ" }))
    );
    servers.push(server);
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/u);
    expect((await post(server, { jsonrpc: "2.0", id: 1, method: "tools/list" }, "zly")).status).toBe(401);
    expect((await post(server, { jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const listed = (await (await post(server, { jsonrpc: "2.0", id: 1, method: "tools/list" })).json()) as { result: { tools: Array<{ name: string }> } };
    expect(listed.result.tools.map((tool) => tool.name)).toEqual(["read_legal_resource"]);
    const called = (await (await post(server, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_legal_resource", arguments: { path: "x.md" } } })).json()) as { result: { content: Array<{ text: string }>; isError: boolean } };
    expect(called.result).toEqual({ content: [{ type: "text", text: "TREŚĆ" }], isError: false });
    const unknown = (await (await post(server, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "run_terminal_command", arguments: {} } })).json()) as { result: { isError: boolean } };
    expect(unknown.result.isError).toBe(true);
    expect(calls).toEqual(['read_legal_resource:{"path":"x.md"}']);
  });
});

describe("Grok (ACP): only the Lex tools", () => {
  const options = [
    { optionId: "always-allow", kind: "allow_always" },
    { optionId: "allow-once", kind: "allow_once" },
    { optionId: "reject-once", kind: "reject_once" }
  ];
  it("allows a Lex tool once and refuses anything else", () => {
    const ask = (tool: string) => acpClientReply({ jsonrpc: "2.0", id: 7, method: "session/request_permission", params: { toolCall: { rawInput: { tool_name: tool } }, options } });
    expect(ask("lex__read_legal_resource")).toEqual({ jsonrpc: "2.0", id: 7, result: { outcome: { outcome: "selected", optionId: "allow-once" } } });
    expect(ask("run_terminal_command")).toEqual({ jsonrpc: "2.0", id: 7, result: { outcome: { outcome: "selected", optionId: "reject-once" } } });
    expect(acpClientReply({ jsonrpc: "2.0", id: 8, method: "fs/read_text_file", params: {} })).toMatchObject({ id: 8, error: { code: -32601 } });
  });

  it("profile: Lex prompt in full, no Grok tools", () => {
    const profile = grokAgentProfile(true);
    expect(profile).toMatch(/^---\nname: lex-machina\n/u);
    expect(profile).toContain("tools: search_tool, use_tool\ninjectDefaultTools: false");
    expect(profile).toContain("promptMode: full");
    expect(profile).toContain("lex__<tool>");
    expect(grokAgentProfile(false)).not.toContain("lex__");
  });
});

describe("Gemini CLI: the Lex server alone", () => {
  it("trusts only the lex server and excludes the CLI's own tools", () => {
    const settings = JSON.parse(geminiToolSettings({ command: "node", args: ["/srv/lex-tools-mcp.js"], env: { LEX_TOOL_PIPE: "p" } })) as {
      mcpServers: Record<string, { trust: boolean; command: string }>;
      tools: { exclude: string[] };
    };
    expect(Object.keys(settings.mcpServers)).toEqual(["lex"]);
    expect(settings.mcpServers.lex).toMatchObject({ command: "node", trust: true });
    for (const tool of ["run_shell_command", "read_file", "write_file", "google_web_search", "web_fetch"]) expect(settings.tools.exclude).toContain(tool);
  });
});
