import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { CompleteDocumentIngestor, type OcrEngine } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { createLexHttpApp } from "../src/http/app.js";

const image = { jpeg: "SKAN", width: 1000, height: 800, unread: [] };
const ocr: OcrEngine = {
  async recognizePages(_data, pages) {
    return pages.map((page) => ({
      page,
      text: "Wezwanie do zapłaty\nnienakłaniania osoby",
      lines: [
        { text: "Wezwanie do zapłaty", score: 0.99, box: [10, 10, 400, 40] as [number, number, number, number] },
        { text: "nienakłaniania osoby", score: 0.8 }
      ],
      image
    }));
  }
};

function service() {
  const ingestor = new CompleteDocumentIngestor(
    { extract: async (data) => ({ bytes: data.byteLength, pages: [{ page: 1, text: "" }] }) },
    ocr
  );
  return new LocalPrivateDocumentService(ingestor, { recognize: async () => [] });
}

describe("scan of a page next to its text in the preview", () => {
  it("gives the page image with the boxes indexed like the OCR lines", async () => {
    const current = service();
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    const scan = await current.pageScan(review.documentId, 1);
    expect(scan).toMatchObject({ page: 1, mediaType: "image/jpeg", data: "SKAN", width: 1000, height: 800 });
    expect(scan!.lines).toEqual([
      { text: "Wezwanie do zapłaty", box: [10, 10, 400, 40] },
      { text: "nienakłaniania osoby", box: null }
    ]);
  });

  it("keeps the scan in view after a hand correction, without line boxes and never as evidence", async () => {
    const current = service();
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    await current.editPage(review.documentId, 1, "Wezwanie do zapłaty\nnienakłaniania osoby trzeciej");
    const scan = await current.pageScan(review.documentId, 1);
    expect(scan).toMatchObject({ data: "SKAN", lines: [] });
    await current.editPage(review.documentId, 1, "Wezwanie do zapłaty.");
    expect((await current.pageScan(review.documentId, 1))!.data).toBe("SKAN");
  });

  it("refuses another case's document and an unknown page", async () => {
    const current = service();
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    await expect(current.pageScan(review.documentId, 3)).rejects.toThrow("INVALID_DOCUMENT_PAGE");
    await expect(current.pageScan("doc_000000000000000000000000", 1)).rejects.toThrow("UNKNOWN_LOCAL_DOCUMENT");
  });

  it("is served over HTTP without caching; a page without a scan is 404", async () => {
    const pageScan = vi.fn(async (_documentId: string, page: number) =>
      page === 1 ? { page, mediaType: "image/jpeg", data: "SKAN", width: 1, height: 1, lines: [] } : null
    );
    const app = createLexHttpApp({ documentService: { pageScan } as never } as never);
    const ok = await request(app).get(`/api/documents/doc_${"a".repeat(24)}/pages/1/scan`);
    expect(ok.status).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    expect(ok.body.data).toBe("SKAN");
    expect((await request(app).get(`/api/documents/doc_${"a".repeat(24)}/pages/2/scan`)).status).toBe(404);
    expect((await request(app).get("/api/documents/zly/pages/1/scan")).status).toBe(400);
  });
});
