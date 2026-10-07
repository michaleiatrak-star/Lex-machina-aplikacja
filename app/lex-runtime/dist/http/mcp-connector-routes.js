import { CaseLawPreviewService } from "../case-law-preview.js";
import { caseLawRepository } from "../case-law-store.js";
import { SupremeCourtCaseVerifier, supremeCourtCardId } from "../case-law-verifier.js";
import { caseLinkProblem, courtOfSignature } from "../court-of-signature.js";
import { AuthError } from "../auth/service.js";
import { isLexMcpServerId } from "../lex-mcp-connectors.js";
import { fetchSourcePreview } from "../source-preview.js";
function requireAdmin(req, res, authService) {
    return authorize(req, res, authService, true);
}
function requireUser(req, res, authService) {
    return authorize(req, res, authService, false);
}
function authorize(req, res, authService, adminOnly) {
    try {
        const actor = authService.authenticateAuthorization(req.get("authorization"));
        if (adminOnly && actor.user.appRole !== "ADMIN") {
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
        code === "CEIDG_KEY_REQUIRED" ||
        code === "SN_SESSION_EMPTY"
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
    const { authService, connectors, search, previewFetch } = dependencies;
    const caseLawPreview = new CaseLawPreviewService(previewFetch);
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
    app.post("/api/admin/mcp-connectors/:server/check", async (req, res) => {
        if (!requireAdmin(req, res, authService))
            return;
        const server = String(req.params.server ?? "");
        if (!isLexMcpServerId(server)) {
            res.status(404).json({ error: "UNKNOWN_MCP_SERVER" });
            return;
        }
        const check = await connectors.check(server);
        res.json({ server, check, status: connectors.status() });
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
    // Sesja sn.pl po weryfikacji (captcha) wykonanej przez zalogowanego użytkownika w oknie sn.pl aplikacji.
    // Ciasteczek nie zwracamy ani nie logujemy.
    app.put("/api/mcp-search/sn-session", (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const cookie = typeof req.body?.cookie === "string" ? req.body.cookie : "";
        const userAgent = typeof req.body?.userAgent === "string" ? req.body.userAgent : "";
        try {
            res.json(connectors.setSnSession(cookie, userAgent));
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
    // Auto-„Gotowe”: aplikacja sonduje snproxy z bieżącymi ciasteczkami okna sn.pl. Gdy przeszło
    // (brak captchy albo rozwiązana), zapisujemy sesję i zwracamy ready:true — aplikacja ponawia
    // zapytanie bez ręcznego kliknięcia. Ciasteczek nie zwracamy ani nie logujemy.
    app.post("/api/mcp-search/sn-session/probe", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const cookie = typeof req.body?.cookie === "string" ? req.body.cookie : "";
        const userAgent = typeof req.body?.userAgent === "string" ? req.body.userAgent : "";
        try {
            const { ready } = await connectors.probeSnSession(cookie, userAgent);
            if (ready)
                connectors.setSnSession(cookie, userAgent);
            res.json({ ready });
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
    app.delete("/api/mcp-search/sn-session", (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        try {
            connectors.clearSnSession();
            res.json({ cleared: true });
        }
        catch (error) {
            sendConnectorError(res, error);
        }
    });
    // Karta „Wyszukiwanie” (każdy zalogowany użytkownik, tylko odczyt).
    app.get("/api/mcp-search/sources", (req, res) => {
        if (!requireUser(req, res, authService))
            return;
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
    });
    app.get("/api/mcp-search/sources/:server/tools", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
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
        const tools = reply.result.tools;
        res.json({ source: server, tools: Array.isArray(tools) ? tools : [] });
    });
    app.post("/api/mcp-search/query", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
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
    });
    // Pełny tekst orzeczenia / interpretacji (SN, NSA/WSA, SAOS, KIO, EUREKA, UODO, TSUE)
    // z zaznaczonym fragmentem przywołanym w odpowiedzi, do ręcznej weryfikacji kontekstu.
    app.post("/api/case-law/preview", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
        const sourceUrl = text(req.body?.sourceUrl, 2000);
        const passage = text(req.body?.passage, 8000);
        const signature = text(req.body?.signature, 200);
        const attributed = text(req.body?.attributed, 4000);
        const previewCase = text(req.body?.caseId, 100);
        if (!sourceUrl || (req.body?.passage !== undefined && !passage && req.body.passage !== "")) {
            res.status(400).json({ error: "CASE_PREVIEW_INVALID" });
            return;
        }
        try {
            res.json(await caseLawPreview.preview({
                sourceUrl,
                ...(passage ? { passage } : {}),
                ...(signature ? { signature } : {}),
                ...(attributed ? { attributed } : {}),
                ...(previewCase ? { caseId: previewCase } : {})
            }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "";
            const code = /^(SOURCE_PREVIEW|CASE_PREVIEW|SN_FULL_TEXT)_[A-Z0-9_]+$/.test(message) ? message : "CASE_PREVIEW_FAILED";
            res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
        }
    });
    // Kopia orzeczenia zapisana w aplikacji (do akt sprawy); źródłem jest karta orzeczenia.
    app.post("/api/case-law/copy", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const sourceUrl = typeof req.body?.sourceUrl === "string" && req.body.sourceUrl.length <= 2000 ? req.body.sourceUrl.trim() : "";
        const signature = typeof req.body?.signature === "string" && req.body.signature.length <= 200 ? req.body.signature.trim() : "";
        if (!sourceUrl) {
            res.status(400).json({ error: "CASE_PREVIEW_INVALID" });
            return;
        }
        try {
            const caseId = typeof req.body?.caseId === "string" && req.body.caseId.length <= 100 ? req.body.caseId.trim() : "";
            res.json(await caseLawPreview.copy({ sourceUrl, ...(signature ? { signature } : {}), ...(caseId ? { caseId } : {}) }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "";
            const code = /^(SOURCE_PREVIEW|CASE_PREVIEW|SN_FULL_TEXT)_[A-Z0-9_]+$/.test(message) ? message : "CASE_PREVIEW_FAILED";
            res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
        }
    });
    // Orzeczenie wskazane przez użytkownika (karta, sygnatura SN, link blob: z sygnaturą):
    // pobierane z oficjalnej bazy i zapisywane w sprawie; źródłem jest karta.
    const caseVerifier = new SupremeCourtCaseVerifier(previewFetch);
    app.post("/api/case-law/resolve", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const field = (value, max) => (typeof value === "string" && value.length <= max ? value.trim() : "");
        const link = field(req.body?.cardUrl, 2000);
        let signature = field(req.body?.signature, 200);
        const caseId = field(req.body?.caseId, 100);
        try {
            const problem = link ? caseLinkProblem(link) : null;
            if (problem?.signature && !signature)
                signature = problem.signature;
            let cardUrl = link && !problem ? link : "";
            const cardId = cardUrl ? supremeCourtCardId(cardUrl) : null;
            if (cardId)
                cardUrl = `https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=${encodeURIComponent(cardId)}`;
            if (!cardUrl && signature) {
                if (courtOfSignature(signature) !== "SN") {
                    res.status(400).json({ error: "CASE_LAW_SIGNATURE_NOT_SN" });
                    return;
                }
                const verified = await caseVerifier.verify({ claim: `sygn. ${signature}`, signature, toolCallId: `resolve-${Date.now()}` });
                if (verified.status !== "FOUND" || !verified.record?.sourceUrl) {
                    res.status(404).json({ error: `CASE_LAW_${verified.status}`, reason: verified.reason });
                    return;
                }
                cardUrl = verified.record.sourceUrl;
                signature = verified.judgment?.signature ?? signature;
            }
            if (!cardUrl) {
                res.status(400).json({ error: problem?.kind === "BLOB" ? "CASE_LAW_BLOB_NEEDS_SIGNATURE" : "CASE_LAW_REFERENCE_MISSING" });
                return;
            }
            res.json(await caseLawPreview.copy({ sourceUrl: cardUrl, ...(signature ? { signature } : {}), ...(caseId ? { caseId } : {}) }));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "";
            const code = /^(SOURCE_PREVIEW|CASE_PREVIEW|SN_FULL_TEXT|SN)_[A-Z0-9_]+$/.test(message) ? message : "CASE_LAW_RESOLVE_FAILED";
            res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
        }
    });
    // Baza orzeczeń (Ustawienia, domyślnie wyłączona): katalog pobranych orzeczeń.
    app.get("/api/case-law/library", (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const repository = caseLawRepository();
        const query = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
        res.json({ enabled: repository?.libraryEnabled() ?? false, available: Boolean(repository), entries: repository?.catalog(query, 100) ?? [] });
    });
    app.put("/api/case-law/library", (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const repository = caseLawRepository();
        if (!repository || typeof req.body?.enabled !== "boolean") {
            res.status(400).json({ error: "CASE_LAW_LIBRARY_INVALID" });
            return;
        }
        repository.setLibraryEnabled(req.body.enabled);
        res.json({ enabled: repository.libraryEnabled() });
    });
    app.post("/api/case-law/library/remove", (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const cardUrl = typeof req.body?.cardUrl === "string" ? req.body.cardUrl : "";
        res.json({ removed: Boolean(cardUrl) && (caseLawRepository()?.remove(cardUrl) ?? false) });
    });
    // Podgląd strony źródła w aplikacji: tylko oficjalne domeny, bez skryptów.
    app.post("/api/mcp-search/source-preview", async (req, res) => {
        if (!requireUser(req, res, authService))
            return;
        const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
        try {
            const preview = await fetchSourcePreview(url, previewFetch);
            res.json(preview.kind === "pdf"
                ? { kind: "pdf", url: preview.url, base64: preview.data.toString("base64") }
                : preview);
        }
        catch (error) {
            const code = error instanceof Error && /^SOURCE_PREVIEW_[A-Z0-9_]+$/.test(error.message)
                ? error.message
                : "SOURCE_PREVIEW_FAILED";
            res.status(/URL_INVALID|HOST_NOT_ALLOWED|REDIRECT_INVALID/.test(code) ? 400 : 502).json({ error: code });
        }
    });
}
