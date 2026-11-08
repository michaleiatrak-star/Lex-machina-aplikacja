#!/bin/bash
# Lex Machina - online bootstrap for macOS (Apple silicon).
#
# Runs as the logged-in user from the native preparation window. Downloads
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
export PYTHONDONTWRITEBYTECODE=1

CODE_ROOT="${1:?usage: macos-online-bootstrap.sh <code-root> [components-root]}"
COMPONENTS_ROOT="${2:-$HOME/Library/Application Support/LexMachina/runtime}"
MANIFEST="$CODE_ROOT/release-source.json"
REQUIREMENTS="$CODE_ROOT/release-requirements.txt"
BOOTSTRAP="$CODE_ROOT/bootstrap"
CACHE="$COMPONENTS_ROOT/.download-cache"
LOGS="$COMPONENTS_ROOT/bootstrap-logs"
# Offline package (build-macos-online.sh with LEX_MACOS_OFFLINE=1): the same components inside
# the app, verified by the same SHA-256 pins; no download, no package index.
OFFLINE="$CODE_ROOT/offline"
[ -d "$OFFLINE" ] && echo "OFFLINE_BUNDLE: $OFFLINE"

fail() {
  echo "BOOTSTRAP_FAILED:$1" >&2
  exit 1
}

[ "$(uname -s)" = "Darwin" ] || fail "NOT_MACOS"
[ "$(uname -m)" = "arm64" ] || fail "APPLE_SILICON_REQUIRED:$(uname -m)"
[ -f "$MANIFEST" ] || fail "MANIFEST_MISSING:$MANIFEST"
[ -f "$REQUIREMENTS" ] || fail "REQUIREMENTS_MISSING:$REQUIREMENTS"

mkdir -p "$COMPONENTS_ROOT" "$CACHE" "$LOGS"
# A single preparation owns these directories. A crashed owner's lock can be reclaimed.
LOCK="$COMPONENTS_ROOT/.setup-lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  owner="$(cat "$LOCK/pid" 2>/dev/null || true)"
  if [ -z "$owner" ] || kill -0 "$owner" 2>/dev/null; then fail "SETUP_ALREADY_RUNNING"; fi
  rm -rf "$LOCK"
  mkdir "$LOCK" || fail "SETUP_LOCK_FAILED"
fi
echo "$$" > "$LOCK/pid"
# Restore replaced environments if any later step fails (including a failed health check).
cleanup() {
  result=$?
  if [ "$result" != 0 ]; then
    for component in node python; do
      if [ -d "$COMPONENTS_ROOT/$component.previous" ]; then
        rm -rf "$COMPONENTS_ROOT/$component"
        mv "$COMPONENTS_ROOT/$component.previous" "$COMPONENTS_ROOT/$component"
      fi
    done
    if [ -f "$COMPONENTS_ROOT/component-lock.previous.json" ]; then
      mv "$COMPONENTS_ROOT/component-lock.previous.json" "$COMPONENTS_ROOT/component-lock.json"
    else
      rm -f "$COMPONENTS_ROOT/component-lock.json"
    fi
  fi
  rm -rf "$LOCK"
}
# Recover backups left by a terminated preparation before starting another attempt.
for component in node python; do
  if [ -d "$COMPONENTS_ROOT/$component.previous" ]; then
    rm -rf "$COMPONENTS_ROOT/$component"
    mv "$COMPONENTS_ROOT/$component.previous" "$COMPONENTS_ROOT/$component"
  fi
done
if [ -f "$COMPONENTS_ROOT/component-lock.previous.json" ]; then
  mv "$COMPONENTS_ROOT/component-lock.previous.json" "$COMPONENTS_ROOT/component-lock.json"
