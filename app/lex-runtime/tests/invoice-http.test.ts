import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { AuthError, type AuthService } from "../src/auth/service.js";
import { registerInvoiceRoutes } from "../src/http/invoice-routes.js";
import { EncryptedInvoiceStore } from "../src/invoice-store.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-invoice-http-"));
const keys = new Map([
  ["user_alice", randomBytes(32)],
  ["user_bob", randomBytes(32)]
]);

// Token = identyfikator użytkownika; brak nagłówka = brak sesji.
const authService = {
  authenticateAuthorization(header: string | undefined) {
    const userId = header?.replace(/^Bearer /, "") ?? "";
    if (!keys.has(userId)) throw new AuthError("AUTHENTICATION_REQUIRED", 401);
    return { user: { userId, appRole: "USER" }, session: { sessionId: userId } };
  },
  async withSessionUserMasterKey<T>(sessionId: string, callback: (key: Buffer) => T | Promise<T>) {
    return callback(keys.get(sessionId)!);
  }
} as unknown as AuthService;

const legalCalls: unknown[] = [];
const app = express();
app.use(express.json({ limit: "2mb" }));
registerInvoiceRoutes(app, {
  authService,
  invoices: new EncryptedInvoiceStore({ rootDir: root }),
  legalText: {
    async direct(input) {
      legalCalls.push(input);
      return { ok: true, result: { status: "FOUND" } };
    }
  }
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const invoice = {
  number: "FV 1/2026",
  issueDate: "2026-10-01",
  seller: { name: "Kancelaria", nip: "1234563218", address: "Warszawa" },
  buyer: { name: "Klient", address: "Kraków" },
  lines: [{ name: "Usługa", unit: "szt.", quantity: "2", unitNetPrice: "100", vatRate: "23" }]
};

describe("invoice routes", () => {
  it("requires a session", async () => {
    await request(app).get("/api/invoices").expect(401);
    await request(app).get("/api/invoices/legal-basis").expect(401);
  });

  it("never returns the KSeF token and keeps users apart", async () => {
    const saved = await request(app)
      .put("/api/invoices/settings/ksef-token")
      .set("authorization", "Bearer user_alice")
      .send({ token: "alice-secret-token-1234" })
      .expect(200);
    expect(saved.body.ksef).toMatchObject({ environment: "test", tokenConfigured: true, tokenHint: "…1234" });
    const settings = await request(app).get("/api/invoices/settings").set("authorization", "Bearer user_alice").expect(200);
    expect(JSON.stringify(settings.body)).not.toContain("alice-secret");
    const bob = await request(app).get("/api/invoices/settings").set("authorization", "Bearer user_bob").expect(200);
    expect(bob.body.ksef.tokenConfigured).toBe(false);
  });

  it("refuses production without confirmation", async () => {
    const refused = await request(app)
      .put("/api/invoices/settings/ksef-environment")
      .set("authorization", "Bearer user_alice")
      .send({ environment: "production" })
      .expect(400);
    expect(refused.body.error).toBe("KSEF_PRODUCTION_CONFIRMATION_REQUIRED");
  });

  it("creates, lists with totals, issues and duplicates invoices", async () => {
    const created = await request(app)
      .post("/api/invoices")
      .set("authorization", "Bearer user_alice")
      .send({ invoice })
      .expect(200);
    expect(created.body.invoice.totals).toMatchObject({ net: "200.00", vat: "46.00", gross: "246.00" });
    const id = created.body.invoice.invoiceId as string;
    await request(app).get(`/api/invoices/${id}`).set("authorization", "Bearer user_bob").expect(404);
    await request(app).post(`/api/invoices/${id}/issue`).set("authorization", "Bearer user_alice").expect(200);
    const copy = await request(app).post(`/api/invoices/${id}/duplicate`).set("authorization", "Bearer user_alice").expect(200);
    expect(copy.body.invoice).toMatchObject({ number: "FV 2/2026", status: "DRAFT", basedOnInvoiceId: id });
    const list = await request(app)
      .get("/api/invoices?q=fv&sort=client-asc")
      .set("authorization", "Bearer user_alice")
      .expect(200);
    expect(list.body.invoices).toHaveLength(2);
    await request(app).get("/api/invoices?sort=random").set("authorization", "Bearer user_alice").expect(400);
  });

  it("fetches art. 106e through the ISAP (ELI) connector", async () => {
    const response = await request(app).get("/api/invoices/legal-basis").set("authorization", "Bearer user_alice").expect(200);
    expect(response.body).toMatchObject({ eli: "DU/2004/535", article: "106e", ok: true });
    expect(legalCalls).toEqual([{ source: "isap", tool: "isap_tekst", arguments: { eli: "DU/2004/535", artykul: "106e" } }]);
  });

  it("searches the VAT act in ELI for the rate instead of a remembered article", async () => {
    legalCalls.length = 0;
    const response = await request(app)
      .get("/api/invoices/legal-basis?topic=vat-rate")
      .set("authorization", "Bearer user_alice")
      .expect(200);
    expect(response.body).toMatchObject({ eli: "DU/2004/535", search: "23%", ok: true });
    expect(legalCalls).toEqual([{ source: "isap", tool: "isap_tekst", arguments: { eli: "DU/2004/535", szukaj: "23%" } }]);
  });

  it("saves reusable invoice templates per user", async () => {
    const template = {
      name: "Stała obsługa Spółki X",
      buyer: { name: "Spółka X", nip: "5260250274", address: "ul. Krzywa 2, 30-001 Kraków" },
      lines: [{ name: "Obsługa prawna (ryczałt)", unit: "mies.", quantity: "1", unitNetPrice: "3000", vatRate: "23" }],
      currency: "PLN",
      paymentMethod: "przelew",
      paymentTermDays: 14
    };
    const auth = { authorization: "Bearer user_alice" };
    const created = await request(app).post("/api/invoices/templates").set(auth).send({ template }).expect(200);
    expect(created.body.template).toMatchObject({ name: template.name, paymentTermDays: 14 });
    expect(created.body.template.templateId).toMatch(/^tpl_[0-9a-f]{32}$/);
    await request(app).post("/api/invoices/templates").set(auth).send({ template: { ...template, name: "stała obsługa spółki x" } }).expect(409);
    const id = created.body.template.templateId;
    await request(app)
      .put(`/api/invoices/templates/${id}`)
      .set(auth)
      .send({ template: { ...template, paymentTermDays: 30 } })
      .expect(200);
    const list = await request(app).get("/api/invoices/templates").set(auth).expect(200);
    expect(list.body.templates).toHaveLength(1);
    expect(list.body.templates[0].paymentTermDays).toBe(30);
    const other = await request(app).get("/api/invoices/templates").set("authorization", "Bearer user_bob").expect(200);
    expect(other.body.templates).toEqual([]);
    await request(app).post("/api/invoices/templates").set(auth).send({ template: { ...template, name: "Bez pozycji", lines: [] } }).expect(400);
    await request(app).delete(`/api/invoices/templates/${id}`).set(auth).expect(200);
    await request(app).delete(`/api/invoices/templates/${id}`).set(auth).expect(404);
  });

  it("stores invoice defaults per user and rejects unknown values", async () => {
    const defaults = { paymentMethod: "przelew", paymentTermDays: 14, vatRate: "23" };
    await request(app)
      .put("/api/invoices/settings/defaults")
      .set("authorization", "Bearer user_alice")
      .send({ defaults })
      .expect(200, { defaults });
    const settings = await request(app).get("/api/invoices/settings").set("authorization", "Bearer user_alice").expect(200);
    expect(settings.body.defaults).toEqual(defaults);
    const other = await request(app).get("/api/invoices/settings").set("authorization", "Bearer user_bob").expect(200);
    expect(other.body.defaults).toBeUndefined();
    for (const bad of [
      { ...defaults, paymentMethod: "karta" },
      { ...defaults, paymentTermDays: 1.5 },
      { ...defaults, vatRate: "abc1" }
    ]) {
      await request(app).put("/api/invoices/settings/defaults").set("authorization", "Bearer user_alice").send({ defaults: bad }).expect(400);
    }
  });
});
