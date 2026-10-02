#!/bin/bash
# Lex Machina - online bootstrap for macOS (Apple silicon).
#
# Runs as the logged-in user (from the .pkg postinstall or by hand). Downloads
# the app-private components, each verified by the SHA-256 pinned in
# release-source.json, into the components root outside the app bundle:
#   node/    Node.js (official darwin-arm64 build)
#   python/  CPython (python-build-standalone) + pinned packages
#   models/  PaddleOCR and Stanza (pl) models
# then writes component-lock.json and runs the runtime self-test.
#
# Usage: macos-online-bootstrap.sh <code-root> [components-root]
#   code-root        Lex Machina.app/Contents/Resources/runtime
#   components-root  default: ~/Library/Application Support/LexMachina/runtime
set -euo pipefail

CODE_ROOT="${1:?usage: macos-online-bootstrap.sh <code-root> [components-root]}"
COMPONENTS_ROOT="${2:-$HOME/Library/Application Support/LexMachina/runtime}"
MANIFEST="$CODE_ROOT/release-source.json"
REQUIREMENTS="$CODE_ROOT/release-requirements.txt"
BOOTSTRAP="$CODE_ROOT/bootstrap"
CACHE="$COMPONENTS_ROOT/.download-cache"
LOGS="$COMPONENTS_ROOT/bootstrap-logs"

