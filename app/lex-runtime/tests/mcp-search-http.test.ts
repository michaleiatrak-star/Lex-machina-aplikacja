import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import request from "supertest";
import {
  afterAll,
  describe,
  expect,
  it
} from "vitest";
import {
  AuthError,
  type AuthService
} from "../src/auth/service.js";
import {
  registerMcpConnectorRoutes
} from "../src/http/mcp-connector-routes.js";
import {
  LegalFederationToolRuntime
} from "../src/legal-federation-tool-runtime.js";
import {
  LexMcpConnectorStore
} from "../src/lex-mcp-connectors.js";

const skillsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../Wersja rozwojowa rozpakowana"
);
const state = fs.mkdtempSync(path.join(os.tmpdir(), "lex-mcp-search-"));

// Token "admin" / "user"; brak nagłówka = brak sesji.
const authService = {
  authenticateAuthorization(header: string | undefined) {
    const role = header?.replace(/^Bearer /, "");
    if (role !== "admin" && role !== "user") {
      throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    }
    return { user: { appRole: role === "admin" ? "ADMIN" : "USER" } };
  }
} as unknown as AuthService;

const connectors = new LexMcpConnectorStore(
  skillsRoot,
  path.join(state, "mcp"),
  path.join(state, "Claude", "claude_desktop_config.json")
);
const search = new LegalFederationToolRuntime(undefined, undefined, connectors);
const app = express();
app.use(express.json());
registerMcpConnectorRoutes(app, { authService, connectors, search });

afterAll(async () => {
  await search.close();
  fs.rmSync(state, { recursive: true, force: true });
});

describe("MCP search tab routes", () => {
  it("lists sources with package integrity for any signed-in user", async () => {
    await request(app).get("/api/mcp-search/sources").expect(401);
    const response = await request(app)
      .get("/api/mcp-search/sources")
      .set("authorization", "Bearer user")
      .expect(200);
    expect(response.body.package.integrity).toBe("MATCH");
    expect(response.body.sources.find((item: { id: string }) => item.id === "ceidg").ready).toBe(false);
    expect(response.body.sources.find((item: { id: string }) => item.id === "nbp").ready).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("packagePath");
  });

  it("stores the sn.pl verification session for a signed-in user without echoing it", async () => {
    await request(app).put("/api/mcp-search/sn-session").send({ cookie: "incap_ses_1=tajne" }).expect(401);
    await request(app).put("/api/mcp-search/sn-session").set("authorization", "Bearer user").send({ cookie: "" }).expect(400);
    const saved = await request(app)
      .put("/api/mcp-search/sn-session")
      .set("authorization", "Bearer user")
      .send({ cookie: "incap_ses_1=tajne", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140.0" })
      .expect(200);
    expect(saved.body.cookies).toBe(1);
    expect(JSON.stringify(saved.body)).not.toContain("tajne");
    await request(app).delete("/api/mcp-search/sn-session").set("authorization", "Bearer user").expect(200);
    expect(connectors.status().sn.sessionSavedAt).toBeNull();
  });

  it("returns the native tool schemas of a source", async () => {
    const response = await request(app)
      .get("/api/mcp-search/sources/nbp/tools")
      .set("authorization", "Bearer user")
      .expect(200);
    expect(response.body.tools.map((tool: { name: string }) => tool.name)).toEqual(["nbp_kurs_waluty"]);
    expect(response.body.tools[0].inputSchema.type).toBe("object");
  }, 60_000);

  it("keeps source gates on direct queries", async () => {
    const mismatch = await request(app)
      .post("/api/mcp-search/query")
      .set("authorization", "Bearer user")
      .send({ source: "isap", tool: "krs_lookup", arguments: {} })
      .expect(200);
    expect(mismatch.body).toMatchObject({ ok: false, result: { error: "FEDERATED_NATIVE_TOOL_SOURCE_MISMATCH" } });

    const ceidg = await request(app)
      .post("/api/mcp-search/query")
      .set("authorization", "Bearer user")
      .send({ source: "ceidg", tool: "ceidg_szukaj", arguments: { nip: "5261040828" } })
      .expect(200);
    expect(ceidg.body).toMatchObject({ ok: false, result: { status: "SOURCE_UNAVAILABLE" } });

    await request(app)
      .post("/api/mcp-search/query")
      .set("authorization", "Bearer user")
      .send({ source: "nbp", tool: "nbp_kurs_waluty", arguments: ["x"] })
      .expect(400);
    await request(app)
      .post("/api/mcp-search/query")
      .set("authorization", "Bearer user")
      .send({ source: "brak", tool: "brak_x" })
      .expect(404);
  });

  it("lets only the admin re-run the readiness handshake", async () => {
    await request(app)
      .post("/api/admin/mcp-connectors/nbp/check")
      .set("authorization", "Bearer user")
      .expect(403);
    const response = await request(app)
      .post("/api/admin/mcp-connectors/nbp/check")
      .set("authorization", "Bearer admin")
      .expect(200);
    expect(response.body.check).toMatchObject({ ok: true, tools: ["nbp_kurs_waluty"] });
    const server = response.body.status.servers.find((item: { id: string }) => item.id === "nbp");
    expect(server.lastCheck.ok).toBe(true);
  }, 60_000);
});