fi
[ ! -f "$COMPONENTS_ROOT/component-lock.json" ] || cp "$COMPONENTS_ROOT/component-lock.json" "$COMPONENTS_ROOT/component-lock.previous.json"
trap cleanup EXIT
trap 'exit 130' INT TERM
progress() {
  # Fixed application-owned labels only; no arbitrary subprocess output enters the UI.
  printf '{"step":%s,"message":"%s","received":%s}\n' "$1" "$2" "${3:-0}" > "$COMPONENTS_ROOT/setup-progress.json.tmp"
  mv "$COMPONENTS_ROOT/setup-progress.json.tmp" "$COMPONENTS_ROOT/setup-progress.json"
}
healthy() {
  [ -x "$COMPONENTS_ROOT/python/bin/python3" ] &&
    "$COMPONENTS_ROOT/python/bin/python3" "$BOOTSTRAP/macos-component-state.py" "$COMPONENTS_ROOT" "$MANIFEST" "$1"
}
progress 1 "Sprawdzam, które narzędzia są już gotowe…"

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
  rm -f "$target"
  if [ -f "$OFFLINE/downloads/$(basename "$target")" ]; then
    echo "Using offline bundle: $label"
    cp "$OFFLINE/downloads/$(basename "$target")" "$target.part" || fail "OFFLINE_COPY_FAILED:$label"
  elif [ -d "$OFFLINE" ]; then
    fail "OFFLINE_COMPONENT_MISSING:$label"
  else
    echo "Downloading $label"
    curl -fL --retry 4 --retry-delay 3 --connect-timeout 30 --speed-time 90 --speed-limit 1024 -C - -o "$target.part" "$url" &
    transfer=$!
    while kill -0 "$transfer" 2>/dev/null; do
      received="$(stat -f%z "$target.part" 2>/dev/null || echo 0)"
      progress 2 "Pobieram narzędzia potrzebne do działania aplikacji…" "$received"
      sleep 1
    done
    # Some servers do not support ranges. Retry from zero only for that case.
    result=0; wait "$transfer" || result=$?
    if [ "$result" = 33 ]; then
      rm -f "$target.part"
      curl -fL --retry 3 --connect-timeout 30 --speed-time 90 --speed-limit 1024 -o "$target.part" "$url" || fail "DOWNLOAD_FAILED:$label"
    elif [ "$result" != 0 ]; then fail "DOWNLOAD_FAILED:$label"; fi
  fi
  local actual
  actual="$(shasum -a 256 "$target.part" | cut -d' ' -f1)"
  [ "$actual" = "$expected" ] || { rm -f "$target.part"; fail "HASH_MISMATCH:$label expected=$expected actual=$actual"; }
  mv "$target.part" "$target"
}

echo "[1/6] Private Node"
NODE_VERSION="$(manifest_value runtime.node.version)"
NODE_DIR="$COMPONENTS_ROOT/node"
if [ "$("$NODE_DIR/bin/node" --version 2>/dev/null || true)" != "v$NODE_VERSION" ] || ! healthy node; then
  archive="$CACHE/node-v$NODE_VERSION-darwin-arm64.tar.gz"
  verified_download "$(manifest_value runtime.node.url)" "$(manifest_value runtime.node.sha256)" "$archive" "node-runtime"
  progress 2 "Przygotowuję podstawowe narzędzia aplikacji…"
  rm -rf "$NODE_DIR.next"; mkdir -p "$NODE_DIR.next"
  tar -xzf "$archive" -C "$NODE_DIR.next" --strip-components 1 || fail "NODE_EXTRACT_FAILED"
  [ "$("$NODE_DIR.next/bin/node" --version)" = "v$NODE_VERSION" ] || fail "NODE_VERSION_INVALID"
  rm -rf "$NODE_DIR.previous"
  [ ! -d "$NODE_DIR" ] || mv "$NODE_DIR" "$NODE_DIR.previous"
  mv "$NODE_DIR.next" "$NODE_DIR"
else
  progress 2 "Podstawowe narzędzia są aktualne — pomijam pobieranie."

fi
[ "$("$NODE_DIR/bin/node" --version)" = "v$NODE_VERSION" ] || fail "NODE_VERSION_INVALID"

