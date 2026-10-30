const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { RuntimeManager } = require('../apps/desktop/runtime-manager.cjs');
(async () => {
  const runtime = path.resolve(__dirname, '../runtime');
  const metadata = JSON.parse(
    await fs.readFile(path.join(runtime, 'modular-manifest.json'), 'utf8'),
  );
  const file = path.join(runtime, 'default.texite-runtime.zip');
  const helpers = await fs.readFile(path.join(runtime, 'helpers.texite-runtime.zip'));
  if (
    !metadata.helpers ||
    helpers.length > 100_000_000 ||
    helpers.length !== metadata.helpers.bytes ||
    crypto.createHash('sha256').update(helpers).digest('hex') !== metadata.helpers.sha256
  )
    throw new Error('Auxiliary runtime checksum or 100 MB budget failed.');
  const { pack: helperPack } = await new RuntimeManager(runtime, runtime).readPack(
    path.join(runtime, 'helpers.texite-runtime.zip'),
  );
  const toolFiles = Object.keys(
    helperPack.modules.find((m) => m.id === 'tools-bibliography-index')?.files || {},
  );
  if (
    !toolFiles.some((f) => /^bin\/biber(?:\.exe)?$/.test(f)) ||
    !toolFiles.some((f) => /^bin\/makeindex(?:\.exe)?$/.test(f)) ||
    !toolFiles.some((f) => /^bin\/kpsewhich(?:\.exe)?$/.test(f)) ||
    (process.platform === 'win32' && !toolFiles.includes('bin/tlmgr.bat'))
  )
    throw new Error(
      'Biber / MakeIndex / Kpathsea auxiliary tools missing; rebuild runtime before packaging.',
    );
  await fs.access(require.resolve('@wasm-zoo/ghostscript/gs-core.wasm'));
  const data = await fs.readFile(file);
  if (
    data.length > 200_000_000 ||
    data.length !== metadata.default.bytes ||
    crypto.createHash('sha256').update(data).digest('hex') !== metadata.default.sha256
  )
    throw new Error('Default runtime checksum or 200 MB budget failed.');
  const { pack } = await new RuntimeManager(runtime, runtime).readPack(file);
  const engines = pack.modules.filter((m) => m.kind === 'engine');
  if (engines.length !== 1 || engines[0].engine !== 'pdflatex')
    throw new Error('Default installer must contain only pdfLaTeX.');
  const ids = new Set(pack.modules.map((m) => m.id));
  for (const id of [
    'pkg-ctex',
    'pkg-cjk',
    'pkg-arphic',
    'pkg-amsmath',
    'pkg-pgf',
    'pkg-pgfplots',
    'pkg-beamer',
    'pkg-booktabs',
    'pkg-hyperref',
  ])
    if (!ids.has(id)) throw new Error('Required module missing: ' + id);
  for (const module of pack.modules)
    for (const id of module.dependencies)
      if (!ids.has(id)) throw new Error('Unresolved dependency: ' + id);
  console.log(
    `Verified real pdfLaTeX / TeX Live 2025: ${(data.length / 1e6).toFixed(1)} MB; ${ids.size} independently managed modules.`,
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
