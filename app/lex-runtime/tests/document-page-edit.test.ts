import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { createLexHttpApp } from "../src/http/app.js";

function service() {
  const pdf = new CompleteDocumentIngestor({
    extract: async (data) => ({
      bytes: data.byteLength,
      pages: [
        { page: 1, text: "Umowa zlecenia zawarta w Krakowie pomiędzy stronami niniejszej umowy." },
        { page: 2, text: "Zl3c3n10b10rc4 ~~ P3S3L #### ¤¤ podp1s n1ecz1telny ¤¤ ////" }
      ]
    })
  });
  return new LocalPrivateDocumentService(pdf, { recognize: async () => [] });
}

describe("user correction of a page's text", () => {
  it("replaces the page text, detects personal data again and finalizes the corrected wording", async () => {
    const current = service();
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    const edited = await current.editPage(
      review.documentId,
      2,
      "Zleceniobiorca: PESEL 44051401359, podpis nieczytelny.\r\n"
    );
    expect(edited.page).toMatchObject({ page: 2, editedByUser: true });
    expect(edited.page.text).toBe("Zleceniobiorca: PESEL 44051401359, podpis nieczytelny.\n");
    expect(edited.suggestions.some((item) => item.page === 2 && item.kind === "PESEL")).toBe(true);

    const finalized = await current.finalizeReview(review.documentId, []);
    const text = finalized.chunks.map((chunk) => chunk.text).join("\n");
    expect(text).toContain("Zleceniobiorca");
    expect(text).not.toContain("Zl3c3n10b10rc4");
    expect(text).not.toContain("44051401359");
    expect(text).toContain("Umowa zlecenia");
  });

  it("rejects an unknown document or page", async () => {
    const current = service();
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    await expect(current.editPage(review.documentId, 9, "x")).rejects.toThrow("INVALID_DOCUMENT_PAGE");
    await expect(current.editPage("doc_000000000000000000000000", 1, "x")).rejects.toThrow("UNKNOWN_LOCAL_DOCUMENT");
  });

  it("does not let access to one case overwrite a document of another case", async () => {
    const saveSource = vi.fn(async () => undefined);
    const pdf = new CompleteDocumentIngestor({
      extract: async (data) => ({ bytes: data.byteLength, pages: [{ page: 1, text: "Umowa zlecenia zawarta w Krakowie pomiędzy stronami niniejszej umowy." }] })
    });
    const store = { saveSource, saveProtected: vi.fn(), loadSource: vi.fn(), loadProtected: vi.fn() };
    const current = new LocalPrivateDocumentService(
      pdf, { recognize: async () => [] }, 24_000, undefined, undefined, store as never
    );
    const keyB = Buffer.alloc(32, 2);
    const caseB = `case_${"b".repeat(32)}`;
    const review = await current.review(Buffer.from("pdf"), "application/pdf", {
      caseId: caseB, caseDataKey: keyB, keyVersion: 1
    });
    saveSource.mockClear();
    await expect(
      current.editPage(review.documentId, 1, "Nadpisane", {
        caseId: `case_${"a".repeat(32)}`, caseDataKey: Buffer.alloc(32, 1), keyVersion: 1
      })
    ).rejects.toThrow("DOCUMENT_VAULT_CONTEXT_REQUIRED");
    await expect(current.editPage(review.documentId, 1, "Nadpisane")).rejects.toThrow("DOCUMENT_VAULT_CONTEXT_REQUIRED");
    expect(saveSource).not.toHaveBeenCalled();
    const own = await current.editPage(review.documentId, 1, "Poprawione", { caseId: caseB, caseDataKey: keyB, keyVersion: 1 });
    expect(own.page.text).toBe("Poprawione");
    expect(saveSource).toHaveBeenCalledWith(expect.objectContaining({ caseId: caseB }));
  });

  it("exposes the correction over HTTP with input validation", async () => {
    const editPage = vi.fn(async (_documentId: string, page: number, text: string) => ({
      page: { page, text, source: "OCR" as const, editedByUser: true },
      suggestions: []
    }));
    const app = createLexHttpApp({ documentService: { editPage } as never } as never);
    const ok = await request(app)
      .post("/api/documents/doc_0123456789abcdef01234567/pages/2/text")
      .send({ text: "Poprawiony tekst" });
    expect(ok.status).toBe(200);
    expect(ok.body.page).toMatchObject({ page: 2, text: "Poprawiony tekst", editedByUser: true });
    expect(editPage).toHaveBeenCalledWith("doc_0123456789abcdef01234567", 2, "Poprawiony tekst");

    const bad = await request(app)
      .post("/api/documents/doc_0123456789abcdef01234567/pages/0/text")
      .send({ text: "x" });
    expect(bad.status).toBe(400);
    const noText = await request(app)
      .post("/api/documents/doc_0123456789abcdef01234567/pages/1/text")
      .send({});
    expect(noText.status).toBe(400);
  });
});
