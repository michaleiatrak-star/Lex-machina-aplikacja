import { describe, expect, it, vi } from "vitest";
import { CompleteDocumentIngestor } from "../src/document-ingestion.js";
import { LocalPrivateDocumentService } from "../src/document-service.js";
import type { PiiSpan } from "../src/privacy/pseudonymizer.js";

// Rozpoznaje tylko "Jan Kowalski" w zdaniu (nie w nagłówku wersalikami, nie w dopełniaczu).
const recognize = vi.fn(async (text: string): Promise<PiiSpan[]> => {
  const start = text.indexOf("Jan Kowalski podpisał");
  return start < 0 ? [] : [{ start, end: start + 12, kind: "PERSON", value: "Jan Kowalski", confidence: 0.9, source: "AUTO" }];
});

function service() {
  const pdf = new CompleteDocumentIngestor({
    extract: async (data) => ({
      bytes: data.byteLength,
      pages: [
        { page: 1, text: "POWÓD: JAN KOWALSKI\nPozew o zapłatę przeciwko pozwanemu wraz z odsetkami ustawowymi za opóźnienie." },
        { page: 2, text: "Uzasadnienie: powód Jan Kowalski wezwał pozwanego do zapłaty." },
        { page: 3, text: "Jan Kowalski podpisał umowę w Krakowie w obecności obu stron i świadków zdarzenia." }
      ]
    })
  });
  return new LocalPrivateDocumentService(pdf, { recognize });
}

describe("propagacja znanych osób w dokumencie", () => {
  it("chroni osobę także na stronach wcześniejszych i w zapisie wersalikami", async () => {
    const current = service();
    const review = await current.review(Buffer.from("pdf"), "application/pdf");
    recognize.mockClear();
    const finalized = await current.finalizeReview(review.documentId, []);
    const text = finalized.chunks.map((chunk) => chunk.text).join("\n");
    expect(text).not.toMatch(/kowalski/i);
    expect(text).toContain("POWÓD: [PII:PERSON:0001]");
    expect(text).toContain("powód [PII:PERSON:0001] wezwał");
    // Drugi przebieg nie uruchamia rozpoznawania ponownie.
    expect(recognize).toHaveBeenCalledTimes(3);
  });
});
