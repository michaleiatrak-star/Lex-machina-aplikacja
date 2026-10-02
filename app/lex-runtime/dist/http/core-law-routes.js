import { AuthError } from "../auth/service.js";
import { CoreLawActLookupError, lookupCoreLawAct } from "../core-law-act-lookup.js";
// Settings → Aktualizacje: state of the local copy of law (RAG) and its
// updates. Reading is open to every user; checking and applying updates and
// switching automatic updates change the shared copy, so they are ADMIN-only.
const ELI_PATTERN = /^(DU|MP)\/\d{4}\/\d{1,6}$/;
function actor(req, res, authService, admin) {
    try {
        const context = authService.authenticateAuthorization(req.get("authorization"));
        if (admin && context.user.appRole !== "ADMIN") {
            res.status(403).json({ error: "AUTHORIZATION_DENIED" });
            return null;
        }
        return context.user.loginName;
    }
    catch (error) {
        if (error instanceof AuthError) {
            res.status(error.httpStatus).json({ error: error.code });
            return null;
        }
        throw error;
    }
}
function background(task) {
    void task.catch((error) => {
        process.stderr.write(`LEX_CORE_LAW_UPDATE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
    });
}
export function registerCoreLawRoutes(app, dependencies) {
    const { authService, index } = dependencies;
    const fetcher = dependencies.fetcher ?? globalThis.fetch.bind(globalThis);
    function reference(req, res) {
        const value = req.body?.reference;
        if (typeof value !== "string" || !value.trim() || value.length > 500) {
            res.status(400).json({ error: "CORE_LAW_ACT_REFERENCE_INVALID" });
            return null;
        }
        return value;
    }
    function lookupFailed(res, error) {
        if (error instanceof CoreLawActLookupError) {
            res.status(error.httpStatus).json({ error: error.code });
            return;
        }
        throw error;
    }
    app.get("/api/core-law/status", (req, res) => {
        if (actor(req, res, authService, false) === null)
            return;
        res.json(index.status());
    });
    app.post("/api/core-law/check", (req, res) => {
        if (actor(req, res, authService, true) === null)
            return;
        background(index.checkNow());
        res.status(202).json(index.status());
    });
    app.post("/api/core-law/apply", (req, res) => {
        if (actor(req, res, authService, true) === null)
            return;
        const raw = req.body?.elis;
        if (raw !== undefined &&
            (!Array.isArray(raw) ||
                raw.length > 500 ||
                !raw.every((eli) => typeof eli === "string" && ELI_PATTERN.test(eli)))) {
            res.status(400).json({ error: "CORE_LAW_APPLY_INVALID" });
            return;
        }
        background(index.applyUpdates(raw));
        res.status(202).json(index.status());
    });
    app.put("/api/core-law/settings", (req, res) => {
        if (actor(req, res, authService, true) === null)
            return;
        if (typeof req.body?.autoApply !== "boolean") {
            res.status(400).json({ error: "CORE_LAW_SETTINGS_INVALID" });
            return;
        }
        index.setAutoApply(req.body.autoApply);
        res.json(index.status());
    });
    // Additional acts (ISAP address, ELI or Dz.U./M.P. reference): always
    // checked in Sejm ELI; the newest consolidated text goes into the copy.
    app.post("/api/core-law/acts/lookup", async (req, res) => {
        if (actor(req, res, authService, true) === null)
            return;
        const value = reference(req, res);
        if (value === null)
            return;
        try {
            const act = await lookupCoreLawAct(value, fetcher);
            res.json({ act, presentAs: index.present([act.currentEli, act.baseEli, act.inputEli]) });
        }
        catch (error) {
            lookupFailed(res, error);
        }
    });
    app.post("/api/core-law/acts", async (req, res) => {
        const login = actor(req, res, authService, true);
        if (login === null)
            return;
        const value = reference(req, res);
        if (value === null)
            return;
        try {
            const act = await lookupCoreLawAct(value, fetcher);
            const result = index.addUserAct(act, login);
            if (!result.added) {
                res.status(409).json({ error: "CORE_LAW_ACT_ALREADY_PRESENT", eli: result.eli });
                return;
            }
            res.status(201).json({ act, status: index.status() });
        }
        catch (error) {
            lookupFailed(res, error);
        }
    });
    app.post("/api/core-law/acts/remove", (req, res) => {
        if (actor(req, res, authService, true) === null)
            return;
        const eli = req.body?.eli;
        if (typeof eli !== "string" || !ELI_PATTERN.test(eli)) {
            res.status(400).json({ error: "CORE_LAW_ACT_REFERENCE_INVALID" });
            return;
        }
        if (!index.removeUserAct(eli)) {
            res.status(404).json({ error: "CORE_LAW_USER_ACT_NOT_FOUND" });
            return;
        }
        res.json(index.status());
    });
}
