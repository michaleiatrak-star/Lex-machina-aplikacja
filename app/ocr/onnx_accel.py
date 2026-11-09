"""OCR on the graphics card of any vendor: the PaddleOCR models converted to ONNX run in ONNX
Runtime with DirectML (Windows: NVIDIA, AMD, Intel, any DirectX 12 card) or CoreML (macOS:
Apple GPU and Neural Engine). PaddleX keeps the steps around the networks (resizing,
normalization, text boxes and decoding). The app measures speed and text consistency before
enabling acceleration. On macOS the detector and small Latin recognizer use ONNX CPU;
only the main recognizer uses CoreML.

LEX_OCR_ACCEL: auto (default: the card when the models and a provider are there), off,
dml, coreml, cpu (ONNX on the processor, for checks). LEX_OCR_ONNX_DIR: the converted models
(<model name>.onnx). LEX_OCR_ORT_DIR: a separate ONNX Runtime build (Windows: the DirectML one,
kept apart from the CPU build the transcription uses). Any failure leaves the Paddle path as it
was, also a failure in the middle of a document: that model goes back to Paddle for good.
"""
import os
import sys
from pathlib import Path

PROVIDERS = {
    "dml": "DmlExecutionProvider",
    "coreml": "CoreMLExecutionProvider",
    "cpu": "CPUExecutionProvider",
}

# At the measured 4.7 MP detector input the complete worker peaked around 9 GiB.
# Large photographs can exceed that substantially. Retain full-resolution
# Paddle detection for those inputs rather than resizing or risking a swap storm.
APPLE_ONNX_DETECTION_MAX_PIXELS = 6_000_000


class OrtRunner:
    """The predictor's runner: the same call (x = list of input arrays, a list of outputs back)."""

    def __init__(self, session, fallback, name=""):
        self.session = session
        self.fallback = fallback
        self.name = name
        self.inputs = [item.name for item in session.get_inputs()]

    def __call__(self, x):
        if self.session is not None:
            if sys.platform == "darwin" and self.name == "PP-OCRv6_medium_det" and x:
                shape = getattr(x[0], "shape", ())
                if len(shape) == 4 and shape[0] * shape[2] * shape[3] > APPLE_ONNX_DETECTION_MAX_PIXELS:
                    # Per-input fallback: smaller pages later still use ONNX.
                    return self.fallback(x=x)
            try:
                return self.session.run(None, dict(zip(self.inputs, x)))
            except Exception as error:  # noqa: BLE001
                self.session = None
                print("LEX_OCR_ACCEL_RUN_FAILED:%s:%s:%s" % (self.name, type(error).__name__, str(error)[:200]), file=sys.stderr, flush=True)
        return self.fallback(x=x)


def wanted_provider():
    mode = os.environ.get("LEX_OCR_ACCEL", "auto").strip().lower()
    if mode == "off":
        return None
    if mode in PROVIDERS:
        return PROVIDERS[mode]
    if sys.platform == "win32":
        return PROVIDERS["dml"]
    if sys.platform == "darwin":
        return PROVIDERS["coreml"]
    return None


def onnxruntime():
    extra = os.environ.get("LEX_OCR_ORT_DIR", "").strip()
    if extra and Path(extra).is_dir() and extra not in sys.path:
        sys.path.insert(0, extra)
        if sys.platform == "win32":
            os.add_dll_directory(str(Path(extra) / "onnxruntime" / "capi"))
    import onnxruntime as ort

    return ort


