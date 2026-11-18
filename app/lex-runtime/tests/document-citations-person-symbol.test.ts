import { describe, expect, it } from "vitest";
import { processDocumentCitationMarkers, QUOTE_MISMATCH_MARKER } from "../src/document-citations.js";

const attachment = (text: string) =>
  ({ documentId: "doc_w", fileName: "wyrok.txt", chunks: [{ index: 0, text, pageStart: 1, pageEnd: 1 }] }) as never;
const source = "1. uniewinnia obwinionego [PII:PERSON:0008] od popełnienia zarzucanego mu czynu;";

describe("a quote with a name where the document holds the person's symbol", () => {
  it("the name stands for the symbol: no mismatch, the symbol highlighted with the words", () => {
    const result = processDocumentCitationMarkers("Sąd „uniewinnia obwinionego Michała Kowalczyka od popełnienia zarzucanego mu czynu” [[LEXDOC:doc_w:0]].", [attachment(source)]);
    expect(result.text).not.toContain(QUOTE_MISMATCH_MARKER);
    const citation = result.citations[0]!;
    expect(source.slice(citation.highlightStart, citation.highlightEnd)).toBe("uniewinnia obwinionego [PII:PERSON:0008] od popełnienia zarzucanego mu czynu");
  });

  it("another word changed is still a mismatch", () => {
    const result = processDocumentCitationMarkers("Sąd „skazuje obwinionego Michała Kowalczyka od popełnienia zarzucanego mu czynu” [[LEXDOC:doc_w:0]].", [attachment(source)]);
    expect(result.text).toContain(QUOTE_MISMATCH_MARKER);
  });
});
