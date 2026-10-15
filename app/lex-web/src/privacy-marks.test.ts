import { describe, expect, it } from "vitest";
import type { PagePrivacyDirective } from "./api.js";
import { addMark, visibleSuggestions } from "./privacy-marks.js";

const mask = (start: number, end: number, page = 1): PagePrivacyDirective => ({ page, start, end, action: "PSEUDONYMIZE", kind: "PERSON" });
const keep = (start: number, end: number): PagePrivacyDirective => ({ page: 1, start, end, action: "KEEP" });

describe("user marks in the privacy preview", () => {
  it("a mark over an earlier one joins it: one decision, no overlap for the runtime", () => {
    expect(addMark([mask(10, 20)], mask(15, 30))).toEqual([mask(10, 30)]);
    expect(addMark([mask(0, 5), mask(10, 20)], mask(3, 12))).toEqual([mask(0, 20)]);
  });

  it("a mark over a 'leave in clear' decision replaces it", () => {
    expect(addMark([keep(10, 20)], mask(5, 25))).toEqual([mask(5, 25)]);
  });

  it("marks on other pages or not touching stay as they are", () => {
    expect(addMark([mask(10, 20, 2), mask(30, 40)], mask(10, 20))).toEqual([mask(10, 20, 2), mask(30, 40), mask(10, 20)]);
  });

  it("an automatic proposal under the user's mark is not drawn over it", () => {
    const suggestions = [{ page: 1, start: 10, end: 20 }, { page: 1, start: 40, end: 45 }];
    expect(visibleSuggestions(suggestions, [mask(5, 15)])).toEqual([{ page: 1, start: 40, end: 45 }]);
  });
});
