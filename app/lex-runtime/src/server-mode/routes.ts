import type { Express, NextFunction, Request, Response } from "express";
import { AuthError, type AuthService } from "../auth/service.js";
import type { AuthenticatedContext, LocalUserStatus } from "../auth/types.js";
import type { ExecutionPhase } from "../execution-steps.js";
import type { ProviderId } from "../providers/types.js";
import { runInAccountScope, type AccountScope } from "./account-scope.js";
import { PROVIDERS, ServerModeError, type ServerModeService } from "./service.js";

/**
 * Local-only features refused in server mode: they act on the machine the
 * runtime runs on (provider CLI logins, local model install/update, the
 * desktop updater, saving to the Downloads folder, opening a file in a local
 * program, writing the Claude Desktop config).
 */
const LOCAL_ONLY: Array<{ method?: string; path: RegExp; when?: (req: Request) => boolean }> = [
  { path: /^\/api\/provider-accounts(?:\/|$)/ },
  { path: /^\/api\/admin\/provider-accounts(?:\/|$)/ },
  { path: /^\/api\/local-models(?:\/|$)/ },
  { path: /^\/api\/update(?:\/|$)/ },
  { path: /^\/api\/downloads\/save$/ },
  { path: /^\/api\/auth\/bootstrap-managed$/ },
  { method: "POST", path: /^\/api\/cases\/[^/]+\/workspace\/items\/[^/]+\/open$/ },
  { method: "POST", path: /^\/api\/admin\/mcp-connectors\/[^/]+\/(?:install|uninstall)$/, when: (req) => req.body?.desktop === true }
];

export function localOnlyRoute(req: Request): boolean {
  return LOCAL_ONLY.some((rule) => (!rule.method || rule.method === req.method) && rule.path.test(req.path) && (!rule.when || rule.when(req)));
}

const MODEL_ROUTES = [/^\/api\/sessions\/execute$/, /^\/api\/cases\/[^/]+\/artifacts\/generate$/];

const POLICY_STATUS: Record<string, number> = {
  TOKEN_LIMIT_REACHED: 429,
  PLAN_REQUIRED: 402,
  PROVIDER_NOT_IN_PLAN: 403,
  SERVER_MODE_LOCAL_ONLY: 403
};

function clientIp(req: Request): string {
  // Behind the firm's reverse proxy (LEX_TRUST_PROXY=1) the first X-Forwarded-For address.
  if (process.env.LEX_TRUST_PROXY?.trim() === "1") {
    const forwarded = req.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ServerModeError) {
    if (error.retryAfterSeconds) res.set("Retry-After", String(error.retryAfterSeconds));
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

export function registerServerModeRoutes(
  app: Express,
  dependencies: {
    authService: Pick<AuthService, "authenticateAuthorization" | "login" | "setUserStatus">;
    serverMode: ServerModeService;
  }
): void {
  const { authService, serverMode } = dependencies;

  const actor = (req: Request): AuthenticatedContext => authService.authenticateAuthorization(req.get("authorization"));

  const handle =
    (work: (req: Request, res: Response) => unknown | Promise<unknown>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await work(req, res);
      } catch (error) {
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

  app.post("/api/server-mode/verify-email", handle((req, res) => {
    serverMode.verifyEmail(req.body ?? {}, clientIp(req));
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

  // Local-only refusal and the account scope (BYOK, plan limits, usage, live turns).
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/") || !serverMode.isEnabled()) {
      next();
      return;
    }
    if (localOnlyRoute(req)) {
      res.status(403).json({ error: "SERVER_MODE_LOCAL_ONLY" });
      return;
    }
    let context: AuthenticatedContext;
    try {
      context = actor(req);
    } catch {
      // The route itself answers the missing or expired session.
      next();
      return;
    }
    const scope: AccountScope = { userId: context.user.userId, sessionId: context.session.sessionId };
    if (req.method === "POST" && MODEL_ROUTES.some((pattern) => pattern.test(req.path))) {
      const provider = typeof req.body?.provider === "string" && (PROVIDERS as string[]).includes(req.body.provider) ? (req.body.provider as ProviderId) : null;
      const model = typeof req.body?.model === "string" ? req.body.model : "";
      try {
        serverMode.assertModelAllowed(context.user.userId, provider, model);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        res.status(POLICY_STATUS[code] ?? 403).json({ error: POLICY_STATUS[code] ? code : "ACCOUNT_POLICY_DENIED" });
        return;
      }
      if (req.path === "/api/sessions/execute") {
        const knowledge = req.body?.knowledge as { caseId?: unknown } | undefined;
        const turnId = serverMode.liveTurns.start({
          userId: context.user.userId,
          loginName: context.user.loginName,
          caseId: knowledge?.caseId,
          skill: req.body?.primarySkill
        });
        scope.turnId = turnId;
        res.locals.lexTurnObserver = (phase: ExecutionPhase, skill: string) => serverMode.liveTurns.step(turnId, phase, skill);
        res.once("finish", () => serverMode.liveTurns.finish(turnId, res.statusCode));
        res.once("close", () => serverMode.liveTurns.finish(turnId, res.writableFinished ? res.statusCode : 499));
      }
    }
    runInAccountScope(scope, next);
  });

  // ---- authenticated ----

  const admin = (req: Request): AuthenticatedContext => {
    const context = actor(req);
    if (context.user.appRole !== "ADMIN") throw new ServerModeError("AUTHORIZATION_DENIED", 403);
    return context;
  };

  app.get("/api/server-mode/settings", handle((req, res) => {
    res.json(serverMode.settings(admin(req)));
  }));

  app.put("/api/server-mode/settings", handle((req, res) => {
    res.json(serverMode.updateSettings(admin(req), req.body ?? {}));
  }));

  app.put("/api/server-mode/enabled", handle((req, res) => {
    const context = admin(req);
    if (typeof req.body?.enabled !== "boolean") throw new ServerModeError("INVALID_REQUEST", 400);
    res.json(serverMode.setEnabled(context, req.body.enabled));
  }));

  app.post("/api/server-mode/smtp/test", handle(async (req, res) => {
    await serverMode.sendTestMail(admin(req), typeof req.body?.to === "string" ? req.body.to.trim() : "");
    res.json({ status: "SENT" });
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
    const status = req.body?.status as LocalUserStatus;
    res.json({ user: authService.setUserStatus(admin(req), String(req.params.userId), status) });
  }));

  app.get("/api/server-mode/turns", handle((req, res) => {
    admin(req);
    res.set("Cache-Control", "no-store");
    res.json({ turns: serverMode.liveTurns.list() });
  }));

  app.get("/api/server-mode/me", handle((req, res) => {
    if (!serverMode.isEnabled()) throw new ServerModeError("SERVER_MODE_DISABLED", 404);
    res.json(serverMode.myAccount(actor(req)));
  }));

  app.put("/api/server-mode/me/keys/:provider", handle(async (req, res) => {
    await serverMode.setByok(actor(req), String(req.params.provider), req.body?.apiKey);
    res.status(204).end();
  }));

  app.delete("/api/server-mode/me/keys/:provider", handle((req, res) => {
    serverMode.clearByok(actor(req), String(req.params.provider));
    res.status(204).end();
  }));
}
