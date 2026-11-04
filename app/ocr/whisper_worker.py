"""Local speech-to-text for recordings (audio and video) with faster-whisper.

The recording never leaves the computer: decoding with PyAV, recognition with the
CTranslate2 Whisper model from --model-dir (no network). Output: JSON with the
duration and the segments (start, end, text). Progress on stderr as
"LEX_STT_PROGRESS <seconds done> <seconds total>".

NVIDIA card (LEX_STT_DEVICE=cuda): the CTranslate2 wheel for Windows is built with CUDA 12 and
loads cuBLAS and cuDNN from LEX_STT_CUDA_DIR (downloaded by the app, checked against SHA-256).
Any failure on the card (driver too old, library missing, out of memory) falls back to the
processor for the whole recording. The last stderr line "LEX_STT_STATS {json}" says which ran.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
INITIAL_PROMPT = "Nagranie rozmowy po polsku. Pan Kowalski, mecenas, powiedział: „Dobrze, zgoda.”"


def decode(path: str) -> np.ndarray:
    """Audio of any container PyAV reads (mp3, wav, m4a, ogg, flac, mp4, mov, webm, mkv)
    as mono float32 at 16 kHz. Decoded here and not by faster_whisper.decode_audio: that
    one passes options newer PyAV releases no longer accept."""
    import av

    chunks = []
    with av.open(path, mode="r") as container:
        if not container.streams.audio:
            raise ValueError("NO_AUDIO_STREAM")
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        raise ValueError("EMPTY_AUDIO")
    return np.concatenate(chunks).astype(np.float32) / 32768.0


def threads() -> int:
    raw = os.environ.get("LEX_STT_THREADS", "").strip()
    if raw.isdigit() and int(raw) > 0:
        return int(raw)
    return max(1, os.cpu_count() or 1)


def cuda_ready(cuda_dir: str) -> str:
    """'' when the card can be used, else the reason."""
    if cuda_dir:
        if not os.path.isdir(cuda_dir):
            return "CUDA_DIR_MISSING"
        os.environ["PATH"] = cuda_dir + os.pathsep + os.environ.get("PATH", "")
        if hasattr(os, "add_dll_directory"):
            os.add_dll_directory(cuda_dir)
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() < 1:
            return "NO_CUDA_DEVICE"
    except Exception as error:  # noqa: BLE001
        return f"{type(error).__name__}:{str(error)[:200]}"
    return ""


def run(model_dir: Path, audio: np.ndarray, language: str, device: str):
    from faster_whisper import WhisperModel

    if device == "cuda":
        model = WhisperModel(str(model_dir), device="cuda", compute_type="float16")
    else:
        model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=threads())
    total = len(audio) / SAMPLE_RATE
    segments, info = model.transcribe(
        audio,
        language=language,
        beam_size=1,
        vad_filter=True,
        # A Polish prompt with punctuation and the previous text as context: measured on 3 min
        # of a Polish recording, 9.0% -> 7.0% wrong words, with punctuation, capitals and names
        # (without it the turbo model wrote everything lowercase, without punctuation).
        condition_on_previous_text=True,
        initial_prompt=INITIAL_PROMPT,
    )
    out = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            out.append({"start": round(segment.start, 2), "end": round(segment.end, 2), "text": text})
        print(f"LEX_STT_PROGRESS {int(segment.end)} {int(total)}", file=sys.stderr, flush=True)
    return out, info


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--language", default="pl")
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    if not (model_dir / "model.bin").is_file():
        print("LEX_STT_MODEL_MISSING", file=sys.stderr, flush=True)
        raise SystemExit(3)

    try:
        audio = decode(args.input)
    except Exception as error:  # noqa: BLE001
        print(f"LEX_STT_DECODE_FAILED:{type(error).__name__}:{str(error)[:200]}", file=sys.stderr, flush=True)
        raise SystemExit(4)

    device = "cuda" if os.environ.get("LEX_STT_DEVICE", "").strip().lower() == "cuda" else "cpu"
    cuda_error = ""
    if device == "cuda":
        cuda_error = cuda_ready(os.environ.get("LEX_STT_CUDA_DIR", "").strip())
        if cuda_error:
            device = "cpu"
    started = time.time()
    try:
        out, info = run(model_dir, audio, args.language, device)
    except Exception as error:  # noqa: BLE001
        if device != "cuda":
            raise
        # The card failed (cuDNN or cuBLAS missing, driver, memory): the whole recording again
        # on the processor, so the text never mixes the two.
        cuda_error = f"{type(error).__name__}:{str(error)[:200]}"
        print(f"LEX_STT_CUDA_FAILED:{cuda_error}", file=sys.stderr, flush=True)
        device = "cpu"
        started = time.time()
        out, info = run(model_dir, audio, args.language, device)
    seconds = round(time.time() - started, 1)
    Path(args.output).write_text(
        json.dumps(
            {
                "duration": round(info.duration, 2),
                "language": info.language,
                "seconds": seconds,
                "device": device,
                "segments": out,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    stats = {"device": device, "seconds": seconds, "audioSeconds": round(len(audio) / SAMPLE_RATE, 1)}
    if cuda_error:
        stats["cudaError"] = cuda_error
    print("LEX_STT_STATS " + json.dumps(stats), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
