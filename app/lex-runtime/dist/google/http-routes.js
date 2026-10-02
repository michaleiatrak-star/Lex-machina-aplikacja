import { AuthError } from "../auth/service.js";
import { GOOGLE_CALLBACK_PATH } from "./config.js";
import { GoogleIntegrationError } from "./recovery-controller.js";
function callbackRedirectUri(req) {
    const address = req.socket.localAddress ?? "127.0.0.1";
    const host = address.includes(":")
        ? address === "::ffff:127.0.0.1"
            ? "127.0.0.1"
            : `[${address}]`
        : address;
    return `http://${host}:${req.socket.localPort}${GOOGLE_CALLBACK_PATH}`;
}
function bodyString(req, key) {
    const value = req.body?.[key];
    return typeof value === "string" ? value : "";
}
function sendError(res, error) {
    if (error instanceof GoogleIntegrationError ||
        error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code });
        return;
    }
    res.status(500).json({ error: "GOOGLE_FLOW_FAILED" });
}
function sendFlowResult(res, controller, req) {
    try {
        const result = controller.result(bodyString(req, "flowId"), bodyString(req, "flowToken"));
        if (result.status === "PENDING") {
            res.status(202).json(result);
        }
        else if (result.status === "FAILED") {
            res.status(409).json(result);
        }
        else {
            res.json(result);
        }
    }
    catch (error) {
        sendError(res, error);
    }
}
const CALLBACK_PAGE = (ok) => "<!doctype html><html lang=\"pl\"><meta charset=\"utf-8\">" +
    "<title>Lex Machina</title><body style=\"font-family:sans-serif;padding:2rem\">" +
    (ok
        ? "<p>Połączono z kontem Google. Możesz zamknąć tę kartę i wrócić do aplikacji.</p>"
        : "<p>Nie udało się połączyć z kontem Google. Wróć do aplikacji, aby zobaczyć szczegóły.</p>") +
    "</body></html>";
// Registered before the /api session middleware: the browser callback and
// the forgotten-password flow have no session.
export function registerGooglePublicRoutes(app, controller) {
    app.get(GOOGLE_CALLBACK_PATH, async (req, res) => {
        const ok = await controller.handleCallback({
            state: req.query.state,
            code: req.query.code,
            error: req.query.error
        });
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
            res.status(201).json(controller.startRecovery(bodyString(req, "loginName"), bodyString(req, "newPassword"), callbackRedirectUri(req)));
        }
        catch (error) {
            sendError(res, error);
        }
    });
    app.post("/api/auth/google-recovery/result", (req, res) => {
        sendFlowResult(res, controller, req);
    });
}
export function registerGoogleAuthenticatedRoutes(app, controller, context) {
    app.get("/api/google/status", (_req, res) => {
        res.json(controller.status(context(res)));
    });
    app.post("/api/google/recovery/link/start", async (req, res) => {
        try {
            res.status(201).json(await controller.startLink(context(res), bodyString(req, "password"), callbackRedirectUri(req)));
        }
        catch (error) {
            sendError(res, error);
        }
    });
    app.post("/api/google/recovery/link/result", (req, res) => {
        sendFlowResult(res, controller, req);
    });
    app.post("/api/google/recovery/unlink", async (req, res) => {
        try {
            res.json(await controller.unlink(context(res), bodyString(req, "password")));
        }
        catch (error) {
            sendError(res, error);
        }
    });
}
