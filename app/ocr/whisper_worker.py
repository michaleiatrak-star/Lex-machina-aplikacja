"""Local speech-to-text for recordings (audio and video) with faster-whisper.

The recording never leaves the computer: decoding with PyAV, recognition with the
CTranslate2 Whisper model from --model-dir (no network). Output: JSON with the
duration and the segments (start, end, text). Progress on stderr as
"LEX_STT_PROGRESS <seconds done> <seconds total>".

NVIDIA card (LEX_STT_DEVICE=cuda): the CTranslate2 wheel for Windows is built with CUDA 12 and
loads cuBLAS and cuDNN from LEX_STT_CUDA_DIR (downloaded by the app, checked against SHA-256).
Any failure on the card (driver too old, library missing, out of memory) falls back to the
processor for the whole recording. The last stderr line "LEX_STT_STATS {json}" says which ran.

Batched recognition (BatchedInferencePipeline, the default; LEX_STT_BATCHED=0: one window after
another): measured on 4 minutes of two Polish readers, 4 CPU cores, large-v3-turbo int8: 85.6 s ->
52.2 s and 10.0/11.1% -> 6.9/9.1% wrong words (the sequential mode carries a mistake into the next
window). Word times come with it at no cost.

Speakers (--diarize-dir with segmentation.onnx and embedding.onnx, --diarize-threshold): sherpa-onnx
(pyannote segmentation 3.0 and a speaker embedding model) labels who speaks when; each word gets
the speaker of its moment and the text is cut into turns. --speakers N when the number is known
(more accurate), 0 for the application's estimate. Without the models or the package: no speakers.
On the graphics card as OCR (DirectML on Windows, CoreML on macOS), the processor when it fails.
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


def batched_enabled() -> bool:
    return os.environ.get("LEX_STT_BATCHED", "1").strip() != "0"


def run(model_dir: Path, audio: np.ndarray, language: str, device: str):
    """Recognized words with their times: [(start, end, word)], and the info of the run."""
    from faster_whisper import BatchedInferencePipeline, WhisperModel

    if device == "cuda":
        model = WhisperModel(str(model_dir), device="cuda", compute_type="float16")
    else:
        model = WhisperModel(str(model_dir), device="cpu", compute_type="int8", cpu_threads=threads())
    total = len(audio) / SAMPLE_RATE
    # A Polish prompt with punctuation: measured on 3 min of a Polish recording, 9.0% -> 7.0%
    # wrong words, with punctuation, capitals and names.
    common = dict(language=language, beam_size=1, vad_filter=True, initial_prompt=INITIAL_PROMPT, word_timestamps=True)
    if batched_enabled():
        pipeline = BatchedInferencePipeline(model=model)
        segments, info = pipeline.transcribe(audio, batch_size=16 if device == "cuda" else 8, **common)
    else:
        segments, info = model.transcribe(audio, condition_on_previous_text=True, **common)
    words = []
    for segment in segments:
        if segment.words:
            words.extend((float(w.start), float(w.end), w.word) for w in segment.words if w.word.strip())
        elif segment.text.strip():
            words.append((float(segment.start), float(segment.end), segment.text))
        print(f"LEX_STT_PROGRESS {int(segment.end)} {int(total)}", file=sys.stderr, flush=True)
    return words, info


def diarize_provider() -> str:
    """The graphics card as for OCR: DirectML on Windows (any DirectX 12 card), CoreML on macOS
    (Apple GPU and Neural Engine); both are built into the sherpa-onnx wheels. LEX_STT_DIARIZE_PROVIDER:
    auto (default), cpu, directml, coreml."""
    wanted = os.environ.get("LEX_STT_DIARIZE_PROVIDER", "auto").strip().lower()
    if wanted in ("cpu", "directml", "coreml"):
        return wanted
    if sys.platform == "win32":
        return "directml"
    if sys.platform == "darwin":
        return "coreml"
    return "cpu"


def diarize_with(audio: np.ndarray, diarize_dir: str, speakers: int, threshold: float, provider: str):
    import sherpa_onnx

    folder = Path(diarize_dir)
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(folder / "segmentation.onnx")),
            num_threads=threads(),
            provider=provider,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=str(folder / "embedding.onnx"), num_threads=threads(), provider=provider),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=speakers if speakers > 0 else -1, threshold=threshold),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not cfg.validate():
        raise ValueError("DIARIZE_CONFIG_INVALID")
    result = sherpa_onnx.OfflineSpeakerDiarization(cfg).process(audio).sort_by_start_time()
    return [(float(r.start), float(r.end), int(r.speaker)) for r in result]


def diarize(audio: np.ndarray, diarize_dir: str, speakers: int, threshold: float):
    """([(start, end, speaker)], provider used, card error) from sherpa-onnx; raises when not even
    the processor can (no package, no models). A failure on the card runs it again on the processor."""
    provider = diarize_provider()
    if provider != "cpu":
        try:
            return diarize_with(audio, diarize_dir, speakers, threshold, provider), provider, ""
        except Exception as error:  # noqa: BLE001
            card_error = f"{type(error).__name__}:{str(error)[:200]}"
            print(f"LEX_STT_DIARIZE_CARD_FAILED:{provider}:{card_error}", file=sys.stderr, flush=True)
            return diarize_with(audio, diarize_dir, speakers, threshold, "cpu"), "cpu", card_error
    return diarize_with(audio, diarize_dir, speakers, threshold, "cpu"), "cpu", ""


def speaker_at(turns, start: float, end: float, previous):
    """The speaker of a word: the turn covering most of it, else the nearest one."""
    best, overlap = None, 0.0
    for t0, t1, spk in turns:
        if t1 <= start:
            continue
        if t0 >= end:
            break
        shared = min(t1, end) - max(t0, start)
        if shared > overlap:
            best, overlap = spk, shared
    if best is not None:
        return best
    middle = (start + end) / 2
    nearest = min(turns, key=lambda t: min(abs(t[0] - middle), abs(t[1] - middle)), default=None)
    if nearest and min(abs(nearest[0] - middle), abs(nearest[1] - middle)) < 1.5:
        return nearest[2]
    return previous


def build_segments(words, turns):
    """Lines of the transcript: a new one at a change of speaker, after a pause of 1.5 s, or at the
    end of a sentence once the line is 12 s long; speakers numbered in order of first appearance."""
    numbers = {}
    out = []
    current = None
    previous_speaker = None
    for start, end, word in words:
        speaker = speaker_at(turns, start, end, previous_speaker) if turns else None
        previous_speaker = speaker
        label = None
        if speaker is not None:
            label = numbers.setdefault(speaker, len(numbers) + 1)
        sentence_end = current is not None and current["text"].rstrip().endswith((".", "?", "!"))
        if (
            current is None
            or label != current.get("speaker")
            or start - current["end"] > 1.5
            or (sentence_end and current["end"] - current["start"] > 12)
        ):
            if current:
                out.append(current)
            current = {"start": round(start, 2), "end": round(end, 2), "text": word.strip()}
            if label is not None:
                current["speaker"] = label
        else:
            current["end"] = round(end, 2)
            # Whisper words carry their own leading space; a word without one continues the last.
            current["text"] += word
    if current:
        out.append(current)
    for item in out:
        item["text"] = " ".join(item["text"].split())
    return [item for item in out if item["text"]], len(numbers)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--language", default="pl")
    parser.add_argument("--diarize-dir", default="")
    parser.add_argument("--speakers", type=int, default=0)
    parser.add_argument("--diarize-threshold", type=float, default=0.7)
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
        words, info = run(model_dir, audio, args.language, device)
    except Exception as error:  # noqa: BLE001
        if device != "cuda":
            raise
        # The card failed (cuDNN or cuBLAS missing, driver, memory): the whole recording again
        # on the processor, so the text never mixes the two.
        cuda_error = f"{type(error).__name__}:{str(error)[:200]}"
        print(f"LEX_STT_CUDA_FAILED:{cuda_error}", file=sys.stderr, flush=True)
        device = "cpu"
        started = time.time()
        words, info = run(model_dir, audio, args.language, device)
    seconds = round(time.time() - started, 1)
    turns = []
    diarize_stats = None
    if args.diarize_dir and args.speakers != 1:
        diarize_started = time.time()
        try:
            turns, provider, card_error = diarize(audio, args.diarize_dir, args.speakers, args.diarize_threshold)
            diarize_stats = {"seconds": round(time.time() - diarize_started, 1), "provider": provider}
            if card_error:
                diarize_stats["cardError"] = card_error
        except Exception as error:  # noqa: BLE001
            # The transcript without speakers rather than none.
            diarize_stats = {"error": f"{type(error).__name__}:{str(error)[:200]}"}
            print(f"LEX_STT_DIARIZE_FAILED:{diarize_stats['error']}", file=sys.stderr, flush=True)
    out, speakers = build_segments(words, turns)
    if diarize_stats is not None:
        diarize_stats["speakers"] = speakers
    Path(args.output).write_text(
        json.dumps(
            {
                "duration": round(info.duration, 2),
                "language": info.language,
                "seconds": seconds,
                "device": device,
                "speakers": speakers,
                "segments": out,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    stats = {"device": device, "seconds": seconds, "audioSeconds": round(len(audio) / SAMPLE_RATE, 1)}
    if cuda_error:
        stats["cudaError"] = cuda_error
    stats["batched"] = batched_enabled()
    if diarize_stats is not None:
        stats["diarize"] = diarize_stats
    print("LEX_STT_STATS " + json.dumps(stats), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
