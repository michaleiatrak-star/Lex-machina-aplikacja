import { describe, expect, it } from "vitest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import type { PersonMorphology } from "../src/privacy/person-morphology.js";

const morphology: PersonMorphology = { analyze: async (surfaces) => surfaces.map(() => null) };

function service() {
  return new LocalPrivateDocumentService(
    new CompleteDocumentIngestor({ async extract() { return { bytes: 1, pages: [] }; } }),
    { recognize: async () => [] },
    24_000,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    morphology
  );
}

// A document reaches a model outside the computer only after the user confirmed its preview.
describe("reviewed documents", () => {
  it("not reviewed: refused for a remote model, given to a local one, sent after the user's confirmation", async () => {
    const documents = service();
    const review = await documents.review(Buffer.from("Umowa najmu lokalu."), "text/plain");
    const result = await documents.finalizeReview(review.documentId, []);
    expect(result.privacy.reviewed).toBe(false);
    const selection = { documentId: review.documentId, chunkIndices: [1] };
    await expect(documents.resolveProtectedChunks(selection, { remote: true })).rejects.toThrow("DOCUMENT_NOT_REVIEWED");
    await expect(documents.resolveProtectedChunks(selection)).resolves.toMatchObject({ documentId: review.documentId });
    const approved = await documents.markReviewed(review.documentId, { caseId: "case-1" });
    expect(approved.reviewed).toBe(true);
    await expect(documents.resolveProtectedChunks(selection, { remote: true })).resolves.toMatchObject({ documentId: review.documentId });
  });

  it("confirmed in the preview before finalizing", async () => {
    const documents = service();
    const review = await documents.review(Buffer.from("Umowa najmu lokalu."), "text/plain");
    const result = await documents.finalizeReview(review.documentId, [], undefined, true);
    expect(result.privacy.reviewed).toBe(true);
  });
});
