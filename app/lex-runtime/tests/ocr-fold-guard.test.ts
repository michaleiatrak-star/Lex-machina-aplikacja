import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// paddle_worker fold mode without the OCR engine (paddleocr and fitz stubbed).
const WORKER = path.resolve(__dirname, "../../ocr/paddle_worker.py");
const PYTHON = process.env.LEX_STORAGE_PYTHON ?? "python3";
const available = spawnSync(PYTHON, ["-c", "import numpy, cv2, PIL"]).status === 0;

const SCRIPT = String.raw`
import importlib.util, json, sys, types
for name in ("paddleocr", "fitz"):
    stub = types.ModuleType(name); stub.PaddleOCR = object; sys.modules[name] = stub
spec = importlib.util.spec_from_file_location("worker", sys.argv[1]); worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
line = lambda text, score: {"text": text, "score": score}
# A blank back page, the other side showing through: the fold reading is noise.
show_through = [line("注", 0.33), line("C)", 0.62), line("ははをー", 0.45), line("LER", 0.08)]
# A folded page: the fold reading recovers the lines the standard one lost.
standard = [line("POSTANOWIENIE", 0.98), line("o umorzeniu dochodzenia", 0.91), line("w,s;a", 0.2)]
folded = standard + [line("Prokurator Prokuratury Rejonowej", 0.95), line("na podstawie art. 17", 0.88)]
print(json.dumps({
    "noise": worker._sure_letters(show_through), "blank": worker._sure_letters([]),
    "standard": worker._sure_letters(standard), "folded": worker._sure_letters(folded),
}))
`;

describe("OCR: fold reading replaces a page only when it reads more", () => {
  it.skipIf(!available)("noise from a blank page showing the other side through counts no sure letters; a recovered fold counts more than the standard reading", () => {
    const run = spawnSync(PYTHON, ["-c", SCRIPT, WORKER], { encoding: "utf8" });
    expect(run.stderr).toBe("");
    const out = JSON.parse(run.stdout);
    expect(out.noise).toBe(0);
    expect(out.noise).not.toBeGreaterThan(out.blank);
    expect(out.standard).toBe(34);
    expect(out.folded).toBeGreaterThan(out.standard);
  });
});
