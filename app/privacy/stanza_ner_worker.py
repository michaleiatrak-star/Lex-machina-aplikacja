#!/usr/bin/env python3
import argparse
import json
import os
import sys
from pathlib import Path

import stanza


PERSON_LABEL_HINTS = (
    "per",
    "pers",
    "person",
    "persname",
)


def is_person_label(label: str) -> bool:
    normalized = label.lower().replace("_", "").replace("-", "")
    return any(hint in normalized for hint in PERSON_LABEL_HINTS)


def load_pipeline() -> "stanza.Pipeline":
    resources_raw = os.environ.get("STANZA_RESOURCES_DIR", "").strip()
    if not resources_raw:
        raise RuntimeError(
            "STANZA_RESOURCES_DIR is required; network model downloads are disabled"
        )
    resources = Path(resources_raw).resolve()
    if not (resources / "resources.json").is_file():
        raise RuntimeError(
            f"Stanza resources.json missing: {resources / 'resources.json'}"
        )
    if not (resources / "pl").is_dir():
        raise RuntimeError(
            f"Polish Stanza models missing: {resources / 'pl'}"
        )
    return stanza.Pipeline(
        lang="pl",
        dir=str(resources),
        processors="tokenize,ner",
        download_method=None,
        use_gpu=False,
        verbose=False,
    )


def persons(pipeline: "stanza.Pipeline", text: str) -> list:
    doc = pipeline(text)
    return [
        {
            "start": int(entity.start_char),
            "end": int(entity.end_char),
            "value": entity.text,
        }
        for entity in doc.ents
        if is_person_label(entity.type)
    ]


def serve(pipeline: "stanza.Pipeline") -> None:
    # One JSON request per stdin line, one JSON answer per stdout line. The model
    # is loaded once (about 8-10 s on CPU) instead of once per checked text.
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            answer = {"id": request_id, "spans": persons(pipeline, str(request["text"]))}
        except Exception as error:  # the worker survives one bad request
            answer = {"id": request_id, "error": str(error)[:500]}
        sys.stdout.write(json.dumps(answer, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--output")
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()

    if args.serve:
        serve(load_pipeline())
        return
    if not args.input or not args.output:
        parser.error("--input and --output are required without --serve")

    text = Path(args.input).read_text(encoding="utf-8")
    results = persons(load_pipeline(), text)
    Path(args.output).write_text(
        json.dumps(results, ensure_ascii=False),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