def session_for(path, provider):
    ort = onnxruntime()

    available = ort.get_available_providers()
    if provider not in available:
        raise RuntimeError("provider %s not available (%s)" % (provider, ",".join(available)))
    options = ort.SessionOptions()
    if sys.platform == "darwin":
        # The detector benefits from the Apple CPU's parallel ONNX kernels.
        # Keep the other sessions small and respect the worker's thread limit.
        raw_threads = os.environ.get("LEX_OCR_THREADS", "").strip()
        cpu_count = os.cpu_count() or 1
        limit = int(raw_threads) if raw_threads.isdigit() and int(raw_threads) > 0 else cpu_count
        detector = path.stem == "PP-OCRv6_medium_det"
        options.intra_op_num_threads = min(8, limit, cpu_count) if detector else 1
        if detector:
            # Dynamic page sizes made the arena retain several GB of reusable
            # intermediate buffers. The allocator choice changes no tensor data.
            options.enable_cpu_mem_arena = False
            options.enable_mem_pattern = False
        options.inter_op_num_threads = 1
        options.add_session_config_entry("session.intra_op.allow_spinning", "0")
        options.add_session_config_entry("session.inter_op.allow_spinning", "0")
    if provider == PROVIDERS["dml"]:
        # DirectML runs one request at a time and without memory pattern optimization.
        options.enable_mem_pattern = False
        options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    if provider == PROVIDERS["coreml"]:
        # The legacy NeuralNetwork converter retained tens of GB of detector
        # intermediates on M4. Use MLProgram for recognition; model selection
        # below deliberately keeps detection off CoreML.
        providers = [(provider, {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"}), PROVIDERS["cpu"]]
    else:
        providers = [provider] if provider == PROVIDERS["cpu"] else [provider, PROVIDERS["cpu"]]
    return ort.InferenceSession(str(path), sess_options=options, providers=providers)


def model_provider(name, provider):
    if provider != PROVIDERS["coreml"]:
        return provider
    # The detector's ONNX CPU kernels are much faster than Paddle's macOS CPU
    # kernels, without the legacy CoreML detector's large intermediates. Keep
    # the same weights and PaddleX preprocessing, thresholds and postprocessing.
    if name == "PP-OCRv6_medium_rec":
        return provider
    if name in ("PP-OCRv6_medium_det", "latin_PP-OCRv5_mobile_rec"):
        return PROVIDERS["cpu"]
    return None


def predictors(ocr):
    """(model name, predictor) of the pipeline: detection, recognition (also the second, latin
    recognizer of MarksReading) and the page orientation."""
    pipeline = getattr(ocr.paddlex_pipeline, "_pipeline", ocr.paddlex_pipeline)
    found = []
    det = getattr(pipeline, "text_det_model", None)
    rec = getattr(pipeline, "text_rec_model", None)
    for model in (det,):
        if model is not None:
            found.append(model)
    if rec is not None:
        primary = getattr(rec, "primary", None)
        second = getattr(rec, "second", None)
        found.extend(item for item in (primary or rec, second) if item is not None)
    doc = getattr(pipeline, "doc_preprocessor_pipeline", None)
    doc = getattr(doc, "_pipeline", doc)
    ori = getattr(doc, "doc_ori_classify_model", None) if doc is not None else None
    if ori is not None:
        found.append(ori)
    return [(getattr(item, "model_name", ""), item) for item in found]


def accelerate(ocr, onnx_dir=None):
    """Moves the networks of the pipeline to the card. Returns the provider used, or None when
    the Paddle path stays (no provider, no models, or a model failed to load)."""
    provider = wanted_provider()
    root = Path(onnx_dir or os.environ.get("LEX_OCR_ONNX_DIR", "")).expanduser()
    if provider is None or not str(root) or not root.is_dir():
        return None
    try:
        swaps = []
        accelerated = 0
        for name, predictor in predictors(ocr):
            selected = model_provider(name, provider)
            model = root / ("%s.onnx" % name)
            if not selected or not name or not model.is_file() or not hasattr(predictor, "runner"):
                continue
            swaps.append((predictor, OrtRunner(session_for(model, selected), predictor.runner, name)))
            accelerated += int(selected == provider)
        if not accelerated:
            return None
        for predictor, runner in swaps:
            predictor.runner = runner
        print("LEX_OCR_ACCEL %s %d" % (provider, accelerated), file=sys.stderr, flush=True)
        return provider
    except Exception as error:  # noqa: BLE001
        print("LEX_OCR_ACCEL_FAILED:%s:%s" % (type(error).__name__, str(error)[:200]), file=sys.stderr, flush=True)
        return None
