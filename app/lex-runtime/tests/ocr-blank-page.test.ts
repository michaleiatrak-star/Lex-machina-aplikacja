import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// paddle_worker.blank_page: an empty back of a sheet is not read; any stroke, also faint, is.
const python = process.env.LEX_OCR_PYTHON ?? "python3";
const ready = spawnSync(python, ["-c", "import paddleocr, PIL, numpy"]).status === 0;
const ocrDir = path.resolve(import.meta.dirname, "../../ocr");

describe("OCR: puste strony", () => {
  it.skipIf(!ready)("pusta kartka i dziurki dziurkacza: pusta; blade słowo i jedna cyfra: czytane", () => {
    const script = `
import sys, numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, sys.argv[1])
import paddle_worker as w
def page(draw=None):
    im = Image.new("RGB", (1820, 2572), (250, 250, 250))
    d = ImageDraw.Draw(im)
    # Punch holes near the right edge of the back of a sheet.
    for y in (950, 1650):
        d.ellipse((1690, y, 1730, y + 14), fill=(90, 90, 90))
    if draw: draw(d)
    return np.array(im)
print(w.blank_page(page()))
print(w.blank_page(page(lambda d: d.rectangle((400, 600, 470, 640), fill=(140, 140, 140)))))
print(w.blank_page(page(lambda d: d.rectangle((400, 600, 410, 640), fill=(20, 20, 20)))))
`;
    const run = spawnSync(python, ["-c", script, ocrDir], { encoding: "utf8" });
    expect(run.stdout.trim().split("\n").slice(-3)).toEqual(["True", "False", "False"]);
  }, 120_000);
});
