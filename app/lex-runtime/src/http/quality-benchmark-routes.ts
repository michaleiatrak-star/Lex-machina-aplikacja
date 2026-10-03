import type { Express, Request, Response } from "express";
import { AuthError, type AuthService } from "../auth/service.js";
import { QualityBenchmarkError, type QualityBenchmarkService } from "../quality-benchmark-service.js";

// Ustawienia → Konserwacja: miernik jakości odpowiedzi (tylko administrator).
const PROVIDERS = new Set(["anthropic", "openai", "xai", "google"]);

function admin(req: Request, res: Response, authService: AuthService): boolean {
  try {
    const context = authService.authenticateAuthorization(req.get("authorization"));
    if (context.user.appRole !== "ADMIN") {
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

function failed(res: Response, error: unknown): void {
  if (error instanceof QualityBenchmarkError) {
    res.status(error.httpStatus).json({ error: error.code });
    return;
  }
  throw error;
}

export function registerQualityBenchmarkRoutes(
  app: Express,
  dependencies: { authService: AuthService; benchmark: QualityBenchmarkService }
): void {
  const { authService, benchmark } = dependencies;

  app.get("/api/admin/quality-benchmark", (req, res) => {
    if (!admin(req, res, authService)) return;
    res.json(benchmark.status());
  });

  app.post("/api/admin/quality-benchmark", (req, res) => {
    if (!admin(req, res, authService)) return;
    const provider = typeof req.body?.provider === "string" ? req.body.provider : "";
    const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    const cases = Array.isArray(req.body?.cases) ? req.body.cases.filter((item: unknown): item is string => typeof item === "string") : undefined;
    const historyChars = req.body?.historyChars === undefined ? undefined : Number(req.body.historyChars);
    if (
      !PROVIDERS.has(provider) ||
      !model ||
      model.length > 200 ||
      model.startsWith("local/") ||
      (historyChars !== undefined && (!Number.isInteger(historyChars) || historyChars < 2_000 || historyChars > 400_000))
    ) {
      res.status(400).json({ error: "QUALITY_BENCHMARK_REQUEST_INVALID" });
      return;
    }
    try {
      res.status(202).json({
        job: benchmark.start({
          authorization: req.get("authorization")!,
          provider,
          model,
          ...(cases?.length ? { cases } : {}),
          ...(historyChars !== undefined ? { historyChars } : {})
        })
      });
    } catch (error) {
      failed(res, error);
    }
  });

  app.post("/api/admin/quality-benchmark/cancel", (req, res) => {
    if (!admin(req, res, authService)) return;
    res.json({ job: benchmark.cancel() });
  });

  app.get("/api/admin/quality-benchmark/reports/:reportId", (req, res) => {
    if (!admin(req, res, authService)) return;
    try {
      res.json(benchmark.report(String(req.params.reportId ?? "")));
    } catch (error) {
      failed(res, error);
    }
  });
}
