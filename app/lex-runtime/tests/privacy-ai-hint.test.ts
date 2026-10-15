import { describe, expect, it } from "vitest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import { LocalLlmPrivacyNamedEntityRecognizer } from "../src/privacy/local-llm-ner.js";
import type { PersonMorphology } from "../src/privacy/person-morphology.js";

const morphology: PersonMorphology = { analyze: async (surfaces) => surfaces.map(() => null) };

// Bielik's verdict "not a person" never unmasks: the review marks the match, the user decides.
describe("local AI hint: a match the model reads as no person", () => {
  const text = "Wilk zaatakował owce na pastwisku. Kowal złożył zeznania.";
  const recognizer = new LocalLlmPrivacyNamedEntityRecognizer(
    {
      stream: async (_provider: string, params: { systemPrompt: string; messages: Array<{ content: string }> }) => ({
        fullText: !params.systemPrompt.includes("⟦")
          ? "[]"
          : params.messages[0]!.content.includes("Kowal")
            ? '[{"id":1,"person":false,"type":"słowo pospolite"},{"id":2,"person":true,"type":"osoba"}]'
            : '[{"id":1,"person":false,"type":"słowo pospolite"}]'
      })
    } as never,
    { configuredModelId: () => "local/bielik", status: () => ({ configured: true, state: "READY" }) } as never,
    {
      recognize: async (input: string) =>
        ["Wilk", "Kowal"].map((value) => ({ start: input.indexOf(value), end: input.indexOf(value) + value.length, kind: "PERSON" as const, value, ambiguous: true }))
    }
  );
  const service = () =>
    new LocalPrivateDocumentService(
      new CompleteDocumentIngestor({ async extract() { return { bytes: 1, pages: [] }; } }),
      recognizer,
      24_000,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      morphology
    );

  it("comes back marked and stays masked without the user's decision", async () => {
    const documents = service();
    const review = await documents.review(Buffer.from(text), "text/plain", { caseId: "case-1", localAi: true });
    expect(review.suggestions.map((item) => [text.slice(item.start, item.end), item.aiNotPerson])).toEqual([
      ["Wilk", "słowo pospolite"],
      ["Kowal", undefined]
    ]);
    const result = await documents.finalizeReview(review.documentId, [], { caseId: "case-1", localAi: true });
    const sent = result.chunks.map((chunk) => chunk.text).join("\n");
    expect(sent).not.toContain("Wilk");
    expect(sent).not.toContain("Kowal");
  });

  it("is unmasked by the user's one click (KEEP)", async () => {
    const documents = service();
    const review = await documents.review(Buffer.from(text), "text/plain", { caseId: "case-1", localAi: true });
    const hint = review.suggestions.find((item) => item.aiNotPerson)!;
    const result = await documents.finalizeReview(
      review.documentId,
      [{ page: hint.page, start: hint.start, end: hint.end, action: "KEEP" }],
      { caseId: "case-1", localAi: true }
    );
    const sent = result.chunks.map((chunk) => chunk.text).join("\n");
    expect(sent).toContain("Wilk zaatakował owce");
    expect(sent).not.toContain("Kowal");
  });
});
