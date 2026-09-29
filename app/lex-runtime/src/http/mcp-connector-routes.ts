import type { Express, Request, Response } from "express";
import {
  AuthError,
  type AuthService
} from "../auth/service.js";
import type {
  LegalFederationToolRuntime
} from "../legal-federation-tool-runtime.js";
import {
  isLexMcpServerId,
  type LexMcpConnectorStore
} from "../lex-mcp-connectors.js";

function requireAdmin(
  req: Request,
  res: Response,
  authService: AuthService
): boolean {
  return authorize(req, res, authService, true);
}

function requireUser(
  req: Request,
  res: Response,
  authService: AuthService
): boolean {
  return authorize(req, res, authService, false);
}

function authorize(
  req: Request,
  res: Response,
  authService: AuthService,
  adminOnly: boolean
): boolean {
  try {
    const actor = authService.authenticateAuthorization(
      req.get("authorization")
    );
    if (adminOnly && actor.user.appRole !== "ADMIN") {
      res.status(403).json({
        error: "AUTHORIZATION_DENIED"
      });
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.httpStatus).json({
        error: error.code,
        ...(error.retryAfter
          ? { retryAfter: error.retryAfter }
          : {})
      });
      return false;
    }
    throw error;
  }
}

function sendConnectorError(
  res: Response,
  error: unknown
): void {
  const code = error instanceof Error
    ? error.message.split(":", 1)[0]!
    : "LEX_MCP_FAILED";
  const status =
    code === "CEIDG_KEY_NOT_JWT" ||
    code === "CEIDG_KEY_REQUIRED"
      ? 400
      : code === "CEIDG_KEY_REJECTED"
        ? 422
        : code === "CLAUDE_DESKTOP_NOT_INSTALLED" ||
            code === "CLAUDE_DESKTOP_CONFIG_INVALID"
          ? 409
          : code.startsWith("LEX_MCP_")
            ? 503
            : 500;
  res.status(status).json({ error: code });
}

export function registerMcpConnectorRoutes(
  app: Express,
  dependencies: {
    authService: AuthService;
    connectors: LexMcpConnectorStore;
    // Osobna instancja dla karty „Wyszukiwanie” — nie ta, której audyt czytają sesje.
    search: LegalFederationToolRuntime;
  }
): void {
  const { authService, connectors, search } = dependencies;

  app.get(
    "/api/admin/mcp-connectors",
    (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      res.json(connectors.status());
    }
  );

  app.post(
    "/api/admin/mcp-connectors/:server/install",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      try {
        const { tools } = await connectors.install(server, {
          desktop: req.body?.desktop === true
        });
        res.json({ server, tools, status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  app.post(
    "/api/admin/mcp-connectors/:server/check",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      const check = await connectors.check(server);
      res.json({ server, check, status: connectors.status() });
    }
  );

  app.post(
    "/api/admin/mcp-connectors/:server/uninstall",
    (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      try {
        connectors.uninstall(server, {
          desktop: req.body?.desktop === true
        });
        res.json({ server, status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  app.put(
    "/api/admin/mcp-connectors/ceidg/key",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const key = typeof req.body?.key === "string" ? req.body.key : "";
      try {
        const result = await connectors.setCeidgKey(key);
        res.json({ ...result, status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  app.delete(
    "/api/admin/mcp-connectors/ceidg/key",
    (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        connectors.clearCeidgKey();
        res.json({ status: connectors.status() });
      } catch (error) {
        sendConnectorError(res, error);
      }
    }
  );

  // Karta „Wyszukiwanie” (każdy zalogowany użytkownik, tylko odczyt).
  app.get(
    "/api/mcp-search/sources",
    (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const status = connectors.status();
      res.json({
        package: status.package,
        sources: status.servers.map((server) => ({
          id: server.id,
          group: server.group,
          label: server.label,
          ready: server.ready,
          ...(server.lastCheck ? { lastCheck: server.lastCheck } : {})
        }))
      });
    }
  );

  app.get(
    "/api/mcp-search/sources/:server/tools",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const server = String(req.params.server ?? "");
      if (!isLexMcpServerId(server)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      const reply = await search.direct({ source: server });
      if (!reply.ok) {
        res.status(503).json({ error: "MCP_SOURCE_UNAVAILABLE", result: reply.result });
        return;
      }
      const tools = (reply.result as { tools?: unknown }).tools;
      res.json({ source: server, tools: Array.isArray(tools) ? tools : [] });
    }
  );

  app.post(
    "/api/mcp-search/query",
    async (req, res) => {
      if (!requireUser(req, res, authService)) return;
      const source = typeof req.body?.source === "string" ? req.body.source : "";
      const tool = typeof req.body?.tool === "string" ? req.body.tool.trim() : "";
      const args = req.body?.arguments;
      if (!isLexMcpServerId(source)) {
        res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
        return;
      }
      if (!tool) {
        res.status(400).json({ error: "MCP_TOOL_REQUIRED" });
        return;
      }
      if (args !== undefined && (!args || typeof args !== "object" || Array.isArray(args))) {
        res.status(400).json({ error: "MCP_ARGUMENTS_INVALID" });
        return;
      }
      const reply = await search.direct({ source, tool, arguments: args ?? {} });
      res.json({ source, tool, ok: reply.ok, result: reply.result });
    }
  );
}
