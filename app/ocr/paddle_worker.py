#!/usr/bin/env python3
import argparse
import json
import sys
import unicodedata
import os
from pathlib import Path

import fitz
import numpy as np
from PIL import Image
from paddleocr import PaddleOCR


def paddle_native_path(path: Path) -> str:
    """Return an ASCII alias for Paddle's native Windows filesystem calls."""
    resolved = str(path.resolve())
    if os.name != "nt" or resolved.isascii():
        return resolved

    import atexit
    import ctypes
    import string
    import subprocess

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    get_short = kernel32.GetShortPathNameW
    get_short.argtypes = [
        ctypes.c_wchar_p,
        ctypes.c_wchar_p,
        ctypes.c_uint32,
    ]
    get_short.restype = ctypes.c_uint32

    needed = get_short(resolved, None, 0)
    if needed:
        buffer = ctypes.create_unicode_buffer(needed + 1)
        written = get_short(resolved, buffer, len(buffer))
        short = buffer.value
        if written and short and short.isascii():
            return short

    # 8.3 names may be disabled. A temporary subst drive gives the native
    # predictor an ASCII alias while files remain in the locked install tree.
    for letter in reversed(string.ascii_uppercase[3:]):
        drive = f"{letter}:"
        drive_root = drive + "\\"
        if os.path.exists(drive_root):
            continue

        result = subprocess.run(
            ["subst", drive, resolved],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        if result.returncode != 0:
            continue

        def cleanup(mapped_drive: str = drive) -> None:
            subprocess.run(
                ["subst", mapped_drive, "/D"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )

        atexit.register(cleanup)
        return drive_root

    raise RuntimeError(
        "PADDLE_ASCII_PATH_UNAVAILABLE:"
        f"{resolved}:winerr={ctypes.get_last_error()}"
    )

MODEL_FILES = ("inference.pdiparams", "inference.yml")


def model_complete(path: Path) -> bool:
    """A model directory with its weights, config and graph (json or pdmodel)."""
    return (
        path.is_dir()
        and all((path / name).is_file() and (path / name).stat().st_size > 0 for name in MODEL_FILES)
        and any((path / name).is_file() for name in ("inference.json", "inference.pdmodel"))
    )


def parse_pages(raw: str) -> list[int]:
    pages = sorted({int(value) for value in raw.split(",") if value.strip()})
    if not pages or any(page < 1 for page in pages):
        raise ValueError("pages must contain positive 1-based page numbers")
    return pages


EVIDENCE_MAX_SIDE = 1600


def _box(values) -> list[float] | None:
    """[x0, y0, x1, y1] from a box or polygon."""
    try:
        flat = np.asarray(values, dtype=float).reshape(-1)
    except (TypeError, ValueError):
        return None
    if flat.size == 4:
        x0, y0, x1, y1 = flat.tolist()
    elif flat.size >= 8 and flat.size % 2 == 0:
        xs, ys = flat[0::2], flat[1::2]
        x0, y0, x1, y1 = float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())
    else:
        return None
    return [min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)]


def _overlap(a: list[float], b: list[float]) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    area = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
    return (w * h) / area


def _field(item, payload: dict, key: str):
    try:
        value = item[key]
        if value is not None:
            return value
    except Exception:
        pass
    return payload.get(key)


def _line_crop(image: np.ndarray, poly) -> str | None:
    """The line cut out along its polygon and straightened, as base64 JPEG.

    For the local vision model, which reads doubtful lines: on a photographed page a
    line is slanted and its bounding box takes in the lines above and below.
    """
    import base64
    import io

    import cv2

    points = np.asarray(poly, dtype=np.float32).reshape(-1, 2)
    if len(points) != 4:
        if len(points) < 3:
            return None
        points = cv2.boxPoints(cv2.minAreaRect(points)).astype(np.float32)
        # Order: top-left, top-right, bottom-right, bottom-left.
        total = points.sum(axis=1)
        diff = np.diff(points, axis=1).ravel()
        points = np.array([points[np.argmin(total)], points[np.argmin(diff)], points[np.argmax(total)], points[np.argmax(diff)]], dtype=np.float32)
    top_left, top_right, bottom_right, bottom_left = points
    width = max(np.linalg.norm(top_right - top_left), np.linalg.norm(bottom_right - bottom_left))
    height = max(np.linalg.norm(bottom_left - top_left), np.linalg.norm(bottom_right - top_right))
    if width < 4 or height < 4:
        return None
    pad_x, pad_y = height * 0.3, height * 0.15
    target = np.array(
        [[pad_x, pad_y], [pad_x + width, pad_y], [pad_x + width, pad_y + height], [pad_x, pad_y + height]],
        dtype=np.float32,
    )
    size = (int(round(width + 2 * pad_x)), int(round(height + 2 * pad_y)))
    matrix = cv2.getPerspectiveTransform(points, target)
    crop = cv2.warpPerspective(
        image[:, :, :3].astype(np.uint8), matrix, size, flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE
    )
    picture = Image.fromarray(crop).convert("L")
    # Line height of about 64 px: enough for the model, small enough to keep in memory.
    if picture.height > 64:
        picture = picture.resize((max(1, round(picture.width * 64 / picture.height)), 64), Image.LANCZOS)
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=85)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


