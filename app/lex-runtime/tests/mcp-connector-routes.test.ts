import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError, type AuthService } from "../src/auth/service.js";
import { registerMcpConnectorRoutes } from "../src/http/mcp-connector-routes.js";
import { LexMcpConnectorStore } from "../src/lex-mcp-connectors.js";
import type { NormalizedToolCall } from "../src/providers/types.js";

const skillsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../Wersja rozwojowa rozpakowana"
);
const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function auth(role: "ADMIN" | "USER" | null): AuthService {
  return {
    authenticateAuthorization: () => {
      if (!role) throw new AuthError("AUTHENTICATION_REQUIRED" as never, 401);
      return { user: { appRole: role } };
    }
  } as unknown as AuthService;
}

function app(role: "ADMIN" | "USER" | null, calls: NormalizedToolCall[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-mcp-routes-"));
  temporary.push(dir);
  const connectors = new LexMcpConnectorStore(skillsRoot, path.join(dir, "state"), path.join(dir, "none", "c.json"));
  const server = express();
  server.use(express.json());
  registerMcpConnectorRoutes(server, {
    authService: auth(role),
    connectors,
    federation: {
      runTools: async (batch) => {
        calls.push(...batch);
        return batch.map((call) => ({ tool_use_id: call.id, content: JSON.stringify({ status: "OK", echo: call.input }) }));
      }
    }
  });
  return { server, connectors };
}

describe("MCP search and readiness routes", () => {
  it("lists only ready sources to any signed-in user", async () => {
    const { server } = app("USER");
    const response = await request(server).get("/api/mcp-search/sources").expect(200);
    const ids = (response.body.sources as Array<{ id: string }>).map((source) => source.id);
    expect(ids).toContain("isap");
    expect(ids).not.toContain("ceidg");
    await request(app(null).server).get("/api/mcp-search/sources").expect(401);
  });

  it("searches one source through the federation runtime and opens a document", async () => {
    const calls: NormalizedToolCall[] = [];
    const { server } = app("USER", calls);
    const search = await request(server)
      .post("/api/mcp-search")
      .send({ source: "eureka", query: "  ulga na dzieci ", dateFrom: "2025-01-01", limit: 5 })
      .expect(200);
    expect(JSON.parse(search.body.content).status).toBe("OK");
    expect(calls[0]).toMatchObject({
      name: "search_federated_legal_sources",
      input: { source: "eureka", query: "ulga na dzieci", dateFrom: "2025-01-01", limit: 5 }
    });
    await request(server).post("/api/mcp-search/document").send({ source: "eureka", documentId: "123" }).expect(200);
    expect(calls[1]).toMatchObject({ name: "get_federated_legal_document", input: { source: "eureka", documentId: "123" } });
    await request(server).post("/api/mcp-search").send({ source: "nope", query: "x" }).expect(404);
    await request(server).post("/api/mcp-search").send({ source: "isap", query: " " }).expect(400);
  });

  it("checks one server's readiness for admins only, with the package version", async () => {
    const { server } = app("ADMIN");
    const response = await request(server).post("/api/admin/mcp-connectors/nbp/check").expect(200);
    expect(response.body).toMatchObject({ server: "nbp", ready: true, tools: ["nbp_kurs_waluty"] });
    expect(response.body.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
    await request(app("USER").server).post("/api/admin/mcp-connectors/nbp/check").expect(403);
  }, 60_000);
});
