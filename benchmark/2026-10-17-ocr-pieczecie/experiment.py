"""Stamp over text lines: OCR of the page as scanned vs. the page split by ink colour.

Synthetic A4 scans (200 dpi): 26 lines of a Polish letter in black, a round court stamp and a
rectangular office stamp over the lines (red, blue, or black as on a photocopy). PaddleOCR
PP-OCRv6 (lang=pl) as in the application. Metrics per variant:
- body: mean character accuracy of the letter's lines, lines read below 95%;
- stamp: share of the stamp's words read;
- leak: stamp words that ended up inside the body lines.
"""
import json
import math
import random
import re
import sys
from pathlib import Path

import numpy as np
from paddleocr import PaddleOCR
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SERIF = "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"
SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
W, H = 1654, 2339

BODY = [
    "Działając w imieniu powoda, na podstawie pełnomocnictwa załączonego do akt, wnoszę o:",
    "zasądzenie od pozwanego na rzecz powoda kwoty 128 450,00 zł wraz z odsetkami",
    "ustawowymi za opóźnienie w transakcjach handlowych od dnia 15 marca 2026 r.",
    "do dnia zapłaty, a także o zasądzenie kosztów postępowania według norm przepisanych.",
    "Powód zawarł z pozwanym umowę o roboty budowlane w dniu 4 września 2025 r.",
    "Zgodnie z § 7 ust. 2 umowy wynagrodzenie płatne było w terminie 30 dni od doręczenia",
    "prawidłowo wystawionej faktury. Pozwany odebrał roboty bez zastrzeżeń protokołem",
    "z dnia 12 lutego 2026 r., podpisanym przez inspektora nadzoru inwestorskiego.",
    "Faktura nr FV/2026/02/117 została doręczona pozwanemu w dniu 14 lutego 2026 r.",
    "Pomimo wezwania do zapłaty z dnia 20 kwietnia 2026 r. pozwany nie uregulował należności.",
    "Pozwany w korespondencji nie kwestionował ani zakresu, ani jakości wykonanych robót.",
    "Wysokość roszczenia wynika wprost z faktury oraz z kosztorysu powykonawczego.",
    "Termin spełnienia świadczenia upłynął bezskutecznie w dniu 16 marca 2026 r.",
    "Strony podjęły próbę polubownego rozwiązania sporu, która nie przyniosła rezultatu.",
    "Pozwany zaproponował zapłatę w ratach, jednak nie przedstawił żadnego harmonogramu.",
    "Powód wyraża zgodę na przeprowadzenie mediacji, jeżeli Sąd uzna ją za celową.",
    "Wartość przedmiotu sporu wynosi 128 450 zł, a opłata od pozwu została uiszczona.",
    "Sąd Okręgowy w Krakowie jest właściwy rzeczowo i miejscowo do rozpoznania sprawy.",
    "Do pozwu załączam odpis umowy, protokół odbioru, fakturę oraz wezwanie do zapłaty.",
    "Wnoszę o przeprowadzenie dowodu z zeznań świadka Marka Wiśniewskiego na okoliczność",
    "przebiegu odbioru robót oraz braku zastrzeżeń zgłoszonych przez przedstawiciela pozwanego.",
    "Wnoszę również o zobowiązanie pozwanego do przedłożenia dziennika budowy.",
    "Powód nie wyraża zgody na przeprowadzenie rozprawy pod jego nieobecność.",
    "Z uwagi na powyższe wnoszę jak na wstępie.",
    "Pełnomocnik powoda, radca prawny Anna Nowak",
    "Kraków, dnia 2 października 2026 r.",
]
ROUND_RING = "SĄD REJONOWY DLA KRAKOWA-ŚRÓDMIEŚCIA W KRAKOWIE"
ROUND_CENTER = ["Wydział I Cywilny", "BIURO PODAWCZE", "wpłynęło 3.10.2026"]
RECT = ["KANCELARIA RADCY PRAWNEGO", "r.pr. Anna Nowak", "ul. Długa 12, 31-147 Kraków", "NIP 677-123-45-67"]
INKS = {"czerwona": (196, 32, 46), "niebieska": (38, 62, 186)}
# A black or grey stamp (black ink, a photocopy, a grey scan): no colour to separate by.
GREYS = {"szara": (105, 105, 108), "czarna": (30, 30, 34)}


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def round_stamp(radius: int) -> Image.Image:
    size = radius * 2 + 20
    layer = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(layer)
    c = size // 2
    draw.ellipse((c - radius, c - radius, c + radius, c + radius), outline=255, width=6)
    draw.ellipse((c - radius + 52, c - radius + 52, c + radius - 52, c + radius - 52), outline=255, width=3)
    ring = font(SANS_BOLD, 26)
    step = 2 * math.pi * 0.86 / len(ROUND_RING)
    for index, letter in enumerate(ROUND_RING):
        angle = -math.pi / 2 - math.pi * 0.86 + step * (index + 0.5)
        glyph = Image.new("L", (40, 40), 0)
        ImageDraw.Draw(glyph).text((20, 20), letter, fill=255, font=ring, anchor="mm")
        glyph = glyph.rotate(-math.degrees(angle) - 90, resample=Image.BICUBIC)
        x = c + (radius - 28) * math.cos(angle) - 20
        y = c + (radius - 28) * math.sin(angle) - 20
        layer.paste(255, (int(x), int(y)), glyph)
    inner = font(SANS_BOLD, 24)
    for row, line in enumerate(ROUND_CENTER):
        draw.text((c, c - 34 + row * 34), line, fill=255, font=inner, anchor="mm")
    return layer


