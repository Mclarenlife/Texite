"""Wrap the legacy, tested Tectonic runtime as an optional importable engine."""
import hashlib
import json
import os
import platform
import zipfile
from pathlib import Path
root = Path(__file__).resolve().parent.parent
runtime = root / 'runtime'
target = 'win32-x64' if os.name == 'nt' else 'darwin-' + platform.machine()
output = root / 'release/engine-packs' / f'Texite-0.5.0-tectonic-{target}.texite-runtime.zip'
output.parent.mkdir(parents=True,exist_ok=True)
binary = 'tectonic.exe' if os.name == 'nt' else 'tectonic'
files = {'bin/'+binary:runtime/binary,'texlive.zip':runtime/'texlive.zip'}
for file in (runtime/'licenses').glob('*'):
    if file.is_file(): files['licenses/'+file.name]=file
module={'id':'engine-tectonic','label':'Tectonic','engine':'tectonic','kind':'engine','version':'Tectonic 0.17.0 / TeX 2022','dependencies':[],'files':{}}
partial=output.with_suffix(output.suffix+'.partial')
with zipfile.ZipFile(partial,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name,file in files.items():
        data=file.read_bytes()
        module['files'][name]={'size':len(data),'sha256':hashlib.sha256(data).hexdigest()}
        z.writestr('engine-tectonic/'+name,data)
    module['bytes']=sum(f['size'] for f in module['files'].values())
    z.writestr('pack.json',json.dumps({'schema':1,'platform':target,'release':'0.5.0','texLive':'tectonic-2022','label':'Tectonic · 离线兼容扩展','modules':[module]}))
partial.replace(output)
print(output.name,round(output.stat().st_size/1e6,1),'MB')
