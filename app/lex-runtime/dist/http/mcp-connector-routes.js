import { AuthError } from "../auth/service.js";
import { LEX_MCP_CATALOG, isLexMcpServerId } from "../lex-mcp-connectors.js";
function requireUser(req, res, authService) {
    try {
        authService.authenticateAuthorization(req.get("authorization"));
        return true;
    }
    catch (error) {
        if (error instanceof AuthError) {
            res.status(error.httpStatus).json({ error: error.code });
            return false;
        }
        throw error;
    }
}
function optionalText(value, max = 300) {
    return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}
function requireAdmin(req, res, authService) {
    try {
        const actor = authService.authenticateAuthorization(req.get("authorization"));
        if (actor.user.appRole !== "ADMIN") {
            res.status(403).json({
                error: "AUTHORIZATION_DENIED"
            });
            return false;
        }
        return true;
    }
    catch (error) {
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
function sendConnectorError(res, error) {
    const code = error instanceof Error
        ? error.message.split(":", 1)[0]
        : "LEX_MCP_FAILED";
    const status = code === "CEIDG_KEY_NOT_JWT" ||
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
export function registerMcpConnectorRoutes(app, dependencies) {
    const { authService, connectors, federation } = dependencies;
    // Gotowość jednego serwera: handshake MCP i lista narzędzi (bez zmiany instalacji).
    app.post("/api/admin/mcp-connectors/:server/check", async (req, res) => {
        if (!requireAdmin(req, res, authService))
            return;
        const server = String(req.params.server ?? "");
        if (!isLexMcpServerId(server)) {
            res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
            return;
        }
        try {
            const tools = await connectors.probe(server);
            res.json({
                server,
                ready: true,
                tools,
                packageVersion: connectors.packageVersion(),
                checkedAt: new Date().toISOString()
            });
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
    // Wyszukiwarka (każdy zalogowany użytkownik): tylko zainstalowane źródła.
    app.get("/api/mcp-search/sources", (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const ready = new Set(connectors.readyServers());
        res.json({
            sources: LEX_MCP_CATALOG
                .filter((server) => ready.has(server.id))
                .map(({ id, group, label }) => ({ id, group, label }))
        });
    });
    app.post("/api/mcp-search", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        if (!federation) {
            res.status(503).json({ error: "LEX_MCP_SEARCH_UNAVAILABLE" });
            return;
        }
        const source = String(req.body?.source ?? "");
        const query = optionalText(req.body?.query);
        if (!isLexMcpServerId(source)) {
            res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
            return;
        }
        if (!query) {
            res.status(400).json({ error: "MCP_SEARCH_QUERY_REQUIRED" });
            return;
        }
        const limit = Number(req.body?.limit);
        const [result] = await federation.runTools([
            {
                id: "mcp_search",
                name: "search_federated_legal_sources",
                input: {
                    source,
                    query,
                    ...(optionalText(req.body?.dateFrom, 10) ? { dateFrom: optionalText(req.body?.dateFrom, 10) } : {}),
                    ...(optionalText(req.body?.dateTo, 10) ? { dateTo: optionalText(req.body?.dateTo, 10) } : {}),
                    ...(Number.isInteger(limit) && limit >= 1 && limit <= 50 ? { limit } : {})
                }
            }
        ]);
        res.json({ source, content: result?.content ?? "" });
    });
    app.post("/api/mcp-search/document", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        if (!federation) {
            res.status(503).json({ error: "LEX_MCP_SEARCH_UNAVAILABLE" });
            return;
        }
        const source = String(req.body?.source ?? "");
        const documentId = optionalText(req.body?.documentId, 200);
        if (!isLexMcpServerId(source)) {
            res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
            return;
        }
        if (!documentId) {
            res.status(400).json({ error: "MCP_DOCUMENT_ID_REQUIRED" });
            return;
        }
        const [result] = await federation.runTools([
            {
                id: "mcp_document",
                name: "get_federated_legal_document",
                input: { source, documentId }
            }
        ]);
        res.json({ source, content: result?.content ?? "" });
    });
    app.get("/api/admin/mcp-connectors", (req, res) => {
        if (!requireAdmin(req, res, authService))
            return;
        res.json(connectors.status());
    });
    app.post("/api/admin/mcp-connectors/:server/install", async (req, res) => {
        if (!requireAdmin(req, res, authService))
            return;
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
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
    app.post("/api/admin/mcp-connectors/:server/uninstall", (req, res) => {
        if (!requireAdmin(req, res, authService))
            return;
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
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
    app.put("/api/admin/mcp-connectors/ceidg/key", async (req, res) => {
        if (!requireAdmin(req, res, authService))
            return;
        const key = typeof req.body?.key === "string" ? req.body.key : "";
        try {
            const result = await connectors.setCeidgKey(key);
            res.json({ ...result, status: connectors.status() });
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
    app.delete("/api/admin/mcp-connectors/ceidg/key", (req, res) => {
        if (!requireAdmin(req, res, authService))
            return;
        try {
            connectors.clearCeidgKey();
            res.json({ status: connectors.status() });
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
}
