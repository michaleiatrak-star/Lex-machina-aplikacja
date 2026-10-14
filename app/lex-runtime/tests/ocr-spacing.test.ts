import { describe, expect, it } from "vitest";
import { restoreOcrSpacing, spacingFixes } from "../src/ocr-spacing.js";

const DICTIONARY = new Set([
  "Pukowca", "podlega", "siedzibą", "Katowicach", "przedsiębiorstwem", "dnia", "zostaje", "ramach", "wykonywania",
  "pracodawcę", "zupełne", "opin", "rozpowszechniać", "października", "odpowiedzialność", "art"
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
