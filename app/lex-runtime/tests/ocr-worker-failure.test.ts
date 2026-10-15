import { describe, expect, it } from "vitest";
import { ocrWorkerFailure } from "../src/ocr/ocr-result.js";

describe("PaddleOCR worker failures", () => {
  it("models left incomplete by an installation cut short get their own code", () => {
    const stderr = "warning: fitz\nLEX_OCR_MODELS_INCOMPLETE:PP-OCRv6_medium_det,PP-OCRv6_medium_rec\n";
    expect(ocrWorkerFailure(stderr, 3, "worker").message).toBe("OCR_MODELS_INCOMPLETE: PP-OCRv6_medium_det, PP-OCRv6_medium_rec");
  });

  it("a missing Python package and any other failure keep their codes", () => {
    expect(ocrWorkerFailure("ModuleNotFoundError: No module named 'paddleocr'", 1, "worker").message).toMatch(/^OCR_ENGINE_MISSING: /u);
    expect(ocrWorkerFailure("Traceback ... MemoryError", 1, "image worker").message)
      .toBe("OCR_ENGINE_FAILED: Local PaddleOCR image worker failed with exit code 1: Traceback ... MemoryError");
  });
});
