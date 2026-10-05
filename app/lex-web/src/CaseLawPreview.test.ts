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

describe("decision saved in the case's files", () => {
  it("names the card as the source above the downloaded text", async () => {
    const { caseLawDocument } = await import("./CaseLawPreview.js");
    const file = caseLawDocument({
      cardUrl: "https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg",
      court: "SN",
      form: "uchwała",
      signature: "III CZP 25/11",
      date: "2011-10-18",
      text: "Pełny tekst uchwały.",
      sha256: "abc",
      fetchedAt: "2026-10-05T10:00:00.000Z"
    });
    expect(file.name).toBe("Orzeczenie III CZP 25-11 z 2011-10-18.txt");
    expect(file.type).toBe("text/plain");
    const text = await file.text();
    expect(text).toContain("Orzeczenie: SN uchwała III CZP 25/11 2011-10-18");
    expect(text).toContain("Karta orzeczenia (źródło): https://sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg");
    expect(text.endsWith("Pełny tekst uchwały.\n")).toBe(true);
  });
});
