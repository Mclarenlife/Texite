"""Pinned TeX Live runtime modules. Downloads occur only on the build machine."""
import concurrent.futures
import hashlib
import io
import json
import lzma
import os
import platform
import re
import shutil
import subprocess
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.tools' / 'tl2025'
OUT = ROOT / 'runtime'
PACKS = ROOT / 'release' / 'engine-packs'
BASE = 'https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2025/tlnet-final'
DATABASE_SHA = '56df038e9070a3d587eeceb5def3f154b2cacccef36d4295bb49e0618977c34a'
ARCH = 'windows' if os.name == 'nt' else 'universal-darwin'
TARGET = 'win32-x64' if os.name == 'nt' else 'darwin-' + platform.machine()
for directory in [CACHE, OUT, PACKS]:
    directory.mkdir(parents=True, exist_ok=True)

def digest(data, algorithm='sha256'):
    return hashlib.new(algorithm, data).hexdigest()

def fetch(url, dest, checksum, algorithm='sha512'):
    if not dest.exists():
        part = dest.with_suffix(dest.suffix + '.part')
        subprocess.run(['curl.exe' if os.name == 'nt' else 'curl', '-fsSL', '--retry', '3', '--max-time', '180', '-o', str(part), url], check=True)
        part.replace(dest)
    if digest(dest.read_bytes(), algorithm) != checksum:
        raise RuntimeError('Checksum mismatch: ' + str(dest))
    return dest

database = ROOT / '.tools/texlive-2025.tlpdb.xz'
fetch(BASE + '/tlpkg/texlive.tlpdb.xz', database, DATABASE_SHA, 'sha256')
index = {}
for block in lzma.decompress(database.read_bytes()).decode().split('\n\n'):
    lines = block.splitlines()
    if not lines or not lines[0].startswith('name '):
        continue
    name = lines[0][5:]
    values = {}
    for line in lines[1:]:
        if line and not line.startswith(' '):
            key, _, value = line.partition(' ')
            values.setdefault(key, []).append(value)
    index[name] = values

# TeX Live's package records do not enumerate every LaTeX-level dependency.
for name, dependencies in {
    'algorithm2e':['ifoddpage','relsize','endfloat','tocbibind'],
    'adjustbox':['ifoddpage','storebox'], 'chemfig':['simplekv'],
    'siunitx':['translations'], 'tcolorbox':['tikzfill','pdfcol','incgraph','marginnote'],
    'newtx':['etextools','mweights','xstring'], 'newpx':['etextools','mweights','xstring','realscripts'],
    'circuitikz':['xstring'], 'fvextra':['upquote'], 'footmisc':['bigfoot'],
    'fontaxes':['figureversions'], 'zref':['makerobust'],
}.items():
    index[name].setdefault('depend',[]).extend(dependencies)

# Engine dependencies are selected explicitly rather than importing every engine
# through latex-bin or ctex. Excluded language/font stacks are outside this profile.
EXCLUDED = {'xetex', 'luatex', 'luahbtex', 'luaotfload', 'luatexja', 'fandol', 'pdftex',
    'tex', 'metafont', 'metapost', 'texlive-scripts', 'texlive.infra', 'latex-bin',
    'dvipdfmx', 'dvips', 'ghostscript', 'epstopdf', 'mptopdf', 'lwarp',
    'platex', 'platex-tools', 'ptex', 'ptex-base', 'ptex-fonts', 'uptex', 'uplatex',
    'zhmetrics', 'zhmetrics-uptex', 'ttfutils', 'cns', 'wadalab', 'uhc', 'fonts-tlwg',
    'garuda-c90', 'norasi-c90', 'l3build', 'luajittex', 'texlive-scripts-extra'}

