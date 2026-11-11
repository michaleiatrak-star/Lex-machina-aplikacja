import type { SkillAutoUpdater } from "../skill-auto-update.js";
import { probeLawSourceSession } from "../eli/law-source-sessions.js";
import { probeWokandaSession, recheckWokandaCourts, wokandaCourtsView, wokandaRegister, wokandaSessionDomains, type FetchText } from "../courts/wokanda.js";
import type { TranscriptionModelManager } from "../transcription.js";
import type { OcrAccelerationManager } from "../ocr/ocr-acceleration.js";
import { ChatTurnJournal } from "../chat-turn-journal.js";
import type { TranscriptionAccelerationManager } from "../transcription-acceleration.js";
import type { Express, Request, Response } from "express";
import {
  AuthError,
  type AuthService
} from "../auth/service.js";
import type {
  LocalBackendPreference,
  LocalModelRuntime
} from "../local-model-runtime.js";
import type { MaintenanceService } from "../maintenance-service.js";
import { isSkillChannel } from "../skill-channel.js";
import type { AnomalyArea, AnomalyJournal, AnomalySeverity } from "../anomaly-journal.js";

function authenticated(
  req: Request,
  authService: AuthService
) {
  return authService.authenticateAuthorization(
    req.get("authorization")
  );
}

function requireAdmin(
  req: Request,
  res: Response,
  authService: AuthService
): ReturnType<typeof authenticated> | null {
  try {
    const actor = authenticated(req, authService);
    if (actor.user.appRole !== "ADMIN") {
      res.status(403).json({
        error: "AUTHORIZATION_DENIED"
      });
      return null;
    }
    return actor;
  } catch (error) {
    if (error instanceof AuthError) {
      res.status(error.httpStatus).json({
        error: error.code,
        ...(error.retryAfter
          ? { retryAfter: error.retryAfter }
          : {})
      });
      return null;
    }
    throw error;
  }
}

function sendMaintenanceError(
  res: Response,
  error: unknown
): void {
  const code = error instanceof Error
    ? error.message.split(":", 1)[0]!
    : "MAINTENANCE_FAILED";
  const status =
    code.includes("IN_PROGRESS")
      ? 409
      : code.includes("NOT_AVAILABLE") ||
          code.includes("UNSUPPORTED") ||
          code.includes("INVALID")
        ? 409
        : code.includes("UNKNOWN")
          ? 404
          : code.includes("MISSING") ||
              code.startsWith("SKILL_CHANNEL_") ||
              code.includes("NOT_VERIFIED") ||
              code.includes("VALIDATION") ||
              code.includes("PROVISIONING_FAILED")
            ? 503
            : 500;
  res.status(status).json({ error: code });
}

