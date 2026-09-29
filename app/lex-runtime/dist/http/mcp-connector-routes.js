import { AuthError } from "../auth/service.js";
import { isLexMcpServerId } from "../lex-mcp-connectors.js";
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
    const { authService, connectors } = dependencies;
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
