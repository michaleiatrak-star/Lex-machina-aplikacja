"""Invalidate only damaged model files; library downloaders reuse the remaining verified files."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys

spec = importlib.util.spec_from_file_location('component_state', Path(__file__).with_name('macos-component-state.py'))
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)
root = Path(sys.argv[1])
manifest = json.loads(Path(sys.argv[2]).read_text())
try:
    lock = json.loads((root / 'component-lock.json').read_text())
except (OSError, ValueError):
    lock = {}
for name in manifest['models']['paddle']:
    prefix = f'models/paddle/official_models/{name}'
    directory = root / prefix
    recorded = any(row['path'].startswith(prefix + '/') for row in lock.get('files', []))
    complete = all((directory / file).is_file() for file in ('inference.pdiparams', 'inference.yml'))
    if directory.exists() and (not complete or (recorded and not state.healthy(root, lock, prefix))):
        shutil.rmtree(directory)
# Stanza verifies existing model files against its resource manifest. Remove only damaged files
# here, retaining other language resources so a missing OCR model never refreshes Stanza.
stanza = root / 'models/stanza'
stanza_damaged = False
for row in lock.get('files', []):
    if not row['path'].startswith('models/stanza/') or '..' in Path(row['path']).parts:
        continue
    file = root / row['path']
    try:
        import hashlib
        with file.open('rb') as stream:
            valid = file.stat().st_size == row['bytes'] and hashlib.file_digest(stream, 'sha256').hexdigest() == row['sha256']
        if not valid:
            stanza_damaged = True
            file.unlink()
    except OSError:
        stanza_damaged = True
ready = not stanza_damaged and all(any((stanza / 'pl' / kind).glob('*.pt')) for kind in ('tokenize', 'ner', 'pretrain'))
print('1' if ready else '0')
