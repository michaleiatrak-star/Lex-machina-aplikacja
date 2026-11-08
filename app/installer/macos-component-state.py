"""Check installed components against the last successful installation before reusing them.
No networking, imports of ML libraries, or writes to user documents.
"""
import hashlib
import json
from pathlib import Path
import sys


def healthy(root, lock, prefix):
    rows = [r for r in lock.get('files', []) if r['path'].startswith(prefix + '/')]
    if not rows:
        return False
    for row in rows:
        file = root / row['path']
        if not file.is_relative_to(root) or '..' in Path(row['path']).parts:
            return False
        try:
            if file.stat().st_size != row['bytes']:
                return False
            with file.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != row['sha256']:
                    return False
        except OSError:
            return False
    return True


def main():
    root, manifest_path, component = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    try:
        lock = json.loads((root / 'component-lock.json').read_text())
        manifest = json.loads(manifest_path.read_text())
    except (OSError, ValueError):
        return 1
    # New installations bind their receipts to the desired component definitions as well.
    previous = lock.get('installerInputs', {})
    desired = manifest['runtime'].get(component) if component in ('node', 'python') else None
    if component in previous and previous[component] != desired:
        return 1
    return 0 if healthy(root, lock, component) else 1

if __name__ == '__main__':
    sys.exit(main())
