import { describe, expect, it } from "vitest";
import type { IngestedPage } from "../src/document-ingestion.js";
import { arbitrateLine, correctWithVision, doubtfulLines, withoutLineCrops } from "../src/ocr-vision.js";

const DICTIONARY = new Set([
  "lub", "innego", "stosunku", "prawnego", "do", "niewykonania", "radcy", "Pawła", "Raka",
  "wszelkie", "Pana", "zadania", "żądania", "dotyczące", "zapłaty", "ją", "przedsiębiorstwa", "Paweł", "Rak", "Rafał",
  "Pawel", "dnia", "Pracodawcy", "wobec", "się", "umowy", "OIRP", "Katowice", "nr", "KAT"
]);
const known = new Set(DICTIONARY);
const knownWords = async (words: string[]) => words.map((word) => DICTIONARY.has(word));

describe("arbiter between the OCR line and the vision model", () => {
  it("takes an unknown word made known by a small edit, a diacritic, a space and regrouped digits", () => {
    expect(arbitrateLine("lub Innego slosunku prewnego, do niewykonania", "lub innego stosunku prawnego, do niewykonania", known).text)
      .toBe("lub innego stosunku prawnego, do niewykonania");
    expect(arbitrateLine("radcy prawnego Pawla Raka", "radcy prawnego Pawła Raka", known).text).toBe("radcy prawnego Pawła Raka");
    expect(arbitrateLine("wszelkie Pana zadania dotyczące", "wszelkie Pana żądania dotyczące", known).text).toBe("wszelkie Pana żądania dotyczące");
    expect(arbitrateLine("dnia 810.2024", "dnia 8.10.2024", known).text).toBe("dnia 8.10.2024");
    // Edge punctuation stays as read; a missing closing mark may be added.
    expect(arbitrateLine("wszelkie Pana zadania, dotyczące", "wszelkie Pana żądania. dotyczące", known).text).toBe("wszelkie Pana żądania, dotyczące");
    expect(arbitrateLine("lub prewnego", "lub prawnego.", known).text).toBe("lub prawnego.");
    expect(arbitrateLine("b) prewnego", "«b) prawnego", known).text).toBe("b) prawnego");
  });

  it("refuses made-up words and dates, changed digits, dropped diacritics and another line", () => {
    expect(arbitrateLine("dnia 9 października", "dnia 29.12.2023 9 października", known).fixes).toEqual([]);
    expect(arbitrateLine("PawerRa", "Pawel Rafał", known).fixes).toEqual([]);
    expect(arbitrateLine("przedsiębiorstwa Pana", "przedsiebiorstwa Pana", known).fixes).toEqual([]);
    expect(arbitrateLine("OIRP Katowice nr KAT 2575", "OIRP Katowice nr KAT 2576", known).fixes).toEqual([]);
    expect(arbitrateLine("lub innego stosunku prawnego", "Sąd Rejonowy w Gliwicach oddalił powództwo w całości", known).fixes).toEqual([]);
  });

  it("reads again only doubtful printed lines with an image; handwriting goes to manual review", () => {
    const lines = [
      { text: "lub innego stosunku", score: 0.99, crop: "x" },
      { text: "radcy prawnego Pawla", score: 0.99, crop: "x" },
      { text: "Wire mats Mithet", score: 0.6, crop: "x" },
      { text: "lub innego stosunku", score: 0.9, crop: "x" },
      { text: "slosunku", score: 0.99 }
    ];
    expect(doubtfulLines(lines, new Set(["lub", "innego", "stosunku", "radcy", "prawnego"]))).toEqual([1, 3]);
  });
});

describe("vision step on a page", () => {
  const page: IngestedPage = {
    page: 1,
    source: "OCR",
    text: "radcy prawnego Pawla Raka\nlub innego stosunku",
    lines: [
      { text: "radcy prawnego Pawla Raka", score: 0.99, crop: "img1" },
      { text: "lub innego stosunku", score: 0.99, crop: "img2" }
    ]
  };

  it("keeps the original words in corrections and asks only about doubtful lines", async () => {
    const asked: string[] = [];
    const [fixed] = await correctWithVision([page], async (image, ocr) => {
      asked.push(image);
      return ocr.replace("Pawla", "Pawła");
    }, knownWords);
    expect(asked).toEqual(["img1"]);
    expect(fixed!.text).toBe("radcy prawnego Pawła Raka\nlub innego stosunku");
    expect(fixed!.corrections).toEqual([{ line: 0, from: "Pawla", to: "Pawła" }]);
  });

  it("drops the line images before the document is kept", () => {
    expect(withoutLineCrops(page).lines!.every((line) => !("crop" in line))).toBe(true);
  });
});
