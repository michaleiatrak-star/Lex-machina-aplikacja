import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IngestedPage } from "../src/document-ingestion.js";
import {
  arbitrateLine,
  correctWithVision,
  doubtfulLines,
  enoughMemoryForVision,
  installedVisionModel,
  visionModelFromManifest,
  withoutLineCrops
} from "../src/ocr-vision.js";

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

  it("starts only with memory for the model files and 1 GB of buffers", () => {
    const model = 5.5 * 1024 ** 3;
    expect(enoughMemoryForVision(model, 6 * 1024 ** 3)).toBe(false);
    expect(enoughMemoryForVision(model, 7 * 1024 ** 3)).toBe(true);
  });

  it("drops the line images before the document is kept", () => {
    expect(withoutLineCrops(page).lines!.every((line) => !("crop" in line))).toBe(true);
  });
});

describe("vision model from the release manifest", () => {
  const sha = (char: string) => char.repeat(64);
  const manifest = {
    models: {
      localVision: [
        { id: "broken", filename: "x.gguf" },
        {
          id: "local/vl",
          displayName: "VL",
          license: "Apache-2.0",
          filename: "vl.gguf",
          url: "https://example.test/vl.gguf",
          sha256: sha("A"),
          bytes: 4,
          projector: { filename: "mmproj.gguf", url: "https://example.test/mmproj.gguf", sha256: sha("b"), bytes: 2 }
        }
      ]
    }
  };

  it("takes the first valid entry", () => {
    const spec = visionModelFromManifest(manifest)!;
    expect(spec.id).toBe("local/vl");
    expect(spec.sha256).toBe(sha("a"));
    expect(visionModelFromManifest({ models: {} })).toBeNull();
  });

  it("counts as installed only with vision.json of this entry and both files of the right size", () => {
    const spec = visionModelFromManifest(manifest)!;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lex-vision-"));
    const model = path.join(dir, "vl.gguf");
    const projector = path.join(dir, "mmproj.gguf");
    fs.writeFileSync(model, "1234");
    fs.writeFileSync(projector, "12");
    expect(installedVisionModel(dir, spec)).toBeNull();
    const record = (id: string) => ({
      model: { id, path: model, sha256: sha("a") },
      projector: { path: projector, sha256: sha("b") }
    });
    fs.writeFileSync(path.join(dir, "vision.json"), JSON.stringify(record("local/vl")));
    expect(installedVisionModel(dir, spec)).toEqual({ id: "local/vl", model, projector, bytes: 6 });
    fs.writeFileSync(projector, "1");
    expect(installedVisionModel(dir, spec)).toBeNull();
    fs.writeFileSync(projector, "12");
    fs.writeFileSync(path.join(dir, "vision.json"), JSON.stringify(record("local/other")));
    expect(installedVisionModel(dir, spec)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
