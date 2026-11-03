import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// paddle_worker text clean-up without the OCR engine (paddleocr and fitz stubbed).
const WORKER = path.resolve(__dirname, "../../ocr/paddle_worker.py");
const PYTHON = process.env.LEX_STORAGE_PYTHON ?? "python3";
const available = spawnSync(PYTHON, ["-c", "import numpy, cv2, PIL"]).status === 0;
const dictionary = available && spawnSync(PYTHON, ["-c", "import morfeusz2"]).status === 0;

const SCRIPT = String.raw`
import importlib.util, json, sys, types
for name in ("paddleocr", "fitz"):
    stub = types.ModuleType(name); stub.PaddleOCR = object; sys.modules[name] = stub
spec = importlib.util.spec_from_file_location("worker", sys.argv[1]); worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
text = sys.argv[2]
out = {"letters": worker._polish_letters(text)}
if sys.argv[3] == "dict":
    worker.DICTIONARY.prepare([out["letters"]])
    out["dict"] = worker.DICTIONARY.text(out["letters"])
print(json.dumps(out, ensure_ascii=False))
`;

const run = (text: string, mode: "letters" | "dict") => {
  const result = spawnSync(PYTHON, ["-c", SCRIPT, WORKER, text, mode], { encoding: "utf8" });
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as { letters: string; dict?: string };
};

describe("OCR: Polish text without other languages' marks", () => {
  it.skipIf(!available)("a foreign mark becomes the Polish letter (or the bare one), one character for one", () => {
    const text = "uwažane skłádania, Spółka ŻÓŁĆ, Čech";
    const out = run(text, "letters");
    expect(out.letters).toBe("uważane składania, Spółka ŻÓŁĆ, Ćech");
    expect(out.letters).toHaveLength(text.length);
  });

  it.skipIf(!dictionary)("a word the dictionary does not know gets its lost mark; known words, abbreviations and names stay", () => {
    const out = run("Human Park Spóika z ograniczoną odpowiedziainością, zazalenia do godz. 12, Juneyoung Park", "dict");
    expect(out.dict).toBe("Human Park Spółka z ograniczoną odpowiedzialnością, zażalenia do godz. 12, Juneyoung Park");
  });
});

const MARKS_SCRIPT = String.raw`
import importlib.util, json, sys, types
for name in ("paddleocr", "fitz"):
    stub = types.ModuleType(name); stub.PaddleOCR = object; sys.modules[name] = stub
spec = importlib.util.spec_from_file_location("worker", sys.argv[1]); worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
lines = [("Sąd Okręgowy w Katowicach, Wydział Pracy i Ubezpieczeń", 0.995), ("Kancelaria adwokacka Michal Kowalski, Okregowa Rada", 0.996),
         ("przedmiot sporu: kwota zł", 0.90), ('ujrzeli "słonko kochane", lżej im', 0.995), ("i poczaął pić. W karczmie", 0.993)]
need = [worker.needs_second_reading(text, score) for text, score in lines]
calls = []
primary = lambda images, **k: iter([{"rec_text": text, "rec_score": score} for text, score in lines])
def second(images, **k):
    calls.append(len(images))
    fixed = {"Kancelaria adwokacka Michal Kowalski, Okregowa Rada": "Kancelaria adwokacka Michał Kowalski, Okręgowa Rada"}
    return iter([{"rec_text": fixed.get(lines[i][0], lines[i][0]), "rec_score": 0.99} for i in images])
reading = worker.MarksReading(primary, lambda images, **k: second(images, **k))
out = [item["rec_text"] for item in reading(list(range(len(lines))))]
print(json.dumps({"need": need, "calls": calls, "out": out}, ensure_ascii=False))
`;

describe("OCR: drugie odczytanie znaków polskich tylko tam, gdzie może coś zmienić", () => {
  it.skipIf(!available)("linia bez znaków polskich, niepewna, z cudzysłowem ASCII albo zdublowaną literą: odczytana drugi raz; pewna linia ze znakami: nie", () => {
    const result = spawnSync(PYTHON, ["-c", MARKS_SCRIPT, WORKER], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    const out = JSON.parse(result.stdout) as { need: boolean[]; calls: number[]; out: string[] };
    expect(out.need).toEqual([false, true, true, true, true]);
    // One call of the second recognizer, with the four lines that need it.
    expect(out.calls).toEqual([4]);
    expect(out.out[1]).toBe("Kancelaria adwokacka Michał Kowalski, Okręgowa Rada");
    expect(out.out[0]).toBe("Sąd Okręgowy w Katowicach, Wydział Pracy i Ubezpieczeń");
  });
});
