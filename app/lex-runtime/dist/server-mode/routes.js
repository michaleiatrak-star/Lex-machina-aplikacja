import { AuthError } from "../auth/service.js";
import { runInAccountScope } from "./account-scope.js";
import { PROVIDERS, ServerModeError, accountPolicyResponse } from "./service.js";
import { isLoopbackAddress } from "../http/browser-access.js";
/**
 * Local-only features refused in server mode: they act on the machine the
 * runtime runs on (provider CLI logins, the desktop updater, saving to the Downloads folder, opening a file in a local
 * program, writing the Claude Desktop config) and the process-memory API
 * keys of the desktop (the admin sets global keys under /api/server-mode/provider-keys).
 */
const LOCAL_ONLY = [
    { path: /^\/api\/provider-accounts(?:\/|$)/ },
    { path: /^\/api\/admin\/provider-accounts(?:\/|$)/ },
    { path: /^\/api\/admin\/providers\/[^/]+\/credential$/ },
    { path: /^\/api\/update(?:\/|$)/ },
    { path: /^\/api\/downloads\/save$/ },
    { path: /^\/api\/auth\/bootstrap-managed$/ },
    { method: "POST", path: /^\/api\/cases\/[^/]+\/workspace\/items\/[^/]+\/open$/ },
    { method: "POST", path: /^\/api\/admin\/mcp-connectors\/[^/]+\/(?:install|uninstall)$/, when: (req) => req.body?.desktop === true }
];
// The server's local model (llama.cpp on this machine or LEX_LOCAL_LLM_ENDPOINT) is shared by
// all accounts: its install, update and removal are the admin's (requireAdmin in the route),
// and so is stopping it, which would cut the other accounts' turns.
const ADMIN_ONLY_IN_SERVER_MODE = [/^\/api\/local-models\/stop$/];
export function localOnlyRoute(req) {
    return LOCAL_ONLY.some((rule) => (!rule.method || rule.method === req.method) && rule.path.test(req.path) && (!rule.when || rule.when(req)));
}
const MODEL_ROUTES = [/^\/api\/sessions\/execute$/, /^\/api\/cases\/[^/]+\/artifacts\/generate$/];
function clientIp(req) {
    // Behind the firm's reverse proxy (LEX_TRUST_PROXY=1) the first X-Forwarded-For address.
    if (process.env.LEX_TRUST_PROXY?.trim() === "1") {
        const forwarded = req.get("x-forwarded-for")?.split(",")[0]?.trim();
        if (forwarded)
            return forwarded;
    }
    return req.socket.remoteAddress ?? "unknown";
}
function sendError(res, error) {
    if (error instanceof ServerModeError) {
        if (error.retryAfterSeconds)
            res.set("Retry-After", String(error.retryAfterSeconds));
        res.status(error.httpStatus).json({ error: error.code });
        return;
    }
    if (error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code, ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}) });
        return;
    }
    process.stderr.write(`SERVER_MODE_ROUTE_FAILED:${error instanceof Error ? error.message.split(":", 1)[0] : "UNKNOWN"}\n`);
    res.status(500).json({ error: "SERVER_MODE_FAILED" });
}
export function registerServerModeRoutes(app, dependencies) {
    const { authService, serverMode, browserAccess } = dependencies;
    const withBrowser = (settings) => ({
        ...settings,
        browser: browserAccess
            ? {
                state: browserAccess.state,
                port: browserAccess.listeningPort,
                networkAccess: browserAccess.networkAccess,
                addresses: browserAccess.addresses(),
                ...(browserAccess.error ? { error: browserAccess.error } : {})
            }
            : null
    });
    const actor = (req) => authService.authenticateAuthorization(req.get("authorization"));
    const handle = (work) => async (req, res) => {
        try {
            await work(req, res);
        }
        catch (error) {
            sendError(res, error);
        }
    };
    // Public: what the login screen shows (registration, password reset by e-mail).
    app.get("/api/server-mode/status", (_req, res) => {
        const enabled = serverMode.isEnabled();
        res.set("Cache-Control", "no-store");
        res.json({ serverMode: enabled, registration: enabled && serverMode.mailConfigured() });
    });
    app.post("/api/server-mode/register", handle(async (req, res) => {
        await serverMode.register(req.body ?? {}, clientIp(req));
        res.status(202).json({ status: "CHECK_EMAIL" });
    }));
    app.post("/api/server-mode/verify-email", handle(async (req, res) => {
        await serverMode.verifyEmail(req.body ?? {}, clientIp(req));
        res.json({ status: "VERIFIED" });
    }));
    app.post("/api/server-mode/password-reset/request", handle(async (req, res) => {
        await serverMode.requestPasswordReset(req.body ?? {}, clientIp(req));
        res.status(202).json({ status: "CHECK_EMAIL" });
    }));
    app.post("/api/server-mode/password-reset/confirm", handle(async (req, res) => {
        await serverMode.confirmPasswordReset(req.body ?? {}, clientIp(req));
        res.json({ status: "PASSWORD_RESET" });
    }));
    // Server mode login: per-IP limit on top of the per-login backoff, and the
    // UMK escrow for a later password reset by e-mail. Off: the usual route.
    app.post("/api/auth/login", (req, res, next) => {
        if (!serverMode.isEnabled()) {
            next();
            return;
        }
        void handle(async () => {
            serverMode.limitLogin(clientIp(req));
            const result = await authService.login({
                loginName: typeof req.body?.loginName === "string" ? req.body.loginName : "",
                password: typeof req.body?.password === "string" ? req.body.password : ""
            });
            await serverMode.escrowFromSession(result.user.userId, result.session.sessionId).catch(() => undefined);
            res.json(result);
        })(req, res);
    });
    // Local-only refusal and the account scope (plan and global limits, usage, live turns).
    app.use((req, res, next) => {
        if (!req.path.startsWith("/api/") || !serverMode.isEnabled()) {
            next();
            return;
        }
        if (localOnlyRoute(req)) {
            res.status(403).json({ error: "SERVER_MODE_LOCAL_ONLY" });
            return;
        }
        let context;
        try {
            context = actor(req);
        }
        catch {
            // The route itself answers the missing or expired session.
            next();
            return;
        }
        if (context.user.appRole !== "ADMIN" && ADMIN_ONLY_IN_SERVER_MODE.some((pattern) => pattern.test(req.path))) {
            res.status(403).json({ error: "AUTHORIZATION_DENIED" });
            return;
        }
        const scope = { userId: context.user.userId, sessionId: context.session.sessionId };
        if (req.method === "POST" && MODEL_ROUTES.some((pattern) => pattern.test(req.path))) {
            const provider = typeof req.body?.provider === "string" && PROVIDERS.includes(req.body.provider) ? req.body.provider : null;
            const model = typeof req.body?.model === "string" ? req.body.model : "";
            try {
                serverMode.assertModelAllowed(context.user.userId, provider, model);
            }
            catch (error) {
                const refusal = accountPolicyResponse(error instanceof Error ? error.message : "");
                res.status(refusal.status).json(refusal.body);
                return;
            }
            if (req.path === "/api/sessions/execute") {
                const knowledge = req.body?.knowledge;
                const turnId = serverMode.liveTurns.start({
                    userId: context.user.userId,
                    loginName: context.user.loginName,
                    caseId: knowledge?.caseId,
                    skill: req.body?.primarySkill
                });
                scope.turnId = turnId;
                res.locals.lexTurnObserver = (phase, skill) => serverMode.liveTurns.step(turnId, phase, skill);
                res.once("finish", () => serverMode.liveTurns.finish(turnId, res.statusCode));
                res.once("close", () => serverMode.liveTurns.finish(turnId, res.writableFinished ? res.statusCode : 499));
            }
        }
        runInAccountScope(scope, next);
    });
    // ---- authenticated ----
    const admin = (req) => {
        const context = actor(req);
        if (context.user.appRole !== "ADMIN")
            throw new ServerModeError("AUTHORIZATION_DENIED", 403);
        return context;
    };
    app.get("/api/server-mode/settings", handle((req, res) => {
        res.json(withBrowser(serverMode.settings(admin(req))));
    }));
    // Dostęp z sieci: zmienia go administrator tylko z tego komputera (bez pośrednika).
    app.put("/api/server-mode/network", handle(async (req, res) => {
        const context = admin(req);
        const mode = req.body?.mode;
        if (mode !== "LOCAL" && mode !== "NETWORK")
            throw new ServerModeError("INVALID_REQUEST", 400);
        if (!isLoopbackAddress(req.socket.remoteAddress) || req.get("x-forwarded-for")) {
            throw new ServerModeError("NETWORK_CHANGE_LOCAL_ONLY", 403);
        }
        if (!browserAccess || browserAccess.state === "OFF")
            throw new ServerModeError("BROWSER_ACCESS_UNAVAILABLE", 409);
        // Hasło tymczasowe admin/admin nie może być dostępne z sieci.
        if (mode === "NETWORK" && authService.status?.().temporaryAdminCredentialsActive) {
            throw new ServerModeError("TEMPORARY_ADMIN_PASSWORD", 409);
        }
        const settings = serverMode.setNetworkAccess(context, mode);
        // Najpierw odpowiedź, potem nowy nasłuch (zamyka bieżące połączenia).
        res.on("finish", () => {
            void browserAccess.setMode(settings.networkAccess);
        });
        res.json(withBrowser({ ...settings, pendingNetworkAccess: settings.networkAccess }));
    }));
    app.put("/api/server-mode/settings", handle((req, res) => {
        res.json(serverMode.updateSettings(admin(req), req.body ?? {}));
    }));
    app.put("/api/server-mode/enabled", handle((req, res) => {
        const context = admin(req);
        if (typeof req.body?.enabled !== "boolean")
            throw new ServerModeError("INVALID_REQUEST", 400);
        const settings = serverMode.setEnabled(context, req.body.enabled);
        if (browserAccess && settings.networkAccess !== browserAccess.networkAccess) {
            res.on("finish", () => {
                void browserAccess.setMode(settings.networkAccess);
            });
        }
        res.json(withBrowser(settings));
    }));
    app.post("/api/server-mode/smtp/test", handle(async (req, res) => {
        await serverMode.sendTestMail(admin(req), typeof req.body?.to === "string" ? req.body.to.trim() : "");
        res.json({ status: "SENT" });
    }));
    // Global provider API keys: only whether a key is set, never the key.
    app.get("/api/server-mode/provider-keys", handle((req, res) => {
        res.set("Cache-Control", "no-store");
        res.json({ providerKeys: serverMode.providerKeys(admin(req)) });
    }));
    app.put("/api/server-mode/provider-keys/:provider", handle((req, res) => {
        res.json({ providerKeys: serverMode.setProviderKey(admin(req), String(req.params.provider), req.body?.apiKey) });
    }));
    app.delete("/api/server-mode/provider-keys/:provider", handle((req, res) => {
        res.json({ providerKeys: serverMode.clearProviderKey(admin(req), String(req.params.provider)) });
    }));
    app.get("/api/server-mode/plans", handle((req, res) => {
        res.json({ plans: serverMode.listPlans(admin(req)) });
    }));
    app.post("/api/server-mode/plans", handle((req, res) => {
        res.status(201).json({ plan: serverMode.savePlan(admin(req), null, req.body ?? {}) });
    }));
    app.put("/api/server-mode/plans/:planId", handle((req, res) => {
        res.json({ plan: serverMode.savePlan(admin(req), String(req.params.planId), req.body ?? {}) });
    }));
    app.delete("/api/server-mode/plans/:planId", handle((req, res) => {
        serverMode.deletePlan(admin(req), String(req.params.planId));
        res.status(204).end();
    }));
    app.get("/api/server-mode/accounts", handle((req, res) => {
        res.json({ accounts: serverMode.accounts(admin(req)) });
    }));
    app.put("/api/server-mode/accounts/:userId/plan", handle((req, res) => {
        const planId = typeof req.body?.planId === "string" && req.body.planId ? req.body.planId : null;
        serverMode.assignPlan(admin(req), String(req.params.userId), planId);
        res.status(204).end();
    }));
    app.put("/api/server-mode/accounts/:userId/status", handle((req, res) => {
        const status = req.body?.status;
        res.json({ user: authService.setUserStatus(admin(req), String(req.params.userId), status) });
    }));
    app.get("/api/server-mode/turns", handle((req, res) => {
        admin(req);
        res.set("Cache-Control", "no-store");
        res.json({ turns: serverMode.liveTurns.list() });
    }));
    app.get("/api/server-mode/me", handle((req, res) => {
        if (!serverMode.isEnabled())
            throw new ServerModeError("SERVER_MODE_DISABLED", 404);
        res.json(serverMode.myAccount(actor(req)));
    }));
}
