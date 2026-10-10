#!/bin/bash
# Builds the macOS (Apple silicon) online installer:
#   Lex Machina.app (Tauri) with the thin runtime payload in Contents/Resources/runtime,
#   ad-hoc signed (no Apple Developer ID), wrapped in a .pkg whose postinstall
#   runs macos-online-bootstrap.sh as the logged-in user.
# Usage: build-macos-online.sh <output.pkg>
set -euo pipefail

OUTPUT="${1:?usage: build-macos-online.sh <output.pkg>}"
INSTALLER="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$INSTALLER/../.." && pwd)"
DESKTOP="$REPO/app/lex-desktop"
TAURI="$DESKTOP/src-tauri"
PAYLOAD="$TAURI/runtime"
WORK="$(mktemp -d)"

[ "$(uname -s)" = "Darwin" ] || { echo "macOS installer must be built on macOS" >&2; exit 1; }

# One version for the app, the manifests and the package (a missed bump would ship a .pkg
# whose receipt and manifest would disagree with the app inside).
VERSION="$(plutil -extract version raw -o - "$TAURI/tauri.conf.json")"
manifest_version="$(plutil -extract applicationVersion raw -o - "$INSTALLER/macos-release-source.json")"
# The release names the .pkg after the Windows manifest's version.
release_version="$(plutil -extract applicationVersion raw -o - "$INSTALLER/windows-release-source.json")"
distribution_version="$(sed -n 's/.*<pkg-ref id="pl.lexmachina.desktop" version="\([^"]*\)".*/\1/p' "$INSTALLER/macos/distribution.xml")"
[ -n "$VERSION" ] && [ "$manifest_version" = "$VERSION" ] && [ "$distribution_version" = "$VERSION" ] \
  && [ "$release_version" = "$VERSION" ] || {
  echo "VERSION_MISMATCH: tauri.conf.json=$VERSION macos-release-source.json=$manifest_version" \
    "distribution.xml=$distribution_version windows-release-source.json=$release_version" >&2
  exit 1
}

echo "[1/6] Runtime JS"
(cd "$REPO/app/lex-runtime" && npm install --no-audit --no-fund && npm run build)
rm -rf "$PAYLOAD" && mkdir -p "$PAYLOAD/app"
cp -R "$REPO/app/lex-runtime/dist" "$PAYLOAD/app/dist"
cp "$REPO/app/lex-runtime/package.json" "$PAYLOAD/app/"
(cd "$PAYLOAD/app" && npm install --omit=dev --ignore-scripts --no-audit --no-fund \
  && npm ls --omit=dev --all --json >"$PAYLOAD/npm-dependency-tree.json")

echo "[2/6] Workers, corpus, manifest and bootstrap"
cp -R "$REPO/app/ocr" "$PAYLOAD/ocr"
cp -R "$REPO/app/privacy" "$PAYLOAD/privacy"
cp -R "$REPO/app/storage" "$PAYLOAD/storage"
cp -R "$REPO/Wersja rozwojowa rozpakowana" "$PAYLOAD/corpus"
find "$PAYLOAD" -name "__pycache__" -type d -prune -exec rm -rf {} +
# MCP connector package must match the skill's CHECKSUMS.sha256 byte for byte.
expected="$(awk '$2=="./mcp-servers/dist/lex-mcp.mjs"{print $1}' "$PAYLOAD/corpus/audyt-systemu-v4/CHECKSUMS.sha256")"
actual="$(shasum -a 256 "$PAYLOAD/corpus/audyt-systemu-v4/mcp-servers/dist/lex-mcp.mjs" | cut -d' ' -f1)"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "MCP_BUNDLE_CHECKSUM_MISMATCH: $actual != $expected" >&2; exit 1; }
cp "$REPO/LICENSE" "$PAYLOAD/LICENSE.txt"
cp "$REPO/POLITYKA-PRYWATNOSCI.md" "$PAYLOAD/POLITYKA-PRYWATNOSCI.md"
cp "$INSTALLER/macos-release-source.json" "$PAYLOAD/release-source.json"
cp "$INSTALLER/windows-release-requirements.txt" "$PAYLOAD/release-requirements.txt"
mkdir -p "$PAYLOAD/bootstrap"
for file in macos-online-bootstrap.sh generate-component-lock.py prefetch-release-models.py verify-python-package-set.py; do
  cp "$INSTALLER/$file" "$PAYLOAD/bootstrap/$file"
done
chmod +x "$PAYLOAD/bootstrap/macos-online-bootstrap.sh"

echo "[3/6] Native runtime sidecar"
(cd "$DESKTOP" && cargo build --release --bin lex-runtime-sidecar --manifest-path src-tauri/Cargo.toml)
cp "$TAURI/target/release/lex-runtime-sidecar" "$PAYLOAD/lex-runtime-sidecar"
chmod +x "$PAYLOAD/lex-runtime-sidecar"

echo "[4/6] Tauri app bundle"
(cd "$REPO/app/lex-web" && npm install --no-audit --no-fund)
(cd "$DESKTOP" && npm install --no-audit --no-fund && npx tauri build --bundles app)
APP="$TAURI/target/release/bundle/macos/Lex Machina.app"
[ -d "$APP" ] || { echo "APP_BUNDLE_MISSING" >&2; exit 1; }
RUNTIME="$APP/Contents/Resources/runtime"
for required in app/dist/http/server.js lex-runtime-sidecar release-source.json release-requirements.txt \
  bootstrap/macos-online-bootstrap.sh bootstrap/generate-component-lock.py corpus/prawny-router-v3/SKILL.md; do
  [ -e "$RUNTIME/$required" ] || { echo "PAYLOAD_REQUIRED_FILE_MISSING:$required" >&2; exit 1; }
done
chmod +x "$RUNTIME/lex-runtime-sidecar" "$RUNTIME/bootstrap/macos-online-bootstrap.sh"

echo "[5/6] Ad-hoc signature"
codesign --force --sign - "$RUNTIME/lex-runtime-sidecar"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "[6/6] Installer package"
mkdir -p "$WORK/root/Applications"
ditto "$APP" "$WORK/root/Applications/Lex Machina.app"
pkgbuild --analyze --root "$WORK/root" "$WORK/components.plist"
# Always install into /Applications, never relocate onto another copy of the app.
plutil -replace 0.BundleIsRelocatable -bool NO "$WORK/components.plist"
pkgbuild --root "$WORK/root" --component-plist "$WORK/components.plist" \
  --scripts "$INSTALLER/macos/scripts" --identifier pl.lexmachina.desktop --version "$VERSION" \
  --install-location / "$WORK/LexMachina-component.pkg"
mkdir -p "$WORK/resources"
cp "$INSTALLER/macos/welcome.html" "$WORK/resources/welcome.html"
productbuild --distribution "$INSTALLER/macos/distribution.xml" --package-path "$WORK" \
  --resources "$WORK/resources" "$OUTPUT"
rm -rf "$WORK"
echo "Installer: $OUTPUT"
