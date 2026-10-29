import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import repository from '../apps/desktop/package-repository.cjs';
import archive from '../apps/desktop/texlive-archive.cjs';
import runtime from '../apps/desktop/runtime-manager.cjs';
const { PackageRepository, packagePlan, missingFiles } = repository;
const { RuntimeManager } = runtime;
const noop = () => {};
const signal = () => new AbortController().signal;
async function fixture() {
  await fs.mkdir('.qa', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.qa/packages-'));
  const manager = new RuntimeManager(root, path.join(root, 'runtime'));
  await manager.save({ schema: 1, initialized: true, modules: {} });
  return { root, manager };
}
test('bundled pinned index resolves cuted and stfloats to sttools without network', async () => {
  const { root, manager } = await fixture();
  const repo = new PackageRepository(manager, root, () => {
    throw Error('must stay offline');
  });
  const catalog = await repo.loadCatalog(signal());
  assert.equal(Object.keys(catalog.packages).length, 4256);
  assert.deepEqual(catalog.files['cuted.sty'], ['pkg-sttools']);
  assert.deepEqual(catalog.files['stfloats.sty'], ['pkg-sttools']);
  assert.equal(
    catalog.packages['pkg-sttools'].paths['tex/latex/sttools/cuted.sty'],
    'texmf-dist/tex/latex/sttools/cuted.sty',
  );
  assert.deepEqual(packagePlan(catalog, ['cuted.sty'], new Set()).selected, ['pkg-sttools']);
  assert.deepEqual(packagePlan(catalog, ['cuted.sty'], new Set(['pkg-sttools'])).selected, []);
  assert.deepEqual(
    missingFiles(
      "! LaTeX Error: File `cuted.sty' not found.\n! LaTeX Error: File `../private.tex' not found.",
    ),
    ['cuted.sty'],
  );
});
test('dependency order is stable, ambiguous filenames are not guessed and cycles stop', () => {
  const catalog = {
    files: { 'a.sty': ['pkg-a'], 'amb.sty': ['pkg-a', 'pkg-b'] },
    packages: {
      'pkg-a': { dependencies: ['pkg-b'], bytes: 1 },
      'pkg-b': { dependencies: [], bytes: 1 },
    },
  };
  assert.deepEqual(packagePlan(catalog, ['a.sty'], new Set()).selected, ['pkg-b', 'pkg-a']);
  assert.deepEqual(packagePlan(catalog, ['amb.sty', 'private.tex'], new Set()).selected, []);
  catalog.packages['pkg-b'].dependencies.push('pkg-a');
  assert.throws(() => packagePlan(catalog, ['a.sty'], new Set()), /循环/);
});
test('archive preflight rejects path traversal, links and oversized contents', () => {
  const listing = '-rw-r--r--  0 root root 12 Jan 1 2025 a.sty';
  assert.deepEqual([...archive.validateEntries('a.sty\n', listing)], ['a.sty']);
  assert.throws(() => archive.validateEntries('../a.sty', listing), /不安全/);
  assert.throws(() => archive.validateEntries('a.sty', listing.replace('-rw', 'lrw')), /链接/);
  assert.throws(
    () => archive.validateEntries('a.sty', listing.replace('12 Jan', '1600000000 Jan')),
    /大小/,
  );
});
test('missing package is downloaded, verified, installed and retried; next compile stays offline', async () => {
  const { root, manager } = await fixture();
  const source = path.join(root, 'source');
  await fs.mkdir(path.join(source, 'tex/latex/test'), { recursive: true });
  await fs.writeFile(path.join(source, 'tex/latex/test/test.sty'), '% test resource');
  const filename = path.join(root, 'test.tar.xz');
  await promisify(execFile)('tar', ['-cJf', filename, '-C', source, 'tex/latex/test/test.sty']);
  const bytes = await fs.readFile(filename);
  let network = 0;
  const repo = new PackageRepository(manager, root, async () => {
    network++;
    return new Response(bytes);
  });
  repo.catalog = {
    files: { 'test.sty': ['pkg-test'] },
    packages: {
      'pkg-test': {
        label: 'test',
        archive: 'test.tar.xz',
        dependencies: [],
        bytes: bytes.length,
        sha512: crypto.createHash('sha512').update(bytes).digest('hex'),
        maps: [],
        paths: { 'tex/latex/test/test.sty': 'texmf-dist/tex/latex/test/test.sty' },
      },
    },
  };
  let attempts = 0;
  const compiler = {
    compile: async () => {
      attempts++;
      const success = (await manager.list()).some((m) => m.id === 'pkg-test');
      return { success, log: success ? 'PDF ready' : "LaTeX Error: File `test.sty' not found." };
    },
  };
  const project = { engine: 'pdflatex', revision: 1 };
  assert.equal((await repo.compile(project, compiler, noop)).success, true);
  assert.equal(attempts, 2);
  assert.equal(network, 1);
  assert.equal((await repo.compile(project, compiler, noop)).success, true);
  assert.equal(network, 1);
  assert.equal(
    await fs.readFile(
      path.join(manager.modulePath('pkg-test'), 'texmf-dist/tex/latex/test/test.sty'),
      'utf8',
    ),
    '% test resource',
  );
  await manager.remove('pkg-test');
  // Retained, verified archive supports offline reinstall after removal.
  await repo.installMissing(['test.sty'], signal(), noop);
  assert.equal(network, 1);
});
test('bad checksum, disabled downloads and cancellation do not install resources', async () => {
  const { root, manager } = await fixture();
  let calls = 0;
  const repo = new PackageRepository(manager, root, async () => {
    calls++;
    return new Response('broken');
  });
  repo.catalog = {
    files: { 'test.sty': ['pkg-test'] },
    packages: {
      'pkg-test': {
        label: 'test',
        dependencies: [],
        archive: 'test.tar.xz',
        bytes: 6,
        sha512: '0'.repeat(128),
        paths: {},
      },
    },
  };
  const compiler = {
    compile: async () => ({ success: false, log: "LaTeX Error: File `test.sty' not found." }),
  };
  let result = await repo.compile({ engine: 'pdflatex' }, compiler, noop);
  assert.match(result.log, /校验失败/);
  assert.deepEqual(await manager.list(), []);
  await repo.configure({ autoDownload: false });
  await repo.compile({ engine: 'pdflatex' }, compiler, noop);
  assert.equal(calls, 1);
  await repo.configure({ autoDownload: true });
  repo.fetcher = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
      queueMicrotask(() => repo.cancel());
    });
  result = await repo.compile({ engine: 'pdflatex' }, compiler, noop);
  assert.equal(result.cancelled, true);
  assert.equal(repo.active, null);
  assert.deepEqual(await manager.list(), []);
});
