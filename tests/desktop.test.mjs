import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import workspace from '../apps/desktop/workspace.cjs';
const { safeRelative, readDirectory, saveDirectory, buildArguments, validateSnapshot } = workspace;
const project = {
  id: 'test',
  name: 'Test',
  engine: 'pdflatex',
  mainFile: 'main.tex',
  revision: 0,
  files: [{ path: 'main.tex', content: 'Hello' }],
};

test('native IPC validation prevents unsafe file names and engine injection', () => {
  for (const name of [
    '../secret',
    'C:/secret',
    '.git/config',
    'nul.tex',
    'x/../y',
    'foo:bar',
    'x.',
  ])
    assert.throws(() => safeRelative(name));
  assert.throws(() => validateSnapshot({ ...project, engine: 'pdflatex & whoami' }));
  const args = buildArguments({ ...project, mainFile: 'chapters/my paper.tex' });
  assert(args.includes('-norc'));
  assert(args.includes('-no-shell-escape'));
  assert.equal(args.at(-1), './chapters/my paper.tex');
});
test('atomic save preserves binary data and refuses conflicting external edits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'texite-test-'));
  try {
    const files = [
      ...project.files,
      {
        path: 'figures/image.png',
        binary: true,
        content: Buffer.from([0, 1, 255, 3]).toString('base64'),
      },
    ];
    await saveDirectory(root, { ...project, files });
    const opened = await readDirectory(root);
    assert.equal(
      opened.files.find((f) => f.path === 'figures/image.png').content,
      files[1].content,
    );
    await fs.writeFile(path.join(root, 'main.tex'), 'External change');
    await assert.rejects(saveDirectory(root, { ...project, files }, opened.hashes), /外部修改/);
    assert.equal(await fs.readFile(path.join(root, 'main.tex'), 'utf8'), 'External change');
  } finally {
    assert(path.basename(root).startsWith('texite-test-'));
    await fs.rm(root, { recursive: true, force: true });
  }
});
