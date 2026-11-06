#!/bin/bash
# Lex Machina - offline component bundle for the macOS (Apple silicon) package.
#
# Collects into <runtime>/offline what macos-online-bootstrap.sh downloads at install time:
#   downloads/  Node.js and CPython archives (the SHA-256 pinned in release-source.json)
#   wheels/     every Python package of release-requirements.txt and its dependencies
#   models/     PaddleOCR and Stanza (pl) models
# The bootstrap uses them instead of the network, with the same checks. The wheel set is
# installed into a scratch Python and the models are fetched with it, so a bundle that would
# fail on the user's Mac fails here.
#
# Usage: prepare-macos-offline.sh <runtime-payload-dir>
set -euo pipefail

PAYLOAD="${1:?usage: prepare-macos-offline.sh <runtime-payload-dir>}"
MANIFEST="$PAYLOAD/release-source.json"
REQUIREMENTS="$PAYLOAD/release-requirements.txt"
BOOTSTRAP="$PAYLOAD/bootstrap"
OFFLINE="$PAYLOAD/offline"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

fail() {
  echo "OFFLINE_PREPARE_FAILED:$1" >&2
  exit 1
}

value() {
  /usr/bin/plutil -extract "$1" raw -o - "$MANIFEST" 2>/dev/null || fail "MANIFEST_KEY_MISSING:$1"
}

fetch() {
  # fetch <url> <sha256> <target>
  curl -fL --retry 4 --retry-delay 3 --connect-timeout 30 -o "$3" "$1" || fail "DOWNLOAD_FAILED:$(basename "$3")"
  [ "$(shasum -a 256 "$3" | cut -d' ' -f1)" = "$2" ] || fail "HASH_MISMATCH:$(basename "$3")"
}

rm -rf "$OFFLINE"
mkdir -p "$OFFLINE/downloads" "$OFFLINE/wheels" "$OFFLINE/models"

echo "[offline 1/4] Node and Python archives"
NODE_VERSION="$(value runtime.node.version)"
PYTHON_VERSION="$(value runtime.python.version)"
# The names macos-online-bootstrap.sh gives them in its download cache.
NODE_ARCHIVE="$OFFLINE/downloads/node-v$NODE_VERSION-darwin-arm64.tar.gz"
PYTHON_ARCHIVE="$OFFLINE/downloads/cpython-$PYTHON_VERSION-aarch64-apple-darwin-install_only.tar.gz"
fetch "$(value runtime.node.url)" "$(value runtime.node.sha256)" "$NODE_ARCHIVE"
fetch "$(value runtime.python.url)" "$(value runtime.python.sha256)" "$PYTHON_ARCHIVE"

echo "[offline 2/4] Wheels of the pinned packages"
mkdir -p "$SCRATCH/python"
tar -xzf "$PYTHON_ARCHIVE" -C "$SCRATCH/python" --strip-components 1 || fail "PYTHON_EXTRACT_FAILED"
PY="$SCRATCH/python/bin/python3"
export PYTHONNOUSERSITE=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# The interpreter the user gets: every wheel matches its version and platform.
"$PY" -X utf8 -m pip wheel --quiet --wheel-dir "$OFFLINE/wheels" -r "$REQUIREMENTS" || fail "WHEELS_FAILED"
# pip itself, for an interpreter whose bundled pip is older than the wheels need.
"$PY" -X utf8 -m pip download --quiet --dest "$OFFLINE/wheels" --only-binary=:all: pip || fail "PIP_WHEEL_FAILED"

echo "[offline 3/4] The wheel set installs without the network"
"$PY" -X utf8 -m pip install --quiet --no-warn-script-location --no-index --find-links "$OFFLINE/wheels" \
  -r "$REQUIREMENTS" || fail "WHEELS_INCOMPLETE"
"$PY" -X utf8 "$BOOTSTRAP/verify-python-package-set.py" "$MANIFEST" || fail "PACKAGE_SET_MISMATCH"

echo "[offline 4/4] OCR/NER models"
fetched=0
for source in bos huggingface modelscope aistudio; do
  if PADDLE_PDX_MODEL_SOURCE="$source" "$PY" -X utf8 "$BOOTSTRAP/prefetch-release-models.py" "$OFFLINE/models"; then
    fetched=1
    break
  fi
  echo "Model prefetch via $source failed, next source" >&2
done
[ "$fetched" = 1 ] || fail "MODEL_PREFETCH_FAILED"
[ -d "$OFFLINE/models/stanza/pl" ] || fail "STANZA_MODEL_MISSING"
for name in PP-LCNet_x1_0_doc_ori UVDoc PP-LCNet_x1_0_textline_ori PP-OCRv6_medium_det PP-OCRv6_medium_rec; do
  [ -f "$OFFLINE/models/paddle/official_models/$name/inference.pdiparams" ] || fail "PADDLE_MODEL_MISSING:$name"
done
find "$OFFLINE" -name "__pycache__" -type d -prune -exec rm -rf {} +
# Download caches and locks of the model hosts (.locks, .cache, *.lock, *.incomplete) are no part
# of the bundle; some are created unreadable, and the app build reads every resource file.
find "$OFFLINE" \( -name ".locks" -o -name ".cache" -o -name ".huggingface" \) -type d -prune -exec rm -rf {} +
find "$OFFLINE" \( -name "*.lock" -o -name "*.incomplete" -o -name ".DS_Store" \) -type f -delete
chmod -R u+rwX,go+rX "$OFFLINE"
unreadable="$(find "$OFFLINE" ! -perm -u+r 2>/dev/null | head -5 || true)"
[ -z "$unreadable" ] || fail "UNREADABLE_FILES:$unreadable"

du -sh "$OFFLINE" "$OFFLINE"/* || true
echo "OFFLINE_BUNDLE_READY $OFFLINE"
