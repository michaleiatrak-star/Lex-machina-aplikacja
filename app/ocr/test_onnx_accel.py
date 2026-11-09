"""Backend safety checks without Paddle/ONNX dependencies or model downloads."""
import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import onnx_accel as accel


class Options:
    def __init__(self):
        self.config = {}

    def add_session_config_entry(self, key, value):
        self.config[key] = value


class Session:
    def __init__(self, fail=False):
        self.fail = fail
        self.calls = 0

    def get_inputs(self):
        return [SimpleNamespace(name="image")]

    def run(self, outputs, inputs):
        self.calls += 1
        if self.fail:
            raise RuntimeError("inference failed")
        return [inputs["image"]]


class BackendTests(unittest.TestCase):
    def test_coreml_session_uses_mlprogram_and_bounded_cpu_pools(self):
        seen = {}

        def create(path, **kwargs):
            seen.update(kwargs)
            return Session()

        ort = SimpleNamespace(
            get_available_providers=lambda: list(accel.PROVIDERS.values()),
            SessionOptions=Options, InferenceSession=create,
        )
        with patch.object(accel, "onnxruntime", return_value=ort), patch.object(accel.sys, "platform", "darwin"):
            accel.session_for(Path("recognizer.onnx"), accel.PROVIDERS["coreml"])
        options = seen["sess_options"]
        self.assertEqual(options.intra_op_num_threads, 1)
        self.assertEqual(options.inter_op_num_threads, 1)
        self.assertEqual(options.config["session.intra_op.allow_spinning"], "0")
        self.assertEqual(options.config["session.inter_op.allow_spinning"], "0")
        self.assertEqual(seen["providers"], [
            ("CoreMLExecutionProvider", {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL"}),
            "CPUExecutionProvider",
        ])

    def test_directml_keeps_its_execution_contract(self):
        seen = {}
        ort = SimpleNamespace(
            get_available_providers=lambda: list(accel.PROVIDERS.values()),
            SessionOptions=Options, ExecutionMode=SimpleNamespace(ORT_SEQUENTIAL="sequential"),
            InferenceSession=lambda path, **kwargs: seen.update(kwargs),
        )
        with patch.object(accel, "onnxruntime", return_value=ort), patch.object(accel.sys, "platform", "win32"):
            accel.session_for(Path("detector.onnx"), accel.PROVIDERS["dml"])
        self.assertFalse(seen["sess_options"].enable_mem_pattern)
        self.assertEqual(seen["sess_options"].execution_mode, "sequential")
        self.assertEqual(seen["providers"], ["DmlExecutionProvider", "CPUExecutionProvider"])

    def test_detection_stays_off_coreml_and_orientation_stays_in_paddle(self):
        names = ["PP-OCRv6_medium_det", "PP-OCRv6_medium_rec", "latin_PP-OCRv5_mobile_rec", "PP-LCNet_x1_0_doc_ori"]
        fallback = lambda *, x: x
        models = [SimpleNamespace(runner=fallback) for _ in names]
        selected = []
        with tempfile.TemporaryDirectory() as temp:
            for name in names:
                (Path(temp) / (name + ".onnx")).touch()
            with patch.object(accel, "wanted_provider", return_value="CoreMLExecutionProvider"), \
                 patch.object(accel, "predictors", return_value=list(zip(names, models))), \
                 patch.object(accel, "session_for", side_effect=lambda path, provider: selected.append((path.stem, provider)) or Session()), \
                 contextlib.redirect_stderr(io.StringIO()) as log:
                self.assertEqual(accel.accelerate(object(), temp), "CoreMLExecutionProvider")
        self.assertIsInstance(models[0].runner, accel.OrtRunner)
        self.assertIs(models[3].runner, fallback)
        self.assertEqual(selected, [(names[0], "CPUExecutionProvider"), (names[1], "CoreMLExecutionProvider"), (names[2], "CPUExecutionProvider")])
        self.assertIn("LEX_OCR_ACCEL CoreMLExecutionProvider 1", log.getvalue())

    def test_detector_cpu_pool_is_bounded_by_worker_threads(self):
        seen = []
        ort = SimpleNamespace(
            get_available_providers=lambda: list(accel.PROVIDERS.values()),
            SessionOptions=Options,
            InferenceSession=lambda path, **kwargs: seen.append(kwargs) or Session(),
        )
        with patch.object(accel, "onnxruntime", return_value=ort), patch.object(accel.sys, "platform", "darwin"), \
             patch.object(accel.os, "cpu_count", return_value=10):
            for limit, expected in [("", 8), ("2", 2), ("1", 1), ("16", 8), ("invalid", 8)]:
                with patch.dict(accel.os.environ, {"LEX_OCR_THREADS": limit}):
                    accel.session_for(Path("PP-OCRv6_medium_det.onnx"), "CPUExecutionProvider")
                self.assertEqual(seen[-1]["sess_options"].intra_op_num_threads, expected)
                self.assertEqual(seen[-1]["providers"], ["CPUExecutionProvider"])
                self.assertFalse(seen[-1]["sess_options"].enable_cpu_mem_arena)
                self.assertFalse(seen[-1]["sess_options"].enable_mem_pattern)
            with patch.object(accel.os, "cpu_count", return_value=2), patch.dict(accel.os.environ, {"LEX_OCR_THREADS": "16"}):
                accel.session_for(Path("PP-OCRv6_medium_det.onnx"), "CPUExecutionProvider")
                self.assertEqual(seen[-1]["sess_options"].intra_op_num_threads, 2)

    def test_cpu_only_swap_does_not_claim_coreml_usage(self):
        model = SimpleNamespace(runner=lambda *, x: x)
        original = model.runner
        with tempfile.TemporaryDirectory() as temp:
            (Path(temp) / "latin_PP-OCRv5_mobile_rec.onnx").touch()
            with patch.object(accel, "wanted_provider", return_value="CoreMLExecutionProvider"), \
                 patch.object(accel, "predictors", return_value=[("latin_PP-OCRv5_mobile_rec", model)]), \
                 patch.object(accel, "session_for", return_value=Session()), \
                 contextlib.redirect_stderr(io.StringIO()) as log:
                self.assertIsNone(accel.accelerate(object(), temp))
        self.assertIs(model.runner, original)
        self.assertNotIn("LEX_OCR_ACCEL CoreMLExecutionProvider", log.getvalue())

    def test_failed_model_setup_leaves_original_runners(self):
        fallback = lambda *, x: x
        models = [SimpleNamespace(runner=fallback), SimpleNamespace(runner=fallback)]
        names = ["PP-OCRv6_medium_rec", "latin_PP-OCRv5_mobile_rec"]
        with tempfile.TemporaryDirectory() as temp:
            for name in names:
                (Path(temp) / (name + ".onnx")).touch()
            with patch.object(accel, "wanted_provider", return_value="CoreMLExecutionProvider"), \
                 patch.object(accel, "predictors", return_value=list(zip(names, models))), \
                 patch.object(accel, "session_for", side_effect=[Session(), RuntimeError("load failed")]), \
                 contextlib.redirect_stderr(io.StringIO()):
                self.assertIsNone(accel.accelerate(object(), temp))
        self.assertTrue(all(model.runner is fallback for model in models))

    def test_inference_failure_permanently_returns_to_paddle(self):
        calls = []
        session = Session(fail=True)
        runner = accel.OrtRunner(session, lambda *, x: calls.append(x) or ["paddle"], "rec")
        with contextlib.redirect_stderr(io.StringIO()) as log:
            self.assertEqual(runner(["first"]), ["paddle"])
            self.assertEqual(runner(["second"]), ["paddle"])
        self.assertEqual(session.calls, 1)
        self.assertEqual(calls, [["first"], ["second"]])
        self.assertIn("LEX_OCR_ACCEL_RUN_FAILED:rec", log.getvalue())

    def test_large_photo_uses_original_pixels_and_does_not_disable_smaller_pages(self):
        large = SimpleNamespace(shape=(1, 3, 4000, 3000))
        small = SimpleNamespace(shape=(1, 3, 2560, 1824))
        calls = []
        session = Session()
        runner = accel.OrtRunner(session, lambda *, x: calls.append(x) or ["paddle"], "PP-OCRv6_medium_det")
        with patch.object(accel.sys, "platform", "darwin"):
            self.assertEqual(runner([large]), ["paddle"])
            self.assertEqual(runner([small]), [small])
        self.assertIs(calls[0][0], large)
        self.assertEqual(session.calls, 1)
        self.assertIs(runner.session, session)


if __name__ == "__main__":
    unittest.main()
