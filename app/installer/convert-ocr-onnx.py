"""Converts the PaddleOCR models of the release to ONNX for OCR on the graphics card
(app/ocr/onnx_accel.py) and checks each against the SHA-256 the app pins
(app/lex-runtime/src/ocr/ocr-acceleration.ts). Python 3.12 (paddle2onnx 2.1.0).

usage: convert-ocr-onnx.py <paddle official_models dir> <out dir> <ocr-acceleration.ts>
       convert-ocr-onnx.py --download <paddle cache dir>
"""
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

MODELS = ["PP-OCRv6_medium_det", "PP-OCRv6_medium_rec", "latin_PP-OCRv5_mobile_rec", "PP-LCNet_x1_0_doc_ori"]


def download(cache):
    """The official models as the installer downloads them (PaddleX, BOS)."""
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(Path(cache).resolve())
    os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "bos")
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    from paddleocr import PaddleOCR, TextRecognition

    PaddleOCR(lang="pl", ocr_version="PP-OCRv6", use_doc_orientation_classify=True, use_doc_unwarping=True,
              use_textline_orientation=True, enable_mkldnn=False, device="cpu")
    TextRecognition(model_name="latin_PP-OCRv5_mobile_rec", enable_mkldnn=False, device="cpu")


def pinned(ts_file):
    text = Path(ts_file).read_text(encoding="utf-8")
    return {m.group(1): (int(m.group(2)), m.group(3)) for m in re.finditer(
        r'filename: "([^"]+\.onnx)", bytes: (\d+), sha256: "([0-9a-f]{64})"', text)}


def convert(models_dir, out_dir, ts_file):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    expected = pinned(ts_file)
    report = {}
    for name in MODELS:
        target = out / f"{name}.onnx"
        subprocess.run([
            "paddle2onnx", "--model_dir", str(Path(models_dir) / name), "--model_filename", "inference.json",
            "--params_filename", "inference.pdiparams", "--save_file", str(target), "--opset_version", "14",
        ], check=True, stdout=subprocess.DEVNULL)
        data = target.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        report[target.name] = {"bytes": len(data), "sha256": digest, "pinned": expected.get(target.name) == (len(data), digest)}
    (out / "SHA256SUMS").write_text("".join(f"{v['sha256']}  {k}\n" for k, v in report.items()), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if not all(item["pinned"] for item in report.values()):
        print("OCR_ONNX_PIN_MISMATCH: update OCR_ACCEL_MODELS in ocr-acceleration.ts", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    if sys.argv[1] == "--download":
        download(sys.argv[2])
    else:
        convert(sys.argv[1], sys.argv[2], sys.argv[3])