# A stamp in coloured ink (red, blue, violet) over printed lines: the detector merges them and
# the recogniser reads neither. Measured on synthetic A4 scans with a round and a rectangular
# stamp over 26 printed lines: printed text 86.2% / 86.5% -> 99.4% / 99.5% of characters (red
# / blue), 5-6 damaged lines -> 0, the stamp's own words read 0 -> 65-74%. The page is read
# from its text layer (coloured ink removed, black letters under it kept) and every stamp from
# its own layer, as separate lines marked "stamp". A black or grey stamp has no colour to split
# by: its lines stay as read and the review flags them.
STAMP_INK_MIN_SHARE = 0.0005
# More coloured ink than this: a colour photo or a colour document, not a stamp on a letter.
STAMP_INK_MAX_SHARE = 0.15
STAMP_MIN_PIXELS = 400
STAMP_MARK = "[PIECZĘĆ lub kolorowy tusz]"


def split_stamp_ink(image: np.ndarray):
    """(text layer, [(x0, y0, stamp layer crop)]) or None without coloured stamp ink."""
    import cv2

    rgb = image[:, :, :3].astype(np.int16)
    high = rgb.max(axis=2)
    chroma = high - rgb.min(axis=2)
    ink = (chroma > 38) & (255 - high > 25)
    share = float(ink.mean())
    if share < STAMP_INK_MIN_SHARE or share > STAMP_INK_MAX_SHARE:
        return None
    kernel = np.ones((3, 3), np.uint8)
    spread = cv2.dilate(ink.astype(np.uint8), kernel) > 0
    # Under the ink a black letter stays dark and grey: it remains in the text layer.
    letter = (chroma < 60) & (high < 90)
    text = image[:, :, :3].copy()
    bright = high > 200
    paper = np.median(rgb[bright], axis=0).astype(np.uint8) if bright.any() else np.array([255, 255, 255], np.uint8)
    text[spread & ~letter] = paper
    darkness = np.clip(255 - (255 - high).astype(np.float32) * 1.6, 0, 255).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(ink.astype(np.uint8), np.ones((25, 25), np.uint8)))
    regions = []
    height, width = ink.shape
    for index in range(1, count):
        x, y, w, h, _ = stats[index]
        x0, y0, x1, y1 = max(0, x - 10), max(0, y - 10), min(width, x + w + 10), min(height, y + h + 10)
        own = ink[y0:y1, x0:x1]
        if w < 40 or h < 20 or int(own.sum()) < STAMP_MIN_PIXELS:
            continue
        layer = np.full((y1 - y0, x1 - x0), 255, np.uint8)
        layer[own] = darkness[y0:y1, x0:x1][own]
        regions.append((x0, y0, np.repeat(layer[:, :, None], 3, axis=2)))
    if not regions:
        return None
    return text, regions


def read_stamps(ocr, regions) -> list[dict]:
    lines = []
    for x0, y0, layer in regions:
        for item in ocr.predict(layer):
            payload = item.json
            if isinstance(payload, str):
                payload = json.loads(payload)
            payload = payload.get("res", payload)
            texts = payload.get("rec_texts") or []
            scores = payload.get("rec_scores") or []
            boxes = _field(item, payload, "rec_boxes")
            for index, text in enumerate(texts):
                if not isinstance(text, str) or len(text.strip()) < 2:
                    continue
                box = _box(boxes[index]) if boxes is not None and len(boxes) == len(texts) else None
                try:
                    score = float(scores[index])
                except (IndexError, TypeError, ValueError):
                    score = None
                lines.append({
                    "text": text.strip(),
                    "score": score,
                    "box": [box[0] + x0, box[1] + y0, box[2] + x0, box[3] + y0] if box else None,
                    "poly": None,
                    "stamp": True,
                })
    return lines


# A photographed page folded or bent: a line breaks on the fold (2-13 degrees on a real
# 5-page decision, mostly at mid-width) and no rotated rectangle fits it. The detector then
# scores the line inside its rectangle, the background drops the score below box_thresh and
# the line is lost; a line kept anyway is cut as a rectangle two or three lines high and read
# as nothing. Measured on that decision (206 lines): 120 lost, CER 73.8% -> with the line
# read along its own shape: 11 lost, CER 7.5%. A flat page keeps the reading above: a line
# counts as broken by its shape, and only a page with enough broken lines is read again.
FOLD_LINE_RECT = 1.35  # rotated rectangle height / line thickness
FOLD_LINE_BOW = 0.35  # midline off its straight fit, in line thicknesses
FOLD_MIN_LINES = 6
FOLD_PAGE_SHARE = 0.2
# A blank back page with the other side showing through looks folded too (faint mirrored
# lines, bent); read along their shape they come out as noise, scored 0.03-0.65 (54-page scan,
# two such pages). The fold reading replaces the page only when it reads more letters with
# at least this score than the standard reading did.
FOLD_SURE_SCORE = 0.8
FOLD_ENGINE = "PaddleOCR PP-OCRv6_medium, linie wzdłuż zgięcia"


