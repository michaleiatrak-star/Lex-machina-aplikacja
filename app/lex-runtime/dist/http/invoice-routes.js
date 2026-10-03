import { AuthError } from "../auth/service.js";
import { INVOICE_SORTS, InvoiceError, invoiceTotals } from "../invoice-store.js";
// Karta „Faktury” i Ustawienia → Faktury i KSeF. Dane każdego użytkownika są
// szyfrowane jego kluczem głównym; token KSeF nie wraca do przeglądarki.
// Ustawa o VAT (akt bazowy); isap_tekst przechodzi do aktualnego tekstu jednolitego.
export const VAT_ACT_ELI = "DU/2004/535";
export const VAT_INVOICE_ARTICLE = "106e";
// Stawka VAT: fragmenty ustawy z frazą stawki, wyszukane w ELI (bez numeru artykułu z pamięci).
export const VAT_RATE_SEARCH = "23%";
function withTotals(invoice) {
    return { ...invoice, totals: invoiceTotals(invoice.lines) };
}
export function registerInvoiceRoutes(app, dependencies) {
    const { authService, invoices, legalText } = dependencies;
    function failed(res, error) {
        if (error instanceof AuthError) {
            res.status(error.httpStatus).json({ error: error.code });
            return;
        }
        if (error instanceof InvoiceError) {
            res.status(error.httpStatus).json({ error: error.code });
            return;
        }
        process.stderr.write(`LEX_INVOICE_FAILED:${error instanceof Error ? error.message : String(error)}\n`);
        res.status(500).json({ error: "INVOICE_FAILED" });
    }
    function handle(action) {
        return async (req, res) => {
            try {
                const context = authService.authenticateAuthorization(req.get("authorization"));
                const result = await authService.withSessionUserMasterKey(context.session.sessionId, (userMasterKey) => action(context, userMasterKey, req));
                res.json(result);
            }
            catch (error) {
                failed(res, error);
            }
        };
    }
    const id = (req) => String(req.params.invoiceId ?? "");
    app.get("/api/invoices/settings", handle(async (context, key) => ({
        ksef: await invoices.ksefSettings(context.user.userId, key),
        ...(await invoices.profile(context.user.userId, key))
    })));
    app.put("/api/invoices/settings/ksef-token", handle(async (context, key, req) => ({
        ksef: await invoices.setKsefToken(context.user.userId, key, req.body?.token, req.body?.contextNip)
    })));
    app.delete("/api/invoices/settings/ksef-token", handle(async (context, key) => ({
        ksef: await invoices.clearKsefToken(context.user.userId, key)
    })));
    app.put("/api/invoices/settings/ksef-environment", handle(async (context, key, req) => ({
        ksef: await invoices.setKsefEnvironment(context.user.userId, key, req.body?.environment, req.body?.confirmProduction)
    })));
    app.put("/api/invoices/settings/seller", handle(async (context, key, req) => ({
        seller: await invoices.setSeller(context.user.userId, key, req.body?.seller)
    })));
    app.put("/api/invoices/settings/defaults", handle(async (context, key, req) => ({
        defaults: await invoices.setDefaults(context.user.userId, key, req.body?.defaults)
    })));
    app.put("/api/invoices/settings/logo", handle(async (context, key, req) => ({
        logo: await invoices.setLogo(context.user.userId, key, req.body ?? {})
    })));
    app.delete("/api/invoices/settings/logo", handle(async (context, key) => {
        await invoices.clearLogo(context.user.userId, key);
        return { ok: true };
    }));
    // Brzmienie art. 106e pobierane na żywo przez ELI (konektor ISAP), nigdy z pamięci.
    app.get("/api/invoices/legal-basis", async (req, res) => {
        try {
            authService.authenticateAuthorization(req.get("authorization"));
        }
        catch (error) {
            failed(res, error);
            return;
        }
        if (!legalText) {
            res.status(503).json({ error: "INVOICE_LEGAL_BASIS_UNAVAILABLE" });
            return;
        }
        const rate = req.query.topic === "vat-rate";
        const reply = await legalText.direct({
            source: "isap",
            tool: "isap_tekst",
            arguments: rate
                ? { eli: VAT_ACT_ELI, szukaj: VAT_RATE_SEARCH }
                : { eli: VAT_ACT_ELI, artykul: VAT_INVOICE_ARTICLE }
        });
        res.status(reply.ok ? 200 : 503).json({
            eli: VAT_ACT_ELI,
            ...(rate ? { search: VAT_RATE_SEARCH } : { article: VAT_INVOICE_ARTICLE }),
            ok: reply.ok,
            result: reply.result,
            retrievedAt: new Date().toISOString()
        });
    });
    app.get("/api/invoices", handle(async (context, key, req) => {
        const sort = String(req.query.sort ?? "date-desc");
        if (!INVOICE_SORTS.includes(sort))
            throw new InvoiceError("INVOICE_SORT_INVALID", 400);
        const query = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
        const list = await invoices.list(context.user.userId, key, query, sort);
        return { invoices: list.map(withTotals) };
    }));
    app.post("/api/invoices", handle(async (context, key, req) => ({
        invoice: withTotals(await invoices.create(context.user.userId, key, req.body?.invoice))
    })));
    app.get("/api/invoices/:invoiceId", handle(async (context, key, req) => ({
        invoice: withTotals(await invoices.get(context.user.userId, key, id(req)))
    })));
    app.put("/api/invoices/:invoiceId", handle(async (context, key, req) => ({
        invoice: withTotals(await invoices.update(context.user.userId, key, id(req), req.body?.invoice))
    })));
    app.delete("/api/invoices/:invoiceId", handle(async (context, key, req) => {
        await invoices.remove(context.user.userId, key, id(req));
        return { ok: true };
    }));
    app.post("/api/invoices/:invoiceId/issue", handle(async (context, key, req) => ({
        invoice: withTotals(await invoices.issue(context.user.userId, key, id(req)))
    })));
    app.post("/api/invoices/:invoiceId/duplicate", handle(async (context, key, req) => ({
        invoice: withTotals(await invoices.duplicate(context.user.userId, key, id(req)))
    })));
}
