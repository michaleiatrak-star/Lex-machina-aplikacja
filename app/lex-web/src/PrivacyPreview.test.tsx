import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DocumentReviewResponse } from "./api.js";
import { PrivacyPreview } from "./PrivacyPreview.js";

const text = "Wilk zaatakował owce. Kowal złożył zeznania. Data doręczenia 810.2024";
const review: DocumentReviewResponse = {
  documentId: "doc_0123456789abcdef01234567",
  mediaType: "application/pdf",
  complete: true,
  totalPages: 1,
  pages: [
    {
      page: 1,
      text,
      source: "OCR",
      corrections: [{ line: 0, from: "Pawla", to: "Pawła" }],
      review: [{ line: 2, text: "Data doręczenia 810.2024", score: 0.7, reason: "LOW_CONFIDENCE" }]
    }
  ],
  suggestions: [
    { page: 1, start: 0, end: 4, kind: "PERSON", aiNotPerson: "słowo pospolite" },
    { page: 1, start: 22, end: 27, kind: "PERSON" }
  ]
};

describe("preview before a document is finalized", () => {
  it("lists what to decide first, then the text with every detection masked", () => {
    const html = renderToStaticMarkup(
      <PrivacyPreview caseId="case_1" review={review} fileName="pismo.pdf" keepClear={false} onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(html).toContain("Do decyzji");
    expect(html).toContain("AI: słowo pospolite");
    expect(html).toContain("Odkryj");
    expect(html).toContain("„Data doręczenia 810.2024”");
    expect(html).toContain("Popraw tekst strony");
    expect(html).toContain("„Pawla” → „Pawła”");
    expect(html).toContain("Zakryte zostanie: 2");
    // The AI hint is still masked until the user unmasks it.
    expect(html).toMatch(/class="privacy-preview-mark is-ai-hint"[^>]*>Wilk<\/mark>/);
  });

  it("OCR only: no masks, the text and the doubtful lines to check", () => {
    const html = renderToStaticMarkup(
      <PrivacyPreview caseId="case_1" review={review} fileName="pismo.pdf" keepClear onConfirm={() => undefined} onCancel={() => undefined} />
    );
    expect(html).toContain("Tekst bez anonimizacji");
    expect(html).not.toContain("AI: słowo pospolite");
    expect(html).toContain("Popraw tekst strony");
    expect(html).not.toContain("privacy-preview-mark");
  });
});
