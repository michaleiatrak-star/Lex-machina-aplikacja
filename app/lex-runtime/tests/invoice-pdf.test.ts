import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import express from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { AuthError, type AuthService } from "../src/auth/service.js";
import { registerInvoiceRoutes } from "../src/http/invoice-routes.js";
import { invoicePdf, invoicePdfFileName } from "../src/invoice-pdf.js";
import { EncryptedInvoiceStore, type InvoiceRecord } from "../src/invoice-store.js";
import { LocalPdfTextExtractor } from "../src/pdf-text-extractor.js";

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    let c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
// RGBA PNG with Sub/Up/Paeth filtered rows and a transparent part.
function png(interlace = 0): Buffer {
  const width = 16;
  const height = 8;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width * 4 + 1);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) row.set([200, 10 * x, 30, x < 4 ? 0 : 255], 1 + x * 4);
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

const record: InvoiceRecord = {
  invoiceId: `inv_${"a".repeat(32)}`,
  number: "FV/7/2026",
  issueDate: "2026-10-04",
  saleDate: "2026-10-03",
  placeOfIssue: "Łódź",
  seller: { name: "Kancelaria Ewa Łęcka-Żółć", nip: "1234563218", address: "ul. Źródlana 5, 90-001 Łódź" },
  buyer: { name: "Spółka sp. z o.o.", address: "Warszawa" },
  lines: [
    { name: "Usługa doradztwa prawnego — gęślą jaźń", unit: "godz.", quantity: "2", unitNetPrice: "350", vatRate: "23" },
    { name: "Opłata zwolniona", unit: "szt.", quantity: "1", unitNetPrice: "100", vatRate: "zw", discount: "10" }
  ],
  currency: "PLN",
  paymentMethod: "przelew",
  paymentDueDate: "2026-10-18",
  annotations: { splitPayment: true },
  status: "ISSUED",
  createdAt: "2026-10-04T10:00:00Z",
  updatedAt: "2026-10-04T10:00:00Z"
};
const logo = (data: Buffer, mediaType: "image/png" | "image/jpeg" = "image/png") => ({ mediaType, fileName: "logo", base64: data.toString("base64"), uploadedAt: "" });
const text = async (pdf: Buffer) => (await new LocalPdfTextExtractor(undefined, { lines: true }).extract(pdf)).text;

describe("invoice PDF", () => {
  it("contains the invoice with Polish letters, totals and the logo", async () => {
    const { pdf, logoOmitted } = invoicePdf(record, { logo: logo(png()), now: new Date("2026-10-04T10:00:00Z") });
    expect(logoOmitted).toBeUndefined();
    expect(pdf.subarray(0, 8).toString("latin1")).toBe("%PDF-1.4");
    expect(pdf.toString("latin1")).toContain("/SMask");
    const content = await text(pdf);
    for (const expected of ["Faktura FV/7/2026", "Łódź", "Łęcka-Żółć", "gęślą jaźń", "700,00 PLN", "Do zapłaty: 951,00 PLN", "mechanizm podzielonej płatności", "strona 1 z 1"]) {
      expect(content).toContain(expected);
    }
  });

  it("omits a logo it cannot embed and still produces the invoice; a draft is marked", async () => {
    const { pdf, logoOmitted } = invoicePdf({ ...record, status: "DRAFT" }, { logo: logo(png(1)) });
    expect(logoOmitted).toBe("PDF_IMAGE_PNG_UNSUPPORTED");
    expect(await text(pdf)).toContain("SZKIC");
    expect(invoicePdfFileName(record)).toBe("Faktura-FV-7-2026.pdf");
  });
});

describe("GET /api/invoices/:invoiceId/pdf", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lex-invoice-pdf-"));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const keys = new Map([["user_alice", randomBytes(32)], ["user_bob", randomBytes(32)]]);
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
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  registerInvoiceRoutes(app, { authService, invoices: new EncryptedInvoiceStore({ rootDir: root }) });

  it("returns the PDF of the user's own invoice with the logo from settings", async () => {
    const logoSaved = await request(app)
      .put("/api/invoices/settings/logo")
      .set("authorization", "Bearer user_alice")
      .send({ mediaType: "image/png", base64: png().toString("base64"), fileName: "logo.png" });
    expect(logoSaved.status, JSON.stringify(logoSaved.body)).toBe(200);
    const created = await request(app)
      .post("/api/invoices")
      .set("authorization", "Bearer user_alice")
      .send({ invoice: { number: "FV 1/2026", issueDate: "2026-10-01", seller: { name: "Kancelaria", nip: "1234563218", address: "Warszawa" }, buyer: { name: "Klient", address: "Kraków" }, lines: [{ name: "Usługa", unit: "szt.", quantity: "2", unitNetPrice: "100", vatRate: "23" }] } });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const id = created.body.invoice.invoiceId as string;
    const response = await request(app)
      .get(`/api/invoices/${id}/pdf`)
      .set("authorization", "Bearer user_alice")
      .buffer(true)
      .parse((res, callback) => {
        const parts: Buffer[] = [];
        res.on("data", (part: Buffer) => parts.push(part));
        res.on("end", () => callback(null, Buffer.concat(parts)));
      })
      .expect(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["content-disposition"]).toContain('filename="Faktura-FV-1-2026.pdf"');
    expect((response.body as Buffer).toString("latin1")).toContain("/Subtype /Image");
    await request(app).get(`/api/invoices/${id}/pdf`).set("authorization", "Bearer user_bob").expect(404);
    await request(app).get(`/api/invoices/${id}/pdf`).expect(401);
  });
});
