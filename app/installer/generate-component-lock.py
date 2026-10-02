"""Component lock for the macOS install (same schema as generate-component-lock.ps1).

The code (app, corpus, workers, sidecar) is inside the app bundle and the
downloaded components (node, python, models) in the components root; the lock
lives in the components root. Paths under node/, python/ and models/ belong to
the components root, all other paths to the code root (runtime_sidecar.rs).

Usage: generate-component-lock.py <code-root> <components-root>
"""

from __future__ import annotations

import datetime
import hashlib
import json
import os
from pathlib import Path
import sys

COMPONENT_DIRS = ("node", "python", "models")
CODE_DIRS = ("app", "corpus", "ocr", "privacy", "storage", "bootstrap")
CODE_FILES = ("lex-runtime-sidecar", "release-source.json", "release-requirements.txt")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def entries(root: Path, top: str) -> list[dict[str, object]]:
    base = root / top
    if base.is_file() and not base.is_symlink():
        return [{"path": top, "bytes": base.stat().st_size, "sha256": sha256(base)}]
    rows: list[dict[str, object]] = []
    for directory, _, names in os.walk(base):
        for name in names:
            path = Path(directory) / name
            if path.is_symlink() or not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            rows.append({"path": relative, "bytes": path.stat().st_size, "sha256": sha256(path)})
    return rows


def main() -> int:
    if len(sys.argv) != 3:
        print("COMPONENT_LOCK_USAGE_ERROR", file=sys.stderr)
        return 2
    code_root = Path(sys.argv[1]).resolve()
    components_root = Path(sys.argv[2]).resolve()

    files: list[dict[str, object]] = []
    for top in COMPONENT_DIRS:
        files += entries(components_root, top)
    for top in CODE_DIRS + CODE_FILES:
        if (code_root / top).exists():
            files += entries(code_root, top)
    files.sort(key=lambda row: str(row["path"]))

    components = [
        ("node-runtime", "node"),
        ("python-runtime", "python"),
        ("lex-runtime", "app"),
        ("legal-corpus", "corpus"),
        ("paddle-ocr-pl", "models/paddle"),
        ("stanza-pl-ner", "models/stanza"),
        ("runtime-sidecar", "lex-runtime-sidecar"),
    ]
    rows = []
    for component_id, relative in components:
        members = [row for row in files if row["path"] == relative or str(row["path"]).startswith(relative + "/")]
        if not members:
            print(f"COMPONENT_EMPTY:{component_id}", file=sys.stderr)
            return 1
        aggregate = "\n".join(f"{row['sha256']}  {row['path']}" for row in members).encode("utf-8")
        rows.append({
            "id": component_id,
            "required": True,
            "relativePath": relative,
            "fileCount": len(members),
            "bytes": sum(int(row["bytes"]) for row in members),
            "sha256Manifest": hashlib.sha256(aggregate).hexdigest(),
        })

    manifest = json.loads((code_root / "release-source.json").read_text(encoding="utf-8"))
    lock = {
        "schemaVersion": 4,
        "status": "INSTALLED_COMPONENT_LOCK",
        "applicationVersion": manifest.get("applicationVersion", "UNKNOWN"),
        "target": "macos-arm64",
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "sourceRepository": "michaleiatrak-star/Lex-Machina",
        "networkRequiredAtInstall": True,
        "runtimeNetworkRequiredAfterBootstrap": False,
        "optionalNetworkActionsAfterInstall": [
            "ACCOUNT_SESSION_CLIENT_PROVISIONING",
            "APPLICATION_UPDATE",
            "SKILL_UPDATE",
        ],
        "expectedUserActionAfterInstall": "PROVIDER_API_KEY_OR_OPTIONAL_LOCAL_AI_SETUP",
        "localAi": {
            "requiredForApplicationHealth": False,
            "delivery": "NOT_AVAILABLE_ON_MACOS_YET",
        },
        "codeRoot": str(code_root),
        "components": rows,
        "files": files,
    }
    target = components_root / "component-lock.json"
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    print(f"Component lock: {target} ({len(files)} files)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
