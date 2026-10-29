import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import runtime from '../apps/desktop/runtime-manager.cjs';
const { RuntimeManager } = runtime;
test('universal resource packs cannot import engine binaries or files outside texmf-dist', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/universal-pack-'));
  const manager = new RuntimeManager(base, base);
  async function write(module) {
    const zip = new JSZip();
    zip.file(
      'pack.json',
      JSON.stringify({ schema: 1, platform: 'all', texLive: '2025', modules: [module] }),
    );
    const file = path.join(base, 'invalid.zip');
    await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
    return file;
  }
  await assert.rejects(
    manager.readPack(await write({ id: 'engine-pdflatex', kind: 'engine', files: {} })),
    /不能包含引擎/,
  );
  await assert.rejects(
    manager.readPack(
      await write({
        id: 'pkg-test',
        kind: 'package',
        label: 'test',
        dependencies: [],
        files: { 'bin/test.exe': {} },
      }),
    ),
    /目录外文件/,
  );
});
test('Base35 maps use installed fonts, provide Base1 encoding and disappear after font removal', async () => {
  const base = await fs.mkdtemp(path.resolve('.qa/base35-map-'));
  const manager = new RuntimeManager(base, base);
  const config = 'texmf-dist/web2c/texmf.cnf';
  const tfm = 'texmf-dist/fonts/tfm/adobe/times/ptmb8r.tfm';
  const pfb = 'texmf-dist/fonts/type1/urw/times/utmb8a.pfb';
  const state = {
    schema: 1,
    initialized: true,
    modules: {
      'engine-pdflatex': { id: 'engine-pdflatex', files: {} },
      'texite-config': { id: 'texite-config', files: { [config]: {} } },
      'pkg-times': { id: 'pkg-times', files: { [tfm]: {}, [pfb]: {} } },
    },
  };
  for (const m of Object.values(state.modules))
    for (const file of Object.keys(m.files)) {
      const target = path.join(manager.modulePath(m.id), file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, '');
    }
  await manager.save(state);
  let env = await manager.environment('pdflatex', base);
  let map = await fs.readFile(path.join(env.cache, 'fonts/map/pdftex.map'), 'utf8');
  assert.match(map, /^ptmb8r NimbusRomNo9L-Medi .*<8r.enc <utmb8a.pfb/m);
  assert.doesNotMatch(
    map,
    /^ptmr8r /m,
    'missing metrics and outlines must not become dangling mappings',
  );
  assert.equal(
    await fs.readFile(path.join(env.cache, 'fonts/enc/8r.enc'), 'utf8'),
    await fs.readFile('apps/desktop/fonts/8r.enc', 'utf8'),
  );
  delete state.modules['pkg-times'];
  await manager.save(state);
  env = await manager.environment('pdflatex', base);
  map = await fs.readFile(path.join(env.cache, 'fonts/map/pdftex.map'), 'utf8');
  assert.doesNotMatch(map, /^ptmb8r /m);
});
test('offline module import is checked, transactional, dependency-aware and persistent', async () => {
  await fs.mkdir('.qa', { recursive: true });
  const base = await fs.mkdtemp(path.resolve('.qa/module-test-'));
  const manager = new RuntimeManager(base, path.join(base, 'installed'));
  async function pack(name, modules, modify = () => {}) {
    const zip = new JSZip();
    const rows = modules.map(([id, dependencies, content]) => {
      const file = 'texmf-dist/tex/test/' + id + '.sty';
      zip.file(id + '/' + file, content);
      return {
        id,
        label: id,
        version: 'test',
        kind: 'package',
        dependencies,
        bytes: content.length,
        files: {
          [file]: {
            size: content.length,
            sha256: crypto.createHash('sha256').update(content).digest('hex'),
          },
        },
      };
    });
    const manifest = {
      schema: 1,
      platform: process.platform + '-' + process.arch,
      texLive: '2025',
      label: 'test',
      modules: rows,
    };
    modify(manifest, zip);
    zip.file('pack.json', JSON.stringify(manifest));
    const file = path.join(base, name + '.zip');
    await fs.writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
    return file;
  }
  const valid = await pack('valid', [
    ['pkg-base', [], 'base'],
    ['pkg-extra', ['pkg-base'], 'extra'],
  ]);
  await manager.install(valid, ['pkg-extra']);
  assert.equal((await manager.list()).length, 2);
  await assert.rejects(manager.remove('pkg-base'), /仍被/);
  const wrong = await pack('wrong', [['pkg-bad', [], 'bad']], (m) => (m.platform = 'wrong'));
  await assert.rejects(manager.install(wrong), /不兼容/);
  const corrupt = await pack(
    'corrupt',
    [
      ['pkg-first', [], 'first'],
      ['pkg-bad', [], 'bad'],
    ],
    (m) => (Object.values(m.modules[1].files)[0].sha256 = '0'.repeat(64)),
  );
  await assert.rejects(manager.install(corrupt), /校验失败/);
  assert.deepEqual(
    (await manager.list()).map((m) => m.id),
    ['pkg-base', 'pkg-extra'],
  );
  const missing = await pack('missing', [['pkg-missing', ['pkg-absent'], 'test']]);
  await assert.rejects(manager.install(missing), /缺少依赖/);
  const traversal = await pack('path', [['pkg-path', [], 'test']], (m) => {
    m.modules[0].files = { '../../escape': Object.values(m.modules[0].files)[0] };
  });
  await assert.rejects(manager.install(traversal), /不安全/);
  await manager.remove('pkg-extra');
  await manager.remove('pkg-base');
  const reopened = new RuntimeManager(base, path.join(base, 'installed'));
  await reopened.init();
  assert.equal((await reopened.list()).length, 0, 'removed modules must not silently reinstall');
  await assert.rejects(reopened.environment('pdflatex', base), /不会自动切换/);
  await reopened.install(valid, ['pkg-extra']);
  assert.equal((await reopened.list()).length, 2);
});