def closure(roots, allow=()):
    selected = set()
    def visit(name):
        if name in selected or name.endswith('.ARCH') or name.startswith('00') or name in EXCLUDED and name not in allow:
            return
        if name not in index:
            raise ValueError('Unknown package: ' + name)
        selected.add(name)
        for dependency in index[name].get('depend', []):
            if not dependency.startswith('setting_'):
                visit(dependency)
    for name in roots:
        visit(name)
    return selected

policy = json.loads((ROOT / 'scripts/runtime-profile.json').read_text())
core = closure(['latex-bin', 'pdftex', 'kpathsea', 'hyphen-base', 'tex-ini-files', 'latexconfig', 'bibtex'], ['latex-bin', 'pdftex'])
default = closure([r for r in policy['roots'] if r not in {'fandol','xecjk'}] + ['arphic', 'cjk', 'cjkpunct', 'hyphen-english']) | core
xe = closure(['xetex', 'dvipdfmx', 'fandol', 'fontspec', 'xecjk', 'adobemapping'], ['xetex','dvipdfmx','fandol'])
lua = closure(['luahbtex', 'luatex', 'luaotfload', 'luatexja', 'chinese-jfm', 'fandol', 'fontspec'], ['luahbtex','luatex','luaotfload','luatexja','fandol'])
core, default, xe, lua = [{n for n in group if not n.startswith('collection-')} for group in (core,default,xe,lua)]
binary_roots = { 'pdflatex': ['pdftex', 'kpathsea', 'bibtex'], 'xelatex': ['xetex', 'dvipdfmx', 'kpathsea', 'bibtex'], 'lualatex': ['luahbtex', 'luatex', 'kpathsea', 'bibtex'] }
binary_packages = {p + '.' + ARCH for roots in binary_roots.values() for p in roots}
all_packages = default | xe | lua | binary_packages

def download(name):
    rec = index[name]
    if 'containerchecksum' not in rec:
        return name, None
    path = fetch(BASE + '/archive/' + name + '.tar.xz', CACHE / (name + '.tar.xz'), rec['containerchecksum'][0])
    return name, path