def _line_geometry(poly) -> np.ndarray | None:
    """Per 4 px column of a line polygon: x, top and bottom of the line."""
    import cv2

    points = np.asarray(poly, dtype=np.float32).reshape(-1, 2)
    if len(points) < 3:
        return None
    x0, y0 = np.floor(points.min(axis=0)).astype(int)
    x1, y1 = np.ceil(points.max(axis=0)).astype(int)
    if x1 - x0 < 8 or y1 - y0 < 2:
        return None
    mask = np.zeros((y1 - y0 + 1, x1 - x0 + 1), np.uint8)
    cv2.fillPoly(mask, [np.round(points - [x0, y0]).astype(np.int32)], 1)
    columns = []
    for x in range(1, mask.shape[1] - 1, 4):
        rows = np.flatnonzero(mask[:, x])
        if rows.size:
            columns.append((x + x0, rows[0] + y0, rows[-1] + y0))
    return np.asarray(columns, dtype=np.float32) if len(columns) >= 4 else None


def _line_shape(poly) -> dict | None:
    """Thickness of the line and whether it is broken or bent (its rectangle does not fit it)."""
    import cv2

    columns = _line_geometry(poly)
    if columns is None:
        return None
    thickness = float(np.median(columns[:, 2] - columns[:, 1]))
    middle = (columns[:, 1] + columns[:, 2]) / 2
    straight = np.polyfit(columns[:, 0], middle, 1)
    bow = float(np.max(np.abs(np.polyval(straight, columns[:, 0]) - middle))) / max(thickness, 1.0)
    rect = min(cv2.minAreaRect(np.asarray(poly, dtype=np.float32).reshape(-1, 2))[1])
    return {
        "columns": columns,
        "thickness": thickness,
        "long": columns[-1, 0] - columns[0, 0] >= 8 * thickness,
        "bent": rect > FOLD_LINE_RECT * thickness or bow > FOLD_LINE_BOW,
    }


