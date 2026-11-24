import { describe, expect, it } from "vitest";
import { cloudPageImage, lowConfidencePages } from "./ocr-page-actions";

const SCAN = { page: 2, mediaType: "image/jpeg" as const, data: "/9j/AAAA", width: 10, height: 10, lines: [] };

describe("low-certainty OCR page (task 06)", () => {
  it("without consent the page image is not prepared for the cloud model", () => {
    expect(cloudPageImage(false, SCAN, "protokol.pdf")).toBeNull();
    expect(cloudPageImage(true, null, "protokol.pdf")).toBeNull();
  });

  it("with consent the page image goes as the next message's image", () => {
    expect(cloudPageImage(true, SCAN, "protokol.pdf")).toEqual({ name: "protokol - strona 2.jpg", mediaType: "image/jpeg", data: "/9j/AAAA" });
  });

  it("lists the marked pages with their certainty", () => {
    expect(lowConfidencePages([{ page: 1, confidence: 0.99 }, { page: 2, lowConfidence: true, confidence: 0.814 }, { page: 3, lowConfidence: true }])).toEqual([
      { page: 2, percent: 81 },
      { page: 3, percent: null }
    ]);
  });
});
