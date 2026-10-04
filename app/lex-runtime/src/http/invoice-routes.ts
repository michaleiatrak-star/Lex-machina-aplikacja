import type { Express, Request, Response } from "express";
import {
  AuthError,
  type AuthService
} from "../auth/service.js";
import type { AuthenticatedContext } from "../auth/types.js";
import { invoicePdf, invoicePdfFileName } from "../invoice-pdf.js";
import {
  INVOICE_SORTS,
  InvoiceError,
  invoiceTotals,
  type EncryptedInvoiceStore,
  type InvoiceRecord,
  type InvoiceSort
} from "../invoice-store.js";
import {
  CATALOG_SECONDARY_SOURCES,
  VAT_ACT_ELI,
  VAT_INVOICE_ARTICLE,
  findLegalText,
  unverifiedReport,
  verifyRequirements
} from "../invoice-requirements.js";

// Karta „Faktury” i Ustawienia → Faktury i KSeF. Dane każdego użytkownika są
// szyfrowane jego kluczem głównym; token KSeF nie wraca do przeglądarki.

export { VAT_ACT_ELI, VAT_INVOICE_ARTICLE } from "../invoice-requirements.js";
// Stawka VAT: fragmenty ustawy z frazą stawki, wyszukane w ELI (bez numeru artykułu z pamięci).
export const VAT_RATE_SEARCH = "23%";

type LegalTextSource = {
  direct(request: {
    source: string;
    tool?: string;
    arguments?: Record<string, unknown>;
  }): Promise<{ ok: boolean; result: unknown }>;
};

function withTotals(invoice: InvoiceRecord) {
  return { ...invoice, totals: invoiceTotals(invoice.lines) };
}

export function registerInvoiceRoutes(
  app: Express,
  dependencies: {
    authService: Pick<AuthService, "authenticateAuthorization" | "withSessionUserMasterKey">;
    invoices: EncryptedInvoiceStore;
    legalText?: LegalTextSource;
  }
): void {
  const { authService, invoices, legalText } = dependencies;

  function failed(res: Response, error: unknown): void {
    if (error instanceof AuthError) {
      res.status(error.httpStatus).json({ error: error.code });
      return;
    }
    if (error instanceof InvoiceError) {
      res.status(error.httpStatus).json({ error: error.code });
      return;
    }
    process.stderr.write(
      `LEX_INVOICE_FAILED:${error instanceof Error ? error.message : String(error)}\n`
    );
    res.status(500).json({ error: "INVOICE_FAILED" });
  }

  function handle(
    action: (
      context: AuthenticatedContext,
      userMasterKey: Buffer,
      req: Request
    ) => Promise<unknown>
  ) {
    return async (req: Request, res: Response) => {
      try {
        const context = authService.authenticateAuthorization(req.get("authorization"));
        const result = await authService.withSessionUserMasterKey(
          context.session.sessionId,
          (userMasterKey) => action(context, userMasterKey, req)
        );
        res.json(result);
      } catch (error) {
        failed(res, error);
      }
    };
  }

  const id = (req: Request) => String(req.params.invoiceId ?? "");

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
    ksef: await invoices.setKsefEnvironment(
      context.user.userId,
      key,
      req.body?.environment,
      req.body?.confirmProduction
    )
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
    } catch (error) {
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
    const retrievedAt = new Date().toISOString();
    const legal = reply.ok ? findLegalText(reply.result) : null;
    // Bez brzmienia z ELI katalog zostaje UNVERIFIED; nie uzupełniamy go z pamięci.
    const report = legal
      ? verifyRequirements(legal.text, {
          retrievedAt,
          ...(legal.sourceUrl ? { sourceUrl: legal.sourceUrl } : {}),
          ...(legal.statusDate ? { statusDate: legal.statusDate } : {})
        })
      : unverifiedReport(reply.ok ? "INVOICE_LEGAL_TEXT_MISSING" : "INVOICE_LEGAL_SOURCE_UNAVAILABLE");
    // 200 także przy awarii źródła: raport z błędem i statusem UNVERIFIED trafia do UI.
    res.json({
      eli: VAT_ACT_ELI,
      ...(rate ? { search: VAT_RATE_SEARCH } : { article: VAT_INVOICE_ARTICLE }),
      ok: reply.ok,
      result: reply.result,
      retrievedAt,
      report,
      secondarySources: CATALOG_SECONDARY_SOURCES
    });
  });

  // Katalog pól generatora bez weryfikacji (status UNVERIFIED do czasu sprawdzenia przez ELI).
  app.get("/api/invoices/requirements", (req, res) => {
    try {
      authService.authenticateAuthorization(req.get("authorization"));
    } catch (error) {
      failed(res, error);
      return;
    }
    res.json({ report: unverifiedReport(), secondarySources: CATALOG_SECONDARY_SOURCES });
  });

  app.put("/api/invoices/settings/numbering", handle(async (context, key, req) => ({
    numbering: await invoices.setNumbering(context.user.userId, key, req.body?.numbering ?? null)
  })));

  app.get("/api/invoices/next-number", handle(async (context, key, req) => {
    const issueDate = String(req.query.issueDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) throw new InvoiceError("INVOICE_FIELD_INVALID:issueDate", 400);
    return { number: await invoices.previewNumber(context.user.userId, key, issueDate) };
  }));

  app.get("/api/invoices", handle(async (context, key, req) => {
    const sort = String(req.query.sort ?? "date-desc") as InvoiceSort;
    if (!INVOICE_SORTS.includes(sort)) throw new InvoiceError("INVOICE_SORT_INVALID", 400);
    const query = typeof req.query.q === "string" ? req.query.q.slice(0, 200) : "";
    const list = await invoices.list(context.user.userId, key, query, sort);
    return { invoices: list.map(withTotals) };
  }));

  // Wzory przed /api/invoices/:invoiceId, żeby "templates" nie było identyfikatorem faktury.
  app.get("/api/invoices/templates", handle(async (context, key) => ({
    templates: await invoices.templates(context.user.userId, key)
  })));

  app.post("/api/invoices/templates", handle(async (context, key, req) => ({
    template: await invoices.saveTemplate(context.user.userId, key, req.body?.template)
  })));

  app.put("/api/invoices/templates/:templateId", handle(async (context, key, req) => ({
    template: await invoices.saveTemplate(context.user.userId, key, req.body?.template, String(req.params.templateId ?? ""))
  })));

  app.delete("/api/invoices/templates/:templateId", handle(async (context, key, req) => {
    await invoices.removeTemplate(context.user.userId, key, String(req.params.templateId ?? ""));
    return { ok: true };
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

  // Eksport faktury do PDF, z logo wystawcy z ustawień (gdy jest ustawione).
  app.get("/api/invoices/:invoiceId/pdf", async (req, res) => {
    try {
      const context = authService.authenticateAuthorization(req.get("authorization"));
      const { invoice, logo } = await authService.withSessionUserMasterKey(
        context.session.sessionId,
        async (userMasterKey) => ({
          invoice: await invoices.get(context.user.userId, userMasterKey, id(req)),
          logo: (await invoices.profile(context.user.userId, userMasterKey)).logo
        })
      );
      const { pdf, logoOmitted } = invoicePdf(invoice, logo ? { logo } : {});
      res
        .status(200)
        .type("application/pdf")
        .set("Content-Disposition", `attachment; filename="${invoicePdfFileName(invoice)}"`)
        .set("Cache-Control", "no-store")
        .set(logoOmitted ? { "X-Lex-Invoice-Logo": `OMITTED:${logoOmitted}` } : {})
        .send(pdf);
    } catch (error) {
      failed(res, error);
    }
  });
}
