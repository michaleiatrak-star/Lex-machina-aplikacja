import { describe, expect, it } from "vitest";
import { QUOTE_MISMATCH_MARKER, processDocumentCitationMarkers } from "../src/document-citations.js";

// XI P 27/26 (2026-11-16): a faithful quote of a hearing record was marked "not in the document"
// because of an editor's "[sic]" and of the record's space before a comma.
const record = {
  caseId: "case_" + "a".repeat(32),
  documentId: "document_" + "d".repeat(32),
  sourceScope: "CASE_KNOWLEDGE" as const,
  chunks: [{ index: 0, pageStart: 1, pageEnd: 1, text: "- Ja współpracowałem z powodem wówczas kiedy zajmował się rekrutacja pracowników, a później jako programista już nie.\n- pracownicy skarżyli się , że on ich straszył" }]
};
const ref = `[[LEXDOC:${record.documentId}:0]]`;

describe("faithful quotes of a hearing record", () => {
  it("an editor's [sic] is not part of the quote", () => {
    const result = processDocumentCitationMarkers(`Świadek: „kiedy zajmował się rekrutacja [sic] pracowników, a później jako programista już nie”${ref}.`, [record]);
    expect(result.text).not.toContain(QUOTE_MISMATCH_MARKER);
  });

  it("the record's space before a comma does not make a quote unfaithful", () => {
    const result = processDocumentCitationMarkers(`Świadek: „pracownicy skarżyli się, że on ich straszył”${ref}.`, [record]);
    expect(result.text).not.toContain(QUOTE_MISMATCH_MARKER);
  });

  it("a changed word still is", () => {
    const result = processDocumentCitationMarkers(`Świadek: „pracownicy skarżyli się, że on ich bił”${ref}.`, [record]);
    expect(result.text).toContain(QUOTE_MISMATCH_MARKER);
  });
});
