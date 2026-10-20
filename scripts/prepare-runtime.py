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
from runtime_profile import select_resources

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.tools'
OUT = ROOT / 'runtime'
CACHE.mkdir(exist_ok=True)
OUT.mkdir(exist_ok=True)
VERSION = '0.17.0'
BUNDLE_URL = 'https://data1b.fullyjustified.net/tlextras-2022.0r0.tar'
BUNDLE_SHA = '425685e124746c15ba9bb8e0596bdaad98fce886afa347fbcf9ec0e9acd7fe79'
DATABASE_URL = 'https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2022/tlnet-final/tlpkg/texlive.tlpdb.xz'
DATABASE_SHA = 'be6ec39a41ff875f37a4dfaab75a75c19ea9793d9370c93f69ed27097b02a0cc'
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
database = CACHE / 'texlive-2022.tlpdb.xz'
fetch(DATABASE_URL, database, DATABASE_SHA)
policy, selected, packages, policy_sha = select_resources(ROOT / 'scripts/runtime-profile.json', database)
output = OUT / 'texlive.zip'
# Rebuild from the pinned source so cached bundles cannot bypass profile changes.
partial = OUT / 'texlive.zip.partial'
inventory, fingerprint = {}, hashlib.sha256()
with tarfile.open(bundle) as t, zipfile.ZipFile(partial, 'w', zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
    def write(name, data):
        if name in inventory:
            raise ValueError(f'Duplicate bundle file: {name}')
        info = zipfile.ZipInfo(name, date_time=(2022, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)
        digest = hashlib.sha256(data).hexdigest()
        inventory[name] = {'bytes': len(data), 'sha256': digest}
        fingerprint.update(name.encode() + b'\0' + bytes.fromhex(digest))

    for member in t:
        if not member.isfile() or member.name == 'SHA256SUM':
            continue
        if member.name not in selected and not member.name.endswith(tuple(policy['keepSuffixes'])) and not member.name.startswith(tuple(policy['keepPrefixes'])):
            continue
        with t.extractfile(member) as src:
            data = src.read()
        if member.name == 'ctexopts.cfg':
            # Use redistributable bundled fonts on Windows and macOS alike.
            # Explicit fontset=... in the user's document still takes precedence.
            configuration = b'\n% Texite default: bundled, platform-independent Chinese fonts.\n\\ctex_set:nn { option } { fontset = fandol }\n'
            # This upstream config ends at EOF, not necessarily \\endinput.
            # A no-op replacement silently keeps macOS's system-font preset.
            if b'\\endinput' in data:
                data = data.replace(b'\\endinput', configuration + b'\\endinput', 1)
            else:
                data += configuration
        write(member.name, data)
    missing = set(policy['requiredFiles']) - inventory.keys()
    if missing:
        raise RuntimeError(f'Required resources missing: {sorted(missing)}')
    # Give the trimmed bundle its own cache identity to avoid reusing incompatible formats.
    bundle_identity = fingerprint.hexdigest()
    write('SHA256SUM', bundle_identity.encode())
if partial.stat().st_size > policy['resourceBudgetBytes']:
    raise RuntimeError(f'Runtime exceeds size budget: {partial.stat().st_size} bytes')
partial.replace(output)
inventory_path = OUT / 'inventory.json'
inventory_path.write_text(json.dumps(inventory, sort_keys=True, separators=(',', ':')), encoding='utf-8')
print(f'Packaged {len(inventory)} resources from {len(packages)} packages: {output.stat().st_size / 1e6:.1f} MB', flush=True)

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
    'profile': policy['profile'], 'policySha256': policy_sha,
    'databaseSource': DATABASE_URL, 'databaseSha256': DATABASE_SHA,
    'resourceCount': len(inventory), 'resourceBytes': output.stat().st_size,
    'bundleIdentity': bundle_identity, 'packages': packages,
    'inventorySha256': sha(inventory_path),
}, indent=2), encoding='utf-8')
print('Offline runtime ready:', OUT, flush=True)
