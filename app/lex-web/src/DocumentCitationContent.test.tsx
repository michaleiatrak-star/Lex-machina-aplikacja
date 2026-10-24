import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { askAboutText, DocumentCitationContent } from "./DocumentCitationContent";

const citation = {
  citationId: "docref_1",
  marker: "[[LEXDOCREF:docref_1]]",
  label: "Dokument 1, s. 2",
  documentId: "document_" + "c".repeat(32),
  chunkIndex: 1,
  pageStart: 2,
  pageEnd: 2,
  contextText: "Pozwany podnosi, że towar został dostarczony z opóźnieniem."
};

describe("DocumentCitationContent", () => {
  it("tells the user a linked quote does not match the document", () => {
    const html = renderToStaticMarkup(
      <DocumentCitationContent
        content="Pozwany: „towar dostarczono bez opóźnienia” [[LEXDOCREF:docref_1]]"
        citations={[{ ...citation, quote: "towar dostarczono bez opóźnienia", quoteFidelity: "NOT_FOUND" }]}
      />
    );
    expect(html).toContain("cytat niezgodny z dokumentem");
  });

  it("does not warn for a faithful quote", () => {
    const html = renderToStaticMarkup(
      <DocumentCitationContent
        content="„towar został dostarczony z opóźnieniem” [[LEXDOCREF:docref_1]]"
        citations={[{ ...citation, quote: "towar został dostarczony z opóźnieniem", quoteFidelity: "EXACT", highlightStart: 17, highlightEnd: 58 }]}
      />
    );
    expect(html).not.toContain("niezgodny");
  });

  it("asks about the quoted words with the citation's label", () => {
    const text = askAboutText({ ...citation, quote: "towar   został dostarczony" }, null);
    expect(text).toBe("Wyjaśnij ten fragment (Dokument 1, s. 2): „towar został dostarczony”\n");
    expect(askAboutText(citation, null)).toContain("„Pozwany podnosi, że towar został dostarczony z opóźnieniem.”");
  });
});

