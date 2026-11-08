import { describe, expect, it } from "vitest";
import { withRememberedLines } from "./page-scan-cache.js";

const scan = (lines: Array<{ text: string; box: [number, number, number, number] | null }>) => ({
  page: 1, mediaType: "image/jpeg" as const, data: "", width: 100, height: 100, lines
});

describe("line frames after a hand correction", () => {
  it("the frames first read stay for a page returned without them", () => {
    const first = scan([{ text: "Kwota 1200 zl", box: [1, 2, 30, 8] }]);
    expect(withRememberedLines("doc_a", 1, first)).toBe(first);
    expect(withRememberedLines("doc_a", 1, scan([]))?.lines).toEqual(first.lines);
    expect(withRememberedLines("doc_b", 1, scan([]))?.lines).toEqual([]);
  });
});
