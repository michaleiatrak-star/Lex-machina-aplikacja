import { describe, expect, it } from "vitest";
import { processDocumentCitationMarkers, QUOTE_UNSOURCED_MARKER } from "../src/document-citations.js";

const contract = {
  documentId: "doc_umowa",
  displayName: "umowa.pdf",
  chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "§ 6. 1. Wykonawca przenosi na wszystkich znanych polach eksploatacji autorskie prawa majątkowe." }]
};

describe("a quote followed by its statute is not a case-document quote (contract test 2026-11-08)", () => {
  it("statute wording after a mention of the contract gets no CYTAT NIEODNALEZIONY", () => {
    const text = "Umowa obejmuje tylko pola eksploatacji „wyraźnie w niej wymienione przez strony”, art. 41 ust. 2 pr. aut.";
    expect(processDocumentCitationMarkers(text, [contract as never]).text).not.toContain(QUOTE_UNSOURCED_MARKER);
  });

  it("a quote attributed to the contract and not found in it is still marked", () => {
    const text = "Umowa przewiduje, że „Wykonawca przenosi prawa także do utworów przyszłych bez ograniczeń”.";
    expect(processDocumentCitationMarkers(text, [contract as never]).text).toContain(QUOTE_UNSOURCED_MARKER);
  });
});