echo "[2/6] Private Python"
PYTHON_VERSION="$(manifest_value runtime.python.version)"
PYTHON_DIR="$COMPONENTS_ROOT/python"
PYTHON="$PYTHON_DIR/bin/python3"
if [ "$("$PYTHON" --version 2>/dev/null || true)" != "Python $PYTHON_VERSION" ] || ! healthy python; then
  archive="$CACHE/cpython-$PYTHON_VERSION-aarch64-apple-darwin-install_only.tar.gz"
  verified_download "$(manifest_value runtime.python.url)" "$(manifest_value runtime.python.sha256)" "$archive" "python-runtime"
  progress 3 "Przygotowuję narzędzia do odczytywania dokumentów…"
  rm -rf "$PYTHON_DIR.next"; mkdir -p "$PYTHON_DIR.next"
  # The archive holds one top-level "python/" directory.
  tar -xzf "$archive" -C "$PYTHON_DIR.next" --strip-components 1 || fail "PYTHON_EXTRACT_FAILED"
  [ "$("$PYTHON_DIR.next/bin/python3" --version)" = "Python $PYTHON_VERSION" ] || fail "PYTHON_VERSION_INVALID"
  rm -rf "$PYTHON_DIR.previous"
  [ ! -d "$PYTHON_DIR" ] || mv "$PYTHON_DIR" "$PYTHON_DIR.previous"
  mv "$PYTHON_DIR.next" "$PYTHON_DIR"
fi
[ "$("$PYTHON" --version)" = "Python $PYTHON_VERSION" ] || fail "PYTHON_VERSION_INVALID"

export PYTHONNOUSERSITE=1
export PIP_DISABLE_PIP_VERSION_CHECK=1

echo "[3/6] Pinned Python/ML packages"
progress 3 "Sprawdzam narzędzia do odczytywania dokumentów…"
if ! "$PYTHON" -X utf8 "$BOOTSTRAP/verify-python-package-set.py" "$MANIFEST" >"$LOGS/package-verifier.log" 2>&1; then
  if [ ! -d "$PYTHON_DIR.previous" ]; then
    rm -rf "$PYTHON_DIR.backup-next"
    ditto "$PYTHON_DIR" "$PYTHON_DIR.backup-next" || fail "BACKUP_FAILED"
    mv "$PYTHON_DIR.backup-next" "$PYTHON_DIR.previous"
  fi
  progress 3 "Uzupełniam narzędzia do odczytywania dokumentów. To może potrwać kilka minut…"
  offline_index=()
  [ -d "$OFFLINE/wheels" ] && offline_index=(--no-index --find-links "$OFFLINE/wheels")
  "$PYTHON" -X utf8 -m pip install --quiet --no-warn-script-location --upgrade-strategy only-if-needed \
    ${offline_index[@]+"${offline_index[@]}"} -r "$REQUIREMENTS" >"$LOGS/pip-install.log" 2>&1 || { tail -40 "$LOGS/pip-install.log" >&2; fail "PYTHON_PACKAGES_FAILED"; }
  "$PYTHON" -X utf8 "$BOOTSTRAP/verify-python-package-set.py" "$MANIFEST" >"$LOGS/package-verifier.log" 2>&1 \
    || { cat "$LOGS/package-verifier.log" >&2; fail "PYTHON_PACKAGE_VERSION_MISMATCH"; }
fi
[ -x "$PYTHON_DIR/bin/uvx" ] || fail "UVX_MISSING"
"$PYTHON" -X utf8 -m pip freeze --all | sort >"$COMPONENTS_ROOT/python-dependency-tree.txt"

