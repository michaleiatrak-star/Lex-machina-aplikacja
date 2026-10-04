import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EncryptedInvoiceStore,
  invoiceTotals,
  nextNumber,
  type InvoiceRecord
} from "./invoice-store.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store(): Promise<EncryptedInvoiceStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "lex-invoices-"));
  roots.push(root);
  return new EncryptedInvoiceStore({ rootDir: root, now: () => new Date("2026-10-02T12:00:00Z") });
}

const USER = "user_0123456789abcdef";
const SELLER = { name: "Kancelaria Test", nip: "123-456-32-18", address: "ul. Prosta 1, 00-001 Warszawa" };

function input(number: string, buyer: string, issueDate: string) {
  return {
    number,
    issueDate,
    saleDate: issueDate,
    seller: SELLER,
    buyer: { name: buyer, address: "ul. Krzywa 2, 30-001 Kraków" },
    currency: "PLN",
    lines: [{ name: "Porada prawna", unit: "godz.", quantity: "1,5", unitNetPrice: "400", vatRate: "23" }]
  };
}

describe("invoiceTotals", () => {
  it("sums net per rate and computes VAT in grosze without float errors", () => {
    const totals = invoiceTotals([
      { name: "a", unit: "szt.", quantity: "3", unitNetPrice: "0.10", vatRate: "23" },
      { name: "b", unit: "szt.", quantity: "1", unitNetPrice: "0.05", vatRate: "23" },
      { name: "c", unit: "szt.", quantity: "2", unitNetPrice: "10", vatRate: "zw" }
    ]);
    expect(totals.byRate).toEqual([
      { vatRate: "23", net: "0.35", vat: "0.08", gross: "0.43" },
      { vatRate: "zw", net: "20.00", vat: "0.00", gross: "20.00" }
    ]);
    expect(totals).toMatchObject({ net: "20.35", vat: "0.08", gross: "20.43" });
  });
});

describe("nextNumber", () => {
  it("increments the first number and skips taken ones", () => {
    const taken = [{ number: "FV 008/2026" }] as InvoiceRecord[];
    expect(nextNumber(taken, "FV 007/2026")).toBe("FV 009/2026");
    expect(nextNumber([], "PROFORMA")).toBe("PROFORMA-2");
  });
});

