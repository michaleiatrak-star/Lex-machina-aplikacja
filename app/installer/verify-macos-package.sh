#!/bin/bash
set -euo pipefail
package="${1:?Provide the installer package path}"
work="$(mktemp -d "${TMPDIR:-/tmp}/lex-package-check.XXXXXX")"
trap 'rm -rf "$work"' EXIT
pkgutil --expand-full "$package" "$work/expanded"
script="$work/expanded/LexMachina-component.pkg/Scripts/postinstall"
if [ ! -f "$script" ] || [ ! -x "$script" ]; then
  echo "Installer postinstall script is missing or not executable" >&2
  exit 1
fi
[ "$(head -n 1 "$script")" = '#!/bin/bash' ] || { echo 'Invalid postinstall interpreter' >&2; exit 1; }
bash -n "$script"
codesign --verify --deep --strict "$work/expanded/LexMachina-component.pkg/Payload/Applications/Lex Machina.app"
echo 'MACOS_PACKAGE_CHECK_PASS'
