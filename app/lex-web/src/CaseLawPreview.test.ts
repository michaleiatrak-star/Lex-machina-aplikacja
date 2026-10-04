import { describe, expect, it } from "vitest";
import { attributedSentence } from "./CaseLawPreview.js";

describe("judgment full-text preview helpers", () => {
  it("finds the answer's sentence citing the case, without markers", () => {
    const answer = "Wstęp.\nIzba uznała, że termin jest zawity (KIO 512/25). ✅ [CASE-QUOTE:abc]\nKoniec.";
    expect(attributedSentence(answer, "KIO  512/25")).toBe("Izba uznała, że termin jest zawity (KIO 512/25).");
  });
});
