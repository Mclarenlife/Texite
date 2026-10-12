"""Build the distributable offline runtime. Network is used at build time only."""
import hashlib
import json
import os
import platform
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.tools'
OUT = ROOT / 'runtime'
CACHE.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)
VERSION = '0.17.0'
BUNDLE_URL = 'https://data1b.fullyjustified.net/tlextras-2022.0r0.tar'
BUNDLE_SHA = '425685e124746c15ba9bb8e0596bdaad98fce886afa347fbcf9ec0e9acd7fe79'
TARGETS = {
    ('Windows', 'AMD64'): ('x86_64-pc-windows-msvc.zip', 'f61ce51f0b0ade1015b7de7ef368541c5424e9756ecbd0d7af97d6d48030845f'),
    ('Darwin', 'arm64'): ('aarch64-apple-darwin.tar.gz', 'a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667'),
    ('Darwin', 'x86_64'): ('x86_64-apple-darwin.tar.gz', '7c90ef5b6ddb1eb1937e4337add5237b79338e4b9676459fa91187d24d6cdf80'),
}

def sha(file):
    with file.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def fetch(url, file, expected=None):
    if not file.exists():
        partial = file.with_suffix(file.suffix + '.partial')
        subprocess.run(['curl.exe' if os.name == 'nt' else 'curl', '-fL', '--retry', '3', '-o', str(partial), url], check=True)
        partial.replace(file)
    if expected and sha(file) != expected:
        raise RuntimeError(f'Checksum mismatch: {file}. Remove the invalid cached file and retry.')

target, binary_sha = TARGETS[(platform.system(), platform.machine())]
archive = CACHE / f'tectonic-{VERSION}-{target}'
fetch(f'https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40{VERSION}/{archive.name}', archive, binary_sha)
binary = 'tectonic.exe' if os.name == 'nt' else 'tectonic'
if archive.suffix == '.zip':
    with zipfile.ZipFile(archive) as z:
        (OUT / binary).write_bytes(z.read(binary))
else:
    with tarfile.open(archive) as t:
        with t.extractfile(binary) as stream, (OUT / binary).open('wb') as dest:
            shutil.copyfileobj(stream, dest)
    (OUT / binary).chmod(0o755)

bundle = CACHE / 'texlive-bundle.tar'
fetch(BUNDLE_URL, bundle, BUNDLE_SHA)
output = OUT / 'texlive.zip'
# All resource bytes are preserved; ZIP is a local bundle format supported by Tectonic.
if not output.exists():
    partial = OUT / 'texlive.zip.partial'
    count = 0
    with tarfile.open(bundle) as t, zipfile.ZipFile(partial, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for member in t:
            if not member.isfile():
                continue
            with t.extractfile(member) as src:
                info = zipfile.ZipInfo(member.name, date_time=(2022, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                z.writestr(info, src.read())
            count += 1
    partial.replace(output)
    print(f'Packaged {count} TeX resources', flush=True)

licenses = OUT / 'licenses'
licenses.mkdir(exist_ok=True)
fetch(f'https://raw.githubusercontent.com/tectonic-typesetting/tectonic/tectonic%40{VERSION}/LICENSE', licenses / 'Tectonic-LICENSE.txt')
fetch('https://www.tug.org/texlive/LICENSE.TL', licenses / 'TeX-Live-LICENSE.txt')
fetch('https://www.tug.org/texlive/copying.html', licenses / 'TeX-Live-redistribution.html')
shutil.copyfile(ROOT / 'docs' / 'runtime-notices.txt', licenses / 'NOTICE.txt')
(OUT / 'manifest.json').write_text(json.dumps({
    'tectonic': VERSION, 'platform': target, 'binarySha256': sha(OUT / binary),
    'bundleSource': BUNDLE_URL, 'bundleSourceSha256': BUNDLE_SHA,
    'bundleSha256': sha(output), 'offline': True,
}, indent=2), encoding='utf-8')
print('Offline runtime ready:', OUT, flush=True)
