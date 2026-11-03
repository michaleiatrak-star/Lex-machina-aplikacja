"""Reads the benchmark page with Paddle on the processor and with the ONNX models on the
graphics card provider, and checks the text is the same (whitespace ignored, at least 95% of
the lines, like the app's own measurement). Times are printed, not judged: a CI runner has no
real card.

usage: ocr-accel-parity.py <python> <accel: dml|coreml|cpu> <onnx dir> <out dir>
env: LEX_PADDLE_MODEL_DIR, optional LEX_OCR_ORT_DIR
"""
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Windows consoles default to cp1252: the Polish lines printed below would not encode.
sys.stdout.reconfigure(encoding="utf-8")
python, accel, onnx_dir, out = sys.argv[1], sys.argv[2], sys.argv[3], Path(sys.argv[4])
out.mkdir(parents=True, exist_ok=True)


def read(mode):
    env = dict(os.environ, LEX_OCR_ACCEL=mode, LEX_OCR_ONNX_DIR=onnx_dir, PYTHONUTF8="1")
    target = out / f"{mode}.json"
    started = time.perf_counter()
    run = subprocess.run([python, str(ROOT / "ocr" / "paddle_worker.py"), "--input", str(ROOT / "ocr" / "fixtures" / "ocr-benchmark.pdf"),
                          "--output", str(target), "--pages", "1,2,3,4"], env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
    seconds = time.perf_counter() - started
    accel_lines = [line for line in run.stderr.splitlines() if line.startswith("LEX_OCR_ACCEL")]
    # Where the time went and whether oneDNN runs (LEX_OCR_MKLDNN_FALLBACK: the 5x slower path).
    for line in run.stderr.splitlines():
        if line.startswith(("LEX_OCR_STATS", "LEX_OCR_MKLDNN_FALLBACK")):
            print(mode, line)
    if run.returncode != 0:
        print(run.stderr[-4000:], file=sys.stderr)
        raise SystemExit(f"OCR_WORKER_FAILED:{mode}")
    pages = [page["text"] for page in json.loads(target.read_text(encoding="utf-8"))]
    return seconds, pages, accel_lines


def lines(pages):
    return [re.sub(r"\s+", "", line) for line in "\n".join(pages).split("\n") if line.strip()]


cpu_s, cpu_pages, _ = read("off")
acc_s, acc_pages, acc_log = read(accel)
a, b = lines(cpu_pages), lines(acc_pages)
same = sum(1 for x, y in zip(a, b) if x == y)
total = max(len(a), len(b))
used = any(re.match(r"^LEX_OCR_ACCEL \S+ \d+$", line) for line in acc_log) and not any("FAILED" in line for line in acc_log)
print(json.dumps({"accel": accel, "cpuSeconds": round(cpu_s, 1), "accelSeconds": round(acc_s, 1), "lines": total, "same": same, "used": used, "log": acc_log}, indent=2))
for x, y in zip(a, b):
    if x != y:
        print("CPU :", x)
        print("ACC :", y)
if not used:
    raise SystemExit("OCR_ACCEL_NOT_USED")
if total == 0 or same / total < 0.95:
    raise SystemExit("OCR_ACCEL_TEXT_DIFFERS")