export function registerMaintenanceRoutes(
  app: Express,
  dependencies: {
    authService: AuthService;
    localModels: LocalModelRuntime;
    maintenance: MaintenanceService;
    // Automatyczna aktualizacja skilli; ręczne zmiany nakładki idą przez jej kolejkę.
    skillAutoUpdate?: SkillAutoUpdater;
    anomalyJournal?: AnomalyJournal;
    transcriptionModel?: TranscriptionModelManager;
    ocrAcceleration?: OcrAccelerationManager;
    transcriptionAcceleration?: TranscriptionAccelerationManager;
    // Tests: the court sites of the wokanda re-check.
    wokandaFetch?: FetchText;
  }
): void {
  const {
    authService,
    localModels,
    maintenance,
    skillAutoUpdate,
    anomalyJournal,
    transcriptionModel,
    ocrAcceleration,
    transcriptionAcceleration
  } = dependencies;

  // Times of the chat turns on this computer by path and stage (chat-turn-journal.ts): no text.
  app.get("/api/diagnostics/chat-turns", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    res.json(new ChatTurnJournal().summary());
  });

  // Wokandy of the common courts (courts/wokanda.ts): the register with each court's status as
  // this computer last saw it; re-checked on the administrator's request (one page per court).
  app.get("/api/courts/wokanda", (req, res) => {
    try {
      authenticated(req, authService);
      // "sesja": the court's verification window was passed and its session is kept (never the cookies).
      const kept = new Set(wokandaSessionDomains());
      res.json({ checkedAt: wokandaRegister().sprawdzono, courts: wokandaCourtsView().map((court) => (kept.has(court.domena) ? { ...court, sesja: true } : court)) });
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code });
        return;
      }
      throw error;
    }
  });
  app.post("/api/courts/wokanda/recheck", async (req, res) => {
    const names = Array.isArray(req.body?.courts) ? (req.body.courts as unknown[]).filter((name): name is string => typeof name === "string").slice(0, 400) : null;
    // One court after the user's own verification in its window: any signed-in user; more: administrator.
    if (names?.length === 1) {
      try {
        authenticated(req, authService);
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.httpStatus).json({ error: error.code });
          return;
        }
        throw error;
      }
    } else if (!requireAdmin(req, res, authService)) return;
    try {
      res.json({ courts: await recheckWokandaCourts(names && names.length ? names : null, dependencies.wokandaFetch) });
    } catch (error) {
      res.status(500).json({ error: "WOKANDA_RECHECK_FAILED", detail: error instanceof Error ? error.message.slice(0, 200) : "" });
    }
  });

  // A court's browser verification passed by the user in the court's window (as for sn.pl): the
  // window's cookies probed against the court's wokanda; kept for this user's checks when the
  // portal answers. Cookies are neither returned nor logged.
  app.post("/api/courts/wokanda/session/probe", async (req, res) => {
    try {
      authenticated(req, authService);
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code });
        return;
      }
      throw error;
    }
    const domain = typeof req.body?.domain === "string" ? req.body.domain : "";
    const cookie = typeof req.body?.cookie === "string" ? req.body.cookie : "";
    const userAgent = typeof req.body?.userAgent === "string" ? req.body.userAgent : "";
    try {
      res.json(await probeWokandaSession(domain, cookie, userAgent, dependencies.wokandaFetch));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "WOKANDA_SESSION_INVALID" });
    }
  });

  // A law source behind a bot check (law-source-sessions.ts): the check passed by the user in the
  // source's window of the application; its cookies probed against the source and kept when it answers.
  app.post("/api/law-sources/session/probe", async (req, res) => {
    try {
      authenticated(req, authService);
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code });
        return;
      }
      throw error;
    }
    const host = typeof req.body?.host === "string" ? req.body.host : "";
    const cookie = typeof req.body?.cookie === "string" ? req.body.cookie : "";
    const userAgent = typeof req.body?.userAgent === "string" ? req.body.userAgent : "";
    try {
      res.json(await probeLawSourceSession(host, cookie, userAgent));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "LAW_SOURCE_SESSION_INVALID" });
    }
  });

  // OCR on the graphics card (see ocr/ocr-acceleration.ts): downloaded and measured on request.
  if (ocrAcceleration) {
    app.get("/api/local-models/ocr-acceleration", (req, res) => {
      try {
        authenticated(req, authService);
        res.json(ocrAcceleration.status());
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.httpStatus).json({ error: error.code });
          return;
        }
        throw error;
      }
    });
    app.post("/api/local-models/ocr-acceleration/install", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        void ocrAcceleration.start();
        res.status(202).json(ocrAcceleration.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
    app.post("/api/local-models/ocr-acceleration/measure", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        void ocrAcceleration.measure();
        res.status(202).json(ocrAcceleration.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
    app.post("/api/local-models/ocr-acceleration/remove", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        ocrAcceleration.remove();
        res.json(ocrAcceleration.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
  }

  // Transcription on an NVIDIA card (see transcription-acceleration.ts): set up by the app itself;
  // the buttons are for an administrator (developer mode).
  if (transcriptionAcceleration) {
    app.get("/api/local-models/transcription-acceleration", (req, res) => {
      try {
        authenticated(req, authService);
        res.json(transcriptionAcceleration.status());
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.httpStatus).json({ error: error.code });
          return;
        }
        throw error;
      }
    });
    app.post("/api/local-models/transcription-acceleration/install", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        void transcriptionAcceleration.start();
        res.status(202).json(transcriptionAcceleration.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
    app.post("/api/local-models/transcription-acceleration/measure", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        void transcriptionAcceleration.measure();
        res.status(202).json(transcriptionAcceleration.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
    app.post("/api/local-models/transcription-acceleration/remove", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        transcriptionAcceleration.remove();
        res.json(transcriptionAcceleration.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
  }

  // Speech-to-text model for recordings (see transcription.ts): downloaded on request.
  if (transcriptionModel) {
    app.get("/api/local-models/transcription", (req, res) => {
      try {
        authenticated(req, authService);
        res.json(transcriptionModel.status());
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.httpStatus).json({ error: error.code });
          return;
        }
        throw error;
      }
    });
    app.post("/api/local-models/transcription/install", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        void transcriptionModel.start();
        res.status(202).json(transcriptionModel.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
    // How many people speak in recordings: 0 = estimated, 2-12 = known (a hearing: 3), more accurate.
    app.post("/api/local-models/transcription/speakers", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const count = Number(req.body?.count);
      if (!Number.isInteger(count) || count < 0 || count > 12 || count === 1) {
        res.status(400).json({ error: "TRANSCRIPTION_SPEAKERS_INVALID" });
        return;
      }
      transcriptionModel.setSpeakerCount(count);
      res.json(transcriptionModel.status());
    });
    app.post("/api/local-models/transcription/remove", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        transcriptionModel.remove();
        res.json(transcriptionModel.status());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    });
  }

  if (anomalyJournal) {
    const query = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;
    app.get("/api/diagnostics/anomalies", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const severity = query(req.query.severity);
      const area = query(req.query.area);
      const since = query(req.query.since);
      const limit = Number(query(req.query.limit) ?? 200);
      res.json({
        file: anomalyJournal.file,
        summary: anomalyJournal.summary(since),
        entries: anomalyJournal.list({
          limit: Number.isFinite(limit) ? limit : 200,
          ...(severity === "WARN" || severity === "ERROR" ? { severity: severity as AnomalySeverity } : {}),
          ...(area ? { area: area as AnomalyArea } : {}),
          ...(since ? { since } : {})
        })
      });
    });
    app.get("/api/diagnostics/anomalies/export", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="lex-nieprawidlowosci.jsonl"');
      res.send(anomalyJournal.exportJsonl());
    });
    app.delete("/api/diagnostics/anomalies", (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      anomalyJournal.clear();
      res.status(204).end();
    });
  }

  app.get(
    "/api/local-models",
    (req, res) => {
      try {
        authenticated(req, authService);
        res.json({
          provider: "local",
          models: localModels.listModels(),
          runtime: localModels.status()
        });
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.httpStatus).json({
            error: error.code
          });
          return;
        }
        throw error;
      }
    }
  );

  // Vision model for OCR: reads doubtful lines of scans again (see ocr-vision.ts).
  app.get("/api/local-models/vision-ocr", (req, res) => {
    try {
      authenticated(req, authService);
      res.json(localModels.visionOcrStatus());
    } catch (error) {
      if (error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code });
        return;
      }
      throw error;
    }
  });

  app.post("/api/local-models/vision-ocr/install", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    try {
      localModels.installVisionOcr();
      res.status(202).json(localModels.visionOcrStatus());
    } catch (error) {
      sendMaintenanceError(res, error);
    }
  });

  app.post("/api/local-models/vision-ocr/remove", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    try {
      localModels.removeVisionOcr();
      res.json(localModels.visionOcrStatus());
    } catch (error) {
      sendMaintenanceError(res, error);
    }
  });

  app.post(
    "/api/local-models/provision",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        const modelId =
          typeof req.body?.modelId === "string"
            ? req.body.modelId.trim()
            : "";
        const contextTokens = Number(req.body?.contextTokens);
        if (!modelId) {
          res.status(400).json({ error: "LOCAL_MODEL_ID_REQUIRED" });
          return;
        }
        if (!Number.isInteger(contextTokens)) {
          res.status(400).json({ error: "LOCAL_MODEL_CONTEXT_INVALID" });
          return;
        }

        const runtimeBefore =
          localModels.status();
        const rawBackend =
          typeof req.body
            ?.backendPreference ===
            "string"
            ? req.body
                .backendPreference
                .trim()
            : "";
        const backendPreference =
          (
            rawBackend ||
            runtimeBefore
              .hardware
              .backendSelectionMode ||
            runtimeBefore
              .backendPolicy
              .default
          ) as
            LocalBackendPreference;
        if (
          !runtimeBefore
            .backendPolicy
            .allowed
            .includes(
              backendPreference
            )
        ) {
          res.status(400).json({
            error:
              "LOCAL_MODEL_BACKEND_INVALID"
          });
          return;
        }

        const sameModel =
          localModels
            .configuredModelId() ===
            modelId;
        const sameBackendMode =
          runtimeBefore
            .hardware
            .backendSelectionMode ===
            backendPreference;

        const provisioned =
          sameModel &&
          sameBackendMode
            ? await localModels
                .reconfigureContext(
                  modelId,
                  contextTokens
                )
            : await localModels
                .provision(
                  modelId,
                  contextTokens,
                  undefined,
                  backendPreference
                );
        res.json({
          ...provisioned,
          runtime: localModels.status()
        });
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  app.post(
    "/api/local-models/repair",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        const repaired =
          localModels
            .requiresModelPackRepair()
            ? await (async () => {
                const installed =
                  localModels
                    .installedModelUpdateIdentity();
                if (!installed) {
                  throw new Error(
                    "MODEL_PACK_REPAIR_MODEL_NOT_INSTALLED"
                  );
                }
                const target =
                  await maintenance
                    .verifiedModelPackTarget(
                      installed.modelId
                    );
                return await localModels
                  .applyVerifiedModelPack({
                    target,
                    contextTokens:
                      installed
                        .contextTokens,
                    force: true
                  });
              })()
            : await localModels
                .repair();
        res.json({
          ...repaired,
          runtime: localModels.status()
        });
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  app.post(
    "/api/local-models/remove",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        const modelId =
          typeof req.body?.modelId === "string"
            ? req.body.modelId.trim()
            : "";
        if (!modelId) {
          res.status(400).json({
            error: "LOCAL_MODEL_ID_REQUIRED"
          });
          return;
        }
        const removed = await localModels.remove(modelId);
        res.json({
          ...removed,
          runtime: localModels.status()
        });
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  app.post(
    "/api/local-models/start",
    async (req, res) => {
      try {
        authenticated(req, authService);
        const modelId =
          typeof req.body?.modelId === "string"
            ? req.body.modelId
            : "";
        const model = await localModels.ensureRunning(modelId);
        res.json({
          model,
          runtime: localModels.status()
        });
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.httpStatus).json({
            error: error.code
          });
          return;
        }
        sendMaintenanceError(res, error);
      }
    }
  );

  app.post(
    "/api/local-models/stop",
    async (req, res) => {
      try {
        authenticated(req, authService);
        await localModels.stop();
        res.json({
          runtime: localModels.status()
        });
      } catch (error) {
        if (error instanceof AuthError) {
          res.status(error.httpStatus).json({
            error: error.code
          });
          return;
        }
        sendMaintenanceError(res, error);
      }
    }
  );

  app.get(
    "/api/local-models/update/status",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        const requestedModelId =
          typeof req.query.modelId === "string"
            ? req.query.modelId.trim()
            : "";
        const installed =
          localModels.installedModelUpdateIdentity(
            requestedModelId || undefined
          );
        res.json(
          await maintenance.modelPackStatus(
            installed
              ? {
                  modelId:
                    installed.modelId,
                  sha256:
                    installed.sha256,
                  ...(installed.packVersion
                    ? {
                        packVersion:
                          installed.packVersion
                      }
                    : {})
                }
              : null
          )
        );
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  app.post(
    "/api/local-models/update/apply",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        const requestedModelId =
          typeof req.body?.modelId ===
            "string"
            ? req.body.modelId.trim()
            : "";
        const installed =
          localModels.installedModelUpdateIdentity(
            requestedModelId || undefined
          );
        if (!installed) {
          throw new Error(
            "MODEL_PACK_UPDATE_MODEL_NOT_INSTALLED"
          );
        }

        const runtimeBefore =
          localModels.status();
        const requestedContext =
          Number(req.body?.contextTokens);
        const contextTokens =
          Number.isInteger(requestedContext)
            ? requestedContext
            : installed.contextTokens;
        const rawBackend =
          typeof req.body?.backendPreference ===
            "string"
            ? req.body.backendPreference.trim()
            : "";
        const backendPreference =
          (
            rawBackend ||
            runtimeBefore.hardware
              .backendSelectionMode ||
            runtimeBefore.backendPolicy
              .default
          ) as LocalBackendPreference;
        if (
          !runtimeBefore.backendPolicy.allowed
            .includes(backendPreference)
        ) {
          res.status(400).json({
            error:
              "LOCAL_MODEL_BACKEND_INVALID"
          });
          return;
        }

        const target =
          await maintenance
            .verifiedModelPackTarget(
              installed.modelId
            );
        const result =
          await localModels
            .applyVerifiedModelPack({
              target,
              contextTokens,
              backendPreference
            });
        res.json({
          ...result,
          runtime:
            localModels.status(),
          update:
            await maintenance
              .modelPackStatus({
                modelId:
                  installed.modelId,
                sha256:
                  result.receipt
                    .modelSha256,
                packVersion:
                  result.receipt
                    .packVersion
              })
        });
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  app.get(
    "/api/skills/update/status",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        res.json(await maintenance.skillStatus());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  // Skille z repozytorium Lex Machina: kanał rozwojowy albo stabilny.
  app.get(
    "/api/skills/channel/status",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const channel = req.query.channel;
      if (!isSkillChannel(channel)) {
        res.status(400).json({ error: "SKILL_CHANNEL_INVALID" });
        return;
      }
      try {
        res.json(await maintenance.skillChannelStatus(channel));
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  app.post(
    "/api/skills/channel/refresh",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      const channel = req.body?.channel;
      if (!isSkillChannel(channel)) {
        res.status(400).json({ error: "SKILL_CHANNEL_INVALID" });
        return;
      }
      try {
        const work = () => maintenance.refreshSkillsFromChannel(channel);
        const result = skillAutoUpdate ? await skillAutoUpdate.exclusive(work) : await work();
        skillAutoUpdate?.markInstalledManually();
        res.json(result);
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  app.post(
    "/api/skills/update/apply",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        const work = () => maintenance.applySkillUpdate();
        const result = skillAutoUpdate ? await skillAutoUpdate.exclusive(work) : await work();
        skillAutoUpdate?.markInstalledManually();
        res.json(result);
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );

  // Automatyczna aktualizacja skilli: stan, włączenie/wyłączenie, sprawdzenie teraz.
  app.get("/api/skills/auto-update", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    if (!skillAutoUpdate) {
      res.status(404).json({ error: "SKILL_AUTO_UPDATE_UNAVAILABLE" });
      return;
    }
    res.json(skillAutoUpdate.state());
  });

  app.put("/api/skills/auto-update", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    if (!skillAutoUpdate) {
      res.status(404).json({ error: "SKILL_AUTO_UPDATE_UNAVAILABLE" });
      return;
    }
    const enabled = req.body?.enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "SKILL_AUTO_UPDATE_ENABLED_INVALID" });
      return;
    }
    res.json(skillAutoUpdate.setEnabled(enabled));
  });

  app.post("/api/skills/auto-update/run", async (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    if (!skillAutoUpdate) {
      res.status(404).json({ error: "SKILL_AUTO_UPDATE_UNAVAILABLE" });
      return;
    }
    await skillAutoUpdate.runOnce();
    res.json(skillAutoUpdate.state());
  });

  app.get("/api/update/progress", (req, res) => {
    if (!requireAdmin(req, res, authService)) return;
    res.json(maintenance.applicationDownloadProgress());
  });

  app.post(
    "/api/update/download",
    async (req, res) => {
      if (!requireAdmin(req, res, authService)) return;
      try {
        res.json(await maintenance.downloadApplicationUpdate());
      } catch (error) {
        sendMaintenanceError(res, error);
      }
    }
  );
}
