import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  validateSnapshot,
  readDirectory,
  saveDirectory,
  Compiler,
} from '../apps/desktop/workspace.cjs';
import { jsonChunks, jsonHash, jsonBytes } from '../apps/desktop/json-stream.cjs';
import { prepareEps } from '../apps/desktop/eps-converter.cjs';

test('streamed sync JSON preserves old hashes and UTF-8 lengths without a whole-project string', () => {
  const input = {
    text: 'x'.repeat(65535) + '🚗中文\n"\\' + '\ud800',
    n: [undefined, null, true, 3],
    ignored: undefined,
  };
  const expected = JSON.stringify(input);
  assert.equal([...jsonChunks(input)].join(''), expected);
  assert.equal(jsonHash(input), createHash('sha256').update(expected).digest('hex'));
  assert.equal(jsonBytes(input), Buffer.byteLength(expected));
  assert.throws(() => jsonBytes(input, 3), /超过/);
});

test(
  '65 MiB / 602-file project imports, saves incrementally and compiles; external edits remain protected',
  { timeout: 180000 },
  async (t) => {
    await fs.mkdir('.qa', { recursive: true });
    const base = await fs.mkdtemp(path.resolve('.qa/large-project-'));
    const root = path.join(base, 'project');
    await fs.mkdir(root);
    const data = Buffer.alloc(65 * 1024 * 1024, 37);
    const project = {
      id: 'large-test',
      engine: 'pdflatex',
      mainFile: 'main.tex',
      revision: 1,
      files: [
        {
          path: 'main.tex',
          content: String.raw`\documentclass{article}\begin{document}\input{chapter-599}\end{document}`,
        },
        ...Array.from({ length: 600 }, (_, i) => ({
          path: `chapters/chapter-${i}.tex`,
          content: `Chapter ${i}.`,
        })),
        { path: 'assets/dataset.bin', content: data.toString('base64'), binary: true },
      ],
    };
    validateSnapshot(project);
    const start = performance.now();
    const hashes = await saveDirectory(root, project);
    const large = path.join(root, 'assets/dataset.bin');
    const first = (await fs.stat(large)).mtimeMs;
    const read = await readDirectory(root);
    assert.equal(read.files.length, 602);
    assert.equal(read.hashes.get('assets/dataset.bin'), hashes.get('assets/dataset.bin'));
    await saveDirectory(
      root,
      {
        ...project,
        revision: 2,
        files: project.files.map((file) =>
          file.path === 'main.tex' ? { ...file, content: file.content + '\n% changed' } : file,
        ),
      },
      hashes,
    );
    assert.equal((await fs.stat(large)).mtimeMs, first, 'unchanged binary must not be rewritten');
    const runtime = path.resolve(process.env.TEXITE_TEST_RUNTIME || 'runtime');
    if (
      await fs.access(path.join(runtime, 'default.texite-runtime.zip')).then(
        () => true,
        () => false,
      )
    ) {
      const compiler = new Compiler(path.join(base, 'compiler'), runtime);
      const result = await compiler.compile(project);
      await fs.writeFile(path.join(base, 'compile.log'), result.log);
      assert.equal(result.success, true, result.log.slice(-4000));
      assert(
        result.pdf instanceof Uint8Array,
        'native PDF transfer must not expand into a JS number array',
      );
    } else t.diagnostic('Native runtime not prepared; compile portion skipped.');
    await fs.writeFile(large, 'externally changed');
    await assert.rejects(saveDirectory(root, project, hashes), /外部修改/);
    assert.equal(await fs.readFile(large, 'utf8'), 'externally changed');
    t.diagnostic(
      JSON.stringify({
        files: 602,
        binaryMiB: 65,
        elapsedMs: Math.round(performance.now() - start),
      }),
    );
  },
);

test('EPS cache is reused, invalidated by source changes, and regenerated after corruption', async () => {
  const base = await fs.mkdtemp(path.resolve('.qa/eps-cache-test-'));
  const root = path.join(base, 'work'),
    cache = path.join(base, 'cache');
  await fs.mkdir(root);
  const eps = '%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 20 20\n0 0 20 20 rectfill\nshowpage';
  const project = { files: [{ path: 'fig.eps', content: eps }] };
  await fs.writeFile(path.join(root, 'fig.eps'), eps);
  let log = '';
  const compile = () =>
    prepareEps(
      project,
      root,
      {},
      (s) => {
        log += s;
      },
      cache,
    );
  await compile();
  log = '';
  await compile();
  assert.match(log, /复用已校验/);
  const cached = (await fs.readdir(cache)).find((f) => f.endsWith('.pdf'));
  await fs.writeFile(path.join(cache, cached), '%PDF-corrupted');
  log = '';
  await compile();
  assert.doesNotMatch(log, /复用已校验/);
  assert((await fs.stat(path.join(cache, cached))).size > 1000);
  project.files[0].content += '\n% modified';
  await fs.writeFile(path.join(root, 'fig.eps'), project.files[0].content);
  log = '';
  await compile();
  assert.doesNotMatch(log, /复用已校验/);
  const unavailableCache = path.join(base, 'not-a-directory');
  await fs.writeFile(unavailableCache, 'occupied');
  log = '';
  await prepareEps(
    project,
    root,
    {},
    (s) => {
      log += s;
    },
    unavailableCache,
  );
  assert.doesNotMatch(log, /转换失败/);
  assert((await fs.stat(path.join(root, 'fig-eps-converted-to.pdf'))).size > 1000);
});