describe("EncryptedInvoiceStore", () => {
  it("keeps the KSeF token and invoices encrypted at rest and never returns the token", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    const view = await invoices.setKsefToken(USER, key, "SECRET-KSEF-TOKEN-abcdef", "1234563218");
    expect(view).toEqual({
      environment: "test",
      tokenConfigured: true,
      tokenHint: "…cdef",
      tokenSetAt: "2026-10-02T12:00:00.000Z",
      contextNip: "1234563218"
    });
    await invoices.create(USER, key, input("FV 1/2026", "Klient Alfa", "2026-10-01"));
    const raw = await readFile(invoices.filePath(USER), "utf8");
    expect(raw).not.toContain("SECRET-KSEF-TOKEN");
    expect(raw).not.toContain("Klient Alfa");
    await expect(invoices.list(USER, randomBytes(32))).rejects.toThrow("INVOICE_STORE_DECRYPT_FAILED");
    expect((await invoices.ksefCredentials(USER, key)).token).toBe("SECRET-KSEF-TOKEN-abcdef");
    expect(await invoices.clearKsefToken(USER, key)).toEqual({ environment: "test", tokenConfigured: false, contextNip: "1234563218" });
  });

  it("switches to production only with explicit confirmation", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    expect((await invoices.ksefSettings(USER, key)).environment).toBe("test");
    expect(() => invoices.setKsefEnvironment(USER, key, "production", undefined)).toThrow("KSEF_PRODUCTION_CONFIRMATION_REQUIRED");
    expect((await invoices.setKsefEnvironment(USER, key, "production", true)).environment).toBe("production");
    expect((await invoices.setKsefEnvironment(USER, key, "test", undefined)).environment).toBe("test");
  });

  it("validates required fields and unique numbers", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    expect(() => invoices.create(USER, key, { ...input("FV 1", "A", "2026-10-01"), buyer: { name: "A" } })).toThrow("INVOICE_FIELD_REQUIRED:buyer.address");
    expect(() => invoices.create(USER, key, { ...input("FV 1", "A", "2026-10-01"), seller: { ...SELLER, nip: "" } })).toThrow("INVOICE_FIELD_REQUIRED:seller.nip");
    expect(() => invoices.create(USER, key, { ...input("FV 1", "A", "2026-10-01"), lines: [] })).toThrow("INVOICE_FIELD_REQUIRED:lines");
    await invoices.create(USER, key, input("FV 1", "A", "2026-10-01"));
    await expect(invoices.create(USER, key, input("fv 1", "B", "2026-10-02"))).rejects.toThrow("INVOICE_NUMBER_TAKEN");
  });

  it("searches by client or number and sorts by date or client", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    await invoices.create(USER, key, input("FV 2/2026", "Żuraw sp. z o.o.", "2026-09-15"));
    await invoices.create(USER, key, input("FV 1/2026", "Alfa S.A.", "2026-08-01"));
    await invoices.create(USER, key, input("FV 3/2026", "Beta", "2026-10-01"));
    const numbers = async (query: string, sort: Parameters<typeof invoices.list>[3]) =>
      (await invoices.list(USER, key, query, sort)).map((entry) => entry.number);
    expect(await numbers("", "date-desc")).toEqual(["FV 3/2026", "FV 2/2026", "FV 1/2026"]);
    expect(await numbers("", "date-asc")).toEqual(["FV 1/2026", "FV 2/2026", "FV 3/2026"]);
    expect(await numbers("", "client-asc")).toEqual(["FV 1/2026", "FV 3/2026", "FV 2/2026"]);
    expect(await numbers("", "client-desc")).toEqual(["FV 2/2026", "FV 3/2026", "FV 1/2026"]);
    expect(await numbers("żuraw", "date-desc")).toEqual(["FV 2/2026"]);
    expect(await numbers("3/2026", "date-desc")).toEqual(["FV 3/2026"]);
  });

  it("issues a draft, locks it, and creates a new draft based on it", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    const draft = await invoices.create(USER, key, input("FV 7/2026", "Alfa", "2026-09-01"));
    const issued = await invoices.issue(USER, key, draft.invoiceId);
    expect(issued.status).toBe("ISSUED");
    await expect(invoices.update(USER, key, draft.invoiceId, input("FV 7/2026", "X", "2026-09-01"))).rejects.toThrow("INVOICE_ALREADY_ISSUED");
    await expect(invoices.remove(USER, key, draft.invoiceId)).rejects.toThrow("INVOICE_ALREADY_ISSUED");
    const copy = await invoices.duplicate(USER, key, draft.invoiceId);
    expect(copy).toMatchObject({
      number: "FV 8/2026",
      issueDate: "2026-10-02",
      status: "DRAFT",
      basedOnInvoiceId: draft.invoiceId,
      buyer: issued.buyer,
      lines: issued.lines
    });
    expect(copy.invoiceId).not.toBe(draft.invoiceId);
  });

  it("accepts PNG or JPEG logos only, checked by content", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(16)]);
    const logo = await invoices.setLogo(USER, key, { mediaType: "image/png", base64: png.toString("base64"), fileName: "logo<script>.png" });
    expect(logo.fileName).toBe("logoscript.png");
    expect((await invoices.profile(USER, key)).logo?.base64).toBe(png.toString("base64"));
    expect(() => invoices.setLogo(USER, key, { mediaType: "image/jpeg", base64: png.toString("base64") })).toThrow("INVOICE_LOGO_TYPE");
    expect(() => invoices.setLogo(USER, key, { mediaType: "image/svg+xml", base64: "PHN2Zz4=" })).toThrow("INVOICE_LOGO_TYPE");
  });

  it("serializes concurrent writes of one user", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        invoices.create(USER, key, input(`FV ${index + 1}/2026`, `Klient ${index}`, "2026-10-01"))
      )
    );
    expect(await invoices.list(USER, key)).toHaveLength(8);
  });

  it("auto-numbers by pattern when the number is left empty", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    await expect(invoices.create(USER, key, { ...input("", "A", "2026-10-01") })).rejects.toThrow("INVOICE_FIELD_REQUIRED:number");
    expect(() => invoices.setNumbering(USER, key, { pattern: "FV {NR}", reset: "monthly" })).toThrow("NUMBERING_PATTERN_MONTH_REQUIRED");
    await invoices.setNumbering(USER, key, { pattern: "FV {NR}/{MM}/{RRRR}", reset: "monthly", padding: 2 });
    expect(await invoices.previewNumber(USER, key, "2026-10-01")).toBe("FV 01/10/2026");
    const first = await invoices.create(USER, key, input("", "A", "2026-10-01"));
    const second = await invoices.create(USER, key, input("", "B", "2026-10-20"));
    const november = await invoices.create(USER, key, input("", "C", "2026-11-02"));
    expect([first.number, second.number, november.number]).toEqual(["FV 01/10/2026", "FV 02/10/2026", "FV 01/11/2026"]);
    const copy = await invoices.duplicate(USER, key, first.invoiceId);
    expect(copy.number).toBe("FV 03/10/2026");
  });

  it("applies line discounts and requires an exemption basis to issue exempt sales", async () => {
    const invoices = await store();
    const key = randomBytes(32);
    const draft = await invoices.create(USER, key, {
      ...input("FV 1", "A", "2026-10-01"),
      lines: [{ name: "Usługa", unit: "szt.", quantity: "2", unitNetPrice: "100", vatRate: "zw", discount: "20" }]
    });
    expect(invoiceTotals(draft.lines)).toMatchObject({ net: "180.00", vat: "0.00", gross: "180.00" });
    await expect(invoices.issue(USER, key, draft.invoiceId)).rejects.toThrow("INVOICE_FIELD_REQUIRED:annotations.exemptionBasis");
    await invoices.update(USER, key, draft.invoiceId, {
      ...input("FV 1", "A", "2026-10-01"),
      lines: draft.lines,
      annotations: { exemptionBasis: "podstawa wpisana przez użytkownika", splitPayment: true, cashMethod: false }
    });
    const issued = await invoices.issue(USER, key, draft.invoiceId);
    expect(issued.annotations).toEqual({ exemptionBasis: "podstawa wpisana przez użytkownika", splitPayment: true });
    expect(() => invoices.create(USER, key, {
      ...input("FV 2", "A", "2026-10-01"),
      lines: [{ name: "x", unit: "szt.", quantity: "1", unitNetPrice: "10", vatRate: "23", discount: "11" }]
    })).toThrow("INVOICE_FIELD_INVALID:lines.0.discount");
  });
});
