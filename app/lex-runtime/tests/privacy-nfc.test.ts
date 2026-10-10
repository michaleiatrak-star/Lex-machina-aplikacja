import { describe, expect, it } from "vitest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService, nfcIngestion } from "../src/document-service.js";
import { nfcRequest } from "../src/session-executor.js";
import type { PiiSpan } from "../src/privacy/pseudonymizer.js";

const NFC_NAME = "Anna Wróbel";
const NFD_NAME = NFC_NAME.normalize("NFD");

// Słownik zna nazwisko tylko w postaci NFC (jak Morfeusz i literały w kluczu).
const recognizer = {
  recognize: async (text: string): Promise<PiiSpan[]> => {
    const start = text.indexOf(NFC_NAME);
    return start < 0 ? [] : [{ start, end: start + NFC_NAME.length, kind: "PERSON", value: NFC_NAME, confidence: 0.9, source: "AUTO" }];
  }
};

describe("normalizacja NFC przed anonimizacją", () => {
  it("chroni nazwisko zapisane w postaci rozłożonej (NFD)", async () => {
    expect(NFD_NAME).not.toBe(NFC_NAME);
    const service = new LocalPrivateDocumentService(
      new CompleteDocumentIngestor({ async extract() { return { bytes: 1, pages: [] }; } }),
      recognizer
    );
    const review = await service.review(Buffer.from(`Pozwana ${NFD_NAME} nie zapłaciła czynszu.`), "text/plain");
    const finalized = await service.finalizeReview(review.documentId, []);
    const text = finalized.chunks.map((chunk) => chunk.text).join("\n");
    expect(text).toContain("Pozwana [PII:PERSON:0001] nie zapłaciła");
    expect(text.normalize("NFC")).not.toContain("Wróbel");
  });

  it("normalizuje linie OCR razem z tekstem strony", () => {
    const source = nfcIngestion({
      complete: true, sha256: "0".repeat(64), bytes: 1, totalPages: 1, digitalPages: 0, ocrPages: 1, blankPages: 0,
      sourceChars: NFD_NAME.length,
      pages: [{ page: 1, text: NFD_NAME, source: "OCR", lines: [{ text: NFD_NAME }] }],
      chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: NFD_NAME }]
    } as never);
    expect(source.pages[0]!.text).toBe(NFC_NAME);
    expect(source.pages[0]!.lines![0]!.text).toBe(NFC_NAME);
    expect(source.chunks[0]!.text).toBe(NFC_NAME);
  });

  it("normalizuje wiadomość czatu", () => {
    const request = nfcRequest({ query: `Pozew ${NFD_NAME}`, auxiliaryText: NFD_NAME } as never);
    expect(request.query).toBe(`Pozew ${NFC_NAME}`);
    expect(request.auxiliaryText).toBe(NFC_NAME);
  });
});
