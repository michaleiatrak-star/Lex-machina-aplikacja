"""Local speech-to-text for recordings (audio and video) with faster-whisper.

The recording never leaves the computer: decoding with PyAV, recognition with the
CTranslate2 Whisper model from --model-dir (no network). Output: JSON with the
duration and the segments (start, end, text). Progress on stderr as
"LEX_STT_PROGRESS <seconds done> <seconds total>".
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

    from faster_whisper import WhisperModel

    model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=threads())
    total = len(audio) / SAMPLE_RATE
    started = time.time()
    segments, info = model.transcribe(
        audio,
        language=args.language,
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
    Path(args.output).write_text(
        json.dumps(
            {
                "duration": round(info.duration, 2),
                "language": info.language,
                "seconds": round(time.time() - started, 1),
                "segments": out,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
