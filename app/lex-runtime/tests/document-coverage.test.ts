import { describe, expect, it } from "vitest";
import { documentCoverage, mergeRanges, missingPages } from "../src/document-coverage.js";

describe("pages of a document the model read", () => {
  it("merges the chunks sent and read, and names the pages left", () => {
    const coverage = documentCoverage([
      { documentId: "doc_a", title: "akta.pdf", totalPages: 40, chunks: [{ pageStart: 1, pageEnd: 6 }, { pageStart: 7, pageEnd: 12 }] },
      { documentId: "doc_a", totalPages: 40, chunks: [{ pageStart: 30, pageEnd: 32 }] },
      { documentId: "doc_b", totalPages: 2, chunks: [{ pageStart: 1, pageEnd: 2 }] },
      // No page count: not reported rather than guessed.
      { documentId: "doc_c", chunks: [{ pageStart: 1, pageEnd: 1 }] }
    ]);
    expect(coverage).toEqual([
      { documentId: "doc_a", title: "akta.pdf", totalPages: 40, pages: [[1, 12], [30, 32]], status: "PARTIAL" },
      { documentId: "doc_b", totalPages: 2, pages: [[1, 2]], status: "FULL" }
    ]);
    expect(missingPages(40, coverage[0]!.pages)).toEqual([[13, 29], [33, 40]]);
  });

  it("joins adjacent ranges", () => {
    expect(mergeRanges([[5, 6], [1, 2], [3, 4]])).toEqual([[1, 6]]);
  });
});
