import type { Express, Request, Response } from "express";
import { AuthError, type AuthService } from "../auth/service.js";
import type { CoreLawIndex } from "../core-law-index.js";

// Settings → Aktualizacje: state of the local copy of law (RAG) and its
// updates. Reading is open to every user; checking and applying updates and
// switching automatic updates change the shared copy, so they are ADMIN-only.

const ELI_PATTERN = /^(DU|MP)\/\d{4}\/\d{1,6}$/;

function actor(req: Request, res: Response, authService: AuthService, admin: boolean): boolean {
  try {
    const context = authService.authenticateAuthorization(req.get("authorization"));
    if (admin && context.user.appRole !== "ADMIN") {
      res.status(403).json({ error: "AUTHORIZATION_DENIED" });
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.httpStatus).json({ error: error.code });
      return false;
    }
    throw error;
  }
}

function background(task: Promise<void>): void {
  void task.catch((error) => {
    process.stderr.write(
      `LEX_CORE_LAW_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}\n`
    );
  });
}

export function registerCoreLawRoutes(
  app: Express,
  dependencies: { authService: AuthService; index: CoreLawIndex }
): void {
  const { authService, index } = dependencies;

  app.get("/api/core-law/status", (req, res) => {
    if (!actor(req, res, authService, false)) return;
    res.json(index.status());
  });

  app.post("/api/core-law/check", (req, res) => {
    if (!actor(req, res, authService, true)) return;
    background(index.checkNow());
    res.status(202).json(index.status());
  });

  app.post("/api/core-law/apply", (req, res) => {
    if (!actor(req, res, authService, true)) return;
    const raw: unknown = req.body?.elis;
    if (
      raw !== undefined &&
      (!Array.isArray(raw) ||
        raw.length > 500 ||
        !raw.every((eli) => typeof eli === "string" && ELI_PATTERN.test(eli)))
    ) {
      res.status(400).json({ error: "CORE_LAW_APPLY_INVALID" });
      return;
    }
    background(index.applyUpdates(raw as string[] | undefined));
    res.status(202).json(index.status());
  });

  app.put("/api/core-law/settings", (req, res) => {
    if (!actor(req, res, authService, true)) return;
    if (typeof req.body?.autoApply !== "boolean") {
      res.status(400).json({ error: "CORE_LAW_SETTINGS_INVALID" });
      return;
    }
    index.setAutoApply(req.body.autoApply);
    res.json(index.status());
  });
}
