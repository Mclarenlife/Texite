"""Prepare pinned offline Android pdfLaTeX assets; never download at runtime."""
import hashlib
import json
from pathlib import Path
import shutil
import urllib.request
import zipfile
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / '.tools/android-runtime'
CACHE = ROOT / '.tools/android-busytex'
TAG = 'build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1'
BASE = f'https://github.com/busytex/busytex/releases/download/{TAG}/'

def prepare():
    OUT.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    lock = json.loads((ROOT / 'apps/mobile/runtime-lock.json').read_text())
    for name, expected in lock['assets'].items():
        source = CACHE / name
        if not source.exists():
            urllib.request.urlretrieve(BASE + name, source)
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected:
            raise SystemExit(f'Runtime integrity check failed: {name}')
        shutil.copyfile(source, OUT / name)
    records, data, maps = [], bytearray(), []
    with zipfile.ZipFile(ROOT / 'runtime/default.texite-runtime.zip') as archive:
        for entry in archive.infolist():
            if entry.filename.split('/')[0] not in ('pkg-cjk', 'pkg-arphic', 'pkg-cjkpunct'):
                continue
            if '/texmf-dist/' not in entry.filename or entry.is_dir():
                continue
            relative = entry.filename.split('/texmf-dist/', 1)[1]
            content = archive.read(entry)
            records.append({'path': relative, 'start': len(data), 'end': len(data) + len(content)})
            data.extend(content)
            if relative.endswith('.map') and '/dvips/' in relative:
                maps.append(content.decode('utf-8'))
    (OUT / 'chinese.data').write_bytes(data)
    (OUT / 'chinese.json').write_text(json.dumps({'files': records, 'maps': '\n'.join(maps)}), encoding='utf-8')
    shutil.copyfile(ROOT / 'apps/mobile/offline-worker.js', OUT / 'worker.js')
    shutil.copyfile(ROOT / 'docs/android-runtime-notices.md', OUT / 'NOTICES.md')
    shutil.copyfile(ROOT / 'LICENSE', OUT / 'Texite-LICENSE.txt')
    shutil.copyfile(ROOT / 'NOTICE', OUT / 'Texite-NOTICE.txt')
    shutil.copytree(ROOT / 'runtime/licenses', OUT / 'licenses', dirs_exist_ok=True)
    print(f'Android runtime: {sum(p.stat().st_size for p in OUT.iterdir() if p.is_file()) / 1024**2:.1f} MiB before APK compression')
if __name__ == '__main__':
    prepare()