def _strip(image: np.ndarray, columns: np.ndarray, thickness: float) -> np.ndarray:
    """The line cut along its midline: every column of the crop taken at the line's own height."""
    import cv2

    x = columns[:, 0]
    middle = (columns[:, 1] + columns[:, 2]) / 2
    k = max(3, int(len(middle) / 25) | 1)
    middle = np.convolve(np.pad(middle, k // 2, mode="edge"), np.ones(k) / k, mode="valid")
    arc = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(x), np.diff(middle)))])
    width, height = max(1, int(arc[-1])), max(8, int(round(thickness * 1.25)))
    u = np.arange(width)
    cx, cy = np.interp(u, arc, x), np.interp(u, arc, middle)
    dx, dy = np.gradient(cx), np.gradient(cy)
    norm = np.hypot(dx, dy) + 1e-6
    nx, ny = -dy / norm, dx / norm
    v = np.arange(height) - height / 2
    map_x = (cx[None, :] + v[:, None] * nx[None, :]).astype(np.float32)
    map_y = (cy[None, :] + v[:, None] * ny[None, :]).astype(np.float32)
    crop = cv2.remap(image[:, :, :3].astype(np.uint8), map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
    pad = int(height * 0.3)
    return cv2.copyMakeBorder(crop, 0, 0, pad, pad, cv2.BORDER_REPLICATE)


def _jpeg64(crop: np.ndarray) -> str:
    import base64
    import io

    picture = Image.fromarray(crop).convert("L")
    if picture.height > 64:
        picture = picture.resize((max(1, round(picture.width * 64 / picture.height)), 64), Image.LANCZOS)
    buffer = io.BytesIO()
    picture.save(buffer, format="JPEG", quality=85)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _outline(poly, scale: float) -> list[list[float]]:
    """The line polygon for the scan preview and the masks, a few points only."""
    import cv2

    points = np.asarray(poly, dtype=np.float32).reshape(-1, 1, 2)
    simple = cv2.approxPolyDP(points, 1.5, True).reshape(-1, 2)
    return [[round(float(x) * scale, 1), round(float(y) * scale, 1)] for x, y in simple]


def _sure_letters(lines: list[dict]) -> int:
    """Letters in the lines read with a sure score."""
    return sum(
        sum(1 for char in line["text"] if char.isalpha())
        for line in lines
        if line.get("score") is not None and line["score"] >= FOLD_SURE_SCORE
    )


def _lines_of(polys) -> list[tuple[np.ndarray, dict]]:
    """Line polygons in reading order, each with its shape (thickness, bent or not)."""
    from paddlex.inference.pipelines.components import SortPolyBoxes

    polys = SortPolyBoxes()(polys) if len(polys) else []
    found = []
    for poly in polys:
        poly = np.asarray(poly, dtype=np.float32).reshape(-1, 2)
        shape = _line_shape(poly)
        if shape:
            found.append((poly, shape))
    return found


class DetectionMap:
    """The text probability map of the page's own detection, kept for the fold check: its line
    polygons come from that map (0.06 s a page) instead of a second detection (4.7-6.5 s; the
    same polygons and decisions on the folded and flat pages measured, the same parameters:
    limit 64 min, thresh 0.3, box 0.6, unclip 1.5)."""

    def __init__(self, post) -> None:
        import copy

        self.inner = post
        self.poly = copy.copy(post)
        self.poly.box_type, self.poly.score_mode = "poly", "slow"
        self.last = None

    def __call__(self, preds, img_shapes, **kwargs):
        maps = preds[0]
        self.last = (maps[0].copy(), img_shapes[0], kwargs) if len(maps) == 1 else None
        return self.inner(preds, img_shapes, **kwargs)

    def __getattr__(self, name):
        return getattr(self.inner, name)

    def lines(self, image: np.ndarray) -> list[tuple[np.ndarray, dict]] | None:
        """The page's line polygons from the kept map; None when it is not this image's."""
        if self.last is None:
            return None
        pred, shape, kwargs = self.last
        if (int(shape[0]), int(shape[1])) != tuple(image.shape[:2]):
            return None
        polys, _ = self.poly([pred[None]], [shape], **kwargs)
        return _lines_of(polys[0])


class FoldReader:
    """Lines of a folded page read along their own shape: a polygon detector scoring the line
    inside its contour, straight lines cut as before, broken ones along their midline."""

    def __init__(self, models: dict, kwargs: dict) -> None:
        from paddlex.inference.pipelines.components import CropByPolys

        self.models, self.kwargs = models, kwargs
        self.detector = None
        self.recognizer = None
        self.crop = CropByPolys(det_box_type="quad")

    def detect(self, image: np.ndarray) -> list[tuple[np.ndarray, dict]]:
        """A detection of its own, when the page's map is not at hand (see DetectionMap)."""
        from paddleocr import TextDetection

        if self.detector is None:
            self.detector = TextDetection(
                model_name="PP-OCRv6_medium_det", model_dir=str(self.models["text_detection_model_dir"]),
                limit_side_len=64, limit_type="min", thresh=0.3, box_thresh=0.6, unclip_ratio=1.5, **self.kwargs
            )
            post = self.detector.paddlex_predictor.post_op
            post.box_type, post.score_mode = "poly", "slow"
        return _lines_of(list(self.detector.predict(image))[0]["dt_polys"])

    @staticmethod
    def folded(found: list[tuple[np.ndarray, dict]]) -> tuple[int, int] | None:
        """(broken, long lines) when the page is folded, else None. Short pieces (digits in
        boxes, a signature) tell nothing about a fold."""
        long = [shape for _, shape in found if shape["long"]]
        broken = sum(1 for shape in long if shape["bent"])
        if len(long) >= FOLD_MIN_LINES and broken >= FOLD_PAGE_SHARE * len(long):
            return broken, len(long)
        return None

    def read(self, image: np.ndarray, found: list[tuple[np.ndarray, dict]]) -> list[dict]:
        import cv2
        from paddleocr import TextRecognition

        if self.recognizer is None:
            self.recognizer = TextRecognition(
                model_name="PP-OCRv6_medium_rec", model_dir=str(self.models["text_recognition_model_dir"]), **self.kwargs
            )
        lines = []
        for poly, shape in found:
            if shape["bent"]:
                crop = _strip(image, shape["columns"], shape["thickness"])
            else:
                crop = self.crop(image, [cv2.boxPoints(cv2.minAreaRect(poly))])[0]
            result = list(self.recognizer.predict(crop))[0]
            lines.append({
                "text": str(result["rec_text"]).strip(), "score": float(result["rec_score"]),
                "box": _box(poly), "poly": poly, "bent": shape["bent"], "crop_image": crop,
            })
        return lines


class FoldMode:
    """The fold reader, built on first use with the engine's oneDNN choice; a failure leaves
    the page as read (LEX_OCR_FOLD_FAILED on stderr), never the document unread."""

    def __init__(self, engine: "OcrEngine", models: dict) -> None:
        self.engine, self.models = engine, models
        self.reader: FoldReader | None = None
        self.failed = False

    def _kwargs(self, mkldnn: bool) -> dict:
        kwargs = {"enable_mkldnn": mkldnn, "cpu_threads": self.engine.kwargs.get("cpu_threads", cpu_threads())}
        if self.engine.kwargs.get("device"):
            kwargs["device"] = self.engine.kwargs["device"]
        return kwargs

    def page(self, image: np.ndarray) -> tuple[list[dict], dict] | None:
        if self.failed:
            return None
        for mkldnn in dict.fromkeys([self.engine.mkldnn, False]):
            try:
                found = self.engine.det_map.lines(image) if self.engine.det_map else None
                if found is not None and not FoldReader.folded(found):
                    return None
                if self.reader is None:
                    self.reader = FoldReader(self.models, self._kwargs(mkldnn))
                if found is None:
                    found = self.reader.detect(image)
                folded = self.reader.folded(found)
                if not folded:
                    return None
                return self.reader.read(image, found), {"brokenLines": folded[0], "lines": folded[1]}
            except Exception as error:  # noqa: BLE001
                self.reader = None
                last = error
        self.failed = True
        print(f"LEX_OCR_FOLD_FAILED:{type(last).__name__}:{str(last)[:200]}", file=sys.stderr, flush=True)
        return None


def cpu_threads() -> int:
    raw = os.environ.get("LEX_OCR_THREADS", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return max(1, os.cpu_count() or 1)


# PP-OCRv6 medium drops Polish marks on some serif prints ("Michal", "Okregowa": 17% of the
# words with them right on a letter of a bar council); the latin PP-OCRv5 model reads them
# (83%) but loses more elsewhere. Each line is read by both: the same letters -> the reading
# with more marks; different letters -> the higher score. Measured on 13 pages (scan, letter,
# folded photo): CER 6.05 -> 5.85% and 5.65 -> 4.35%, marks 90 -> 92% and 17 -> 83%.
LATIN_REC = "latin_PP-OCRv5_mobile_rec"


def _bare(text: str) -> str:
    text = text.replace("ł", "l").replace("Ł", "L")
    return "".join(char for char in unicodedata.normalize("NFD", text) if not unicodedata.combining(char))


POLISH_MARKS = frozenset("ąćęłńóśźżĄĆĘŁŃÓŚŹŻ")


# Each foreign mark to the Polish letter it is misread for, else the bare letter; one character
# for one, so the lines stay aligned with the page text (masks, the scan preview).
FOREIGN_TO_POLISH = str.maketrans(
    "žŽčČšŠňŇñÑřŘďĎťŤľĽĺĹŕŔáÁàÀâÂäÄãÃåÅéÉèÈêÊëËěĚíÍìÌîÎïÏôÔòÒöÖõÕőŐúÚùÙûÛüÜůŮűŰýÝÿçÇğĞşŞţŢı",
    "żŻćĆśŚńŃńŃrRdDtTlLlLrRaAaAaAaAaAaAeEeEeEeEeEiIiIiIiIoOoOoOoOoOuUuUuUuUuUuUyYycCgGsStTi",
)


def _polish_letters(text: str) -> str:
    return text.translate(FOREIGN_TO_POLISH)


class DictionaryFix:
    """A word the Polish dictionary (Morfeusz, installed for the anonymizer) does not know,
    made into the one word it knows within two OCR confusions (dictionary_service.py: "Spóika" ->
    "Spółka", "zazalenia" -> "zażalenia"); two candidates or none: left as read. Measured on
    13 pages: marks 92.3 -> 94.8% (scan), 82.3 -> 90.4% (folded photo), no critical field lost.
    Without Morfeusz, after a failure of its process or with LEX_OCR_DICT=off the text is as read."""

    WORD = r"\S+"

    def __init__(self) -> None:
        self.process = None
        self.failed = os.environ.get("LEX_OCR_DICT", "on") == "off"
        self.corrections: dict[str, str] = {}
        self.asked: set[str] = set()

    @staticmethod
    def _core(token: str) -> str | None:
        import re

        core = re.sub(r"^\W+|\W+$", "", token)
        # Abbreviations ("godz.", "ust."), numbers and short words are left alone.
        if len(core) < 4 or not core.isalpha() or (token.endswith(".") and len(core) <= 6):
            return None
        return core

    def _ask(self, words: list[str]) -> None:
        import subprocess

        if self.process is None:
            self.process = subprocess.Popen(
                [sys.executable, "-X", "utf8", str(Path(__file__).with_name("dictionary_service.py"))],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        self.process.stdin.write(json.dumps(words, ensure_ascii=False) + "\n")
        self.process.stdin.flush()
        reply = self.process.stdout.readline()
        if not reply:
            raise RuntimeError(f"dictionary process ended ({self.process.poll()})")
        self.corrections.update(json.loads(reply))

    def prepare(self, texts: list[str]) -> None:
        """One question to the dictionary for the words of a page not asked yet."""
        if self.failed:
            return
        import re

        words = sorted({core for text in texts for token in re.findall(self.WORD, text) if (core := self._core(token)) and core not in self.asked})
        if not words:
            return
        try:
            self._ask(words)
            self.asked.update(words)
        except Exception as error:  # noqa: BLE001
            self.failed = True
            print(f"LEX_OCR_DICT_FAILED:{type(error).__name__}:{str(error)[:200]}", file=sys.stderr, flush=True)

    def text(self, text: str) -> str:
        if self.failed or not self.corrections:
            return text
        import re

        def fix(match):
            token = match.group(0)
            core = self._core(token)
            return token.replace(core, self.corrections[core]) if core and core in self.corrections else token

        return re.sub(self.WORD, fix, text)


DICTIONARY = DictionaryFix()


def _polish_marks(text: str) -> int:
    return sum(1 for char in text if char in POLISH_MARKS)


def _foreign_marks(text: str) -> int:
    return sum(1 for char in text if char.isalpha() and ord(char) > 127 and char not in POLISH_MARKS)


class MarksReading:
    """The pipeline's recognizer with a second one for the Polish marks (see LATIN_REC)."""

    def __init__(self, primary, second) -> None:
        self.primary, self.second = primary, second

    def __call__(self, images, **kwargs):
        images = list(images)
        for first, other in zip(self.primary(images, **kwargs), self.second(images, **kwargs)):
            # Marks of other languages ("dó skłádania", "uwažane") are misreadings, never a gain.
            if _foreign_marks(other["rec_text"]) > _foreign_marks(first["rec_text"]):
                yield first
            elif _bare(first["rec_text"]) == _bare(other["rec_text"]):
                yield other if _polish_marks(other["rec_text"]) > _polish_marks(first["rec_text"]) else first
            else:
                yield other if other["rec_score"] > first["rec_score"] else first

    def __getattr__(self, name):
        return getattr(self.primary, name)


class OcrEngine:
    """PaddleOCR on CPU oneDNN (about 5x faster, the same text); when oneDNN fails to
    start or to run (PaddlePaddle CPU regressions on some builds), the plain path."""

    def __init__(self, kwargs: dict, latin_dir: Path | None = None) -> None:
        self.kwargs = kwargs
        self.latin_dir = latin_dir
        self.det_map: DetectionMap | None = None
        self.mkldnn = os.environ.get("LEX_OCR_MKLDNN", "on") != "off"
        self.verified = not self.mkldnn
        try:
            self.ocr = PaddleOCR(**kwargs, enable_mkldnn=self.mkldnn)
        except Exception as error:  # noqa: BLE001
            if not self.mkldnn:
                raise
            self._fallback(error)
            return
        self._attach()

    def _attach(self) -> None:
        """The page's detection map kept for the fold check, and the second recognizer when
        its model is installed (without it, as before)."""
        try:
            pipeline = self.ocr.paddlex_pipeline
            detector = getattr(pipeline, "_pipeline", pipeline).text_det_model
            self.det_map = DetectionMap(detector.post_op)
            detector.post_op = self.det_map
        except Exception as error:  # noqa: BLE001
            self.det_map = None
            print(f"LEX_OCR_DET_MAP_FAILED:{type(error).__name__}:{str(error)[:200]}", file=sys.stderr, flush=True)
        if self.latin_dir is None:
            return
        try:
            from paddleocr import TextRecognition

            pipeline = self.ocr.paddlex_pipeline
            pipeline = getattr(pipeline, "_pipeline", pipeline)
            second = TextRecognition(
                model_name=LATIN_REC, model_dir=str(self.latin_dir), enable_mkldnn=self.mkldnn,
                cpu_threads=self.kwargs.get("cpu_threads", cpu_threads()),
                **({"device": self.kwargs["device"]} if self.kwargs.get("device") else {}),
            ).paddlex_predictor
            pipeline.text_rec_model = MarksReading(pipeline.text_rec_model, second)
        except Exception as error:  # noqa: BLE001
            print(f"LEX_OCR_MARKS_FAILED:{type(error).__name__}:{str(error)[:200]}", file=sys.stderr, flush=True)

    def _fallback(self, error: Exception) -> None:
        print(
            f"LEX_OCR_MKLDNN_FALLBACK:{type(error).__name__}:{str(error)[:200]}",
            file=sys.stderr,
            flush=True,
        )
        self.mkldnn = False
        self.verified = True
        self.ocr = PaddleOCR(**self.kwargs, enable_mkldnn=False)
        self._attach()

    def predict(self, image):
        if self.det_map:
            self.det_map.last = None
        if self.verified:
            return self.ocr.predict(image)
        try:
            prediction = list(self.ocr.predict(image))
        except Exception as error:  # noqa: BLE001
            self._fallback(error)
            return self.ocr.predict(image)
        self.verified = True
        return prediction


def predict_page(
    ocr: PaddleOCR,
    image: np.ndarray,
    page_number: int,
    evidence_dir: Path | None = None,
    line_crops: bool = False,
    stamps: bool = True,
    fold: "FoldMode | None" = None,
) -> dict:
    """The page; with coloured stamp ink, its text layer and its stamps read apart."""
    split = split_stamp_ink(image) if stamps else None
    if split is None:
        return predict_image(ocr, image, page_number, evidence_dir, line_crops, fold=fold)
    text_layer, regions = split
    result = predict_image(ocr, text_layer, page_number, evidence_dir, line_crops, original=image, stamp_regions=regions, fold=fold)
    if result.pop("rotated", False):
        # The page was turned by the orientation step: stamp boxes would not match; as before.
        return predict_image(ocr, image, page_number, evidence_dir, line_crops, fold=fold)
    return result


def predict_image(
    ocr: PaddleOCR,
    image: np.ndarray,
    page_number: int,
    evidence_dir: Path | None = None,
    line_crops: bool = False,
    original: np.ndarray | None = None,
    stamp_regions: list | None = None,
    fold: "FoldMode | None" = None,
) -> dict:
    prediction = list(ocr.predict(image))
    texts: list[str] = []
    scores: list[float] = []
    # Per line: text, recognition score and box, for OCR correction and for
    # masking personal data on the page image sent as evidence.
    lines: list[dict] = []
    unread: list[list[float]] = []
    evidence_image = image
    boxes_known = True

    for item in prediction:
        payload = item.json
        if isinstance(payload, str):
            payload = json.loads(payload)
        if "res" in payload:
            payload = payload["res"]

        rec_texts = payload.get("rec_texts") or []
        rec_scores = payload.get("rec_scores") or []
        rec_boxes = _field(item, payload, "rec_boxes")
        rec_polys = _field(item, payload, "rec_polys")
        dt_polys = _field(item, payload, "dt_polys")
        geometry = rec_boxes if rec_boxes is not None and len(rec_boxes) == len(rec_texts) else rec_polys
        if geometry is None or len(geometry) != len(rec_texts):
            boxes_known = False
            geometry = [None] * len(rec_texts)

        # Boxes are in the coordinates of the preprocessed (rotated,
        # unwarped) image; without it the boxes cannot be trusted.
        pre = _field(item, payload, "doc_preprocessor_res")
        if pre is not None:
            try:
                output_img = pre["output_img"]
            except Exception:
                output_img = None
            if output_img is None:
                boxes_known = False
            else:
                evidence_image = np.asarray(output_img)
                if original is not None:
                    try:
                        angle = int(pre["angle"])
                    except Exception:
                        angle = 0 if evidence_image.shape[:2] == original.shape[:2] else -1
                    if angle != 0:
                        return {"page": page_number, "rotated": True}

        read_boxes: list[list[float]] = []
        for index, text in enumerate(rec_texts):
            try:
                score = float(rec_scores[index])
            except (IndexError, TypeError, ValueError):
                score = None
            if score is not None:
                scores.append(score)
            box = _box(geometry[index]) if geometry[index] is not None else None
            poly = rec_polys[index] if rec_polys is not None and len(rec_polys) == len(rec_texts) else None
            if isinstance(text, str) and text.strip():
                texts.append(text.strip())
                lines.append({"text": text.strip(), "score": score, "box": box, "poly": poly})
                if box:
                    read_boxes.append(box)
            elif box:
                unread.append(box)
        for poly in dt_polys if dt_polys is not None else []:
            box = _box(poly)
            if box and not any(_overlap(box, known) > 0.5 for known in read_boxes):
                unread.append(box)

    # A folded page: its lines read again along their shape, in the same image the boxes
    # refer to (turned by the orientation step, text layer when stamps were split).
    folded = None
    if fold is not None and boxes_known:
        again = fold.page(evidence_image)
        if again is not None and _sure_letters(again[0]) > _sure_letters(lines):
            fold_lines, folded = again
            texts, scores, lines, unread = [], [], [], []
            for line in fold_lines:
                if line["text"]:
                    texts.append(line["text"])
                    scores.append(line["score"])
                    lines.append(line)
                elif line["box"]:
                    unread.append(line["box"])

    # Line crops from the text layer (no stamp over the line); the evidence image is the scan.
    crop_image = evidence_image
    if original is not None:
        evidence_image = original[:, :, :3]
        for line in read_stamps(ocr, stamp_regions or []):
            texts.append(f"{STAMP_MARK} {line['text']}")
            if line["score"] is not None:
                scores.append(line["score"])
            lines.append(line)
            if line["box"] is None:
                boxes_known = False

    # Polish text: a letter with another language's mark is a misreading ("uwažane", "dó"),
    # and a word the dictionary does not know is checked for a lost mark (DictionaryFix).
    texts = [_polish_letters(text) for text in texts]
    for line in lines:
        line["text"] = _polish_letters(line["text"])
    DICTIONARY.prepare(texts)
    texts = [DICTIONARY.text(text) for text in texts]
    for line in lines:
        line["text"] = DICTIONARY.text(line["text"])

    confidence = (
        sum(scores) / len(scores)
        if scores
        else None
    )

    result = {
        "page": page_number,
        "text": "\n".join(texts),
        "confidence": confidence,
        "lineCount": len(texts),
        "engine": FOLD_ENGINE if folded else "PaddleOCR PP-OCRv6_medium",
        **({"fold": folded} if folded else {}),
        "lines": [
            {"text": line["text"], "score": line["score"], **({"stamp": True} if line.get("stamp") else {})}
            for line in lines
        ],
    }

    if line_crops and boxes_known:
        for index, line in enumerate(lines):
            if line["poly"] is None:
                continue
            try:
                # A broken line: its strip along the midline, not a rectangle across the fold.
                crop = _jpeg64(line["crop_image"]) if line.get("bent") else _line_crop(crop_image, line["poly"])
            except Exception:
                crop = None
            if crop:
                result["lines"][index]["crop"] = crop

    if evidence_dir is not None and boxes_known and all(line["box"] for line in lines):
        height, width = evidence_image.shape[:2]
        scale = min(1.0, EVIDENCE_MAX_SIDE / max(width, height))
        picture = Image.fromarray(evidence_image[:, :, :3].astype(np.uint8))
        if scale < 1.0:
            picture = picture.resize((max(1, round(width * scale)), max(1, round(height * scale))))
        name = f"page-{page_number}.jpg"
        picture.save(evidence_dir / name, format="JPEG", quality=90)
        scaled = lambda box: [round(value * scale, 1) for value in box]
        for index, line in enumerate(lines):
            result["lines"][index]["box"] = scaled(line["box"])
            # The line's own outline for the preview frame and the masks (a fold bends it).
            if line.get("poly") is not None:
                try:
                    result["lines"][index]["poly"] = _outline(line["poly"], scale)
                except Exception:
                    pass
        result["evidence"] = {
            "file": name,
            "width": picture.width,
            "height": picture.height,
            "unread": [scaled(box) for box in unread],
        }

    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pages", default="1")
    parser.add_argument("--lang", default="pl")
    parser.add_argument("--dpi", type=int, default=220)
    parser.add_argument("--device", default=None)
    parser.add_argument("--evidence-dir", default=None)
    # Straightened image of every line (base64 JPEG) for the local vision model.
    parser.add_argument("--line-crops", action="store_true")
    parser.add_argument(
        "--mode",
        choices=("pdf", "image"),
        default="pdf",
    )
    # UVDoc straightens a photographed, bent page. On a flat scan it bends the
    # text and merges neighbouring lines (a whole "KRS ... NIP ... ul." line was
    # lost on a real scan), so by default it runs for photographs only.
    parser.add_argument(
        "--unwarp",
        choices=("auto", "on", "off"),
        default=os.environ.get("LEX_OCR_UNWARP", "auto"),
    )
    args = parser.parse_args()

    pages = parse_pages(args.pages)
    model_root_raw = os.environ.get("LEX_PADDLE_MODEL_DIR", "").strip()
    if not model_root_raw:
        raise RuntimeError("LEX_PADDLE_MODEL_DIR is required; network model downloads are disabled")
    model_root = Path(model_root_raw).resolve()
    native_model_root = Path(paddle_native_path(model_root))
    required_models = {
        "doc_orientation_classify_model_dir":
            native_model_root / "PP-LCNet_x1_0_doc_ori",
        "doc_unwarping_model_dir":
            native_model_root / "UVDoc",
        "textline_orientation_model_dir":
            native_model_root / "PP-LCNet_x1_0_textline_ori",
        "text_detection_model_dir":
            native_model_root / "PP-OCRv6_medium_det",
        "text_recognition_model_dir":
            native_model_root / "PP-OCRv6_medium_rec",
    }
    # A download cut short (installer closed, network lost) leaves some model
    # directories missing or without weights: the runtime tells the user to
    # finish the installation instead of showing a traceback.
    missing = [
        path.name
        for path in required_models.values()
        if not model_complete(path)
    ]
    if missing:
        print(
            "LEX_OCR_MODELS_INCOMPLETE:" + ",".join(missing),
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(3)

    ocr_kwargs = dict(
        lang=args.lang,
        ocr_version="PP-OCRv6",
        use_doc_orientation_classify=True,
        use_doc_unwarping=(args.unwarp == "on" or (args.unwarp == "auto" and args.mode == "image")),
        # Per-line orientation (the model stays installed) turned lines of degraded
        # scans upside down and garbled them; page orientation is still corrected.
        use_textline_orientation=False,
        cpu_threads=cpu_threads(),
        **{
            key: str(value)
            for key, value in required_models.items()
        },
    )
    if args.device:
        ocr_kwargs["device"] = args.device

    # Optional: installed by the bootstrap since 0.1.38; an older install reads as before.
    latin_dir = native_model_root / LATIN_REC
    ocr = OcrEngine(ocr_kwargs, latin_dir if model_complete(latin_dir) and os.environ.get("LEX_OCR_MARKS", "on") != "off" else None)
    # Folded photographs read along their lines (LEX_OCR_FOLDS=off: as before).
    fold = FoldMode(ocr, required_models) if os.environ.get("LEX_OCR_FOLDS", "on") != "off" else None
    # Coloured stamps read apart from the text (LEX_OCR_STAMPS=off: the page as scanned).
    stamp_split = os.environ.get("LEX_OCR_STAMPS", "on") != "off"
    results = []
    evidence_dir = Path(args.evidence_dir) if args.evidence_dir else None
    if evidence_dir is not None:
        evidence_dir.mkdir(parents=True, exist_ok=True)

    if args.mode == "image":
        if pages != [1]:
            raise ValueError("image mode accepts only page 1")
        with Image.open(args.input) as source:
            image = np.array(source.convert("RGB"))
        results.append(
            predict_page(ocr, image, 1, evidence_dir, args.line_crops, stamps=stamp_split and not ocr_kwargs["use_doc_unwarping"], fold=fold)
        )
    else:
        doc = fitz.open(args.input)
        try:
            for page_number in pages:
                if page_number > doc.page_count:
                    raise ValueError(
                        f"requested page {page_number} exceeds document page count {doc.page_count}"
                    )

                page = doc.load_page(page_number - 1)
                pix = page.get_pixmap(
                    dpi=args.dpi,
                    alpha=False,
                )
                channels = pix.n
                image = np.frombuffer(
                    pix.samples,
                    dtype=np.uint8,
                ).reshape(
                    pix.height,
                    pix.width,
                    channels,
                )
                if channels == 4:
                    image = image[:, :, :3]

                results.append(
                    predict_page(
                        ocr,
                        image,
                        page_number,
                        evidence_dir,
                        args.line_crops,
                        stamps=stamp_split and not ocr_kwargs["use_doc_unwarping"],
                        fold=fold,
                    )
                )
                # Progress for the runtime (page number only, no content).
                print(f"LEX_OCR_PAGE {page_number}", file=sys.stderr, flush=True)
        finally:
            doc.close()

    Path(args.output).write_text(
        json.dumps(results, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
