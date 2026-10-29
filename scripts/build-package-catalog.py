"""Generate the small bundled index for on-demand, pinned TeX Live downloads.

Only the verified upstream database is downloaded. No packages or installers are
built. Run again when deliberately upgrading the bundled TeX Live distribution.
"""
import gzip, hashlib, json, lzma, re, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE = 'https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final'
DATABASE_SHA = '56df038e9070a3d587eeceb5def3f154b2cacccef36d4295bb49e0618977c34a'

def main():
    database = ROOT / '.tools/texlive-2025.tlpdb.xz'
    database.parent.mkdir(parents=True, exist_ok=True)
    if not database.exists():
        subprocess.run(['curl', '-fsSL', '--retry', '3', '-o', str(database), BASE + '/tlpkg/texlive.tlpdb.xz'], check=True)
    if hashlib.sha256(database.read_bytes()).hexdigest() != DATABASE_SHA:
        raise RuntimeError('TeX Live database checksum mismatch')
    records = {}
    for block in lzma.decompress(database.read_bytes()).decode().split('\n\n'):
        lines = block.splitlines()
        if not lines or not lines[0].startswith('name '): continue
        name = lines[0][5:]; row = {}; section = ''; files = []
        for line in lines[1:]:
            if line and not line.startswith(' '):
                key, _, value = line.partition(' '); row.setdefault(key, []).append(value); section = key
            elif section == 'runfiles': files.append(line.strip())
        if row.get('category') != ['Package'] or not files or any(f.startswith('bin/') for f in files): continue
        if not re.fullmatch(r'[a-z][a-z0-9.-]{0,96}', name) or not row.get('containerchecksum'): continue
        paths = {}
        for file in files:
            p = file.replace('RELOC/', 'texmf-dist/', 1)
            if not p.startswith('texmf-dist/') or any('/'+d+'/' in p for d in ['doc','source','scripts']): continue
            if re.search(r'[\\:<>|?*\x00-\x1f]', p) or any(s in ['', '.', '..'] or s.endswith(('.', ' ')) or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', s, re.I) for s in p.split('/')): continue
            paths[p[len('texmf-dist/'):] if row.get('relocated') == ['1'] else p] = p
        if not paths: continue
        row['paths'] = paths; records[name] = row
    catalog = {'schema':1, 'texLive':'2025', 'databaseSha256':DATABASE_SHA, 'packages':{}, 'files':{}}
    for name, rec in records.items():
        mid = 'pkg-' + name
        catalog['packages'][mid] = {
            'label':name, 'dependencies':sorted({'pkg-'+d for d in rec.get('depend',[]) if d in records and d != name}),
            'archive':name+'.tar.xz', 'sha512':rec['containerchecksum'][0], 'bytes':int(rec['containersize'][0]),
            'paths':rec['paths'], 'maps':[v.split()[1] for v in rec.get('execute',[]) if re.match(r'add(?:Mixed)?Map ',v,re.I)],
        }
        for p in rec['paths'].values():
            catalog['files'].setdefault(Path(p).name, set()).add(mid)
    catalog['files'] = {name: sorted(ids) for name,ids in catalog['files'].items()}
    data = gzip.compress(json.dumps(catalog,sort_keys=True,separators=(',',':')).encode(),mtime=0)
    destination = ROOT/'apps/desktop/texlive-2025-catalog.json.gz'
    destination.write_bytes(data)
    print(json.dumps({'packages':len(records),'indexBytes':len(data),'destination':str(destination)}))

if __name__ == '__main__': main()