fail() {
  echo "BOOTSTRAP_FAILED:$1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "NOT_MACOS"
[ "$(uname -m)" = "arm64" ] || fail "APPLE_SILICON_REQUIRED:$(uname -m)"
[ -f "$MANIFEST" ] || fail "MANIFEST_MISSING:$MANIFEST"
[ -f "$REQUIREMENTS" ] || fail "REQUIREMENTS_MISSING:$REQUIREMENTS"

mkdir -p "$COMPONENTS_ROOT" "$CACHE" "$LOGS"

manifest_value() {
  /usr/bin/plutil -extract "$1" raw -o - "$MANIFEST" 2>/dev/null || fail "MANIFEST_KEY_MISSING:$1"
}

verified_download() {
  # verified_download <url> <sha256> <target> <label>
  local url="$1" expected="$2" target="$3" label="$4"
  if [ -f "$target" ] && [ "$(shasum -a 256 "$target" | cut -d' ' -f1)" = "$expected" ]; then
    echo "Using verified cache: $label"
    return 0
  fi
  rm -f "$target" "$target.part"
  echo "Downloading $label"
  curl -fL --retry 4 --retry-delay 3 --connect-timeout 30 -o "$target.part" "$url" || fail "DOWNLOAD_FAILED:$label"
  local actual
  actual="$(shasum -a 256 "$target.part" | cut -d' ' -f1)"
  [ "$actual" = "$expected" ] || { rm -f "$target.part"; fail "HASH_MISMATCH:$label expected=$expected actual=$actual"; }
  mv "$target.part" "$target"
}

echo "[1/6] Private Node"
NODE_VERSION="$(manifest_value runtime.node.version)"
NODE_DIR="$COMPONENTS_ROOT/node"
if [ "$("$NODE_DIR/bin/node" --version 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  archive="$CACHE/node-v$NODE_VERSION-darwin-arm64.tar.gz"
  verified_download "$(manifest_value runtime.node.url)" "$(manifest_value runtime.node.sha256)" "$archive" "node-runtime"
  rm -rf "$NODE_DIR" && mkdir -p "$NODE_DIR"
  tar -xzf "$archive" -C "$NODE_DIR" --strip-components 1 || fail "NODE_EXTRACT_FAILED"
fi
[ "$("$NODE_DIR/bin/node" --version)" = "v$NODE_VERSION" ] || fail "NODE_VERSION_INVALID"

echo "[2/6] Private Python"
PYTHON_VERSION="$(manifest_value runtime.python.version)"
PYTHON_DIR="$COMPONENTS_ROOT/python"
PYTHON="$PYTHON_DIR/bin/python3"
if [ "$("$PYTHON" --version 2>/dev/null || true)" != "Python $PYTHON_VERSION" ]; then
  archive="$CACHE/cpython-$PYTHON_VERSION-aarch64-apple-darwin-install_only.tar.gz"
  verified_download "$(manifest_value runtime.python.url)" "$(manifest_value runtime.python.sha256)" "$archive" "python-runtime"
  rm -rf "$PYTHON_DIR" && mkdir -p "$PYTHON_DIR"
  # The archive holds one top-level "python/" directory.
  tar -xzf "$archive" -C "$PYTHON_DIR" --strip-components 1 || fail "PYTHON_EXTRACT_FAILED"
fi
[ "$("$PYTHON" --version)" = "Python $PYTHON_VERSION" ] || fail "PYTHON_VERSION_INVALID"

export PYTHONNOUSERSITE=1
export PIP_DISABLE_PIP_VERSION_CHECK=1

echo "[3/6] Pinned Python/ML packages"
if ! "$PYTHON" -X utf8 "$BOOTSTRAP/verify-python-package-set.py" "$MANIFEST" >"$LOGS/package-verifier.log" 2>&1; then
  "$PYTHON" -X utf8 -m pip install --quiet --no-warn-script-location --upgrade-strategy only-if-needed \
    -r "$REQUIREMENTS" >"$LOGS/pip-install.log" 2>&1 || { tail -40 "$LOGS/pip-install.log" >&2; fail "PYTHON_PACKAGES_FAILED"; }
  "$PYTHON" -X utf8 "$BOOTSTRAP/verify-python-package-set.py" "$MANIFEST" >"$LOGS/package-verifier.log" 2>&1 \
    || { cat "$LOGS/package-verifier.log" >&2; fail "PYTHON_PACKAGE_VERSION_MISMATCH"; }
fi
[ -x "$PYTHON_DIR/bin/uvx" ] || fail "UVX_MISSING"
"$PYTHON" -X utf8 -m pip freeze --all | sort >"$COMPONENTS_ROOT/python-dependency-tree.txt"

echo "[4/6] OCR/NER models"
MODELS="$COMPONENTS_ROOT/models"
models_ready() {
  [ -d "$MODELS/stanza/pl" ] || return 1
  for name in PP-LCNet_x1_0_doc_ori UVDoc PP-LCNet_x1_0_textline_ori PP-OCRv6_medium_det PP-OCRv6_medium_rec; do
    [ -d "$MODELS/paddle/official_models/$name" ] || return 1
  done
}
if ! models_ready; then
  mkdir -p "$MODELS"
  prefetched=0
  # Official model hosters, as on Windows; each attempt in a fresh process.
  for source in bos huggingface modelscope aistudio; do
    echo "Model prefetch via official source: $source"
    if PADDLE_PDX_MODEL_SOURCE="$source" "$PYTHON" -X utf8 "$BOOTSTRAP/prefetch-release-models.py" "$MODELS" \
      >"$LOGS/prefetch-$source.log" 2>&1; then
      prefetched=1
      break
    fi
    tail -5 "$LOGS/prefetch-$source.log" >&2 || true
  done
  [ "$prefetched" = 1 ] || fail "MODEL_PREFETCH_FAILED"
fi
models_ready || fail "MODELS_INCOMPLETE"

echo "[5/6] Integrity lock"
"$PYTHON" -X utf8 "$BOOTSTRAP/generate-component-lock.py" "$CODE_ROOT" "$COMPONENTS_ROOT" \
  || fail "COMPONENT_LOCK_FAILED"

echo "[6/6] Runtime self-test"
LEX_COMPONENTS_ROOT="$COMPONENTS_ROOT" "$CODE_ROOT/lex-runtime-sidecar" --self-test || fail "SELF_TEST_FAILED"

rm -rf "$CACHE"
echo "BOOTSTRAP_PASS components=$COMPONENTS_ROOT"
