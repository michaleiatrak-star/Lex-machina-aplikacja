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
On the graphics card as OCR (DirectML on Windows, CoreML on macOS) once a measurement on this
computer showed it faster with the same result; the processor otherwise and when it fails.
"""
import argparse
import json
import os
import platform
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


class MlxInfo:
    def __init__(self, duration: float, language: str):
        self.duration = duration
        self.language = language


def mlx_usable(mlx_dir: str) -> bool:
    """macOS on Apple Silicon with the MLX model (config.json, weights.safetensors) and package."""
    if not mlx_dir or sys.platform != "darwin" or platform.machine() != "arm64":
        return False
    folder = Path(mlx_dir)
    if not ((folder / "config.json").is_file() and (folder / "weights.safetensors").is_file()):
        return False
    try:
        import mlx_whisper  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def run_mlx(mlx_dir: str, audio: np.ndarray, language: str):
    """The same words with times as run(), on the Apple GPU (mlx-whisper, large-v3-turbo in MLX)."""
    import mlx_whisper

    total = len(audio) / SAMPLE_RATE
    result = mlx_whisper.transcribe(
        audio.astype(np.float32),
        path_or_hf_repo=str(mlx_dir),
        language=language,
        initial_prompt=INITIAL_PROMPT,
        word_timestamps=True,
        condition_on_previous_text=False,
        verbose=None,
    )
    words = []
    for segment in result.get("segments", []):
        seg_words = segment.get("words") or []
        if seg_words:
            words.extend((float(w["start"]), float(w["end"]), str(w["word"])) for w in seg_words if str(w["word"]).strip())
        elif str(segment.get("text", "")).strip():
            words.append((float(segment["start"]), float(segment["end"]), str(segment["text"])))
        print(f"LEX_STT_PROGRESS {int(segment.get('end', 0))} {int(total)}", file=sys.stderr, flush=True)
    return words, MlxInfo(total, str(result.get("language") or language))


MLX_RECORD = "card.json"
MLX_BENCH_SECONDS = 60


def same_words(a, b) -> float:
    import difflib

    left = [w[2].strip().lower().strip(".,?!;:") for w in a]
    right = [w[2].strip().lower().strip(".,?!;:") for w in b]
    if not left and not right:
        return 1.0
    return difflib.SequenceMatcher(None, left, right, autojunk=False).ratio()


def mlx_decision(audio: np.ndarray, mlx_dir: str, model_dir: Path, language: str):
    """Whether the Apple GPU transcribes: measured once per computer on the first minute of a
    recording (GPU and processor), kept in the MLX model folder. The GPU stays when it takes at
    most CARD_MIN_GAIN of the processor's time and the words match at least MLX_MIN_SAME.
    None: a recording too short to measure (the processor this time)."""
    record = Path(mlx_dir) / MLX_RECORD
    try:
        import importlib.metadata as metadata

        version = metadata.version("mlx-whisper")
    except Exception:  # noqa: BLE001
        version = ""
    try:
        saved = json.loads(record.read_text(encoding="utf-8"))
        if saved.get("mlxWhisper") == version and isinstance(saved.get("accepted"), bool):
            return saved, False
    except (OSError, ValueError):
        pass
    seconds = min(len(audio) / SAMPLE_RATE, MLX_BENCH_SECONDS)
    if seconds < BENCH_MIN_SECONDS:
        return None, False
    sample = audio[: int(seconds * SAMPLE_RATE)]
    result = {"mlxWhisper": version}
    try:
        run_mlx(mlx_dir, sample[: SAMPLE_RATE * 5], language)  # loads the model; not counted
        started = time.time()
        gpu, _ = run_mlx(mlx_dir, sample, language)
        result["gpuSeconds"] = round(time.time() - started, 2)
    except Exception as error:  # noqa: BLE001
        result.update(accepted=False, error=f"{type(error).__name__}:{str(error)[:200]}")
        gpu = None
    started = time.time()
    cpu, _ = run(model_dir, sample, language, "cpu")
    result["cpuSeconds"] = round(time.time() - started, 2)
    if gpu is not None:
        result["sameWords"] = round(same_words(cpu, gpu), 3)
        result["accepted"] = result["gpuSeconds"] <= CARD_MIN_GAIN * result["cpuSeconds"] and result["sameWords"] >= MLX_MIN_SAME
    result["measuredSeconds"] = round(seconds, 1)
    try:
        tmp = record.with_suffix(".tmp")
        tmp.write_text(json.dumps(result), encoding="utf-8")
        tmp.replace(record)
    except OSError:
        pass
    print("LEX_STT_MLX_BENCH " + json.dumps(result), file=sys.stderr, flush=True)
    return result, True


def diarize_provider() -> tuple[str, bool]:
    """The graphics card as for OCR: DirectML on Windows (any DirectX 12 card), CoreML on macOS
    (Apple GPU and Neural Engine); both are built into the sherpa-onnx wheels. LEX_STT_DIARIZE_PROVIDER:
    auto (default: the card only after the measurement below accepted it), cpu, directml, coreml.
    Returns the provider and whether it was chosen by the user (no measurement then)."""
    wanted = os.environ.get("LEX_STT_DIARIZE_PROVIDER", "auto").strip().lower()
    if wanted in ("cpu", "directml", "coreml"):
        return wanted, True
    if sys.platform == "win32":
        return "directml", False
    if sys.platform == "darwin":
        return "coreml", False
    return "cpu", False


# The card is kept when it takes at most this share of the processor's time and labels at least
# this share of the measured audio the same way (as the OCR measurement, ocr-acceleration.ts).
CARD_MIN_GAIN = 0.85
CARD_MIN_SAME = 0.95
BENCH_SECONDS = 120
BENCH_MIN_SECONDS = 30
CARD_RECORD = "card.json"
# Words (order kept) the GPU must read as the processor does; two Whisper runs differ a little.
MLX_MIN_SAME = 0.9


def frame_labels(turns, frames: int, step: float = 0.1):
    labels = [None] * frames
    for start, end, speaker in turns:
        for index in range(max(0, int(start / step)), min(frames, int(end / step))):
            if labels[index] is None:
                labels[index] = speaker
    return labels


def same_share(cpu_turns, card_turns, seconds: float) -> float:
    """Share of the speech frames both runs give to the same person (labels matched by overlap:
    two runs may number the same people differently)."""
    frames = int(seconds / 0.1) + 1
    a, b = frame_labels(cpu_turns, frames), frame_labels(card_turns, frames)
    pairs = {}
    for x, y in zip(a, b):
        if x is not None and y is not None:
            pairs[(x, y)] = pairs.get((x, y), 0) + 1
    mapping, used = {}, set()
    for (x, y), _count in sorted(pairs.items(), key=lambda item: -item[1]):
        if y not in mapping and x not in used:
            mapping[y] = x
            used.add(x)
    speech = sum(1 for x, y in zip(a, b) if x is not None or y is not None)
    same = sum(1 for x, y in zip(a, b) if x is not None and y is not None and mapping.get(y) == x)
    return same / speech if speech else 1.0


def sherpa_version() -> str:
    try:
        import sherpa_onnx

        return str(getattr(sherpa_onnx, "__version__", ""))
    except Exception:  # noqa: BLE001
        return ""


def card_decision(audio: np.ndarray, diarize_dir: str, speakers: int, threshold: float, provider: str):
    """Whether the card is used: measured once per computer (card and processor on the first two
    minutes of a recording), the result kept in the speaker models folder. None: not decided yet
    (a recording too short to measure, the processor used this time)."""
    record = Path(diarize_dir) / CARD_RECORD
    key = {"provider": provider, "sherpa": sherpa_version()}
    try:
        saved = json.loads(record.read_text(encoding="utf-8"))
        if all(saved.get(name) == value for name, value in key.items()) and isinstance(saved.get("accepted"), bool):
            return saved, False
    except (OSError, ValueError):
        pass
    seconds = min(len(audio) / 16000, BENCH_SECONDS)
    if seconds < BENCH_MIN_SECONDS:
        return None, False
    sample = audio[: int(seconds * 16000)]
    result = dict(key)
    try:
        # A first short run loads (CoreML: compiles) the models on the card; not counted.
        diarize_with(sample[: 16000 * 5], diarize_dir, speakers, threshold, provider)
        started = time.time()
        card = diarize_with(sample, diarize_dir, speakers, threshold, provider)
        result["cardSeconds"] = round(time.time() - started, 2)
    except Exception as error:  # noqa: BLE001
        result.update(accepted=False, error=f"{type(error).__name__}:{str(error)[:200]}")
        card = None
    started = time.time()
    cpu = diarize_with(sample, diarize_dir, speakers, threshold, "cpu")
    result["cpuSeconds"] = round(time.time() - started, 2)
    if card is not None:
        result["sameShare"] = round(same_share(cpu, card, seconds), 3)
        result["accepted"] = result["cardSeconds"] <= CARD_MIN_GAIN * result["cpuSeconds"] and result["sameShare"] >= CARD_MIN_SAME
    result["measuredSeconds"] = round(seconds, 1)
    try:
        tmp = record.with_suffix(".tmp")
        tmp.write_text(json.dumps(result), encoding="utf-8")
        tmp.replace(record)
    except OSError:
        pass
    print("LEX_STT_DIARIZE_BENCH " + json.dumps(result), file=sys.stderr, flush=True)
    return result, True


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
    """([(start, end, speaker)], provider used, card error, measurement) from sherpa-onnx; raises
    when not even the processor can (no package, no models). A failure on the card runs it again
    on the processor."""
    provider, chosen = diarize_provider()
    measured = None
    if provider != "cpu" and not chosen:
        decision, fresh = card_decision(audio, diarize_dir, speakers, threshold, provider)
        if fresh:
            measured = decision
        if not (decision and decision.get("accepted")):
            provider = "cpu"
    if provider != "cpu":
        try:
            return diarize_with(audio, diarize_dir, speakers, threshold, provider), provider, "", measured
        except Exception as error:  # noqa: BLE001
            card_error = f"{type(error).__name__}:{str(error)[:200]}"
            print(f"LEX_STT_DIARIZE_CARD_FAILED:{provider}:{card_error}", file=sys.stderr, flush=True)
            return diarize_with(audio, diarize_dir, speakers, threshold, "cpu"), "cpu", card_error, measured
    return diarize_with(audio, diarize_dir, speakers, threshold, "cpu"), "cpu", "", measured


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
    # macOS (Apple Silicon): large-v3-turbo in MLX for the GPU, used once measured faster.
    parser.add_argument("--mlx-dir", default="")
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
    mlx_stats = None
    if device == "cpu" and os.environ.get("LEX_STT_MLX", "auto").strip().lower() != "off" and mlx_usable(args.mlx_dir):
        decision, fresh = mlx_decision(audio, args.mlx_dir, model_dir, args.language)
        mlx_stats = {"measurement": decision} if fresh else {}
        if decision and decision.get("accepted"):
            device = "mlx"
    started = time.time()
    try:
        words, info = run_mlx(args.mlx_dir, audio, args.language) if device == "mlx" else run(model_dir, audio, args.language, device)
    except Exception as error:  # noqa: BLE001
        if device == "mlx":
            # The GPU failed: the whole recording on the processor, so the text never mixes the two.
            if mlx_stats is not None:
                mlx_stats["error"] = f"{type(error).__name__}:{str(error)[:200]}"
            print(f"LEX_STT_MLX_FAILED:{type(error).__name__}:{str(error)[:200]}", file=sys.stderr, flush=True)
            device = "cpu"
            started = time.time()
            words, info = run(model_dir, audio, args.language, device)
        elif device != "cuda":
            raise
        else:
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
            turns, provider, card_error, measured = diarize(audio, args.diarize_dir, args.speakers, args.diarize_threshold)
            diarize_stats = {"seconds": round(time.time() - diarize_started, 1), "provider": provider}
            if card_error:
                diarize_stats["cardError"] = card_error
            if measured:
                diarize_stats["cardBenchmark"] = measured
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
    if mlx_stats is not None:
        stats["mlx"] = mlx_stats
    if diarize_stats is not None:
        stats["diarize"] = diarize_stats
    print("LEX_STT_STATS " + json.dumps(stats), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
