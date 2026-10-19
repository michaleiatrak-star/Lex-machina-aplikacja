import type {
  Express,
  Request,
  Response
} from "express";
import { AuthError } from "../auth/service.js";
import type { AuthenticatedContext } from "../auth/types.js";
import { GOOGLE_CALLBACK_PATH } from "./config.js";
import { driveFiles, listDrive } from "./drive.js";
import { gmailThreadFiles, searchGmailThreads, type ImportedFile } from "./gmail.js";
import {
  GoogleIntegrationError,
  type GoogleRecoveryController
} from "./recovery-controller.js";
import type { GoogleWorkspaceController } from "./workspace-controller.js";

function callbackRedirectUri(req: Request): string {
  const address = req.socket.localAddress ?? "127.0.0.1";
  const host = address.includes(":")
    ? address === "::ffff:127.0.0.1"
      ? "127.0.0.1"
      : `[${address}]`
    : address;
  return `http://${host}:${req.socket.localPort}${GOOGLE_CALLBACK_PATH}`;
}

function bodyString(req: Request, key: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

function sendError(res: Response, error: unknown): void {
  if (
    error instanceof GoogleIntegrationError ||
    error instanceof AuthError
  ) {
    res.status(error.httpStatus).json({ error: error.code });
    return;
  }
  res.status(500).json({ error: "GOOGLE_FLOW_FAILED" });
}

function sendFlowResult(
  res: Response,
  controller: Pick<GoogleRecoveryController | GoogleWorkspaceController, "result">,
  req: Request
): void {
  try {
    const result = controller.result(
      bodyString(req, "flowId"),
      bodyString(req, "flowToken")
    );
    if (result.status === "PENDING") {
      res.status(202).json(result);
    } else if (result.status === "FAILED") {
      res.status(409).json(result);
    } else {
      res.json(result);
    }
  } catch (error) {
    sendError(res, error);
  }
}

const CALLBACK_PAGE = (ok: boolean) =>
  "<!doctype html><html lang=\"pl\"><meta charset=\"utf-8\">" +
  "<title>Lex Machina</title><body style=\"font-family:sans-serif;padding:2rem\">" +
  (ok
    ? "<p>Połączono z kontem Google. Możesz zamknąć tę kartę i wrócić do aplikacji.</p>"
    : "<p>Nie udało się połączyć z kontem Google. Wróć do aplikacji, aby zobaczyć szczegóły.</p>") +
  "</body></html>";

// Registered before the /api session middleware: the browser callback and
// the forgotten-password flow have no session.
export function registerGooglePublicRoutes(
  app: Express,
  controller: GoogleRecoveryController,
  workspace?: GoogleWorkspaceController
): void {
  app.get(GOOGLE_CALLBACK_PATH, async (req, res) => {
    const query = {
      state: req.query.state,
      code: req.query.code,
      error: req.query.error
    };
    // One redirect URI for both flows: the state says whose it is.
    const ok =
      (await workspace?.handleCallback(query)) ??
      (await controller.handleCallback(query));
    res
      .status(ok ? 200 : 400)
      .set("cache-control", "no-store")
      .type("html")
      .send(CALLBACK_PAGE(ok));
  });

  app.get("/api/auth/google-recovery/available", (_req, res) => {
    res.json({ configured: controller.isConfigured() });
  });

  app.post("/api/auth/google-recovery/start", (req, res) => {
    try {
      res.status(201).json(
        controller.startRecovery(
          bodyString(req, "loginName"),
          bodyString(req, "newPassword"),
          callbackRedirectUri(req)
        )
      );
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/auth/google-recovery/result", (req, res) => {
    sendFlowResult(res, controller, req);
  });
}

export function registerGoogleAuthenticatedRoutes(
  app: Express,
  controller: GoogleRecoveryController,
  context: (res: Response) => AuthenticatedContext
): void {
  app.get("/api/google/status", (_req, res) => {
    res.json(controller.status(context(res)));
  });

  app.post("/api/google/recovery/link/start", async (req, res) => {
    try {
      res.status(201).json(
        await controller.startLink(
          context(res),
          bodyString(req, "password"),
          callbackRedirectUri(req)
        )
      );
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/google/recovery/link/result", (req, res) => {
    sendFlowResult(res, controller, req);
  });

  app.post("/api/google/recovery/unlink", async (req, res) => {
    try {
      res.json(
        await controller.unlink(
          context(res),
          bodyString(req, "password")
        )
      );
    } catch (error) {
      sendError(res, error);
    }
  });
}

export type GoogleImportTarget = (
  context: AuthenticatedContext,
  caseId: string,
  files: ImportedFile[]
) => Promise<unknown[]>;

const MAX_IMPORT_ITEMS = 20;

// Gmail and Drive read for the signed-in user; picked threads and files go into a case.
export function registerGoogleWorkspaceRoutes(
  app: Express,
  workspace: GoogleWorkspaceController,
  context: (res: Response) => AuthenticatedContext,
  saveToCase: GoogleImportTarget,
  sendOtherError: (res: Response, error: unknown) => boolean = () => false
): void {
  const queryString = (req: Request, key: string) => {
    const value = req.query[key];
    return typeof value === "string" ? value : "";
  };

  app.get("/api/google/workspace/status", async (_req, res) => {
    try {
      res.json(await workspace.status(context(res)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/google/workspace/connect", (req, res) => {
    try {
      res.status(201).json(workspace.startConnect(context(res), callbackRedirectUri(req)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/google/workspace/connect/result", (req, res) => {
    sendFlowResult(res, workspace, req);
  });

  app.post("/api/google/workspace/disconnect", async (_req, res) => {
    try {
      res.json(await workspace.disconnect(context(res)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/google/gmail/threads", async (req, res) => {
    try {
      const token = await workspace.accessToken(context(res));
      const pageToken = queryString(req, "pageToken");
      res.json(await searchGmailThreads(workspace.fetch, token, queryString(req, "q"), pageToken || undefined));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get("/api/google/drive/files", async (req, res) => {
    try {
      const token = await workspace.accessToken(context(res));
      const folderId = queryString(req, "folderId");
      const query = queryString(req, "q");
      const pageToken = queryString(req, "pageToken");
      res.json(
        await listDrive(workspace.fetch, token, {
          ...(folderId ? { folderId } : {}),
          ...(query ? { query } : {}),
          ...(pageToken ? { pageToken } : {})
        })
      );
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post("/api/cases/:caseId/google/import", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ids = (key: string) =>
      (Array.isArray(body[key]) ? (body[key] as unknown[]) : []).filter(
        (item): item is string => typeof item === "string" && /^[A-Za-z0-9_-]{1,200}$/u.test(item)
      );
    const threads = ids("gmailThreadIds");
    const drive = ids("driveFileIds");
    if (!threads.length && !drive.length) {
      res.status(400).json({ error: "GOOGLE_IMPORT_EMPTY" });
      return;
    }
    if (threads.length + drive.length > MAX_IMPORT_ITEMS) {
      res.status(400).json({ error: "GOOGLE_IMPORT_TOO_MANY" });
      return;
    }
    try {
      const actor = context(res);
      const token = await workspace.accessToken(actor);
      const files: ImportedFile[] = [];
      for (const id of threads) files.push(...(await gmailThreadFiles(workspace.fetch, token, id)));
      for (const id of drive) files.push(...(await driveFiles(workspace.fetch, token, id)));
      const stored = await saveToCase(actor, String(req.params.caseId ?? "").trim(), files);
      res.status(201).json({ files: stored });
    } catch (error) {
      if (!(error instanceof GoogleIntegrationError) && sendOtherError(res, error)) return;
      sendError(res, error);
    }
  });
}
