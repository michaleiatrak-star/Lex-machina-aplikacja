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

describe("decisions the user points to", () => {
  it("takes cards; a blob: or old PDF of sn.pl goes by the signature in the message", async () => {
    const { caseLawReferences } = await import("./CaseLawPreview.js");
    expect(caseLawReferences("zobacz https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg.")).toEqual([
      { kind: "CARD", cardUrl: "https://www.sn.pl/pl/wyszukiwarka-orzeczen?orzeczenie=ZuUySp8Bw1HnVDW6c5lg" }
    ]);
    expect(caseLawReferences("II CSKP 89/26 blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466 to jest link orzeczenia")).toEqual([
      { kind: "SIGNATURE", signature: "II CSKP 89/26", link: "blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466" }
    ]);
    expect(caseLawReferences("blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466")).toEqual([
      { kind: "BLOB_WITHOUT_SIGNATURE", link: "blob:https://www.sn.pl/aeff2f6a-34cd-4771-8941-6b7ea9295466" }
    ]);
    expect(caseLawReferences("https://orzeczenia.nsa.gov.pl/doc/1A2B3C4D5E")).toEqual([{ kind: "CARD", cardUrl: "https://orzeczenia.nsa.gov.pl/doc/1A2B3C4D5E" }]);
    expect(caseLawReferences("https://www.sn.pl/pl/wyszukiwarka-orzeczen oraz https://www.sn.pl/aktualnosci")).toEqual([]);
    expect(caseLawReferences("wyrok II Cz 12/20 blob:https://x.pl/1")[0]?.kind).toBe("BLOB_WITHOUT_SIGNATURE");
    const sp = "https://orzeczenia.poznan.so.gov.pl/content/$N/155000000001006_I_C_000100_2015_Uz_2015-06-18_001";
    expect(caseLawReferences(`wyrok ${sp}`)).toEqual([{ kind: "CARD", cardUrl: sp }]);
    expect(isCaseLawSource("https://orzeczenia.ms.gov.pl/details/$N/1")).toBe(true);
    expect(isCaseLawSource("https://ipo.trybunal.gov.pl/ipo/Sprawa?dokument=1")).toBe(true);
  });
});
