import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import runtime from '../apps/desktop/runtime-manager.cjs';
const { RuntimeManager } = runtime;
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
