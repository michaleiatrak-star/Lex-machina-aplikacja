import { describe, expect, it } from "vitest";
import { restoreOcrSpacing, spacingFixes } from "../src/ocr-spacing.js";

const DICTIONARY = new Set([
  "Pukowca", "podlega", "siedzibą", "Katowicach", "przedsiębiorstwem", "dnia", "zostaje", "ramach", "wykonywania",
  "pracodawcę", "zupełne", "opin", "rozpowszechniać", "października", "odpowiedzialność", "art",
  "pros", "proszę", "pracownie", "pracowniczych", "spółka", "zarządu", "pełnomocnictwo", "mając", "Czapłowski"
]);
const known = async (words: string[]) => words.map((word) => DICTIONARY.has(word));
const fixes = async (line: string) => (await spacingFixes([line], known)).map((fix) => `${fix.from}→${fix.to}`);

describe("spaces dropped by OCR", () => {
  it("a word or abbreviation glued to a number", async () => {
    expect(await fixes("ul. Pukowca15, 40-847 Katowice")).toEqual(["Pukowca15,→Pukowca 15,"]);
    expect(await fixes("w art.270 Kodeksu")).toEqual(["art.270→art. 270"]);
    expect(await fixes("tel:32250-56-13")).toEqual(["tel:32250-56-13→tel: 32250-56-13"]);
    expect(await fixes("zapisów nr 6,7 i8")).toEqual(["i8→i 8"]);
  });

  it("two known words glued, one reading only", async () => {
    expect(await fixes("ipodlega karze")).toEqual(["ipodlega→i podlega"]);
    expect(await fixes("z siedzibąw Katowicach")).toEqual(["siedzibąw→siedzibą w"]);
    expect(await fixes("i Human Park wKatowicach")).toEqual(["wKatowicach→w Katowicach"]);
    expect(await fixes("z dniazostaje rozwiązana")).toEqual(["dniazostaje→dnia zostaje"]);
  });

  it("leaves identifiers, known words, the author's typos and negations", async () => {
    expect(await fixes("KRS0001025052 ABC123456 PL61109010140000071219812874 2A/31 2024r.")).toEqual([]);
    expect(await fixes("odpowiedzialność")).toEqual([]);
    expect(await fixes("w opini publicznej")).toEqual([]);
    expect(await fixes("nierozpowszechniać")).toEqual([]);
  });

  it("a misread word is not glue: one letter read differently gives a known word", async () => {
    expect(await fixes("Tym samym prosze regulować")).toEqual(["prosze→proszę"]);
    expect(await fixes("obowiązków pracowniezych")).toEqual([]);
  });

  it("an amount with a letter o for a zero", async () => {
    expect(await fixes("kara w wysokości 20.ooo,00 zł")).toEqual(["20.ooo,00→20.000,00"]);
    expect(await fixes("kwoty 60.0o0,00 zł")).toEqual(["60.0o0,00→60.000,00"]);
    expect(await fixes("kwoty 60.000,00 zł i 1o osób")).toEqual([]);
  });

  it("a common word with one lost diacritic, not a name written without them", async () => {
    expect(await fixes("Spólka Human Park, Członkach Zarzadu")).toEqual(["Spólka→Spółka", "Zarzadu→Zarządu"]);
    expect(await fixes("PELNOMOCNICTWO")).toEqual(["PELNOMOCNICTWO→PEŁNOMOCNICTWO"]);
    expect(await fixes("- pelnomocnictwo.")).toEqual(["pelnomocnictwo.→pełnomocnictwo."]);
    expect(await fixes("Jan Czaplowski, jan.czaplowski@firma.pl, tel")).toEqual([]);
  });

  it("rebuilds the page text and keeps the original tokens", async () => {
    const page = await restoreOcrSpacing(
      { page: 1, source: "OCR", text: "ul.Pukowca15\nipodlega", lines: [{ text: "ul. Pukowca15" }, { text: "ipodlega" }] },
      known
    );
    expect(page.text).toBe("ul. Pukowca 15\ni podlega");
    expect(page.corrections).toEqual([
      { line: 0, from: "Pukowca15", to: "Pukowca 15" },
      { line: 1, from: "ipodlega", to: "i podlega" }
    ]);
  });
});
