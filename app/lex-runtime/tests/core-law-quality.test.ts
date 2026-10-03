import { describe, expect, it } from "vitest";
import { checkArticleExtraction, splitArticles } from "../src/core-law-index.js";
import { CoreLawSearchIndex, articleUnits } from "../src/core-law-search.js";
import { coreLawRetrievalPrompt } from "../src/core-law-tool-runtime.js";
import type { CoreActRecord } from "../src/core-law-index.js";

describe("core law: PDF extraction check", () => {
  it("flags the article before a numbering gap, a duplicate or a jump back", () => {
    // Zgubiony nagłówek "Art. 3.": jego tekst dopisał się do art. 2.
    const text = [
      "Art. 1. Ustawa określa zasady.",
      "Art. 2. Organem jest wojewoda.",
      "Termin wynosi 14 dni.",
      "Art. 4. Skarga przysługuje stronie.",
      "Art. 5. (uchylony)",
      "Art. 6. Przepis końcowy.",
      "Art. 5. Wtrącony nagłówek strony.",
      "Art. 7. Wejście w życie."
    ].join("\n");
    const { order } = splitArticles(text);
    const check = checkArticleExtraction(text, order);
    expect(check.gaps).toEqual(["3"]);
    expect(check.duplicates).toBe(1);
    expect(check.suspectArticles).toEqual(expect.arrayContaining(["2", "6"]));
    expect(check.suspectArticles).not.toContain("4");
  });

  it("passes a clean text with repealed articles kept in place", () => {
    const text = "Art. 1. A.\nArt. 2. (uchylony)\nArt. 2a. B.\nArt. 3. C.";
    const check = checkArticleExtraction(text, splitArticles(text).order);
    expect(check).toEqual({ gaps: [], outOfOrder: 0, duplicates: 0, suspectArticles: [] });
  });
});

describe("core law: paragraph-level search", () => {
  const filler = Array.from({ length: 30 }, (_, i) => `${i + 2}. Organ prowadzi rejestr spraw w zakresie ${i + 2}. Wpis obejmuje dane podmiotu i datę.`);
  const long = ["Art. 10.", "1. Strona może wnieść zażalenie na postanowienie o odmowie wszczęcia postępowania w terminie siedmiu dni.", ...filler].join("\n");

  it("splits ust. and § paragraphs, keeping the article heading", () => {
    const units = articleUnits(long);
    expect(units[0]).toMatchObject({ unit: "ust. 1" });
    expect(units[0]!.text.startsWith("Art. 10.")).toBe(true);
    expect(articleUnits("Art. 3. § 1. Pierwszy.\n§ 2. Drugi.").map((u) => u.unit)).toEqual(["§ 1", "§ 2"]);
    expect(articleUnits("Art. 4. Jednolity przepis bez ustępów.")).toEqual([{ unit: null, text: "Art. 4. Jednolity przepis bez ustępów." }]);
  });

  it("finds the matching paragraph of a long article and returns one hit per article", () => {
    const index = new CoreLawSearchIndex([
      { eli: "DU/1", title: "Ustawa", article: "10", text: long },
      { eli: "DU/1", title: "Ustawa", article: "11", text: "Art. 11. Postępowanie wszczyna się na wniosek strony lub z urzędu; zażalenie przysługuje w przypadkach przewidzianych w ustawie." },
      { eli: "DU/1", title: "Ustawa", article: "12", text: "Art. 12. Odmowa wymaga postanowienia." }
    ]);
    const hits = index.search("termin na zażalenie na odmowę wszczęcia postępowania");
    expect(hits[0]).toMatchObject({ article: "10", unit: "ust. 1" });
    expect(hits.filter((hit) => hit.article === "10")).toHaveLength(1);
  });

  it("puts the matching paragraph of a long article into the RAG prompt", () => {
    const tail = ["Art. 20.", ...filler, "40. Zażalenie na odmowę wydania zaświadczenia wnosi się w terminie czternastu dni."].join("\n");
    const search = new CoreLawSearchIndex([{ eli: "DU/1", title: "Ustawa", article: "20", text: tail }]);
    const prompt = coreLawRetrievalPrompt(
      {
        search: (query, options) => search.search(query, options),
        currentRecord: () => ({ articles: { "20": tail } }) as unknown as CoreActRecord
      },
      "w jakim terminie zażalenie na odmowę wydania zaświadczenia"
    );
    expect(prompt).toContain("trafienie: ust. 40");
    expect(prompt).toContain("czternastu dni");
  });
});
