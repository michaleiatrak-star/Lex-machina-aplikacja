import { AuthError } from "../auth/service.js";
import { MICROSOFT_CALLBACK_PATH } from "./config.js";
import { graphFiles, listGraph } from "./graph.js";
import { MicrosoftIntegrationError } from "./oauth.js";
const MAX_IMPORT_ITEMS = 20;
function callbackRedirectUri(req) {
    // Entra ID loopback redirect: 127.0.0.1, any port (Mobile and desktop applications).
    return `http://127.0.0.1:${req.socket.localPort}${MICROSOFT_CALLBACK_PATH}`;
}
function sendError(res, error) {
    if (error instanceof MicrosoftIntegrationError || error instanceof AuthError) {
        res.status(error.httpStatus).json({ error: error.code });
        return;
    }
    res.status(500).json({ error: "MICROSOFT_FLOW_FAILED" });
}
const CALLBACK_PAGE = (ok) => '<!doctype html><html lang="pl"><meta charset="utf-8"><title>Lex Machina</title><body style="font-family:sans-serif;padding:2rem">' +
    (ok
        ? "<p>Połączono z kontem Microsoft. Możesz zamknąć tę kartę i wrócić do aplikacji.</p>"
        : "<p>Nie udało się połączyć z kontem Microsoft. Wróć do aplikacji, aby zobaczyć szczegóły.</p>") +
    "</body></html>";
// Before the /api session middleware: the browser's return has no session.
export function registerMicrosoftPublicRoutes(app, controller) {
    app.get(MICROSOFT_CALLBACK_PATH, async (req, res) => {
        const ok = await controller.handleCallback({ state: req.query.state, code: req.query.code, error: req.query.error });
        res
            .status(ok ? 200 : 400)
            .set("cache-control", "no-store")
            .type("html")
            .send(CALLBACK_PAGE(ok === true));
    });
}
// OneDrive and SharePoint read for the signed-in user; picked files go into a case.
export function registerMicrosoftRoutes(app, controller, context, saveToCase, sendOtherError = () => false) {
    const queryString = (req, key) => {
        const value = req.query[key];
        return typeof value === "string" ? value : "";
    };
    app.get("/api/microsoft/status", async (_req, res) => {
        try {
            res.json(await controller.status(context(res)));
        }
        catch (error) {
            sendError(res, error);
        }
    });
    app.post("/api/microsoft/connect", (req, res) => {
        try {
            res.status(201).json(controller.startConnect(context(res), callbackRedirectUri(req)));
        }
        catch (error) {
            sendError(res, error);
        }
    });
    app.post("/api/microsoft/connect/result", (req, res) => {
        try {
            const body = (req.body ?? {});
            const result = controller.result(String(body.flowId ?? ""), String(body.flowToken ?? ""));
            res.status(result.status === "PENDING" ? 202 : result.status === "FAILED" ? 409 : 200).json(result);
        }
        catch (error) {
            sendError(res, error);
        }
    });
    app.post("/api/microsoft/disconnect", async (_req, res) => {
        try {
            res.json(await controller.disconnect(context(res)));
        }
        catch (error) {
            sendError(res, error);
        }
    });
    app.get("/api/microsoft/files", async (req, res) => {
        try {
            const token = await controller.accessToken(context(res));
            const place = queryString(req, "place");
            const query = queryString(req, "q");
            const next = queryString(req, "next");
            res.json(await listGraph(controller.fetch, token, { ...(place ? { place } : {}), ...(query ? { query } : {}), ...(next ? { next } : {}) }));
        }
        catch (error) {
            sendError(res, error);
        }
    });
    app.post("/api/cases/:caseId/microsoft/import", async (req, res) => {
        const raw = (req.body ?? {});
        const ids = (Array.isArray(raw.itemIds) ? raw.itemIds : []).filter((item) => typeof item === "string" && item.length <= 610);
        if (!ids.length) {
            res.status(400).json({ error: "MICROSOFT_IMPORT_EMPTY" });
            return;
        }
        if (ids.length > MAX_IMPORT_ITEMS) {
            res.status(400).json({ error: "MICROSOFT_IMPORT_TOO_MANY" });
            return;
        }
        try {
            const actor = context(res);
            const token = await controller.accessToken(actor);
            const files = [];
            for (const id of ids)
                files.push(...(await graphFiles(controller.fetch, token, id)));
            const stored = await saveToCase(actor, String(req.params.caseId ?? "").trim(), files);
            res.status(201).json({ files: stored });
        }
        catch (error) {
            if (!(error instanceof MicrosoftIntegrationError) && sendOtherError(res, error))
                return;
            sendError(res, error);
        }
    });
}