print(f'Downloading {len(all_packages)} pinned runtime packages (no docs or sources)...', flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    archives = dict(pool.map(download, sorted(all_packages)))

modules = {}
opentype = {}
def record(mid, label, files, dependencies=(), kind='package', **extra):
    modules[mid] = {'id': mid, 'label': label, 'version': 'TeX Live 2025 final', 'kind': kind,
        'dependencies': sorted(dependencies), 'files': files, **extra}

for name in sorted(all_packages - binary_packages):
    files = {}
    if archives[name]:
        with tarfile.open(archives[name]) as tar:
            for member in tar:
                if not member.isfile():
                    continue
                p = member.name.replace('RELOC/', 'texmf-dist/', 1)
                if index[name].get('relocated') == ['1'] and not p.startswith(('texmf-dist/', 'tlpkg/')):
                    p = 'texmf-dist/' + p
                if not p.startswith('texmf-dist/') or '/doc/' in p or '/source/' in p or '/scripts/' in p:
                    continue
                data = tar.extractfile(member).read()
                if '/fonts/opentype/' in p or '/fonts/truetype/' in p:
                    opentype[p] = data
                else:
                    files[p] = data
    dependencies = [d for d in index[name].get('depend', []) if d in all_packages - binary_packages and d not in EXCLUDED]
    maps = [v.split()[1] for v in index[name].get('execute', []) if re.match(r'add(?:Mixed)?Map ', v, re.I)]
    record('pkg-' + name, name, files, ['pkg-' + d for d in dependencies], maps=maps, core=name in core)

record('opentype-fonts', 'OpenType 字体 · Fandol / Latin Modern / TeX Gyre', opentype)
for engine, roots in binary_roots.items():
    files = {}
    for pkg in roots:
        with tarfile.open(archives[pkg + '.' + ARCH]) as tar:
            for member in tar:
                if not (member.isfile() or member.issym() or member.islnk()) or not member.name.startswith('bin/'):
                    continue
                name = PurePosixPath(member.name).name
                keep = name.endswith('.dll') or name in {'pdftex.exe','pdftex','bibtex.exe','bibtex','xetex.exe','xetex','xdvipdfmx.exe','xdvipdfmx','luahbtex.exe','luahbtex'}
                if keep:
                    files['bin/' + name] = tar.extractfile(member).read()
    # Current Windows binaries use the MSVC runtime, supplied by TL's Lua package.
    if os.name == 'nt':
        with tarfile.open(archives['luatex.windows']) as tar:
            for member in tar:
                name = PurePosixPath(member.name).name
                if member.isfile() and (name.startswith(('vcruntime','api-ms-')) or name in {'ucrtbase.dll','lua53w64.dll'}):
                    files['bin/' + name] = tar.extractfile(member).read()
    required = core | (xe if engine == 'xelatex' else lua if engine == 'lualatex' else set())
    deps = ['pkg-' + n for n in required]
    if engine != 'pdflatex':
        deps.append('opentype-fonts')
    record('engine-' + engine, {'pdflatex':'pdfLaTeX','xelatex':'XeLaTeX','lualatex':'LuaLaTeX'}[engine], files, deps + ['texite-config'], 'engine', engine=engine)

config = {
 'texmf-dist/web2c/texmf.cnf': b'''TEXINPUTS = .;$TEXMF/tex//
TFMFONTS = .;$TEXMF/fonts/tfm//
VFFONTS = .;$TEXMF/fonts/vf//
T1FONTS = .;$TEXMF/fonts/type1//
AFMFONTS = .;$TEXMF/fonts/afm//
TTFONTS = .;$TEXMF/fonts/truetype//
OPENTYPEFONTS = .;$TEXMF/fonts/opentype//
ENCFONTS = .;$TEXMF/fonts/enc//
TEXFONTMAPS = .;$TEXMF/fonts/map//
BIBINPUTS = .;$TEXMF/bibtex/bib//
BSTINPUTS = .;$TEXMF/bibtex/bst//
TEXPSHEADERS = .;$TEXMF/fonts//;$TEXMF/dvips//
TEXFORMATS = $TEXITE_FORMATS
LUAINPUTS = .;$TEXMF/tex//
CLUAINPUTS = .;$TEXMF/scripts//
CMAPFONTS = .;$TEXMF/fonts/cmap//
SFDFONTS = .;$TEXMF/fonts/sfd//
shell_escape = f
openin_any = p
openout_any = p
MKTEXFMT = 0
MKTEXPK = 0
MKTEXTFM = 0
main_memory = 5000000
extra_mem_top = 5000000
extra_mem_bot = 5000000
pool_size = 6250000
max_strings = 500000
font_mem_size = 8000000
hash_extra = 600000
buf_size = 200000
stack_size = 10000
param_size = 20000
nest_size = 1000
font_max = 9000
save_size = 200000
trie_size = 1000000
max_print_line = 1000
''',
 'texmf-dist/tex/generic/config/pdftexconfig.tex': b'\\pdfoutput=1\n\\pdfcompresslevel=9\n\\pdfdecimaldigits=3\n\\pdfpagewidth=210 true mm\n\\pdfpageheight=297 true mm\n\\pdfhorigin=1 true in\n\\pdfvorigin=1 true in\n',
 'texmf-dist/tex/generic/config/language.dat': b'english hyphen.tex\n',
 'texmf-dist/tex/generic/config/language.def': b'\\addlanguage{english}{hyphen.tex}{}{2}{3}\n',
 'texmf-dist/tex/generic/config/language.dat.lua': b"return {english={loader='hyphen.tex',lefthyphenmin=2,righthyphenmin=3}}\n",
 'texmf-dist/tex/latex/ctex/ctexopts.cfg': br'''\ExplSyntaxOn
\sys_if_engine_pdftex:TF
  { \ctex_set:nn { option } { fontset = texite } }
  { \ctex_set:nn { option } { fontset = fandol } }
\ExplSyntaxOff
''',
 'texmf-dist/tex/latex/ctex/ctex-fontset-texite.def': br'''\ProvidesExplFile{ctex-fontset-texite.def}{2026/10/13}{1.0}{Texite bundled Arphic fonts}
\ctex_zhmap_case:nnn
 { \ctex_fontset_error:n { texite } }
 {
  \ctex_set:nn { option } { zhmap = false }
  \renewcommand\CJKrmdefault{gbsn}
  \renewcommand\CJKsfdefault{gbsn}
  \renewcommand\CJKttdefault{gkai}
  \DeclareRobustCommand\songti{\CJKfamily{gbsn}}
  \DeclareRobustCommand\kaishu{\CJKfamily{gkai}}
 }
 { \ctex_fontset_error:n { texite } }
''',
}
record('texite-config', '编译配置与中文默认字体', config, [], core=True)

def bundle(label, selected, destination):
    metadata = {'schema': 1, 'platform': TARGET, 'release': '0.5.0', 'texLive': '2025', 'label': label, 'modules': []}
    partial=destination.with_suffix(destination.suffix+'.partial')
    with zipfile.ZipFile(partial, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for mid in sorted(selected):
            module = modules[mid]
            row = {k:v for k,v in module.items() if k != 'files'}
            row['files'] = {}
            for name, data in sorted(module['files'].items()):
                row['files'][name] = {'size':len(data), 'sha256':digest(data)}
                z.writestr(mid + '/' + name, data)
            row['bytes'] = sum(f['size'] for f in row['files'].values())
            metadata['modules'].append(row)
        z.writestr('pack.json', json.dumps(metadata, ensure_ascii=False))
    partial.replace(destination)
    print(destination.name, f'{destination.stat().st_size / 1e6:.1f} MB, {len(selected)} modules', flush=True)
    return {'name':destination.name, 'sha256':digest(destination.read_bytes()), 'bytes':destination.stat().st_size}

default_ids = {'pkg-' + n for n in default} | {'engine-pdflatex', 'texite-config'}
artifacts = []
artifacts.append(bundle('pdfLaTeX · 中文与常用宏包', default_ids, OUT / 'default.texite-runtime.zip'))
if artifacts[0]['bytes'] > 200_000_000:
    raise RuntimeError('Default runtime exceeds the 200 MB budget.')
shutil.copyfile(OUT / 'default.texite-runtime.zip', PACKS / f'Texite-0.5.0-pdflatex-{TARGET}.texite-runtime.zip')
for engine, pkgs in [('xelatex',xe),('lualatex',lua)]:
    ids = {'pkg-' + n for n in pkgs} | {'engine-' + engine, 'opentype-fonts'}
    artifacts.append(bundle(engine + ' · 离线扩展', ids - default_ids, PACKS / f'Texite-0.5.0-{engine}-{TARGET}.texite-runtime.zip'))
(OUT / 'modular-manifest.json').write_text(json.dumps({'schema':1,'platform':TARGET,'texLive':'2025','databaseSha256':DATABASE_SHA,'default':artifacts[0]},indent=2))
(PACKS / f'checksums-{TARGET}.json').write_text(json.dumps(artifacts,indent=2))
licenses=OUT/'licenses'
licenses.mkdir(exist_ok=True)
shutil.copyfile(ROOT/'docs/runtime-notices.txt',licenses/'NOTICE.txt')
(licenses/'TeX-Live-packages.json').write_text(json.dumps({n:{'revision':index[n].get('revision'),'archive':BASE+'/archive/'+n+'.tar.xz','sha512':index[n].get('containerchecksum'),'source':BASE+'/archive/'+n+'.source.tar.xz','documentation':BASE+'/archive/'+n+'.doc.tar.xz'} for n in sorted(all_packages)},indent=2))
