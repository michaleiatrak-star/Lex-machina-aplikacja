import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type {
  NormalizedToolCall,
  NormalizedToolResult
} from "./types.js";

export type ToolBridge = {
  pipe: string;
  token: string;
  close(): Promise<void>;
};

const MAX_REQUEST_BYTES = 1024 * 1024;

export function bridgePipePath(
  id: string,
  platform: NodeJS.Platform = process.platform
): string {
  return platform === "win32"
    ? `\\\\.\\pipe\\lex-tools-${id}`
    : path.join(os.tmpdir(), `lex-tools-${id}.sock`);
}

function sameToken(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Lex runtime tools for a model CLI running as a separate process: the Lex
 * MCP server started by the CLI (lex-tools-mcp.js) sends each tool call over
 * a private local pipe with a per-run token, and the call runs through the
 * same audited Lex tool runtime as every other model turn.
 */
export async function startToolBridge(
  runTools: (calls: NormalizedToolCall[]) => Promise<NormalizedToolResult[]>,
  onCall?: (call: NormalizedToolCall) => void
): Promise<ToolBridge> {
  const id = crypto.randomBytes(12).toString("hex");
  const token = crypto.randomBytes(32).toString("hex");
  const pipe = bridgePipePath(id);

  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("error", () => socket.destroy());
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.destroy();
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      const line = buffer.slice(0, end);
      buffer = "";
      void (async () => {
        let reply: { content: string; isError: boolean };
        try {
          const request = JSON.parse(line) as { token?: unknown; name?: unknown; input?: unknown };
          if (typeof request.token !== "string" || !sameToken(request.token, token)) {
            socket.destroy();
            return;
          }
          if (typeof request.name !== "string" || !request.name) throw new Error("TOOL_NAME_REQUIRED");
          const call: NormalizedToolCall = {
            id: `mcp_${crypto.randomBytes(6).toString("hex")}`,
            name: request.name,
            input:
              request.input && typeof request.input === "object" && !Array.isArray(request.input)
                ? (request.input as Record<string, unknown>)
                : {}
          };
          onCall?.(call);
          const [result] = await runTools([call]);
          reply = { content: result?.content ?? "", isError: !result };
        } catch (error) {
          reply = { content: error instanceof Error ? error.message : String(error), isError: true };
        }
        socket.end(JSON.stringify(reply) + "\n");
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipe, () => {
      server.off("error", reject);
      resolve();
    });
  });
  if (process.platform !== "win32") {
    try {
      fs.chmodSync(pipe, 0o600);
    } catch {
      // The token still guards the socket.
    }
  }

  return {
    pipe,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        if (process.platform !== "win32") {
          fs.rmSync(pipe, { force: true });
        }
      })
  };
}

export type HttpToolServer = {
  url: string;
  token: string;
  close(): Promise<void>;
};

type ToolSchema = { name: string; description: string; parameters?: Record<string, unknown> };

/**
 * The Lex tools of one run as an MCP server over HTTP on loopback (JSON-RPC answered with
 * JSON), for a client whose MCP connection runs inside its own process: Grok's strict sandbox
 * lets its child processes read only the working directory, so a stdio server of the
 * application could not start there. The per-run bearer token guards it.
 */
export async function startHttpToolServer(
  schemas: ToolSchema[],
  runTools: (calls: NormalizedToolCall[]) => Promise<NormalizedToolResult[]>,
  onCall?: (call: NormalizedToolCall) => void
): Promise<HttpToolServer> {
  const token = crypto.randomBytes(32).toString("hex");
  const answer = async (message: { id?: unknown; method?: unknown; params?: Record<string, unknown> }): Promise<unknown | null> => {
    const id = message.id;
    const method = typeof message.method === "string" ? message.method : "";
    if (id === undefined || id === null) return null;
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "lex", version: "1.0.0" }
        }
      };
    }
    if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
    if (method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: schemas.map((schema) => ({ name: schema.name, description: schema.description, inputSchema: schema.parameters ?? { type: "object", properties: {} } })) }
      };
    }
    if (method === "tools/call") {
      const name = typeof message.params?.name === "string" ? message.params.name : "";
      if (!schemas.some((schema) => schema.name === name)) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `UNKNOWN_TOOL:${name}` }], isError: true } };
      }
      const input = message.params?.arguments;
      const call: NormalizedToolCall = {
        id: `mcp_${crypto.randomBytes(6).toString("hex")}`,
        name,
        input: input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
      };
      try {
        onCall?.(call);
        const [result] = await runTools([call]);
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: result?.content ?? "" }], isError: !result } };
      } catch (error) {
        return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } };
      }
    }
    return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  };
  const server = http.createServer((req, res) => {
    const authorization = req.headers.authorization ?? "";
    if (req.method !== "POST" || !authorization.startsWith("Bearer ") || !sameToken(authorization.slice(7), token)) {
      res.writeHead(req.method === "POST" ? 401 : 405).end();
      return;
    }
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) req.destroy();
    });
    req.on("end", () => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
          return;
        }
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        const replies = (await Promise.all(messages.map((message) => answer(message as Record<string, unknown>)))).filter((reply) => reply !== null);
        if (!replies.length) {
          res.writeHead(202).end();
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
      })();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}
