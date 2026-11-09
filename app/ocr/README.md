# Lex Machina local OCR

G27 uses **PaddleOCR PP-OCRv6_medium** with `lang=pl` as the primary local OCR engine.

The OCR path is deliberately separate from G20. G20 verifies official PDFs that already expose text. G27 handles user documents and scanned pages. G27A extends the same local PaddleOCR worker to direct photographs and image files.

## Installation

Create a dedicated Python environment and install:

```bash
python -m pip install -r app/ocr/requirements.txt
```

The first PaddleOCR initialization may download model weights. After the models are present in the local cache, document OCR runs locally. For an offline workstation, pre-warm the models before disconnecting network access.

## Apple Silicon execution

The acceleration measurement keeps the same PP-OCRv6 models, 220 DPI PDF rendering,
detector parameters, and Polish second reading. On macOS, detection and the
small Latin recognizer use ONNX Runtime CPU, the main line recognizer uses
CoreML **MLProgram**, and page orientation stays in Paddle. The detector uses
up to eight CPU threads, bounded by the CPU count and `LEX_OCR_THREADS` when set.
Its ONNX memory arena and memory patterns are disabled so variable page sizes do
not retain several GB of intermediate buffers. This changes allocation, not
image resolution, weights, or numerical precision. The legacy CoreML NeuralNetwork detector
allocated tens of GB on the M4 benchmark and must not be used for this path.

The ONNX detector retains PaddleX's preprocessing and postprocessing. Numerical
differences can slightly change detected line boundaries, so the app still
checks text consistency before enabling the faster backend. In the M4 test,
the observed differences fixed a missing space and a duplicated dash; synthetic
Polish amounts, dates and account numbers remained identical to the Paddle output.
Detector inputs above 6 million pixels use the original Paddle runner at full
resolution to bound memory growth on large photographs; subsequent smaller pages
can still use ONNX. This does not resize or discard document content.

One CoreML worker runs at a time to bound memory use. A changed CoreML engine
revision invalidates the old performance decision and schedules a fresh automatic
measurement using the already installed models. DirectML on Windows is unchanged.
Model initialization or inference failure retains the original Paddle fallback.

The `mkldnn` statistic reports compiled oneDNN support as well as the requested
setting; the macOS arm64 Paddle build reports `MKLDNN_NOT_COMPILED` rather than
claiming that oneDNN is active.

Backend regression tests (no model downloads), from the application root:

```bash
python3 -m unittest discover -s app/ocr -p 'test_onnx_accel.py'
```

## Supported inputs

- PDF;
- JPEG;
- PNG;
- WebP;
- TIFF.

A direct image is treated as one OCR page and is processed by PP-OCRv6 with Polish language support, orientation classification, document unwarping and text-line orientation enabled.

## Completeness contract

The Node runtime first inspects **every PDF page**. Pages with a usable text layer remain DIGITAL. Pages with too little text are sent to OCR. Every requested OCR page must return an accounted result; otherwise ingestion fails closed.

A page can be classified as BLANK only after the OCR path has actually processed it and returned no text.

Large documents are not truncated for model context. Their page text is divided into ordered chunks with explicit page markers. The chunker verifies that the sum of source characters in all chunks equals the source character count of the complete document.

Default safety bounds are intentionally high but finite:

- 512 MiB input;
- 10,000 pages;
- 100,000,000 extracted characters;
- 24,000 characters per chunk.

These are safety limits, not model-context truncation. They can be made configurable later without weakening the all-pages accounting rule.

## Manual privacy review

The local web UI can open either a PDF or supported image through `POST /api/documents/review`. OCR/extracted text remains inside the local runtime/browser boundary while the user reviews it. The protected chunks are produced only after `POST /api/documents/:documentId/finalize`.
