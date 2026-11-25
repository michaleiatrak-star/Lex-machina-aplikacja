import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { createLexHttpApp } from "../src/http/app.js";
import { lowConfidencePage, lowLineShare } from "../src/ocr-page-quality.js";

const IMAGE = { jpeg: "/9j/AAAA", width: 10, height: 10, unread: [] as Array<[number, number, number, number]> };

function service(confidences: number[], vision?: { readPage: (jpeg: string, ocr: string) => Promise<string> }) {
  const pdf = new CompleteDocumentIngestor(
    { extract: async (data) => ({ bytes: data.byteLength, pages: confidences.map((_, index) => ({ page: index + 1, text: "" })) }) },
    {
      recognizePages: async (_data, pages) =>
        pages.map((page) => ({
          page,
          text: `Protokół rozprawy strona ${page} z dnia 6 sierpnia, sąd rejonowy, wydział pracy.`,
          confidence: confidences[page - 1]!,
          lines: [{ text: `Protokół rozprawy strona ${page}`, score: confidences[page - 1]! }],
          image: IMAGE
        }))
    }
  );
  const reader = vision ? () => ({ readLine: async (_j: string, ocr: string) => ocr, readPage: vision.readPage, stop: () => undefined, modelBytes: 0 }) : undefined;
  return new LocalPrivateDocumentService(pdf, { recognize: async () => [] }, 24_000, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, reader as never);
}

describe("low-certainty OCR pages (task 06)", () => {
  it("threshold: mean below 0.95 or a quarter of the lines below 0.95; clean scans pass", () => {
    expect(lowConfidencePage({ source: "OCR", confidence: 0.992 })).toBe(false);
    expect(lowConfidencePage({ source: "OCR", confidence: 0.986, lines: [{ text: "a", score: 0.99 }, { text: "b", score: 0.9 }, { text: "c", score: 0.99 }, { text: "d", score: 0.99 }, { text: "e", score: 0.99 }] })).toBe(false);
    expect(lowConfidencePage({ source: "OCR", confidence: 0.814 })).toBe(true);
    expect(lowConfidencePage({ source: "OCR", confidence: 0.97, lines: [{ text: "a", score: 0.6 }, { text: "b", score: 0.99 }, { text: "c", score: 0.99 }] })).toBe(true);
    expect(lowConfidencePage({ source: "DIGITAL", confidence: 0.2 })).toBe(false);
    expect(lowConfidencePage({ source: "OCR", confidence: 0.2, editedByUser: true })).toBe(false);
    expect(lowLineShare({ lines: [{ text: "pieczęć", score: 0.1, stamp: true }] })).toBeNull();
  });

  it("marks only the low page in the preview and offers the vision re-read when the model reads pages", async () => {
    const plain = await service([0.99, 0.81]).review(Buffer.from("pdf"), "application/pdf");
    expect(plain.pages.map((page) => Boolean(page.lowConfidence))).toEqual([false, true]);
    expect(plain.visionReread).toBeUndefined();
    const withVision = await service([0.99, 0.81], { readPage: async () => "x" }).review(Buffer.from("pdf"), "application/pdf");
    expect(withVision.visionReread).toBe(true);
  });

  it("the vision re-read is a proposal: the stored page text stays until the user saves it", async () => {
    const readPage = vi.fn(async (jpeg: string, ocr: string) => `${jpeg.length}|${ocr}|ODCZYT`);
    const current = service([0.99, 0.81], { readPage });
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    const proposal = await current.visionReadPage(review.documentId, 2);
    expect(readPage).toHaveBeenCalledWith(IMAGE.jpeg, "Protokół rozprawy strona 2");
    expect(proposal).toEqual({ page: 2, text: "8|Protokół rozprawy strona 2|ODCZYT" });
    const scan = await current.pageScan(review.documentId, 2);
    expect(scan?.lines[0]?.text).toBe("Protokół rozprawy strona 2");
  });

  it("without a vision model the re-read is refused; nothing reaches any other model", async () => {
    const current = service([0.81]);
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    await expect(current.visionReadPage(review.documentId, 1)).rejects.toThrow("VISION_MODEL_UNAVAILABLE");
    const app = createLexHttpApp({ documentService: { visionReadPage: async () => { throw new Error("VISION_MODEL_UNAVAILABLE"); } } } as never);
    const response = await request(app).post(`/api/documents/doc_${"a".repeat(24)}/pages/1/vision-read`).send({});
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("VISION_MODEL_UNAVAILABLE");
  });
});
