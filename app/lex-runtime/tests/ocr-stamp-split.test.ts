import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// paddle_worker.split_stamp_ink without the OCR engine (paddleocr and fitz stubbed); runs where
// the worker's own image libraries (numpy, Pillow, OpenCV) are installed.
const WORKER = path.resolve(__dirname, "../../ocr/paddle_worker.py");
const PYTHON = process.env.LEX_STORAGE_PYTHON ?? "python3";
const available = spawnSync(PYTHON, ["-c", "import numpy, cv2, PIL"]).status === 0;

const SCRIPT = String.raw`
import importlib.util, json, sys, types
for name in ("paddleocr", "fitz"):
    stub = types.ModuleType(name); stub.PaddleOCR = object; sys.modules[name] = stub
spec = importlib.util.spec_from_file_location("worker", sys.argv[1]); worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
import numpy as np
def page():
    image = np.full((400, 600, 3), 246, np.uint8)
    image[100:112, 50:550] = (20, 20, 22)            # a printed line
    return image
out = {}
plain = page(); out["plain"] = worker.split_stamp_ink(plain) is None
red = page()
red[60:160, 200:400] = np.minimum(red[60:160, 200:400], np.array([200, 40, 50], np.uint8))  # ink over the line
text, regions = worker.split_stamp_ink(red)
out["letter_kept"] = bool((text[100:112, 210:390] < 60).all())
out["ink_removed"] = bool((text[60:95, 210:390] > 200).all())
out["regions"] = [[int(x), int(y), list(layer.shape[:2])] for x, y, layer in regions]
x0, y0, layer = regions[0]; out["stamp_dark"] = bool((layer[70 - y0:90 - y0, 210 - x0:390 - x0] < 200).all())
grey = page(); grey[60:160, 200:400] = np.minimum(grey[60:160, 200:400], 90); out["grey"] = worker.split_stamp_ink(grey) is None
photo = (np.random.default_rng(0).random((400, 600, 3)) * 255).astype(np.uint8); out["photo"] = worker.split_stamp_ink(photo) is None
import cv2
def framed(color):
    # A framed stamp with two lines of strokes over two printed lines.
    # An A4 page's proportions (the stamp a small share of it, as on paper).
    image = np.full((1400, 1100, 3), 246, np.uint8)
    for y in (200, 300):
        image[y:y + 12, 40:860] = (20, 20, 22)
    ink = np.full((1400, 1100, 3), 255, np.uint8)
    cv2.rectangle(ink, (250, 150), (650, 400), color, 6)
    for y in (215, 320):
        for x in range(290, 610, 28):
            cv2.line(ink, (x, y), (x + 14, y + 40), color, 5)
    return np.minimum(image, ink)
text, regions = worker.split_stamp_ink(framed((40, 60, 175)))
out["framed_once"] = len(regions)
grey_stamp = framed((128, 128, 128))
split = worker.split_stamp_ink(grey_stamp)
out["grey_stamp"] = split is not None and len(split[1]) == 1
if split:
    gtext, _ = split
    out["grey_letter_kept"] = bool((gtext[200:212, 300:600] < 80).mean() > 0.9)
    out["grey_ink_removed"] = bool((gtext[155:170, 300:600] > 200).all())
logo = page(); cv2.ellipse(logo, (450, 250), (120, 90), 0, 0, 360, (140, 140, 140), -1); out["grey_logo"] = worker.split_stamp_ink(logo) is None
print(json.dumps(out))
`;

describe("OCR: a coloured or grey stamp read apart from the printed lines", () => {
  it.skipIf(!available)("text layer keeps black letters under the ink, the stamp gets its own layer; grey ink and a colour photo are left as they are", () => {
    const run = spawnSync(PYTHON, ["-c", SCRIPT, WORKER], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    const out = JSON.parse(run.stdout);
    expect(out).toMatchObject({ plain: true, letter_kept: true, ink_removed: true, stamp_dark: true, grey: true, photo: true });
    expect(out.regions).toHaveLength(1);
    // A frame around the stamp's lines: one block (each line was read twice before).
    expect(out.framed_once).toBe(1);
  });

  it.skipIf(!available)("a grey stamp is split by lightness, black letters under it stay; a filled grey logo is not a stamp", () => {
    const run = spawnSync(PYTHON, ["-c", SCRIPT, WORKER], { encoding: "utf8" });
    const out = JSON.parse(run.stdout);
    expect(out).toMatchObject({ grey_stamp: true, grey_letter_kept: true, grey_ink_removed: true, grey_logo: true });
  });
});
