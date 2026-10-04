import { describe, expect, it } from "vitest";
import { attributedSentence, isCaseLawSource } from "./CaseLawPreview.js";

describe("judgment full-text preview helpers", () => {
  it("recognizes judgment and interpretation sources, including KIO", () => {
    expect(isCaseLawSource("https://orzeczenia.uzp.gov.pl/Home/Details/1")).toBe(true);
    expect(isCaseLawSource("https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=1")).toBe(true);
    expect(isCaseLawSource("https://eureka.mf.gov.pl/informacje/podglad/5")).toBe(true);
    expect(isCaseLawSource("https://api.sejm.gov.pl/eli/acts/DU/2025/383/text.pdf")).toBe(false);
  });

  it("finds the answer's sentence citing the case, without markers", () => {
    const answer = "Wstęp.\nIzba uznała, że termin jest zawity (KIO 512/25). ✅ [CASE-QUOTE:abc]\nKoniec.";
    expect(attributedSentence(answer, "KIO  512/25")).toBe("Izba uznała, że termin jest zawity (KIO 512/25).");
  });
});