echo "[4/6] OCR/NER models"
progress 4 "Sprawdzam rozpoznawanie tekstu i danych osobowych…"
MODELS="$COMPONENTS_ROOT/models"
STANZA_READY="$("$PYTHON" "$BOOTSTRAP/macos-model-state.py" "$COMPONENTS_ROOT" "$MANIFEST")"
models_ready() {
  [ "$STANZA_READY" = 1 ] || return 1
  # latin_PP-OCRv5_mobile_rec is optional: missing, the prefetch runs again, never fails on it.
  for name in PP-LCNet_x1_0_doc_ori UVDoc PP-LCNet_x1_0_textline_ori PP-OCRv6_medium_det PP-OCRv6_medium_rec "${1:-}"; do
    [ -n "$name" ] || continue
    [ -f "$MODELS/paddle/official_models/$name/inference.pdiparams" ] || return 1
    [ -f "$MODELS/paddle/official_models/$name/inference.yml" ] || return 1
  done
}
if ! models_ready && [ -d "$OFFLINE/models" ]; then
  echo "Using offline bundle: models"
  mkdir -p "$MODELS"
  ditto "$OFFLINE/models" "$MODELS" || fail "OFFLINE_MODELS_COPY_FAILED"
  STANZA_READY=1
fi
if ! models_ready && [ -d "$OFFLINE" ]; then
  models_ready || fail "OFFLINE_MODELS_INCOMPLETE"
elif ! models_ready; then
  mkdir -p "$MODELS"
  # PaddleX treats an existing model directory as downloaded: drop partial ones.
  for name in PP-LCNet_x1_0_doc_ori UVDoc PP-LCNet_x1_0_textline_ori PP-OCRv6_medium_det PP-OCRv6_medium_rec latin_PP-OCRv5_mobile_rec; do
    dir="$MODELS/paddle/official_models/$name"
    if [ -d "$dir" ] && { [ ! -f "$dir/inference.pdiparams" ] || [ ! -f "$dir/inference.yml" ]; }; then
      rm -rf "$dir"
    fi
  done
  progress 4 "Pobieram brakujące narzędzia do rozpoznawania tekstu i danych osobowych…"
  prefetched=0
  # Official model hosters, as on Windows; each attempt in a fresh process.
  for source in bos huggingface modelscope aistudio; do
    echo "Model prefetch via official source: $source"
    if LEX_PREFETCH_SKIP_STANZA="$STANZA_READY" LEX_PREFETCH_SKIP_OPTIONAL=1 PADDLE_PDX_MODEL_SOURCE="$source" "$PYTHON" -X utf8 "$BOOTSTRAP/prefetch-release-models.py" "$MODELS" \
      >"$LOGS/prefetch-$source.log" 2>&1; then
      prefetched=1
      STANZA_READY=1
      break
    fi
    tail -5 "$LOGS/prefetch-$source.log" >&2 || true
  done
  [ "$prefetched" = 1 ] || fail "MODEL_PREFETCH_FAILED"
fi
models_ready || fail "MODELS_INCOMPLETE"

echo "[5/6] Integrity lock"
progress 5 "Sprawdzam kompletność przygotowanych plików…"
"$PYTHON" -X utf8 "$BOOTSTRAP/generate-component-lock.py" "$CODE_ROOT" "$COMPONENTS_ROOT" \
  || fail "COMPONENT_LOCK_FAILED"

echo "[6/6] Runtime self-test"
progress 6 "Sprawdzam, czy aplikacja jest gotowa do pracy…"
LEX_COMPONENTS_ROOT="$COMPONENTS_ROOT" "$CODE_ROOT/lex-runtime-sidecar" --self-test || fail "SELF_TEST_FAILED"

# Keep only the current runtime archives for a retry/repair (bounded to two archives).
find "$CACHE" -maxdepth 1 -type f ! -name "node-v$NODE_VERSION-darwin-arm64.tar.gz" ! -name "cpython-$PYTHON_VERSION-aarch64-apple-darwin-install_only.tar.gz" -delete
rm -rf "$NODE_DIR.previous" "$PYTHON_DIR.previous"
rm -f "$COMPONENTS_ROOT/component-lock.previous.json"
progress 6 "Wszystko gotowe. Możesz otworzyć Lex Machina."
echo "BOOTSTRAP_PASS components=$COMPONENTS_ROOT"
