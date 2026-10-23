import { describe, expect, it } from "vitest";
import { needsPrivacyReview } from "./DocumentPrivacyPanel.js";

const page = { page: 1, text: "Umowa najmu lokalu.", source: "DIGITAL" as const };
const clean = { suggestions: [], pages: [page] };

describe("needsPrivacyReview: Przetwórz zatwierdza plik bez danych do decyzji", () => {
  it("plik bez wykryć, bez danych o zdrowiu i bez niepewnego OCR nie wymaga podglądu", () => {
    expect(needsPrivacyReview(clean)).toBe(false);
  });

  it("wykryte dane osobowe, dane o zdrowiu, niepewna linia OCR albo niedziałający rozpoznawacz: podgląd zostaje", () => {
    expect(needsPrivacyReview({ ...clean, suggestions: [{ page: 1, start: 0, end: 5, kind: "PERSON" as never }] })).toBe(true);
    expect(needsPrivacyReview({ ...clean, healthData: [{ page: 1, start: 0, end: 5 }] })).toBe(true);
    expect(needsPrivacyReview({ ...clean, recognizerWarnings: [{ name: "Morfeusz", reason: "DOWN" }] })).toBe(true);
    expect(needsPrivacyReview({ ...clean, pages: [{ ...page, source: "OCR" as const, review: [{ line: 1, text: "pieczęć", reason: "STAMP" as const }] }] })).toBe(true);
  });
});
