"""Synthetic macOS installation tests. No real downloads, Keychain or user data."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

INSTALLER = Path(__file__).resolve().parent

class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lex-bootstrap-')
        self.base = Path(self.temp.name)
        self.code = self.base / 'code with spaces'
        self.root = self.base / 'components with spaces'
        self.code.mkdir(); self.root.mkdir()
        bootstrap = self.code / 'bootstrap'; bootstrap.mkdir()
        for name in ('macos-online-bootstrap.sh', 'macos-component-state.py', 'macos-model-state.py', 'generate-component-lock.py'):
            shutil.copy(INSTALLER / name, bootstrap / name)
        (bootstrap / 'verify-python-package-set.py').write_text('import os,sys\nsys.exit(int(os.environ.get("TEST_PACKAGES_FAIL", "0")))\n')
        (bootstrap / 'prefetch-release-models.py').write_text('''import os,sys
from pathlib import Path
root=Path(sys.argv[1])
(root/'prefetch-called').write_text(os.environ.get('LEX_PREFETCH_SKIP_STANZA',''))
for file in ('inference.pdiparams','inference.yml'):
 p=root/'paddle/official_models/UVDoc'/file
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text('valid')
''')
        self.executable(self.root / 'node/bin/node', '#!/bin/bash\necho v24.21.0\n')
        self.executable(self.root / 'python/bin/python3', f'''#!/bin/bash
if [ "$1" = --version ]; then echo 'Python 3.13.16'; exit 0; fi
if [ "$1" = -X ]; then shift 2; fi
if [ "$1" = -m ] && [ "$2" = pip ]; then
  if [ "$3" = install ]; then exit 1; fi
  exit 0
fi
exec '{sys.executable}' "$@"
''')
        self.executable(self.root / 'python/bin/uvx', '#!/bin/bash\nexit 0\n')
        self.executable(self.code / 'lex-runtime-sidecar', '#!/bin/bash\nexit "${TEST_HEALTH_FAIL:-0}"\n')
        for top in ('app','corpus','ocr','privacy','storage'):
            (self.code / top).mkdir(); (self.code / top / 'file').write_text('code')
        self.names = ['PP-LCNet_x1_0_doc_ori','UVDoc','PP-LCNet_x1_0_textline_ori','PP-OCRv6_medium_det','PP-OCRv6_medium_rec']
        for name in self.names:
            for file in ('inference.pdiparams','inference.yml'):
                p=self.root/'models/paddle/official_models'/name/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('valid')
        for kind in ('tokenize','ner','pretrain'):
            p=self.root/'models/stanza/pl'/kind/'default.pt';p.parent.mkdir(parents=True,exist_ok=True);p.write_text('valid')
        manifest={'applicationVersion':'0.1.70','runtime':{'node':{'version':'24.21.0','sha256':'a'*64,'url':'https://invalid.test/node'},'python':{'version':'3.13.16','sha256':'b'*64,'url':'https://invalid.test/python'}},'models':{'paddle':self.names}}
        (self.code/'release-source.json').write_text(json.dumps(manifest))
        (self.code/'release-requirements.txt').write_text('')
        self.bin=self.base/'bin';self.bin.mkdir()
        self.executable(self.bin/'curl', '#!/bin/bash\necho "UNEXPECTED_DOWNLOAD" >&2\nexit 99\n')
        subprocess.run([sys.executable,str(bootstrap/'generate-component-lock.py'),str(self.code),str(self.root)],check=True,capture_output=True)
    def tearDown(self):
        self.temp.cleanup()
    def executable(self,path,text):
        path.parent.mkdir(parents=True,exist_ok=True);path.write_text(text);path.chmod(0o755)
    def run_bootstrap(self, **env):
        return subprocess.run(['/bin/bash',str(self.code/'bootstrap/macos-online-bootstrap.sh'),str(self.code),str(self.root)],env={**os.environ,'PATH':str(self.bin)+':'+os.environ['PATH'],**env},capture_output=True,text=True,timeout=30)
    def test_ready_installation_downloads_nothing_even_without_optional_model(self):
        for _ in range(2):
            result=self.run_bootstrap()
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            self.assertNotIn('UNEXPECTED_DOWNLOAD',result.stderr)
            self.assertFalse((self.root/'models/prefetch-called').exists())
        self.assertIn('Wszystko gotowe',json.loads((self.root/'setup-progress.json').read_text())['message'])
    def test_damaged_ocr_model_keeps_other_models_and_skips_stanza(self):
        damaged=self.root/'models/paddle/official_models/UVDoc/inference.yml';damaged.write_text('bad')
        untouched=self.root/'models/paddle/official_models/PP-OCRv6_medium_rec/inference.pdiparams';before=untouched.stat().st_mtime_ns
        result=self.run_bootstrap()
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)
        self.assertEqual((self.root/'models/prefetch-called').read_text(),'1')
        self.assertEqual(untouched.stat().st_mtime_ns,before)
        self.assertEqual(damaged.read_text(),'valid')
    def test_package_failure_restores_previous_environment_and_receipt(self):
        old=(self.root/'component-lock.json').read_bytes()
        result=self.run_bootstrap(TEST_PACKAGES_FAIL='1')
        self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/'python/bin/python3').exists())
        self.assertEqual((self.root/'component-lock.json').read_bytes(),old)
        self.assertFalse((self.root/'.setup-lock').exists())
    def test_incomplete_backup_never_replaces_healthy_environment(self):
        self.executable(self.bin/'ditto', '#!/bin/bash\nmkdir -p "$2"\necho partial > "$2/partial"\nexit 1\n')
        original=(self.root/'python/bin/python3').read_bytes()
        result=self.run_bootstrap(TEST_PACKAGES_FAIL='1')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((self.root/'python/bin/python3').read_bytes(),original)
        self.assertFalse((self.root/'python.previous').exists())
    def test_failed_health_check_does_not_commit_new_receipt(self):
        old=(self.root/'component-lock.json').read_bytes()
        result=self.run_bootstrap(TEST_HEALTH_FAIL='1')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual((self.root/'component-lock.json').read_bytes(),old)
    def test_live_preparation_cannot_be_started_twice(self):
        lock=self.root/'.setup-lock';lock.mkdir();(lock/'pid').write_text(str(os.getpid()))
        result=self.run_bootstrap()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('SETUP_ALREADY_RUNNING',result.stdout+result.stderr)
        self.assertTrue(lock.exists())

if __name__ == '__main__': unittest.main()