def rect_stamp() -> Image.Image:
    f = font(SANS_BOLD, 30)
    layer = Image.new("L", (640, 210), 0)
    draw = ImageDraw.Draw(layer)
    draw.rectangle((4, 4, 635, 205), outline=255, width=5)
    for row, line in enumerate(RECT):
        draw.text((320, 38 + row * 45), line, fill=255, font=f, anchor="mm")
    return layer


def page(ink: tuple[int, int, int] | None, seed: int) -> tuple[Image.Image, list[tuple[int, int, int, int]]]:
    """The scan and the boxes of its stamps; ink None = black stamp (photocopy)."""
    rng = random.Random(seed)
    paper = Image.new("RGB", (W, H), (247, 245, 238))
    draw = ImageDraw.Draw(paper)
    body = font(SERIF, 31)
    y = 260
    for line in BODY:
        draw.text((150, y), line, fill=(22, 22, 24), font=body)
        y += 66
    array = np.asarray(paper).astype(np.float32) / 255.0
    boxes = []
    for layer, (x, y) in ((round_stamp(190), (900 + rng.randint(-40, 40), 520 + rng.randint(-30, 30))),
                          (rect_stamp(), (230 + rng.randint(-30, 30), 1370 + rng.randint(-20, 20)))):
        layer = layer.rotate(rng.uniform(-14, 14), resample=Image.BICUBIC, expand=True)
        alpha = np.zeros((H, W), np.float32)
        a = np.asarray(layer).astype(np.float32) / 255.0
        # Uneven ink: a stamp is never evenly pressed.
        pressure = np.asarray(Image.fromarray((np.random.default_rng(seed).random((a.shape[0] // 24 + 1, a.shape[1] // 24 + 1)) * 255).astype(np.uint8)).resize((a.shape[1], a.shape[0]), Image.BICUBIC)).astype(np.float32) / 255.0
        a = a * (0.55 + 0.4 * pressure)
        alpha[y:y + a.shape[0], x:x + a.shape[1]] = a[: H - y, : W - x]
        colour = np.array(ink, np.float32) / 255.0
        # Ink multiplies with what is under it (black text stays black under red ink).
        array = array * (1 - alpha[..., None] * (1 - colour))
        boxes.append((x, y, x + a.shape[1], y + a.shape[0]))
    scan = Image.fromarray((np.clip(array, 0, 1) * 255).astype(np.uint8))
    scan = scan.filter(ImageFilter.GaussianBlur(0.7))
    noise = np.random.default_rng(seed + 1).normal(0, 6, (H, W, 1))
    scan = Image.fromarray(np.clip(np.asarray(scan).astype(np.float32) + noise, 0, 255).astype(np.uint8))
    return scan, boxes


def split_by_ink(image: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """The text layer (coloured ink removed) and the stamp layer (only coloured ink)."""
    rgb = image.astype(np.int16)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    dark = 255 - rgb.max(axis=2)
    mask = (chroma > 38) & (dark > 25)
    mask = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))) > 0
    # Under the ink, a black letter keeps low chroma: dark and grey stays text.
    text = image.copy()
    keep_text = mask & (chroma < 60) & (rgb.max(axis=2) < 90)
    text[mask & ~keep_text] = (245, 245, 245)
    stamp = np.full_like(image, 255)
    value = np.clip(255 - (dark.astype(np.float32) * 1.6), 0, 255).astype(np.uint8)
    stamp[mask] = np.repeat(value[mask][:, None], 3, axis=1)
    return text, stamp, float(mask.mean())


def split_by_darkness(image: np.ndarray, threshold: int) -> tuple[np.ndarray, np.ndarray, float]:
    """Grey stamp: print is near-black and even, the stamp lighter; split by brightness."""
    grey = image.astype(np.float32).mean(axis=2)
    stamp_ink = (grey < 215) & (grey >= threshold)
    text = np.where(grey[..., None] < threshold, image, 245).astype(np.uint8)
    stamp = np.full_like(image, 255)
    stamp[stamp_ink] = np.repeat(np.clip((grey[stamp_ink] - threshold) * 1.6, 0, 200).astype(np.uint8)[:, None], 3, axis=1)
    return text, stamp, float(stamp_ink.mean())


def lev(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, row[0] = row[0], i
        for j in range(1, len(b) + 1):
            cur = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return row[-1]


def acc(gt: str, got: str) -> float:
    return max(0.0, 1 - lev(gt, got) / max(1, len(gt)))


def lines_of(ocr: PaddleOCR, image: np.ndarray) -> list[dict]:
    out = []
    for item in ocr.predict(image):
        res = item.json["res"]
        for text, score, box in zip(res["rec_texts"], res["rec_scores"], res["rec_boxes"]):
            if text.strip():
                out.append({"text": text.strip(), "score": float(score), "box": [float(v) for v in box]})
    return out


def body_metrics(lines: list[dict]) -> dict:
    # Each letter line against the OCR lines on its row, joined left to right.
    accs = []
    for index, gt in enumerate(BODY):
        top = 260 + index * 66
        row = sorted((line for line in lines if abs((line["box"][1] + line["box"][3]) / 2 - (top + 18)) < 26), key=lambda line: line["box"][0])
        accs.append(acc(gt, " ".join(line["text"] for line in row)))
    return {"body_acc": round(float(np.mean(accs)), 4), "body_lines_below_95": int(sum(a < 0.95 for a in accs)), "per_line": [round(a, 3) for a in accs]}


WORD = re.compile(r"[\wĄĆĘŁŃÓŚŹŻąćęłńóśźż.-]{3,}")


def stamp_words() -> set[str]:
    return {w.upper() for w in WORD.findall(" ".join([ROUND_RING, *ROUND_CENTER, *RECT]))}


def stamp_metrics(lines: list[dict], body_lines: list[dict]) -> dict:
    wanted = stamp_words()
    body_words = {w.upper() for gt in BODY for w in WORD.findall(gt)}
    got = {w.upper() for line in lines for w in WORD.findall(line["text"])}
    leak = {w.upper() for line in body_lines for w in WORD.findall(line["text"])} & (wanted - body_words)
    return {"stamp_words_read": round(len(wanted & got) / len(wanted), 3), "stamp_words_leaked_into_body": sorted(leak)}


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    ocr = PaddleOCR(lang="pl", ocr_version="PP-OCRv6", use_doc_orientation_classify=True, use_doc_unwarping=False, use_textline_orientation=False, enable_mkldnn=True)
    results = []
    variants = [("bez pieczęci", "none", None), *[(name, "colour", rgb) for name, rgb in INKS.items()], *[(name, "grey", rgb) for name, rgb in GREYS.items()]]
    for variant, kind, ink in variants:
        for seed in (1,):
            if kind == "none":
                rng_page = Image.new("RGB", (W, H), (247, 245, 238))
                draw = ImageDraw.Draw(rng_page)
                y = 260
                for line in BODY:
                    draw.text((150, y), line, fill=(22, 22, 24), font=font(SERIF, 31))
                    y += 66
                scan = rng_page.filter(ImageFilter.GaussianBlur(0.7))
            else:
                scan, boxes = page(ink, seed)
            image = np.asarray(scan)
            scan.save(out / f"{variant.split()[0]}-{seed}.png")
            original = lines_of(ocr, image)
            row = {"variant": variant, "seed": seed, "original": {**body_metrics(original), **stamp_metrics(original, original)}}
            splits = [] if kind == "none" else [("kolor", lambda: split_by_ink(image))] + ([("jasność 90", lambda: split_by_darkness(image, 90)), ("jasność 70", lambda: split_by_darkness(image, 70))] if kind == "grey" else [])
            for name, split in splits:
                text, stamp, share = split()
                Image.fromarray(text).save(out / f"{variant.split()[0]}-{seed}-{name.split()[0]}{name.split()[-1]}-tekst.png")
                Image.fromarray(stamp).save(out / f"{variant.split()[0]}-{seed}-{name.split()[0]}{name.split()[-1]}-pieczec.png")
                text_lines = lines_of(ocr, text)
                # The stamp layer only where the stamps are (the rest of the layer is blank).
                stamp_lines = [line for x0, y0, x1, y1 in boxes for line in lines_of(ocr, stamp[max(0, y0 - 20):y1 + 20, max(0, x0 - 20):x1 + 20])]
                row[name] = {"ink_share": round(share, 4), **body_metrics(text_lines), **stamp_metrics(stamp_lines, text_lines), "stamp_lines": [line["text"] for line in stamp_lines]}
            results.append(row)
            print(json.dumps({k: (v if k in ("variant", "seed") else {kk: vv for kk, vv in v.items() if kk not in ("per_line", "stamp_lines")}) for k, v in row.items()}, ensure_ascii=False), flush=True)
            if kind == "none":
                break
    (out / "wyniki.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
